import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { OpenAIEmbeddings } from '@langchain/openai'

// ===== Embedding 统一封装（OpenAI 兼容接口，全局共享） =====
//
// 背景：knowledge.service 原先内部懒加载 OpenAIEmbeddings（索引/检索两侧共用），
// 长期记忆语义召回需要同一套客户端。为避免两个模块各自解释配置造成分裂，
// 统一收敛到本类：env 读取与默认值与旧实现完全一致
// - 独立变量 EMBEDDING_* > 复用 LLM_* 配置，均为 OpenAI 兼容格式
// - 默认 baseURL 智谱 open.bigmodel.cn、默认模型 embedding-3
// - 未配置 API Key 时 get() 返回 null，调用方自行决定回退（记忆召回）或报错（知识库索引）

@Injectable()
export class EmbeddingsClient {
  private embeddings: OpenAIEmbeddings | null = null

  constructor(private readonly configService: ConfigService) {}

  // 懒加载 embedding 客户端（避免无 API Key 时启动失败）
  get(): OpenAIEmbeddings | null {
    if (this.embeddings) return this.embeddings
    const apiKey =
      this.configService.get<string>('EMBEDDING_API_KEY') ||
      this.configService.get<string>('LLM_API_KEY')
    if (!apiKey) return null
    this.embeddings = new OpenAIEmbeddings({
      model:
        this.configService.get<string>('EMBEDDING_MODEL') ||
        this.configService.get<string>('LLM_EMBEDDING_MODEL') ||
        'embedding-3',
      apiKey,
      configuration: {
        baseURL:
          this.configService.get<string>('EMBEDDING_BASE_URL') ||
          this.configService.get<string>('LLM_API_URL') ||
          'https://open.bigmodel.cn/api/paas/v4/',
      },
    })
    return this.embeddings
  }
}

// 余弦相似度（共享实现：知识库稠密检索与记忆语义召回同源，维度不一致或零模长时返回 0）
export function cosineSimilarity(a: number[], b: number[]): number {
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
