import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const highlighterStyle = oneDark as any
import { RootState } from '@/app/providers/store'
import {
  addMessage,
  updateMessageContent,
  setIsGenerating,
  setCurrentChat,
  setMessages,
  setSessions,
  renameChat,
  setActiveTab,
  setActivePrompt,
  clearActivePrompt,
} from '@/entities/chat/model/chatSlice'
import { api, syncToken } from '@/shared/api/client'
import type { MessageSource, PromptItem, TicketRef, ToolTraceStep } from '@servicedesk/sdk'
import {
  Send,
  Bot,
  User,
  Square,
  Activity,
  ArrowDown,
  Terminal,
  Sparkles,
  X,
  BookMarked,
  Wrench,
  Search,
  TicketCheck,
  Check,
  Loader2,
} from 'lucide-react'

const FLUSH_INTERVAL = 60

// Markdown 渲染组件，用于 AI 消息
const MarkdownMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="md-body">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          return match ? (
            <SyntaxHighlighter
              style={highlighterStyle}
              language={match[1]}
              PreTag="div"
              className="!rounded-lg !text-[12px] !my-2 !bg-s4 !border !border-line"
              {...(props as React.HTMLAttributes<HTMLDivElement>)}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className="bg-s3 text-brand px-1 py-0.5 rounded font-mono text-[11px]" {...props}>
              {children}
            </code>
          )
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>
        },
        ul({ children }) {
          return <ul className="list-disc list-inside mb-2 space-y-0.5 text-t2">{children}</ul>
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside mb-2 space-y-0.5 text-t2">{children}</ol>
        },
        li({ children }) {
          return <li className="leading-relaxed">{children}</li>
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-brand/60 pl-3 my-2 text-t3 italic">
              {children}
            </blockquote>
          )
        },
        h1({ children }) {
          return <h1 className="font-display text-base font-bold text-t1 mb-2 mt-3">{children}</h1>
        },
        h2({ children }) {
          return <h2 className="font-display text-sm font-bold text-t1 mb-1.5 mt-3">{children}</h2>
        },
        h3({ children }) {
          return <h3 className="text-sm font-semibold text-t1 mb-1 mt-2">{children}</h3>
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:text-brand/80 underline underline-offset-2 decoration-brand/40"
            >
              {children}
            </a>
          )
        },
        strong({ children }) {
          return <strong className="font-semibold text-t1">{children}</strong>
        },
        hr() {
          return <hr className="border-line my-3" />
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
)

// 引用溯源卡片：RAG 命中的知识库片段
const SourceCards: React.FC<{ sources: MessageSource[] }> = ({ sources }) => {
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return null
  return (
    <div className="mt-3 rounded-xl border border-line bg-s4/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-s3/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-brand tracking-wider">
          <BookMarked className="w-3 h-3" />
          内容溯源 · {sources.length} 个知识库片段
        </span>
        <span className="text-[10px] font-mono text-t4">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 fade-in">
          {sources.map((s, i) => (
            <div
              key={`${s.documentId}-${i}`}
              className="p-2.5 rounded-lg bg-s3/60 border border-line/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-t2 truncate">
                  {s.documentName}
                  {s.sectionPath ? ` · ${s.sectionPath}` : ''}
                </span>
                <span className="text-[9px] font-mono text-brand shrink-0">相关度 {s.score}</span>
              </div>
              <p className="text-[11px] text-t3 mt-1 leading-relaxed line-clamp-3">{s.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Agent 工具元信息（轨迹展示用）
const TOOL_META: Record<string, { label: string; icon: React.ReactNode }> = {
  search_knowledge: { label: '知识库检索', icon: <Search className="w-3 h-3" /> },
  create_ticket: { label: '创建工单', icon: <TicketCheck className="w-3 h-3" /> },
}

// Agent 执行轨迹：工具调用步骤（检索/建单）可视化，生成中实时展示
const AgentTrace: React.FC<{ steps: ToolTraceStep[]; live?: boolean }> = ({ steps, live }) => {
  const [open, setOpen] = useState(live ?? true)
  if (steps.length === 0) return null
  return (
    <div className="mt-3 rounded-xl border border-line bg-s4/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-s3/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-signal tracking-wider">
          <Wrench className="w-3 h-3" />
          执行轨迹 · {steps.length} 步
        </span>
        <span className="text-[10px] font-mono text-t4">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 fade-in">
          {steps.map((s, i) => {
            const meta = TOOL_META[s.tool] || {
              label: s.tool,
              icon: <Wrench className="w-3 h-3" />,
            }
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-s3/60 border border-line/60"
              >
                <span className="text-t3 shrink-0">{meta.icon}</span>
                <span className="text-[11px] text-t2 font-medium shrink-0">{meta.label}</span>
                {s.summary && (
                  <span className="text-[10px] font-mono text-t4 truncate flex-1">{s.summary}</span>
                )}
                {s.status === 'start' ? (
                  <Loader2 className="w-3 h-3 text-signal animate-spin shrink-0" />
                ) : (
                  <Check className="w-3 h-3 text-brand shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Agent 自动创建的工单通知卡片
const TicketNotice: React.FC<{ ticket: TicketRef }> = ({ ticket }) => {
  const dispatch = useDispatch()
  return (
    <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-xl border border-signal/25 bg-signal/[0.06] fade-in">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-signal/10 border border-signal/25 text-signal flex items-center justify-center shrink-0">
          <TicketCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-mono text-signal/80 tracking-wider">
            已升级 · 自动创建工单
          </p>
          <p className="text-xs text-t1 font-semibold truncate mt-0.5">{ticket.title}</p>
        </div>
      </div>
      <button
        onClick={() => dispatch(setActiveTab('tickets'))}
        className="px-3 py-1.5 rounded-lg bg-signal/10 hover:bg-signal/20 border border-signal/30 hover:border-signal/50 text-signal text-[10px] font-mono shrink-0 transition-colors"
      >
        查看工单 →
      </button>
    </div>
  )
}

// 空状态的建议提问
const SUGGESTIONS = [
  '解释 Monorepo 与 Turborepo 的增量构建原理',
  '帮我设计 Prisma 的多租户数据模型',
  'NestJS 中如何实现 SSE 流式响应？',
  '对比 Redis 缓存与内存缓存的取舍',
]

export const ChatPage: React.FC = () => {
  const dispatch = useDispatch()
  const { currentChatId, messagesBySession, sessions, selectedModel, isGenerating, activePrompt } =
    useSelector((state: RootState) => state.chat)
  const token = useSelector((state: RootState) => state.auth.token)
  const messages = currentChatId ? (messagesBySession[currentChatId] ?? []) : []
  const [input, setInput] = useState('')
  const [showThinking, setShowThinking] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [promptList, setPromptList] = useState<PromptItem[]>([])
  const [liveTrace, setLiveTrace] = useState<ToolTraceStep[]>([])
  const pickerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 提示词选择器：打开时按需拉取列表
  useEffect(() => {
    if (!pickerOpen || promptList.length > 0) return
    api
      .listPrompts()
      .then(setPromptList)
      .catch(() => {})
  }, [pickerOpen, promptList.length])

  // 点击选择器外部时关闭
  useEffect(() => {
    if (!pickerOpen) return
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [pickerOpen])

  const bufferRef = useRef({ id: '', content: '' })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isNewSessionRef = useRef(false)

  // token 变化时同步到共享客户端
  useEffect(() => {
    syncToken(token)
  }, [token])

  // 自适应高度：先复位再测量，避免残留高度干扰 scrollHeight
  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`
  }

  // 输入内容变化时同步高度（建议提问回填、消息发送清空等场景）。
  // 用 useLayoutEffect：在浏览器绘制前完成测量，避免"先塌缩再跳变"的闪烁。
  // （内联样式不再固定 height，交给这里统一管理）
  useLayoutEffect(() => {
    adjustTextareaHeight()
  }, [input])

  // 切换到某会话时从服务器加载消息
  useEffect(() => {
    if (!currentChatId) return
    const existing = messagesBySession[currentChatId]
    if (existing && existing.length > 0) return
    api
      .getMessages(currentChatId)
      .then((msgs) => {
        dispatch(
          setMessages({
            sessionId: currentChatId,
            messages: msgs.map((m) => ({
              id: m.id,
              sessionId: m.chatId,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: new Date(m.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
              model: m.model || undefined,
              sources: m.sources || undefined,
            })),
          }),
        )
      })
      .catch(() => {})
  }, [currentChatId, dispatch])

  const flushBuffer = useCallback(() => {
    const { id, content } = bufferRef.current
    if (!id || !content) return
    dispatch(updateMessageContent({ id, sessionId: currentChatId || '', content }))
  }, [dispatch, currentChatId])

  const startFlushTimer = useCallback(() => {
    if (timerRef.current) return
    timerRef.current = setInterval(flushBuffer, FLUSH_INTERVAL)
  }, [flushBuffer])

  const stopFlushTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    flushBuffer()
    stopFlushTimer()
    dispatch(setIsGenerating(false))
  }, [dispatch, flushBuffer, stopFlushTimer])

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150
  }, [])

  const scrollToBottom = useCallback((smooth = true) => {
    const el = messagesContainerRef.current
    if (!el) return
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // 内容变化时仅在贴近底部时跟随滚动，避免用户回看历史时被强制拉回；
  // 生成中用瞬时滚动，平滑动画追不上快速增长的流式内容
  useEffect(() => {
    if (isNearBottom()) scrollToBottom(!isGenerating)
  })

  // 切换会话：无条件回到底部；输入框高度变化后重新吸附
  useEffect(() => {
    scrollToBottom(false)
  }, [currentChatId, isGenerating, activePrompt, scrollToBottom])

  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() || isGenerating) return

      let sessionId = currentChatId
      if (!sessionId) {
        try {
          const chat = await api.createChat()
          sessionId = chat.id
          isNewSessionRef.current = true
          dispatch(setCurrentChat(chat.id))
          dispatch(
            setSessions([
              { id: chat.id, title: chat.title, date: chat.date, pinned: chat.pinned },
              ...sessions,
            ]),
          )
        } catch {
          return
        }
      }

      const userMsg = input.trim()
      setInput('')

      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      dispatch(
        addMessage({
          id: Date.now().toString(),
          sessionId,
          role: 'user',
          content: userMsg,
          timestamp: ts,
        }),
      )

      dispatch(setIsGenerating(true))
      setShowThinking(true)

      const controller = new AbortController()
      abortRef.current = controller
      let assistantMsgId = ''
      let pendingSources: MessageSource[] | undefined
      let pendingTrace: ToolTraceStep[] = []
      let pendingTicket: TicketRef | undefined
      setLiveTrace([])

      try {
        for await (const chunk of api.streamMessage(
          sessionId,
          {
            prompt: userMsg,
            model: selectedModel,
            useRag: true,
            systemPrompt: activePrompt?.content,
          },
          controller.signal,
        )) {
          // 引用溯源事件先于正文到达，暂存待创建消息时带上
          if (chunk.sources && chunk.sources.length > 0) {
            pendingSources = chunk.sources
          }

          // Agent 工具轨迹：start 推入，done 回填摘要（实时同步到思考区）
          if (chunk.tool) {
            if (chunk.tool.status === 'start') {
              pendingTrace = [...pendingTrace, { tool: chunk.tool.tool, status: 'start' }]
            } else {
              pendingTrace = pendingTrace.map((s, i) =>
                i === pendingTrace.length - 1 && s.status === 'start'
                  ? { ...chunk.tool!, status: 'done' as const }
                  : s,
              )
            }
            setLiveTrace(pendingTrace)
          }

          // Agent 自动创建的工单引用
          if (chunk.ticket) {
            pendingTicket = chunk.ticket
          }

          if (chunk.error) {
            setShowThinking(false)
            if (isNewSessionRef.current) {
              isNewSessionRef.current = false
              const title = userMsg.length > 10 ? userMsg.slice(0, 10) + '...' : userMsg
              dispatch(renameChat({ id: sessionId, title }))
              api.renameChat(sessionId, title).catch(() => {})
            }
            dispatch(
              addMessage({
                id: Date.now().toString(),
                sessionId,
                role: 'assistant',
                content: `出错了：${chunk.error}`,
                timestamp: ts,
              }),
            )
            break
          }

          if (chunk.done) {
            stopFlushTimer()
            flushBuffer()
            bufferRef.current = { id: '', content: '' }
            dispatch(setIsGenerating(false))
            assistantMsgId = ''
            break
          }

          if (chunk.content) {
            if (assistantMsgId) {
              bufferRef.current.content += chunk.content
            } else {
              setShowThinking(false)
              if (isNewSessionRef.current) {
                isNewSessionRef.current = false
                const title = userMsg.length > 10 ? userMsg.slice(0, 10) + '...' : userMsg
                dispatch(renameChat({ id: sessionId, title }))
                api.renameChat(sessionId, title).catch(() => {})
              }
              assistantMsgId = Date.now().toString()
              bufferRef.current = { id: assistantMsgId, content: chunk.content }
              dispatch(
                addMessage({
                  id: assistantMsgId,
                  sessionId,
                  role: 'assistant',
                  content: chunk.content,
                  timestamp: ts,
                  model: selectedModel,
                  sources: pendingSources,
                  toolTrace: pendingTrace.length > 0 ? pendingTrace : undefined,
                  ticketRef: pendingTicket || undefined,
                }),
              )
            }
            startFlushTimer()
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        stopFlushTimer()
        setShowThinking(false)
        if (isNewSessionRef.current) {
          isNewSessionRef.current = false
          const title = userMsg.length > 10 ? userMsg.slice(0, 10) + '...' : userMsg
          dispatch(renameChat({ id: sessionId, title }))
          api.renameChat(sessionId, title).catch(() => {})
        }
        try {
          const res = await api.sendMessage(sessionId, {
            prompt: userMsg,
            model: selectedModel,
            useRag: true,
            systemPrompt: activePrompt?.content,
          })
          dispatch(
            addMessage({
              id: Date.now().toString(),
              sessionId,
              role: 'assistant',
              content: res.data,
              timestamp: ts,
              model: selectedModel,
            }),
          )
        } catch {
          dispatch(
            addMessage({
              id: Date.now().toString(),
              sessionId,
              role: 'assistant',
              content: '无法连接到服务器，请先在设置中检查后端连接状态。',
              timestamp: ts,
            }),
          )
        }
        dispatch(setIsGenerating(false))
      } finally {
        abortRef.current = null
      }
    },
    [
      dispatch,
      input,
      isGenerating,
      selectedModel,
      activePrompt,
      currentChatId,
      sessions,
      flushBuffer,
      stopFlushTimer,
      startFlushTimer,
    ],
  )

  const isEmpty = !currentChatId || messages.length === 0

  return (
    <div className="flex flex-col h-full">
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
        {isEmpty ? (
          /* ===== 空状态：引导台 ===== */
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="relative rise-in">
              <div className="absolute -inset-6 rounded-full bg-brand/10 blur-2xl" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center shadow-xl shadow-emerald-500/30">
                <Activity className="w-8 h-8 text-brand-on" strokeWidth={2.2} />
              </div>
            </div>
            <h2
              className="rise-in font-display text-xl font-bold text-t1 mt-6 tracking-tight"
              style={{ animationDelay: '90ms' }}
            >
              ServiceDeck 智能服务台助手
            </h2>
            <p
              className="rise-in font-mono text-[11px] text-t3 mt-2 tracking-wider"
              style={{ animationDelay: '150ms' }}
            >
              流式通道就绪 · 输入指令开始对话
            </p>

            <div
              className="rise-in grid grid-cols-2 gap-2.5 mt-8 w-full max-w-xl"
              style={{ animationDelay: '220ms' }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s)
                    textareaRef.current?.focus()
                  }}
                  className="text-left px-3.5 py-3 rounded-xl panel card-hover text-xs text-t3 hover:text-t1 leading-relaxed flex items-start gap-2"
                >
                  <Terminal className="w-3 h-3 mt-0.5 text-brand/70 shrink-0" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ===== 消息流 ===== */
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
            {messages.map((msg) =>
              msg.role === 'user' ? (
                /* 用户消息：右对齐气泡 */
                <div key={msg.id} className="flex items-start gap-3 justify-end rise-in">
                  <div className="max-w-[75%] rounded-2xl rounded-tr-md bg-brand/10 border border-brand/20 px-4 py-3">
                    <div className="flex items-center justify-end gap-2 mb-1">
                      <span className="text-[10px] text-t3">{msg.timestamp}</span>
                      <span className="text-[10px] font-mono text-brand/80">你</span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed text-sm text-t1">
                      {msg.content}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-s3 border border-line flex items-center justify-center shrink-0 text-t2">
                    <User className="w-4 h-4" />
                  </div>
                </div>
              ) : (
                /* AI 消息：平铺式，突出内容与模型标识 */
                <div key={msg.id} className="flex items-start gap-3 rise-in">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/20">
                    <Bot className="w-4 h-4 text-brand-on" />
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-mono text-brand/90 tracking-wide">
                        {msg.model || '智能助手'}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-linestrong" />
                      <span className="text-[10px] text-t3">{msg.timestamp}</span>
                    </div>
                    {msg.toolTrace && msg.toolTrace.length > 0 && (
                      <AgentTrace steps={msg.toolTrace} />
                    )}
                    <div className="text-sm text-t2">
                      <MarkdownMessage content={msg.content} />
                      {isGenerating &&
                        msg.id === messages[messages.length - 1].id &&
                        !showThinking && <span className="stream-cursor" />}
                    </div>
                    {msg.ticketRef && <TicketNotice ticket={msg.ticketRef} />}
                    {msg.sources && msg.sources.length > 0 && <SourceCards sources={msg.sources} />}
                  </div>
                </div>
              ),
            )}

            {/* 思考中：Agent 轨迹实时展示 + 推理指示 */}
            {isGenerating && showThinking && (
              <div className="flex items-start gap-3 fade-in">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center shrink-0 animate-pulse">
                  <Bot className="w-4 h-4 text-brand-on" />
                </div>
                <div className="pt-1 flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1">
                      <span className="thinking-dot" />
                      <span className="thinking-dot" style={{ animationDelay: '0.15s' }} />
                      <span className="thinking-dot" style={{ animationDelay: '0.3s' }} />
                    </div>
                    <span className="text-[11px] font-mono text-t3 tracking-wider">
                      {liveTrace.length > 0
                        ? '工具执行中...'
                        : `${selectedModel.toUpperCase()} 正在推理...`}
                    </span>
                  </div>
                  {liveTrace.length > 0 && <AgentTrace steps={liveTrace} live />}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ===== 输入台 ===== */}
      <div className="px-6 pb-4 pt-2">
        <form onSubmit={handleSend} className="max-w-3xl mx-auto">
          {isGenerating && (
            <div className="flex justify-center pb-2.5">
              <button
                type="button"
                onClick={handleStop}
                className="px-3.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 text-[11px] font-mono flex items-center gap-1.5 transition-colors border border-rose-500/25"
              >
                <Square className="w-2.5 h-2.5 fill-rose-500" />
                停止生成
              </button>
            </div>
          )}
          {/* 已注入的提示词 chip */}
          {activePrompt && (
            <div className="fade-in flex justify-center pb-2.5">
              <div className="flex items-center gap-2 pl-3 pr-1.5 py-1 rounded-full bg-brand/10 border border-brand/30 max-w-full">
                <Sparkles className="w-3 h-3 text-brand shrink-0" />
                <span className="text-[11px] text-brand font-mono truncate">
                  角色 · {activePrompt.title}
                </span>
                <button
                  type="button"
                  onClick={() => dispatch(clearActivePrompt())}
                  className="p-0.5 rounded-full text-brand/70 hover:text-brand hover:bg-brand/20 transition-colors shrink-0"
                  title="移除注入"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
          <div
            className={`relative rounded-2xl panel transition-all duration-300 p-2 gap-2 flex items-end focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_var(--brand-ring),0_8px_30px_-12px_var(--brand-glow)] ${
              isGenerating ? 'scanline' : ''
            }`}
          >
            {/* 提示词选择器 */}
            <div ref={pickerRef} className="relative shrink-0">
              {pickerOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl panel border border-line shadow-2xl shadow-black/50 overflow-hidden rise-in z-20">
                  <div className="px-3 py-2 border-b border-line">
                    <span className="text-[10px] font-mono text-brand/70">注入提示词</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {promptList.length === 0 ? (
                      <div className="px-3 py-4 text-center text-[11px] font-mono text-t4">
                        暂无提示词 · 去提示词广场创建
                      </div>
                    ) : (
                      promptList.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            dispatch(
                              setActivePrompt({ id: p.id, title: p.title, content: p.content }),
                            )
                            setPickerOpen(false)
                          }}
                          className={`w-full text-left px-3 py-2.5 hover:bg-s3 transition-colors flex items-center gap-2.5 ${
                            p.id === activePrompt?.id ? 'bg-brand/10' : ''
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full shrink-0 ${
                              p.id === activePrompt?.id ? 'bg-brand' : 'bg-linestrong'
                            }`}
                          />
                          <span className="text-xs text-t2 truncate flex-1">{p.title}</span>
                          <span className="text-[9px] font-mono text-t4 shrink-0">
                            {p.category}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className={`p-2 rounded-lg transition-colors ${
                  activePrompt
                    ? 'text-brand bg-brand/10 hover:bg-brand/20'
                    : 'text-t3 hover:text-t1 hover:bg-s3'
                }`}
                title="注入提示词角色"
              >
                <Sparkles className="w-4 h-4" />
              </button>
            </div>

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend(e)
                }
              }}
              placeholder="向智能助手发送指令..."
              rows={1}
              className="flex-1 bg-transparent border-none text-sm text-t1 placeholder:text-t4 focus:outline-none px-1 resize-none overflow-y-auto leading-relaxed"
              style={{
                boxSizing: 'border-box',
                minHeight: '32px',
                maxHeight: '192px',
                lineHeight: '20px',
                padding: '6px 4px',
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isGenerating}
              className="p-2.5 rounded-xl bg-brand-strong hover:brightness-110 disabled:opacity-30 text-brand-on transition-all shadow-md shadow-emerald-500/25 shrink-0"
              title="发送"
            >
              <ArrowDown className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>
          <div className="flex items-center justify-between px-2 pt-2 text-[10px] text-t4 font-mono">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <span className="flex items-center gap-1.5">
              <Send className="w-3 h-3" />
              流式对话 · {selectedModel.toUpperCase()}
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}
