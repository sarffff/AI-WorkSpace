import { Injectable, Logger } from '@nestjs/common'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { KnowledgeService, RagHit } from '@/modules/knowledge/knowledge.service'

export interface ToolCallRecord {
  id: string // OpenAI tool_call id
  name: string
  args: Record<string, unknown>
  output: string // 截断后的工具结果
  status: 'ok' | 'error' | 'denied'
  sources?: RagHit[] // search_knowledge 命中的片段（用于引用来源展示）
}

export interface ToolActivity {
  id: string
  name: string
  args: Record<string, unknown>
  output: string
  status: 'ok' | 'error' | 'denied'
}

// OpenAI 兼容工具 schema
export interface AgentTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name)

  constructor(private knowledgeService: KnowledgeService) {}

  // 注册的工具清单（可被模型选择调用）
  private get registered(): AgentTool[] {
    return [
      {
        type: 'function' as const,
        function: {
          name: 'search_knowledge',
          description:
            '在本地知识库中语义检索片段，返回与查询相关的文档内容、来源文档名和相似度。适合回答关于内部文档、项目规范、手册的问题。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索查询（自然语言问题）' },
              topK: { type: 'number', description: '返回片段数，默认 4' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'web_fetch',
          description: '抓取指定 URL 的网页正文并返回前 2000 字符。适合获取实时或外部信息。',
          parameters: {
            type: 'object',
            properties: { url: { type: 'string', description: '要抓取的完整 http(s) URL' } },
            required: ['url'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'calculate',
          description: '执行数学计算，返回数值结果。支持 + - * / 和括号，如 (2+3)*4。',
          parameters: {
            type: 'object',
            properties: { expression: { type: 'string', description: '要计算的数学表达式' } },
            required: ['expression'],
          },
        },
      },
    ]
  }

  // 向模型暴露的 OpenAI tools 格式
  getApiTools(): ChatCompletionTool[] {
    return this.registered.map((t) => ({ type: 'function', function: t.function }))
  }

  // 执行工具调用（捕获异常 → 返回错误文本给模型）
  async execute(
    toolCall: { id: string; name: string; args: Record<string, unknown> },
    userId?: string,
  ): Promise<ToolCallRecord> {
    try {
      const { output, sources } = await this.runTool(toolCall.name, toolCall.args, userId)
      const record: ToolCallRecord = {
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
        output: truncate(output, 4000),
        status: 'ok',
      }
      if (sources?.length) record.sources = sources
      return record
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.logger.warn(`tool ${toolCall.name} failed: ${message}`)
      return {
        id: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
        output: `工具执行失败：${message}`,
        status: 'error',
      }
    }
  }

  // 顶层工具逻辑
  private async runTool(
    name: string,
    args: Record<string, unknown>,
    userId?: string,
  ): Promise<{ output: string; sources?: RagHit[] }> {
    switch (name) {
      case 'search_knowledge': {
        if (!userId) throw new Error('知识库工具缺少用户上下文')
        const query = String(args.query ?? '').trim()
        if (!query) throw new Error('缺少 query 参数')
        const topK = Math.min(10, Math.max(1, Number(args.topK) || 4))
        const hits = await this.knowledgeService.searchRelevant(userId, query, topK)
        if (hits.length === 0) return { output: '知识库未命中任何相关内容', sources: [] }
        return {
          output: hits
            .map(
              (h, i) =>
                `[片段 ${i + 1}] 来源《${h.documentName}》#${h.index + 1} 相似度${h.score}\n${h.content}`,
            )
            .join('\n\n---\n\n'),
          sources: hits,
        }
      }
      case 'web_fetch': {
        const url = String(args.url ?? '').trim()
        if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 链接')
        assertPublicUrl(url)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10_000)
        try {
          const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'AI-Workspace-Agent/1.0' },
            redirect: 'follow',
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const text = await res.text()
          return { output: stripHtml(text).slice(0, 2000) }
        } finally {
          clearTimeout(timer)
        }
      }
      case 'calculate': {
        const expression = String(args.expression ?? '').trim()
        const value = evaluateExpression(expression)
        return { output: `${expression} = ${value}` }
      }
      default:
        throw new Error(`未知工具: ${name}`)
    }
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…（已截断，共 ${s.length} 字符）`
}

// 简易 HTML → 文本
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// SSRF 防护：禁止内网/环回地址
function assertPublicUrl(url: string) {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    throw new Error('URL 格式无效')
  }
  const blocked =
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^(172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    /^\[?(::1)\]?$/.test(host)
  if (blocked) throw new Error('不允许访问内网地址')
}

// 安全四则运算解析器（避免 eval；仅 + - * / 与括号、数字、空格）
// 递归下降：expr := term (('+'|'-') term)*; term := factor (('*'|'/'|'%') factor)*; factor := number | '(' expr ')'
function evaluateExpression(expr: string): number {
  const tokens = expr.match(/[0-9.]+|[+\-*/%()]/g)
  if (!tokens) throw new Error('表达式无效')
  let pos = 0
  const peek = () => tokens[pos]
  const consume = (expected?: string) => {
    const t = tokens[pos]
    if (expected && t !== expected) throw new Error(`表达式无效：期望 ${expected}，得到 ${t}`)
    pos += 1
    return t
  }
  const parseFactor = (): number => {
    const t = consume()
    if (t === '(') {
      const v = parseExpr()
      consume(')')
      return v
    }
    const n = Number(t)
    if (Number.isNaN(n)) throw new Error(`无法解析: ${t}`)
    return n
  }
  const parseTerm = (): number => {
    let v = parseFactor()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume()
      const r = parseFactor()
      if (op === '*') v *= r
      else if (op === '/') {
        if (r === 0) throw new Error('除数为 0')
        v /= r
      } else {
        if (r === 0) throw new Error('取模除数为 0')
        v %= r
      }
    }
    return v
  }
  const parseExpr = (): number => {
    let v = parseTerm()
    while (peek() === '+' || peek() === '-') {
      const op = consume()
      const r = parseTerm()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const value = parseExpr()
  if (pos !== tokens.length) throw new Error('表达式包含多余字符')
  return value
}
