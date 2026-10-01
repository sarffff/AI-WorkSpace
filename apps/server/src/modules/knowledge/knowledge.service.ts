import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAIEmbeddings } from '@langchain/openai'
import * as mammoth from 'mammoth'
import OpenAI from 'openai'
import { Prisma } from '@prisma/client'
import { PrismaService } from '@/prisma/prisma.service'
import { SettingsService } from '@/modules/settings/settings.service'
import { LlmClient } from '@/common/llm-client'
import { EmbeddingsClient } from '@/common/embeddings'
import {
  extractGapCandidates,
  planGapSync,
  summarizeGapBoard,
  summarizeGaps,
  type GapRecord,
  type GapStatus,
} from './knowledge-gap'
import { IndexingQueueService } from './indexing-queue.service'
import { UploadPayloadStore } from './upload-payload.store'
import { chunkDocument, ChunkConfig } from './chunking'
import { tokenize } from './bm25'
import {
  coarseRank,
  fallbackRank,
  HitChunk,
  LeafInput,
  rankCandidates,
  RetrievalIndex,
  RetrievalIndexCache,
  scopeKeyOf,
} from './retrieval-index'
import { cleanText, detectMojibake } from './cleaning'

// 单文件上传体积上限（env KNOWLEDGE_MAX_UPLOAD_MB，默认 20MB）。
// 由 controller 的 FileInterceptor limits 拦在读入内存之前，service 再做一次兜底断言。
const uploadMb = parseInt(process.env.KNOWLEDGE_MAX_UPLOAD_MB ?? '', 10)
export const MAX_UPLOAD_BYTES =
  (Number.isFinite(uploadMb) && uploadMb > 0 ? uploadMb : 20) * 1024 * 1024

// 语料检索索引的存活时间（env RAG_INDEX_TTL_MS，默认 30s）。
// 同进程内的语料变更靠代数失效即时可见，TTL 只为多进程部署兜底，不宜设长。
const indexTtlMs = parseInt(process.env.RAG_INDEX_TTL_MS ?? '', 10)
export const RETRIEVAL_INDEX_TTL_MS =
  Number.isFinite(indexTtlMs) && indexTtlMs >= 0 ? indexTtlMs : 30_000

export interface RagHit {
  content: string
  score: number
  documentId: string
  documentName: string
  /** 结构切块记录的章节路径（如 "VPN 排查 > 连接失败"），供引用溯源展示 */
  sectionPath?: string | null
}

type ChunkWithDoc = Prisma.KnowledgeChunkGetPayload<{
  include: { document: { select: { name: true } } }
}>

// 当前用户可见的文档过滤条件：
// 本人上传 ∪ 本部门共享；管理员可见全部（行级权限在检索阶段生效）
function visibleDocFilter(user: { id: string; role: string; department: string | null }) {
  if (user.role === 'admin') return {}
  const or: Record<string, unknown>[] = [{ userId: user.id }]
  if (user.department) or.push({ department: user.department })
  return { OR: or }
}

// 数据库行 → 流水线内部形状：文档名拍平，使来自索引的叶子与来自库的父块可同构处理
function toHitChunk(row: ChunkWithDoc): HitChunk {
  return {
    id: row.id,
    documentId: row.documentId,
    documentName: row.document.name,
    sectionPath: row.sectionPath,
    content: row.content,
  }
}

// 支持解析的扩展名 → 抽取方式
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'ts',
  'js',
  'jsx',
  'tsx',
  'py',
  'java',
  'go',
  'html',
  'css',
  'yml',
  'yaml',
  'xml',
  'log',
  'sql',
  'sh',
  'bat',
  'ini',
  'toml',
])

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name)
  private rewriteClient: OpenAI | null = null

  // 语料变更后自增，缓存见到代数变化即整体作废（详见 RetrievalIndexCache）
  private indexGeneration = 0
  private readonly indexCache = new RetrievalIndexCache(RETRIEVAL_INDEX_TTL_MS)

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private llmClient: LlmClient,
    private embeddingsClient: EmbeddingsClient,
    private settingsService: SettingsService,
    private readonly queue: IndexingQueueService,
    private readonly payloads: UploadPayloadStore,
  ) {}

  // 注册后台处理函数：队列消费时执行完整索引流水线
  onModuleInit() {
    this.queue.registerHandler((documentId, buffer) => this.processDocument(documentId, buffer))
    void this.recoverInterruptedIndexing().catch((err: unknown) => {
      // 恢复只是收尾，失败不应阻塞启动
      this.logger.error(`启动恢复失败: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  // 重启会丢掉内存队列：索引到一半的文档在库里仍停在 processing，前端无限轮询「处理中」。
  // 原文件字节已落盘的 → 重新入队续跑（用户不用重传）；取不回的 → 收敛为 failed，
  // 至少状态是诚实的、可操作的。
  // 宽限期（默认 10 分钟）不只是保守：Document 没有 updatedAt，只能拿 createdAt 判新旧，
  // 而多实例部署下另一实例正在索引的文档在库里同样是「创建很久的 processing」。
  private async recoverInterruptedIndexing() {
    const graceMs = this.intEnv('RAG_INDEX_STALE_GRACE_MIN', 10) * 60_000
    const stranded = await this.prisma.document.findMany({
      where: { status: 'processing', createdAt: { lt: new Date(Date.now() - graceMs) } },
      select: { id: true, name: true },
    })
    // 一次 read 定分档：取到字节 → 续跑；确认没有 → 判失败；读取出错 → 什么都别做
    // （磁盘抖动不该把一个本可恢复的文档直接判死，保持 processing 下次重启再试）
    const resumable: { id: string; name: string; buffer: Buffer }[] = []
    const abandoned: typeof stranded = []
    const unknown: typeof stranded = []
    for (const doc of stranded) {
      try {
        const buffer = await this.payloads.read(doc.id)
        if (buffer) resumable.push({ ...doc, buffer })
        else abandoned.push(doc)
      } catch (err) {
        this.logger.warn(
          `读取上传副本失败，本轮不处理 ${doc.name}: ` +
            (err instanceof Error ? err.message : String(err)),
        )
        unknown.push(doc)
      }
    }

    if (abandoned.length > 0) {
      await this.prisma.document.updateMany({
        where: { id: { in: abandoned.map((d) => d.id) } },
        data: { status: 'failed' },
      })
      this.logger.warn(
        `启动恢复：${abandoned.length} 个文档索引中断且原文件已不可得，置为 failed（需重新上传）：` +
          abandoned.map((d) => d.name).join(', '),
      )
    }

    // 逐个重排：队列本身单消费者顺序执行，这里只是把字节读回来排队
    for (const doc of resumable) {
      this.queue.enqueue(doc.id, doc.buffer)
    }
    if (resumable.length > 0) {
      this.logger.log(
        `启动恢复：${resumable.length} 个中断的索引任务已重新入队续跑` +
          (unknown.length ? `，${unknown.length} 个待下次重试` : ''),
      )
    }
  }

  // 懒加载 embedding 客户端（共享 EmbeddingsClient；未配置 API Key 时明确报错，
  // 由索引流水线/检索调用方按各自策略处理）
  private getEmbeddings(): OpenAIEmbeddings {
    const client = this.embeddingsClient.get()
    if (!client) {
      throw new Error('embedding 未配置（EMBEDDING_API_KEY 或 LLM_API_KEY），无法执行向量化')
    }
    return client
  }

  // ===== 切块/检索参数（环境变量为全局默认，Setting 表可按用户覆盖检索参数）=====

  // 索引切块参数（全局，重新上传文档生效）
  private chunkConfig(): ChunkConfig {
    return {
      parentSize: this.intEnv('RAG_PARENT_SIZE', 600),
      parentOverlap: this.intEnv('RAG_PARENT_OVERLAP', 100),
      leafSize: this.intEnv('RAG_LEAF_SIZE', 250),
      leafOverlap: this.intEnv('RAG_LEAF_OVERLAP', 50),
    }
  }

  private intEnv(key: string, def: number): number {
    const v = this.configService.get<string>(key)
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) && n > 0 ? n : def
  }

  private async settingInt(userId: string, key: string, def: number): Promise<number> {
    const v = await this.settingsService.get(userId, key)
    const n = v ? parseInt(v, 10) : NaN
    return Number.isFinite(n) && n > 0 ? n : def
  }

  private async settingNum(userId: string, key: string, def: number): Promise<number> {
    const v = await this.settingsService.get(userId, key)
    const n = v ? parseFloat(v) : NaN
    return Number.isFinite(n) ? n : def
  }

  private async settingOn(userId: string, key: string, def: boolean): Promise<boolean> {
    const v = (await this.settingsService.get(userId, key)).toLowerCase()
    if (v === 'on' || v === 'true' || v === '1') return true
    if (v === 'off' || v === 'false' || v === '0') return false
    return def
  }

  // 上下文前缀（Contextual Retrieval 简化版）：文档名 > 章节路径 + 正文。
  // 索引与检索两侧用同一拼接函数，保证嵌入/BM25/Rerank 所见文本一致。
  private prefixedText(docName: string, sectionPath: string | null, content: string): string {
    const prefix = sectionPath ? `${docName} > ${sectionPath}` : docName
    return `${prefix}\n${content}`
  }

  // ===== 文档管理（按用户/部门隔离）=====

  async getDocuments(user: { id: string; role: string; department: string | null }) {
    const docs = await this.prisma.document.findMany({
      where: visibleDocFilter(user),
      orderBy: { createdAt: 'desc' },
    })
    return docs.map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      chunks: d.chunks,
      status: d.status,
      department: d.department,
      ownerId: d.userId,
      // 处理中的文档附带队列进度（前端轮询渲染）
      progress: d.status === 'processing' ? this.queue.get(d.id) : undefined,
    }))
  }

  // 上传：仅做同步校验 + 落库（processing）+ 入队，立即返回
  // 重活（抽取/切块/向量化/入库）由 IndexingQueueService 后台顺序执行
  async uploadDocument(
    user: { id: string; role: string; department: string | null },
    file: Express.Multer.File,
    department?: string,
  ) {
    if (!file) throw new BadRequestException('未收到文件')
    // 兜底断言：正常路径由 FileInterceptor limits 拦截，此处防御绕过/未配置拦截器的调用
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `文件过大，单个文件不得超过 ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB`,
      )
    }
    const name = file.originalname || 'untitled'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    this.assertSupportedExt(ext)
    return this.ingestDocument(user, name, file.buffer, department)
  }

  // 文本建文档：与上传同一条索引流水线，内容直接以 utf8 字节入队。
  // 知识运营闭环的入口：缺口候选草稿一键晋升、坐席随手补一篇 SOP 都走这里 ——
  // 此前只有 multipart 上传，候选草稿必须先落成本地文件才能入库，飞轮转不起来。
  // 只接受文本类扩展名（缺省补 .md）：文本入口不该收到 pdf/docx 二进制
  async createDocumentFromText(
    user: { id: string; role: string; department: string | null },
    input: { name: string; content: string; department?: string; fromGapTicketId?: string },
  ) {
    const content = input.content?.trim() ?? ''
    if (content.length < 20) {
      throw new BadRequestException('文档正文至少 20 字，请把解决步骤写完整')
    }
    const buffer = Buffer.from(input.content, 'utf8')
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `内容过大，单篇不得超过 ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB`,
      )
    }
    let name = input.name?.trim() || 'untitled.md'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (!TEXT_EXTS.has(ext)) name = `${name}.md`
    const doc = await this.ingestDocument(user, name, buffer, input.department)

    // 闭环就发生在这一刻：从缺口草稿晋升出来的文档一落地，那条缺口记为已成文，
    // 出处就是它。记账失败不影响成文 —— 缺口没标上是台账的问题，不是内容的问题，
    // 反过来（为了记账把已写好的文档吐回去）才是要命的
    if (input.fromGapTicketId) {
      try {
        await this.setGapStatus(user, input.fromGapTicketId, {
          status: 'covered',
          documentId: doc.id,
          note: '由缺口草稿成文',
        })
      } catch (err) {
        this.logger.warn(
          `缺口成文记账失败 ticket=${input.fromGapTicketId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }
    return doc
  }

  // 入库公共路径：落库 processing → 字节落盘（重启续跑）→ 入队后台索引
  private async ingestDocument(
    user: { id: string; department: string | null },
    name: string,
    buffer: Buffer,
    department?: string,
  ) {
    const shareDept = department && department === user.department ? department : null

    const doc = await this.prisma.document.create({
      data: {
        userId: user.id,
        department: shareDept,
        name,
        size: buffer.byteLength,
        chunks: 0,
        status: 'processing',
      },
    })

    // 先把原始字节落盘再入队：内存队列一重启就没了，落盘后才有「续跑」这回事。
    // 写失败不阻断上传（本轮仍在内存里，能正常索引），只是这份文档失去重启续跑能力
    await this.payloads.write(doc.id, buffer)

    this.queue.enqueue(doc.id, buffer)

    return {
      id: doc.id,
      name: doc.name,
      size: doc.size,
      chunks: doc.chunks,
      status: doc.status,
      department: doc.department,
      ownerId: doc.userId,
      progress: this.queue.get(doc.id),
    }
  }

  // 后台索引流水线：抽取 → 清洗 → 结构切块（父块+叶子块）→ 上下文前缀向量化 → 入库，全程更新进度
  private async processDocument(documentId: string, buffer: Buffer) {
    const doc = await this.prisma.document.findUnique({ where: { id: documentId } })
    if (!doc) return
    const ext = doc.name.split('.').pop()?.toLowerCase() || ''

    try {
      this.queue.update(documentId, { stage: 'extracting', percent: 10 })
      const raw = await this.extractText(
        { buffer, originalname: doc.name, size: doc.size } as Express.Multer.File,
        ext,
      )

      // 数据清洗：页码/页脚噪声、重复行、HTML 标签、密钥脱敏、空白归一（详见 cleaning.ts）
      const text = cleanText(raw, ext)
      const mojibake = detectMojibake(text)
      if (mojibake) this.logger.warn(`mojibake in "${doc.name}": ${mojibake}`)

      // 扫描件 PDF 抽不出文本：快速失败并给出明确原因，避免存一堆垃圾向量
      if (ext === 'pdf' && text.trim().length < 20) {
        throw new BadRequestException('PDF 未抽取到有效文本，扫描件需要先经过 OCR 处理')
      }

      this.queue.update(documentId, { stage: 'chunking', percent: 35 })
      const { parents, leaves } = await chunkDocument(text, ext, this.chunkConfig())
      if (parents.length === 0) {
        throw new BadRequestException('未能从文件中抽取到文本内容')
      }

      this.queue.update(documentId, { stage: 'embedding', percent: 50, chunks: leaves.length })
      // 叶子块带上下文前缀（文档名 > 章节路径）嵌入，缓解「无头片段」语义丢失
      const leafTexts = leaves.map((l) => this.prefixedText(doc.name, l.sectionPath, l.content))
      const vectors = await this.getEmbeddings().embedDocuments(leafTexts)

      this.queue.update(documentId, { stage: 'storing', percent: 85, chunks: parents.length })
      // 先存父块（embedding 为空，喂给 LLM），再存叶子块（带向量，参与检索）
      const parentRows = await this.prisma.$transaction(
        parents.map((p, i) =>
          this.prisma.knowledgeChunk.create({
            data: {
              documentId,
              parentId: null,
              index: i,
              content: p.content,
              sectionPath: p.sectionPath,
            },
          }),
        ),
      )
      await this.prisma.$transaction(
        leaves.map((l, i) =>
          this.prisma.knowledgeChunk.create({
            data: {
              documentId,
              parentId: parentRows[l.parentIndex].id,
              index: i,
              content: l.content,
              sectionPath: l.sectionPath,
              embedding: vectors[i],
            },
          }),
        ),
      )

      await this.prisma.document.update({
        where: { id: documentId },
        data: { chunks: parents.length, status: 'indexed' },
      })
      // 新叶子上线：语料索引必须作废，否则刚上传的文档在 TTL 内检索不到
      this.invalidateRetrievalIndex()
      // 已进终态：删掉原文件副本，否则磁盘只增不减
      await this.payloads.remove(documentId)
      this.queue.update(documentId, { stage: 'done', percent: 100, chunks: parents.length })
      this.logger.log(`indexed "${doc.name}": ${parents.length} parents / ${leaves.length} leaves`)
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
      this.logger.error(`index failed for "${doc.name}": ${errorMessage}`)
      await this.prisma.document
        .update({ where: { id: documentId }, data: { status: 'failed' } })
        .catch(() => {})
      // 失败也是终态（用户可重新上传）：留着副本只会在下次启动把一个已判失败的文档再跑一遍
      await this.payloads.remove(documentId)
      this.queue.update(documentId, { stage: 'failed', percent: 100, error: errorMessage })
      throw err
    }
  }

  // 删除文档（仅限本人或管理员）
  async deleteDocument(user: { id: string; role: string }, id: string) {
    const existing = await this.prisma.document.findUnique({ where: { id } })
    if (!existing || (existing.userId !== user.id && user.role !== 'admin')) {
      throw new NotFoundException('文档不存在')
    }
    await this.prisma.document.delete({ where: { id } })
    // 级联删掉了该文档全部块：不清索引的话已删内容仍可能被检出并作为引用展示
    this.invalidateRetrievalIndex()
    // 副本也要删：否则一个已删文档会在下次启动时被当作中断任务重新索引回来
    await this.payloads.remove(id)
    return { success: true }
  }

  // ===== 向量检索（RAG，行级权限过滤后仅在可见语料中检索）=====

  // 取当前可见范围的语料索引（同范围多次检索复用，语料变更后代数失效重建）
  private async getRetrievalIndex(user: {
    id: string
    role: string
    department: string | null
  }): Promise<RetrievalIndex> {
    return this.indexCache.resolve(scopeKeyOf(user), this.indexGeneration, () =>
      this.buildRetrievalIndex(user),
    )
  }

  // 语料变更（索引完成 / 删除文档）后调用：同进程内的下一次检索立即重建
  private invalidateRetrievalIndex() {
    this.indexGeneration++
  }

  // 行级权限仍由 SQL 过滤（本人上传 ∪ 本部门共享，管理员全量），
  // 缓存键只用于复用同一可见范围下必然一致的结果
  private async buildRetrievalIndex(user: {
    id: string
    role: string
    department: string | null
  }): Promise<RetrievalIndex> {
    // 加载可见叶子块（旧版单级块 embedding 非空且 parentId 为空 → 视为叶子，命中后返回自身）
    const rows = await this.prisma.knowledgeChunk.findMany({
      where: {
        embedding: { not: Prisma.DbNull },
        document: { status: 'indexed', ...visibleDocFilter(user) },
      },
      include: { document: { select: { name: true } } },
    })
    // 叶子文本 = 上下文前缀 + 正文（与索引侧拼接一致）
    const inputs: LeafInput[] = rows.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      documentId: c.documentId,
      documentName: c.document.name,
      sectionPath: c.sectionPath,
      content: c.content,
      leafText: this.prefixedText(c.document.name, c.sectionPath, c.content),
      embedding: c.embedding as number[] | null,
    }))
    return new RetrievalIndex(inputs)
  }

  // 混合检索流水线：
  // 查询改写 → 稠密余弦（语义门控） + 本地 BM25（词法召回） → RRF 融合 → 去重到父块
  // → Reranker 精排（可选，失败回退 RRF）→ Top-K 父块（附来源文档/章节路径）
  async searchRelevant(
    user: { id: string; role: string; department: string | null },
    query: string,
    topK?: number,
    // 定标探针用：覆盖语义门阈值与是否精排。要观测的恰恰是被门挡掉的那部分分数分布，
    // 用线上配置去跑只会看到「门后剩下什么」，量不出门该放在哪
    opts: { minScore?: number; rerank?: boolean } = {},
  ): Promise<RagHit[]> {
    // 参数配置化：显式 topK > Setting 表 > 环境变量 > 默认
    const [cfgTopK, cfgMinScore, coarseTopK, cfgRerank, useRewrite] = await Promise.all([
      this.settingInt(user.id, 'ragTopK', 4),
      this.settingNum(user.id, 'ragMinScore', 0.25),
      this.settingInt(user.id, 'ragCoarseTopK', 20),
      this.settingOn(user.id, 'ragRerank', true),
      this.settingOn(user.id, 'ragQueryRewrite', true),
    ])
    const minScore = opts.minScore ?? cfgMinScore
    const useRerank = opts.rerank ?? cfgRerank
    const finalTopK = Math.min(Math.max(topK ?? cfgTopK, 1), 10)

    // 查询改写：口语化提问 → 知识库风格检索语句（HyDE 简化版，仅降级检索词）
    let searchQuery = query
    if (useRewrite) {
      const rewritten = await this.rewriteQuery(user.id, query)
      if (rewritten && rewritten !== query) {
        searchQuery = rewritten
        this.logger.log(`query rewritten: "${query}" → "${rewritten}"`)
      }
    }

    // 语料索引按可见范围缓存复用：省去每次检索全量读回 content + Json 向量、
    // 现场分词与现场归一化
    const index = await this.getRetrievalIndex(user)
    if (index.size === 0) return []

    // 排序主体（稠密 + 稀疏 + RRF 融合 + 折叠到父块 + 回退门）全走 retrieval-index 的
    // 纯函数，与离线评测同一实现。向量已在构建期 L2 归一化，比较退化为点积，结果与余弦一致
    const queryVector = await this.getEmbeddings().embedQuery(searchQuery)
    const coarse = coarseRank(index, queryVector, tokenize(searchQuery), minScore, coarseTopK)
    if (coarse.length === 0) return []

    // 只有粗排候选的父块需要正文，按 id 精确取回，不随语料规模膨胀
    const parentIds = [
      ...new Set(coarse.map((c) => c.parentId).filter((id): id is string => Boolean(id))),
    ]
    const parentRows = parentIds.length
      ? await this.prisma.knowledgeChunk.findMany({
          where: {
            id: { in: parentIds },
            document: { status: 'indexed', ...visibleDocFilter(user) },
          },
          include: { document: { select: { name: true } } },
        })
      : []
    const parentById = new Map<string, HitChunk>(parentRows.map((p) => [p.id, toHitChunk(p)]))
    const deduped = rankCandidates(index, parentById, coarse)

    // Reranker 精排（默认开；未配置/失败时回退 RRF 排序）
    let ranked: { parent: HitChunk; score: number }[] = []
    let reranked = false
    if (useRerank && deduped.length > 1) {
      const docs = deduped.map((d) =>
        this.prefixedText(d.parent.documentName, d.parent.sectionPath, d.parent.content),
      )
      const scores = await this.rerank(searchQuery, docs, finalTopK)
      if (scores) {
        reranked = true
        // 终筛：bge-reranker 对无关片段的输出 ≈0（0.00x），过滤后可避免负例误召回
        ranked = deduped
          .map((d, i) => ({ d, s: scores.get(i) ?? -1 }))
          .filter((x) => x.s > 0.01)
          .sort((a, b) => b.s - a.s)
          .slice(0, finalTopK)
          .map((x) => ({ parent: x.d.parent, score: x.s }))
      }
    }
    if (!reranked) {
      // 回退门控与离线评测共用 fallbackRank：语义相关或词法命中靠前才保留，按融合分取 Top-K
      ranked = fallbackRank(deduped, { minScore, finalTopK })
    }

    return ranked.map((h) => ({
      content: h.parent.content,
      score: Math.round(h.score * 1000) / 1000,
      documentId: h.parent.documentId,
      documentName: h.parent.documentName,
      sectionPath: h.parent.sectionPath ?? null,
    }))
  }

  // Reranker：POST {base}/rerank（OpenAI 兼容网关通用格式，SiliconFlow bge-reranker-v2-m3）
  // 返回 Map<候选下标, 相关度>；未配置/调用失败返回 null（调用方回退 RRF 排序）
  private async rerank(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<Map<number, number> | null> {
    const baseUrl =
      this.configService.get<string>('RERANK_BASE_URL') ||
      this.configService.get<string>('EMBEDDING_BASE_URL') ||
      this.configService.get<string>('LLM_API_URL') ||
      ''
    const apiKey =
      this.configService.get<string>('RERANK_API_KEY') ||
      this.configService.get<string>('EMBEDDING_API_KEY') ||
      this.configService.get<string>('LLM_API_KEY') ||
      ''
    if (!baseUrl || !apiKey) return null
    const model = this.configService.get<string>('RERANK_MODEL') || 'BAAI/bge-reranker-v2-m3'
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/rerank`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          query,
          documents: documents.map((d) => d.slice(0, 4000)),
          top_n: topN,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
      }
      const data = (await res.json()) as { results?: { index: number; relevance_score: number }[] }
      const map = new Map<number, number>()
      for (const r of data.results ?? []) map.set(r.index, r.relevance_score)
      this.logger.log(`rerank: ${map.size} scores for "${query.slice(0, 40)}"`)
      return map
    } catch (err) {
      this.logger.warn(
        `rerank unavailable (${err instanceof Error ? err.message : 'unknown'}), fallback to RRF`,
      )
      return null
    }
  }

  // 查询改写（HyDE 简化版）：用环境变量配置的 LLM 把口语化提问改写为检索语句。
  // 开关：Setting 表 ragQueryRewrite 或环境变量 RAG_QUERY_REWRITE（默认 on）
  // LLM 调用走 LlmClient 封装（超时/重试/备用模型降级），失败回退原查询
  private async rewriteQuery(userId: string, query: string): Promise<string> {
    const client = this.getRewriteClient()
    if (!client) return query
    try {
      const modelChain = this.llmClient.modelChain(
        this.configService.get<string>('LLM_API_MODEL') || 'GLM-4-Flash',
      )
      const { completion } = await this.llmClient.complete(client, modelChain, {
        temperature: 0,
        max_tokens: 128,
        messages: [
          {
            role: 'system',
            content: `你是企业知识库的检索查询改写助手。把用户的提问改写成 1 句适合在知识库中检索的独立查询语句：保留关键名词、编号、专业术语与操作步骤词，删除口语化表达与冗余；若原句已适合检索则原样返回。只输出改写后的查询，不要任何解释或前缀。

示例 1（口语化→检索词）
用户提问: 我电脑连不上网了，急死了，怎么弄
改写结果: VPN 连接失败 排查步骤

示例 2（流程类）
用户提问: 报销单要盖几个章啊
改写结果: 报销流程 审批盖章要求

示例 3（编号/专有名词）
用户提问: 那个 A-302 会议室能坐几个人
改写结果: A-302 会议室 容纳人数

示例 4（错误码）
用户提问: 老报错 ERR-4012 是什么情况
改写结果: ERR-4012 错误 处理方法

示例 5（已适合检索，原样返回）
用户提问: 请假流程需要哪些审批人
改写结果: 请假流程需要哪些审批人`,
          },
          { role: 'user', content: query },
        ],
      })
      const out = (completion.choices[0]?.message?.content || '').trim()
      return out && out.length <= 200 ? out : query
    } catch (err) {
      this.logger.warn(
        `query rewrite failed (${err instanceof Error ? err.message : 'unknown'}), use original`,
      )
      return query
    }
  }

  // 懒加载查询改写客户端（环境变量配置，与 embedding 同为全局共享）
  private getRewriteClient(): OpenAI | null {
    if (this.rewriteClient) return this.rewriteClient
    const apiKey = this.configService.get<string>('LLM_API_KEY') || ''
    if (!apiKey) return null
    this.rewriteClient = new OpenAI({
      baseURL:
        this.configService.get<string>('LLM_API_URL') || 'https://open.bigmodel.cn/api/paas/v4/',
      apiKey,
    })
    return this.rewriteClient
  }

  // ===== 文本抽取 =====

  private assertSupportedExt(ext: string) {
    if (ext !== 'pdf' && ext !== 'docx' && !TEXT_EXTS.has(ext)) {
      throw new BadRequestException(`不支持的文件类型: .${ext || 'unknown'}`)
    }
  }

  private async extractText(file: Express.Multer.File, ext: string): Promise<string> {
    if (ext === 'pdf') {
      // pdf-parse 必须惰性 CJS require：该包被 ESM 方式加载时会进入 debug 模式
      // （module.parent 为空 → 尝试读取包内测试 PDF → 崩溃）
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text: string }>
      const parsed = await pdfParse(file.buffer)
      return parsed.text
    }
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer })
      return result.value
    }
    if (TEXT_EXTS.has(ext)) {
      let text = file.buffer.toString('utf8')
      // UTF-8 严格解码出现替换符（U+FFFD）→ 中文遗留文件常为 GBK 编码，回退重解码
      if (text.includes('\uFFFD')) {
        try {
          text = new TextDecoder('gbk').decode(file.buffer)
        } catch {
          // 无 gbk decoder（非 Node 环境）时保留原样
        }
      }
      return text
    }
    return file.buffer.toString('utf8')
  }

  // ===== 知识回流：AI 接不住、人工解决了的问题 = 文档缺口 =====

  /**
   * 待补文档候选清单。仅坐席/管理员 —— 内容含工单原文与处理结论，不是全员可见的信息。
   *
   * 判定与草稿生成都住在 knowledge-gap.ts（纯函数，14 个用例钉着）；这里只把
   * Ticket / Message / AgentRun 三张表拼成它要的输入，不掺任何判断逻辑。
   */
  async getGapCandidates(user: { role: string }, days = 30, limit = 50) {
    if (user.role !== 'agent' && user.role !== 'admin') {
      throw new ForbiddenException('仅坐席/管理员可查看知识缺口清单')
    }
    const since = new Date(Date.now() - days * 86_400_000)
    const capped = Math.min(Math.max(Math.round(limit) || 50, 1), 200)

    const tickets = await this.prisma.ticket.findMany({
      where: {
        source: 'agent',
        chatId: { not: null },
        status: { in: ['resolved', 'closed'] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: capped,
      // kind='comment' 才是人工留言；系统事件（受理、状态流转）不是处理结论
      include: {
        comments: {
          where: { kind: 'comment' },
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        },
      },
    })
    const chatIds = [...new Set(tickets.map((t) => t.chatId).filter((c): c is string => !!c))]
    const ticketIds = tickets.map((t) => t.id)

    const [userMsgs, runs, unlinked] = await Promise.all([
      chatIds.length
        ? this.prisma.message.findMany({
            where: { chatId: { in: chatIds }, role: 'user' },
            orderBy: { createdAt: 'asc' },
            select: { chatId: true, content: true },
          })
        : Promise.resolve([]),
      ticketIds.length
        ? this.prisma.agentRun.findMany({
            where: { ticketId: { in: ticketIds } },
            orderBy: { createdAt: 'asc' },
            select: { ticketId: true, sources: true },
          })
        : Promise.resolve([]),
      // 追不到会话的已解决 AI 工单：清单可能不完整，这个数要摆在台面上
      this.prisma.ticket.count({
        where: {
          source: 'agent',
          chatId: null,
          status: { in: ['resolved', 'closed'] },
          createdAt: { gte: since },
        },
      }),
    ])

    // 同一工单可能有多条运行（反思轮各落一条时取最后一次的命中数）
    const hitsByTicket = new Map<string, number>()
    for (const r of runs) {
      if (r.ticketId) hitsByTicket.set(r.ticketId, r.sources)
    }
    const questionsByChat = new Map<string, string[]>()
    for (const m of userMsgs) {
      questionsByChat.set(m.chatId, [...(questionsByChat.get(m.chatId) ?? []), m.content])
    }

    const candidates = extractGapCandidates(
      tickets.map((t) => ({
        id: t.id,
        title: t.title,
        content: t.content,
        category: t.category,
        chatId: t.chatId,
        status: t.status,
        createdAt: t.createdAt,
        humanComments: t.comments.map((c) => c.content),
        userQuestions: questionsByChat.get(t.chatId ?? '') ?? [],
        ragHits: t.id ? (hitsByTicket.get(t.id) ?? null) : null,
      })),
    )

    // 台账同步：只为没见过的 ticketId 建行。已有行代表有人处置过（成文/不补），
    // 一次重算没有资格替人改回来 —— 所以既不覆盖也不删除。
    const ledger = await this.prisma.knowledgeGap.findMany({
      select: {
        ticketId: true,
        chatId: true,
        category: true,
        question: true,
        reason: true,
        hasSolution: true,
        status: true,
        closedAt: true,
        closedDocId: true,
        firstSeenAt: true,
      },
      orderBy: { firstSeenAt: 'asc' },
    })
    const knownRows: GapRecord[] = ledger.map((r) => ({
      ticketId: r.ticketId,
      chatId: r.chatId,
      category: r.category,
      question: r.question,
      reason: r.reason as GapRecord['reason'],
      hasSolution: r.hasSolution,
      status: r.status as GapRecord['status'],
      closedAt: r.closedAt,
      closedDocId: r.closedDocId,
      firstSeenAt: r.firstSeenAt,
    }))
    const planned = planGapSync(candidates, knownRows)
    if (planned.length > 0) {
      await this.prisma.knowledgeGap.createMany({ data: planned, skipDuplicates: true })
    }
    // 本轮新建的行不回读，直接按"开放、刚发现"补进内存视图：再来一次 findMany
    // 换不到更准的时间，反而在两次读之间又插了一次写
    const rows: GapRecord[] = [
      ...knownRows,
      ...planned.map((p) => ({
        ...p,
        status: 'open' as GapStatus,
        closedAt: null,
        closedDocId: null,
        firstSeenAt: new Date(),
      })),
    ]
    const statusOf = new Map(knownRows.map((r) => [r.ticketId, r.status]))
    // 清单只留待补的：已成文/已判不补的还在账上（board 里能看到），但不该再占坐席的注意力
    const openCandidates = candidates.filter((c) => (statusOf.get(c.ticketId) ?? 'open') === 'open')

    return {
      days,
      scanned: tickets.length,
      // 观测/归属追不全时不说"没有缺口"，说"这条拿不到"
      unlinkedResolvedTickets: unlinked,
      summary: summarizeGaps(openCandidates),
      candidates: openCandidates,
      // 台账全貌：处置分布、挂了多久、成文后又复发的
      board: summarizeGapBoard(rows),
    }
  }

  /**
   * 缺口处置：成文（covered）/ 不打算成文（dismissed）/ 重新打开（open）。
   *
   * covered 必须指明是哪篇文档把它补上的 —— 说"已成文"却指不出出处，
   * 一周后没人信这条处置，缺口清单也就没人再维护了。文档还要过可见性：
   * 指一篇自己看不见的文档等于没指。
   */
  async setGapStatus(
    user: { id: string; role: string; department: string | null },
    ticketId: string,
    input: { status: GapStatus; documentId?: string; note?: string },
  ) {
    if (user.role !== 'agent' && user.role !== 'admin') {
      throw new ForbiddenException('仅坐席/管理员可处置知识缺口')
    }
    const status = input.status
    if (status !== 'open' && status !== 'covered' && status !== 'dismissed') {
      throw new BadRequestException('缺口状态不合法（open / covered / dismissed）')
    }
    const row = await this.prisma.knowledgeGap.findUnique({ where: { ticketId } })
    if (!row) {
      throw new NotFoundException('缺口不在台账里：清单按时间窗重算，请先刷新列表')
    }

    let closedDocId: string | null = row.closedDocId
    if (status === 'covered') {
      if (!input.documentId) {
        throw new BadRequestException('标记成文需要指明对应文档 documentId')
      }
      const doc = await this.prisma.document.findFirst({
        where: { id: input.documentId, ...visibleDocFilter(user) },
        select: { id: true },
      })
      if (!doc) throw new BadRequestException('该文档不存在或不在你的可见范围内')
      closedDocId = doc.id
    } else if (status === 'open') {
      closedDocId = null
    }

    const reopened = status === 'open'
    return this.prisma.knowledgeGap.update({
      where: { ticketId },
      data: {
        status,
        closedBy: reopened ? null : user.id,
        closedDocId,
        closeNote: input.note?.trim().slice(0, 500) ?? null,
        closedAt: reopened ? null : new Date(),
      },
      select: {
        ticketId: true,
        status: true,
        closedBy: true,
        closedDocId: true,
        closedAt: true,
        closeNote: true,
      },
    })
  }
}
