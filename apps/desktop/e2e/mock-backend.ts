import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

// ===== E2E 用后端替身 =====
//
// 为什么不用真实 Nest：主链路要打通 LLM 流式与建单确认，依赖真实模型 Key 与 MySQL，
// 结果不确定且无法进 CI。这里用同一台 Node 进程同时托管「已构建的渲染层」与
// 「API 替身」，二者同源（http://127.0.0.1:PORT），既绕开 file:// 跨源限制与 CORS，
// 也让 SSE 事件序列完全可控。
//
// 只实现主链路真正会打到的端点，其余一律 501 —— 一旦前端新增调用，测试会立刻失败
// 而不是静默走偏，替身不会悄悄落后于真实实现。

const RENDERER_DIR = resolve(__dirname, '../dist')

const API_PREFIXES = [
  '/auth',
  '/chats',
  '/tickets',
  '/knowledge',
  '/settings',
  '/prompts',
  '/analytics',
]

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

const USER = {
  id: 'u-e2e-1',
  email: 'e2e@servicedeck.test',
  name: 'E2E 坐席',
  avatar: null,
  department: 'IT',
  // 员工视角：工单列表只见自己创建的，无需 /tickets/staff 与 /tickets/stats 这两个坐席端点
  role: 'employee',
}

const CHAT_ID = 'chat-e2e-1'
const REQUEST_ID = `${CHAT_ID}:1700000000000:e2edraft`
const PROMPT_TEXT = '我的 VPN 连不上，证书也重新装过了'
const DRAFT_TITLE = 'VPN 账号疑似被锁定，需管理员解锁'

const SOURCES = [
  {
    documentId: 'doc-vpn',
    documentName: 'vpn-troubleshooting.md',
    sectionPath: 'VPN 排查 > 连接失败',
    content: '连接失败时请先确认账号未被锁定，再检查证书是否过期。',
    score: 0.812,
  },
]

// 正文一律在 HITL 确认门之后才发：真实服务端是「工具循环（含建单）跑完 → 生成最终答案」，
// 客户端也只在首个 content 帧创建消息时读取 ticketRef，帧序若颠倒则工单卡片永远不出现
const ANSWER_APPROVED =
  '根据知识库，VPN 连接失败通常是账号锁定或证书过期。这个问题需要管理员介入解锁账号，已为你升级工单。'
const ANSWER_REJECTED = '好的，先不升级工单。如果稍后仍需要人工处理，随时告诉我。'
// 非流式回退（降级）路径的返回体：一次性给出，无 SSE
const ANSWER_DEGRADED = '（非流式）VPN 连接失败请联系 IT 解锁账号。'

export interface RecordedConfirm {
  requestId: string
  approved: boolean
}

export interface MockTicket {
  id: string
  title: string
  content: string
  status: string
  priority: string
  category: string
  creator: { id: string; name: string | null; email: string; role?: string }
  assignee: null
  source: string
  createdAt: string
  updatedAt: string
  comments: { id: string; kind: string; content: string; author: unknown; createdAt: string }[]
}

export interface MockBackend {
  url: string
  /** 供断言：Agent 推来的建单确认是否真的回传到了服务端 */
  confirmations: RecordedConfirm[]
  /** 供断言：SSE 实际发出的事件顺序 */
  emittedEvents: string[]
  /** 诊断用：按序记录打到的 API 请求 */
  requestLog: string[]
  tickets: MockTicket[]
  /** 造一个「断连后遗留的未决建单草稿」场景，用于验证恢复确认卡 */
  seedPendingDraft: () => void
  /** 用例之间清空记录与建单结果 */
  reset: () => void
  close: () => Promise<void>
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((done) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        done(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch {
        done({})
      }
    })
  })
}

function json(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function staticPathFor(pathname: string): string | null {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''))
  const abs = resolve(RENDERER_DIR, rel)
  // 目录穿越防护：只允许取渲染产物目录内的文件
  if (abs !== RENDERER_DIR && !abs.startsWith(RENDERER_DIR + sep)) return null
  return abs
}

async function serveRenderer(res: ServerResponse, pathname: string) {
  const file = staticPathFor(pathname)
  if (!file) return json(res, 403, { message: 'forbidden' })
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(buf)
  } catch {
    // SPA 回退：非 API、非静态资源的 GET 一律回 index.html
    try {
      const html = await readFile(resolve(RENDERER_DIR, 'index.html'))
      res.writeHead(200, { 'Content-Type': MIME['.html'] })
      res.end(html)
    } catch {
      json(res, 404, {
        message: 'renderer not built; run pnpm --filter @servicedesk/desktop build',
      })
    }
  }
}

export async function startMockBackend(): Promise<MockBackend> {
  const confirmations: RecordedConfirm[] = []
  const emittedEvents: string[] = []
  const requestLog: string[] = []
  const tickets: MockTicket[] = []
  // 断连后遗留的未决草稿（恢复场景用）；有草稿时会话才出现在列表里
  let pendingDraft: Record<string, unknown> | null = null
  // 流跑完后才「落库」的回答，供 GET /messages 复现真实服务端的持久化时序
  let persistedAnswer: string | null = null
  // 建单确认闸门：SSE 生成器在此挂起，直到前端 POST /confirm-ticket
  let resolveConfirm: ((approved: boolean) => void) | null = null

  const createTicketFromDraft = (): MockTicket => {
    const now = new Date().toISOString()
    const ticket: MockTicket = {
      id: 'tk-e2e-1',
      title: DRAFT_TITLE,
      content: '员工反馈 VPN 连不上，知识库指引的证书排查无效，怀疑账号被锁定。',
      status: 'open',
      priority: 'high',
      category: 'network',
      creator: { id: USER.id, name: USER.name, email: USER.email, role: USER.role },
      assignee: null,
      source: 'agent',
      createdAt: now,
      updatedAt: now,
      comments: [
        {
          id: 'tc-1',
          kind: 'system',
          content: '工单由 AI 对话升级创建',
          author: { id: USER.id, name: USER.name, email: USER.email, role: USER.role },
          createdAt: now,
        },
      ],
    }
    tickets.push(ticket)
    return ticket
  }

  const handleStream = async (res: ServerResponse, chatId: string, prompt: string) => {
    // 触发词：让流式端点直接失败，驱动客户端走非流式回退（降级路径）
    if (prompt.includes('触发中断')) {
      return json(res, 500, { message: 'sse unavailable' })
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const send = (event: Record<string, unknown>) => {
      emittedEvents.push(Object.keys(event)[0] ?? '?')
      // 客户端要求行首为字面量 "data: "（含空格），且以空行分帧
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    }

    send({ tool: { tool: 'search_knowledge', status: 'start' } })
    send({ tool: { tool: 'search_knowledge', status: 'done', summary: '命中 1 个片段' } })
    send({ sources: SOURCES })

    // Agent 判定超范围 → 推确认草稿并挂起，等用户拍板（HITL 确认门的真实形态）
    send({ tool: { tool: 'create_ticket', status: 'start' } })
    send({
      confirm: {
        requestId: REQUEST_ID.replace('chat-e2e-1', chatId),
        title: DRAFT_TITLE,
        content: '员工反馈 VPN 连不上，知识库指引的证书排查无效，怀疑账号被锁定。',
        priority: 'high',
        category: 'network',
      },
    })

    const approved = await new Promise<boolean>((r) => {
      resolveConfirm = r
    })
    const answer = approved ? ANSWER_APPROVED : ANSWER_REJECTED
    if (approved) {
      const ticket = createTicketFromDraft()
      send({
        tool: { tool: 'create_ticket', status: 'done', summary: `已创建工单 ${ticket.id}` },
      })
      send({ ticket: { id: ticket.id, title: ticket.title } })
    } else {
      send({ tool: { tool: 'create_ticket', status: 'done', summary: '用户选择暂不建单' } })
    }
    for (const piece of chunk(answer)) send({ content: piece })
    persistedAnswer = answer
    send({ done: true })
    res.end()
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (!API_PREFIXES.some((p) => path.startsWith(p))) {
      if (method === 'GET') return serveRenderer(res, path)
      return json(res, 405, { message: 'method not allowed' })
    }
    requestLog.push(`${method} ${path}`)

    if (method === 'POST' && path === '/auth/login') {
      return json(res, 201, { token: 'e2e-jwt', user: USER })
    }
    if (method === 'GET' && path === '/auth/me') {
      return json(res, 200, USER)
    }
    if (method === 'GET' && path === '/chats') {
      return json(
        res,
        200,
        pendingDraft
          ? [
              {
                id: CHAT_ID,
                title: '我的 VPN 连不上...',
                pinned: false,
                date: new Date().toISOString(),
              },
            ]
          : [],
      )
    }
    const draftsMatch = path.match(/^\/chats\/([^/]+)\/ticket-drafts$/)
    if (method === 'GET' && draftsMatch) {
      // 真实服务端按 chatId 过滤且只返回 pending：这里等价于「本会话有一条待决草稿」
      return json(res, 200, pendingDraft && draftsMatch[1] === CHAT_ID ? [pendingDraft] : [])
    }
    if (method === 'POST' && path === '/chats') {
      return json(res, 201, {
        id: CHAT_ID,
        title: '',
        pinned: false,
        date: new Date().toISOString(),
      })
    }
    if (method === 'PATCH' && path === `/chats/${CHAT_ID}`) {
      return json(res, 200, {
        id: CHAT_ID,
        title: 'VPN 连不上',
        pinned: false,
        date: new Date().toISOString(),
      })
    }
    const messagesMatch = path.match(/^\/chats\/([^/]+)\/messages$/)
    if (method === 'GET' && messagesMatch) {
      // 流还没跑完就是「新会话，服务端尚无落库消息」。这里必须有返回空：
      // ChatPage 的历史加载 effect 会用 setMessages 整体覆盖本地消息，
      // 若在此返回任何预置内容都会把在途的流式回答冲掉。
      if (!persistedAnswer) {
        // 例外：有待决建单草稿的会话，必然是「问过一句然后断连」——那句提问已落库
        if (pendingDraft && messagesMatch[1] === CHAT_ID) {
          return json(res, 200, [
            {
              id: 'm-user',
              chatId: CHAT_ID,
              role: 'user',
              content: PROMPT_TEXT,
              createdAt: new Date(Date.now() - 60_000).toISOString(),
            },
          ])
        }
        return json(res, 200, [])
      }
      return json(res, 200, [
        {
          id: 'm-user',
          chatId: messagesMatch[1],
          role: 'user',
          content: PROMPT_TEXT,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'm-assistant',
          chatId: messagesMatch[1],
          role: 'assistant',
          content: persistedAnswer,
          model: 'e2e-model',
          sources: SOURCES,
          createdAt: new Date().toISOString(),
        },
      ])
    }
    const streamMatch = path.match(/^\/chats\/([^/]+)\/completions\/stream$/)
    if (method === 'POST' && streamMatch) {
      const body = await readBody(req)
      return handleStream(res, streamMatch[1], String(body.prompt ?? ''))
    }
    // 非流式回退：真实服务端这条仍做 RAG 并落库，但不跑工具循环（不建单），
    // 所以引用来源要回传、由客户端标注为降级回答
    const completionsMatch = path.match(/^\/chats\/([^/]+)\/completions$/)
    if (method === 'POST' && completionsMatch) {
      return json(res, 201, {
        success: true,
        data: ANSWER_DEGRADED,
        sources: SOURCES,
      })
    }
    if (method === 'POST' && path === `/chats/${CHAT_ID}/confirm-ticket`) {
      const body = await readBody(req)
      const requestId = String(body.requestId ?? '')
      const approved = Boolean(body.approved)
      confirmations.push({ requestId, approved })
      // 与真实服务端一致：requestId 必须归属本会话，否则视为无效确认
      if (!requestId.startsWith(`${CHAT_ID}:`)) {
        return json(res, 200, { success: false, message: '确认请求已失效' })
      }
      resolveConfirm?.(approved)
      resolveConfirm = null
      return json(res, 200, { success: true })
    }
    if (method === 'GET' && path === '/tickets') {
      return json(res, 200, tickets)
    }
    const detailMatch = path.match(/^\/tickets\/([^/]+)$/)
    if (method === 'GET' && detailMatch) {
      const ticket = tickets.find((t) => t.id === detailMatch[1])
      return ticket ? json(res, 200, ticket) : json(res, 404, { message: '工单不存在' })
    }

    return json(res, 501, { message: `mock 未实现：${method} ${path}` })
  })

  await new Promise<void>((r) => {
    server.listen(0, '127.0.0.1', r)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    confirmations,
    emittedEvents,
    requestLog,
    tickets,
    reset: () => {
      confirmations.length = 0
      emittedEvents.length = 0
      requestLog.length = 0
      tickets.length = 0
      persistedAnswer = null
      pendingDraft = null
    },
    seedPendingDraft: () => {
      pendingDraft = {
        requestId: REQUEST_ID,
        title: DRAFT_TITLE,
        content: '上次断连前 Agent 提出的建单请求，尚未拍板。',
        priority: 'high',
        category: 'network',
      }
    },
    close: () =>
      new Promise<void>((r) => {
        resolveConfirm?.(false)
        server.close(() => r())
      }),
  }
}

// 把答案切成若干「词级」片段模拟流式 token
function chunk(text: string): string[] {
  return text.match(/[^，。；]+[，。；]?/g) ?? [text]
}
