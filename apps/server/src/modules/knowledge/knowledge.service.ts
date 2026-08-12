import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAIEmbeddings } from '@langchain/openai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import * as pdfParse from 'pdf-parse'
import * as mammoth from 'mammoth'
import { PrismaService } from '@/prisma/prisma.service'
import { SettingsService } from '@/modules/settings/settings.service'

export interface RagHit {
  content: string
  score: number
  documentId: string
  documentName: string
  index: number
}

// 支持解析的扩展名 → 抽取方式
export const TEXT_EXTS = new Set([
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

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name)
  private embeddings: OpenAIEmbeddings | null = null
  private readonly splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 600,
    chunkOverlap: 100,
  })

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private settingsService: SettingsService,
  ) {}

  // 懒加载 embedding 客户端（独立变量 EMBEDDING_* 优先，均可被运行时设置覆盖）
  private async getEmbeddings(): Promise<OpenAIEmbeddings> {
    const [embeddingModel, embeddingKey, embeddingBaseUrl] = await Promise.all([
      this.settingsService.get('EMBEDDING_MODEL'),
      this.settingsService.get('EMBEDDING_API_KEY'),
      this.settingsService.get('EMBEDDING_BASE_URL'),
    ])
    const model =
      embeddingModel || this.configService.get<string>('LLM_EMBEDDING_MODEL') || 'embedding-3'
    const apiKey = embeddingKey || this.configService.get<string>('LLM_API_KEY')
    const baseURL =
      embeddingBaseUrl ||
      this.configService.get<string>('LLM_API_URL') ||
      'https://open.bigmodel.cn/api/paas/v4/'

    if (!this.embeddings) {
      this.embeddings = new OpenAIEmbeddings({ model, apiKey, configuration: { baseURL } })
    }
    return this.embeddings
  }

  // ===== 文档管理 =====

  // 分页获取文档列表
  async getDocuments(userId: string, page = 1, pageSize = 20) {
    const total = await this.prisma.document.count({ where: { ownerId: userId } })
    const docs = await this.prisma.document.findMany({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
    return {
      items: docs.map((d) => ({
        id: d.id,
        name: d.name,
        size: d.size,
        chunks: d.chunks,
        status: d.status,
      })),
      total,
      page,
      pageSize,
    }
  }

  // 上传并索引：抽取文本 → 切块 → 向量化 → 入库（原始文件一并存储，供重新索引）
  async uploadDocument(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('未收到文件')
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('文件不能超过 30MB')
    }
    const name = file.originalname || 'untitled'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    if (ext !== 'pdf' && ext !== 'docx' && !TEXT_EXTS.has(ext)) {
      throw new BadRequestException(`不支持的文件类型: .${ext || 'unknown'}`)
    }

    let doc = await this.prisma.document.create({
      data: {
        name,
        size: file.size,
        chunks: 0,
        status: 'processing',
        fileBytes: file.buffer,
        ownerId: userId,
      },
    })

    try {
      const text = await this.extractText(file, ext)
      await this.indexChunks(doc.id, text)
      doc = await this.prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
      this.logger.log(`indexed "${name}": ${doc.chunks} chunks`)
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err)

      this.logger.error(`index failed for "${name}": ${errorMessage}`)
      await this.prisma.document
        .update({ where: { id: doc.id }, data: { status: 'failed' } })
        .catch(() => {})
      throw new BadRequestException(`文档处理失败: ${errorMessage}`)
    }

    return { id: doc.id, name: doc.name, size: doc.size, chunks: doc.chunks, status: doc.status }
  }

  // 重新索引：用存储的原始文件重新抽取/切块/向量化（处理失败文档重试）
  async reindexDocument(userId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, ownerId: userId } })
    if (!doc) throw new NotFoundException('文档不存在')
    if (!doc.fileBytes) throw new BadRequestException('该文档未保存原始文件，无法重新索引')

    const file: Express.Multer.File = {
      buffer: doc.fileBytes as Buffer,
      originalname: doc.name,
      size: doc.size,
    } as Express.Multer.File
    const ext = doc.name.split('.').pop()?.toLowerCase() || ''

    await this.prisma.document.update({ where: { id }, data: { status: 'processing' } })
    try {
      const text = await this.extractText(file, ext)
      await this.prisma.knowledgeChunk.deleteMany({ where: { documentId: id } })
      await this.indexChunks(id, text)
      const updated = await this.prisma.document.findUniqueOrThrow({ where: { id } })
      this.logger.log(`reindexed "${doc.name}": ${updated.chunks} chunks`)
      return { id: updated.id, name: updated.name, chunks: updated.chunks, status: updated.status }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await this.prisma.document
        .update({ where: { id }, data: { status: 'failed' } })
        .catch(() => {})
      throw new BadRequestException(`重新索引失败: ${message}`)
    }
  }

  async deleteDocument(userId: string, id: string) {
    const existing = await this.prisma.document.findFirst({ where: { id, ownerId: userId } })
    if (!existing) throw new NotFoundException('文档不存在')
    await this.prisma.document.delete({ where: { id } })
    return { success: true }
  }

  // 查看文档的切块列表（预览用，不返回向量）
  async getDocumentChunks(userId: string, id: string) {
    const doc = await this.prisma.document.findFirst({ where: { id, ownerId: userId } })
    if (!doc) throw new NotFoundException('文档不存在')
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { documentId: id },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, content: true },
    })
    return { documentId: id, chunks }
  }

  // ===== 向量检索（RAG）=====

  // 查询 → 向量化 → 全量余弦相似度 → Top-K 片段（阈值与数量可配置）
  async searchRelevant(userId: string, query: string, topK = 4): Promise<RagHit[]> {
    const [configuredTopK, configuredThreshold] = await Promise.all([
      this.settingsService.getNumber('RAG_TOP_K', topK),
      this.settingsService.getNumber('RAG_THRESHOLD', 0.25),
    ])

    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { document: { status: 'indexed', ownerId: userId } },
      include: { document: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
    if (chunks.length === 0) return []

    const embeddings = await this.getEmbeddings()
    const queryVector = await embeddings.embedQuery(query)
    const scored = chunks.map((c) => ({
      content: c.content,
      index: c.index,
      documentId: c.document.id,
      documentName: c.document.name,
      score: cosineSimilarity(queryVector, c.embedding as number[]),
    }))

    scored.sort((a, b) => b.score - a.score)
    const hits = scored.slice(0, configuredTopK).filter((h) => h.score > configuredThreshold)
    return hits.map((h) => ({ ...h, score: Math.round(h.score * 1000) / 1000 }))
  }

  // ===== 内部工具 =====

  // 切块 + 向量化 + 事务入库，返回块数
  private async indexChunks(documentId: string, text: string): Promise<number> {
    const chunks = await this.splitter.splitText(text)
    if (chunks.length === 0) {
      throw new BadRequestException('未能从文件中抽取到文本内容')
    }

    const embeddings = await this.getEmbeddings()
    const vectors = await embeddings.embedDocuments(chunks)

    await this.prisma.$transaction(
      chunks.map((content, i) =>
        this.prisma.knowledgeChunk.create({
          data: { documentId, index: i, content, embedding: vectors[i] },
        }),
      ),
    )
    await this.prisma.document.update({
      where: { id: documentId },
      data: { chunks: chunks.length, status: 'indexed' },
    })
    return chunks.length
  }

  private async extractText(file: Express.Multer.File, ext: string): Promise<string> {
    if (ext === 'pdf') {
      const parsed = await pdfParse(file.buffer)
      return parsed.text
    }
    if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: file.buffer })
      return result.value
    }
    if (TEXT_EXTS.has(ext)) {
      return file.buffer.toString('utf8')
    }
    throw new BadRequestException(`不支持的文件类型: .${ext || 'unknown'}`)
  }
}

// 余弦相似度
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}
