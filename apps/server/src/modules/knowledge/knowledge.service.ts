import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAIEmbeddings } from '@langchain/openai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import * as pdfParse from 'pdf-parse'
import * as mammoth from 'mammoth'
import { PrismaService } from '@/prisma/prisma.service'

export interface RagHit {
  content: string
  score: number
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
  ) {}

  // 懒加载 embedding 客户端（避免无 API Key 时启动失败）
  // 独立变量 EMBEDDING_* > 复用 LLM_* 配置，均为 OpenAI 兼容格式
  private getEmbeddings(): OpenAIEmbeddings {
    if (this.embeddings) return this.embeddings
    this.embeddings = new OpenAIEmbeddings({
      model:
        this.configService.get<string>('EMBEDDING_MODEL') ||
        this.configService.get<string>('LLM_EMBEDDING_MODEL') ||
        'embedding-3',
      apiKey:
        this.configService.get<string>('EMBEDDING_API_KEY') ||
        this.configService.get<string>('LLM_API_KEY'),
      configuration: {
        baseURL:
          this.configService.get<string>('EMBEDDING_BASE_URL') ||
          this.configService.get<string>('LLM_API_URL') ||
          'https://open.bigmodel.cn/api/paas/v4/',
      },
    })
    return this.embeddings
  }

  // ===== 文档管理 =====

  async getDocuments() {
    const docs = await this.prisma.document.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return docs.map((d) => ({
      id: d.id,
      name: d.name,
      size: d.size,
      chunks: d.chunks,
      status: d.status,
    }))
  }

  // 上传并索引：抽取文本 → 切块 → 向量化 → 入库
  async uploadDocument(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('未收到文件')
    const name = file.originalname || 'untitled'
    const ext = name.split('.').pop()?.toLowerCase() || ''

    let doc = await this.prisma.document.create({
      data: { name, size: file.size, chunks: 0, status: 'processing' },
    })

    try {
      const text = await this.extractText(file, ext)
      const chunks = await this.splitter.splitText(text)

      if (chunks.length === 0) {
        throw new BadRequestException('未能从文件中抽取到文本内容')
      }

      const vectors = await this.getEmbeddings().embedDocuments(chunks)

      await this.prisma.$transaction(
        chunks.map((content, i) =>
          this.prisma.knowledgeChunk.create({
            data: { documentId: doc.id, index: i, content, embedding: vectors[i] },
          }),
        ),
      )

      doc = await this.prisma.document.update({
        where: { id: doc.id },
        data: { chunks: chunks.length, status: 'indexed' },
      })

      this.logger.log(`indexed "${name}": ${chunks.length} chunks`)
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

  async deleteDocument(id: string) {
    const existing = await this.prisma.document.findUnique({ where: { id } })
    if (!existing) throw new NotFoundException('文档不存在')
    await this.prisma.document.delete({ where: { id } })
    return { success: true }
  }

  // ===== 向量检索（RAG）=====

  // 查询 → 向量化 → 全量余弦相似度 → Top-K 片段
  async searchRelevant(query: string, topK = 4): Promise<RagHit[]> {
    const chunks = await this.prisma.knowledgeChunk.findMany({
      where: { document: { status: 'indexed' } },
      orderBy: { createdAt: 'asc' },
    })
    if (chunks.length === 0) return []

    const queryVector = await this.getEmbeddings().embedQuery(query)
    const scored = chunks.map((c) => ({
      content: c.content,
      score: cosineSimilarity(queryVector, c.embedding as number[]),
    }))

    scored.sort((a, b) => b.score - a.score)
    const hits = scored.slice(0, topK).filter((h) => h.score > 0.25)
    return hits.map((h) => ({ content: h.content, score: Math.round(h.score * 1000) / 1000 }))
  }

  // ===== 文本抽取 =====

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
