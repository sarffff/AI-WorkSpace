import {
  Injectable,
  BadRequestException,
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
import { EmbeddingsClient, cosineSimilarity } from '@/common/embeddings'
import { IndexingQueueService } from './indexing-queue.service'
import { chunkDocument, ChunkConfig } from './chunking'
import { BM25, tokenize } from './bm25'
import { cleanText, detectMojibake } from './cleaning'

// 单文件上传体积上限（env KNOWLEDGE_MAX_UPLOAD_MB，默认 20MB）。
// 由 controller 的 FileInterceptor limits 拦在读入内存之前，service 再做一次兜底断言。
const uploadMb = parseInt(process.env.KNOWLEDGE_MAX_UPLOAD_MB ?? '', 10)
export const MAX_UPLOAD_BYTES =
  (Number.isFinite(uploadMb) && uploadMb > 0 ? uploadMb : 20) * 1024 * 1024

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

// RRF 融合参数（k 越大，名次差异对分数影响越平缓）
const RRF_K = 60

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeService.name)
  private rewriteClient: OpenAI | null = null

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private llmClient: LlmClient,
    private embeddingsClient: EmbeddingsClient,
    private settingsService: SettingsService,
    private readonly queue: IndexingQueueService,
  ) {}

  // 注册后台处理函数：队列消费时执行完整索引流水线
  onModuleInit() {
    this.queue.registerHandler((documentId, buffer) => this.processDocument(documentId, buffer))
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
    const shareDept = department && department === user.department ? department : null
    const name = file.originalname || 'untitled'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    this.assertSupportedExt(ext)

    const doc = await this.prisma.document.create({
      data: {
        userId: user.id,
        department: shareDept,
        name,
        size: file.size,
        chunks: 0,
        status: 'processing',
      },
    })

    this.queue.enqueue(doc.id, file.buffer)

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
      this.queue.update(documentId, { stage: 'done', percent: 100, chunks: parents.length })
      this.logger.log(`indexed "${doc.name}": ${parents.length} parents / ${leaves.length} leaves`)
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)
      this.logger.error(`index failed for "${doc.name}": ${errorMessage}`)
      await this.prisma.document
        .update({ where: { id: documentId }, data: { status: 'failed' } })
        .catch(() => {})
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
    return { success: true }
  }

  // ===== 向量检索（RAG，行级权限过滤后仅在可见语料中检索）=====

  // 混合检索流水线：
  // 查询改写 → 稠密余弦（语义门控） + 本地 BM25（词法召回） → RRF 融合 → 去重到父块
  // → Reranker 精排（可选，失败回退 RRF）→ Top-K 父块（附来源文档/章节路径）
  async searchRelevant(
    user: { id: string; role: string; department: string | null },
    query: string,
    topK?: number,
  ): Promise<RagHit[]> {
    // 参数配置化：显式 topK > Setting 表 > 环境变量 > 默认
    const [cfgTopK, minScore, coarseTopK, useRerank, useRewrite] = await Promise.all([
      this.settingInt(user.id, 'ragTopK', 4),
      this.settingNum(user.id, 'ragMinScore', 0.25),
      this.settingInt(user.id, 'ragCoarseTopK', 20),
      this.settingOn(user.id, 'ragRerank', true),
      this.settingOn(user.id, 'ragQueryRewrite', true),
    ])
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

    // 加载可见叶子块（旧版单级块 embedding 非空且 parentId 为空 → 视为叶子，命中后返回自身）
    const leaves = await this.prisma.knowledgeChunk.findMany({
      where: {
        embedding: { not: Prisma.DbNull },
        document: { status: 'indexed', ...visibleDocFilter(user) },
      },
      include: { document: { select: { name: true } } },
    })
    if (leaves.length === 0) return []

    // 叶子文本 = 上下文前缀 + 正文（与索引侧拼接一致）
    const leafTexts = leaves.map((c) =>
      this.prefixedText(c.document.name, c.sectionPath, c.content),
    )

    // 稠密检索：余弦相似度，语义门控（> 阈值才进入候选，保持旧行为且可配置）
    const queryVector = await this.getEmbeddings().embedQuery(searchQuery)
    const denseList = leaves
      .map((c) => ({ id: c.id, score: cosineSimilarity(queryVector, c.embedding as number[]) }))
      .filter((d) => d.score > minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, coarseTopK)

    // 稀疏检索：本地 BM25（编号/专有名词类查询的召回补充，如 "ERR-4012"）
    const bm25 = new BM25(leafTexts.map((t) => tokenize(t)))
    const bm25Scores = bm25.score(tokenize(searchQuery))
    const bm25List = leaves
      .map((c, i) => ({ id: c.id, score: bm25Scores[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, coarseTopK)

    // RRF 融合（结果序融合，抗分数尺度差异）→ 粗排候选
    const fused = rrfFuse([denseList, bm25List])
    const candidates = fused.slice(0, coarseTopK)
    if (candidates.length === 0) return []

    // 叶子 → 父块映射；同一父块的多个叶子只保留融合分最高者（Small-to-Big）
    const leafById = new Map(leaves.map((l) => [l.id, l]))
    const parentIds = [
      ...new Set(
        candidates
          .map((c) => leafById.get(c.id)?.parentId)
          .filter((id): id is string => Boolean(id)),
      ),
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
    const parentById = new Map(parentRows.map((p) => [p.id, p]))
    const bm25RankById = new Map(bm25List.map((x, i) => [x.id, i + 1]))

    const deduped: {
      leaf: ChunkWithDoc
      parent: ChunkWithDoc
      denseScore: number
      fusedScore: number
      bm25Rank?: number
    }[] = []
    const byParent = new Map<string, number>()
    for (const c of candidates) {
      const leaf = leafById.get(c.id)!
      const parent = leaf.parentId ? (parentById.get(leaf.parentId) ?? leaf) : leaf
      const key = parent.id
      const idx = byParent.get(key)
      if (idx === undefined) {
        byParent.set(key, deduped.length)
        deduped.push({
          leaf,
          parent,
          denseScore: 0,
          fusedScore: c.score,
          bm25Rank: bm25RankById.get(leaf.id),
        })
      } else {
        deduped[idx].fusedScore = Math.max(deduped[idx].fusedScore, c.score)
      }
    }
    // 稠密分数（语义可比，0-1）用于展示与无 Rerank 时的排序
    const denseById = new Map(denseList.map((d) => [d.id, d.score]))
    for (const d of deduped) d.denseScore = denseById.get(d.leaf.id) ?? 0

    // Reranker 精排（默认开；未配置/失败时回退 RRF 排序）
    let ranked: { parent: ChunkWithDoc; score: number }[] = []
    let reranked = false
    if (useRerank && deduped.length > 1) {
      const docs = deduped.map((d) =>
        this.prefixedText(d.parent.document.name, d.parent.sectionPath, d.parent.content),
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
      // 回退门控：语义相关（稠密 > 阈值）或词法命中（BM25 靠前）才保留
      ranked = deduped
        .filter((d) => d.denseScore > minScore || (d.bm25Rank ?? Infinity) <= finalTopK)
        .sort((a, b) => b.fusedScore - a.fusedScore)
        .slice(0, finalTopK)
        .map((x) => ({ parent: x.parent, score: x.denseScore || x.fusedScore }))
    }

    return ranked.map((h) => ({
      content: h.parent.content,
      score: Math.round(h.score * 1000) / 1000,
      documentId: h.parent.documentId,
      documentName: h.parent.document.name,
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
          // 当前运行时无 GBK 支持时保留原结果（由 detectMojibake 告警）
        }
      }
      return text
    }
    throw new BadRequestException(`不支持的文件类型: .${ext || 'unknown'}`)
  }
}

// RRF（Reciprocal Rank Fusion）：对多个按分数排序的榜单做结果序融合，抗不同分数尺度
function rrfFuse(
  lists: { id: string; score: number }[][],
  k = RRF_K,
): { id: string; score: number }[] {
  const acc = new Map<string, number>()
  for (const list of lists) {
    list.forEach((item, i) => {
      acc.set(item.id, (acc.get(item.id) ?? 0) + 1 / (k + i + 1))
    })
  }
  return [...acc.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}
