import React, { useState, useRef, useEffect, useCallback } from 'react'
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
} from '@/entities/chat/model/chatSlice'
import { api, syncToken } from '@/shared/api/client'
import { Send, Bot, User, Paperclip, Square, Activity, ArrowDown, Terminal } from 'lucide-react'

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

// 空状态的建议提问
const SUGGESTIONS = [
  '解释 Monorepo 与 Turborepo 的增量构建原理',
  '帮我设计 Prisma 的多租户数据模型',
  'NestJS 中如何实现 SSE 流式响应？',
  '对比 Redis 缓存与内存缓存的取舍',
]

export const ChatPage: React.FC = () => {
  const dispatch = useDispatch()
  const { currentChatId, messagesBySession, sessions, selectedModel, isGenerating } = useSelector(
    (state: RootState) => state.chat,
  )
  const token = useSelector((state: RootState) => state.auth.token)
  const messages = currentChatId ? (messagesBySession[currentChatId] ?? []) : []
  const [input, setInput] = useState('')
  const [showThinking, setShowThinking] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const bufferRef = useRef({ id: '', content: '' })
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isNewSessionRef = useRef(false)

  // token 变化时同步到共享客户端
  useEffect(() => {
    syncToken(token)
  }, [token])

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = '20px'
      const scrollHeight = textarea.scrollHeight
      textarea.style.height = `${Math.min(scrollHeight, 192)}px`
    }
  }

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

  useEffect(() => {
    if (isNearBottom()) scrollToBottom()
  })

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
      if (textareaRef.current) textareaRef.current.style.height = '20px'

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

      try {
        for await (const chunk of api.streamMessage(
          sessionId,
          { prompt: userMsg, model: selectedModel },
          controller.signal,
        )) {
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
                content: `Error: ${chunk.error}`,
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
          const res = await api.sendMessage(sessionId, { prompt: userMsg, model: selectedModel })
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
              AI Workspace 智能助手
            </h2>
            <p
              className="rise-in font-mono text-[11px] text-t3 mt-2 tracking-wider"
              style={{ animationDelay: '150ms' }}
            >
              STREAM READY · 输入指令开始对话
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
                      <span className="text-[10px] font-mono text-brand/80">YOU</span>
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
                        {(msg.model || 'AGENT').toUpperCase()}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-linestrong" />
                      <span className="text-[10px] text-t3">{msg.timestamp}</span>
                    </div>
                    <div className="text-sm text-t2">
                      <MarkdownMessage content={msg.content} />
                      {isGenerating &&
                        msg.id === messages[messages.length - 1].id &&
                        !showThinking && <span className="stream-cursor" />}
                    </div>
                  </div>
                </div>
              ),
            )}

            {/* 思考中 */}
            {isGenerating && showThinking && (
              <div className="flex items-start gap-3 fade-in">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center shrink-0 animate-pulse">
                  <Bot className="w-4 h-4 text-brand-on" />
                </div>
                <div className="pt-3 flex items-center gap-2.5">
                  <div className="flex items-center gap-1">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" style={{ animationDelay: '0.15s' }} />
                    <span className="thinking-dot" style={{ animationDelay: '0.3s' }} />
                  </div>
                  <span className="text-[11px] font-mono text-t3 tracking-wider">
                    {selectedModel.toUpperCase()} 正在推理...
                  </span>
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
                STOP · 停止生成
              </button>
            </div>
          )}
          <div
            className={`relative rounded-2xl panel transition-all duration-300 p-2 gap-2 flex items-end focus-within:border-brand/50 focus-within:shadow-[0_0_0_1px_var(--brand-ring),0_8px_30px_-12px_var(--brand-glow)] ${
              isGenerating ? 'scanline' : ''
            }`}
          >
            <button
              type="button"
              className="p-2 text-t3 hover:text-t1 hover:bg-s3 rounded-lg transition-colors shrink-0"
              title="上传文件（即将支持）"
            >
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                adjustTextareaHeight()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend(e)
                }
              }}
              placeholder="向 Agent 发送指令..."
              className="flex-1 bg-transparent border-none text-sm text-t1 placeholder:text-t4 focus:outline-none px-1 py-2 resize-none overflow-y-auto leading-relaxed"
              style={{ height: '20px', minHeight: '20px', maxHeight: '192px' }}
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
            <span>ENTER 发送 · SHIFT+ENTER 换行</span>
            <span className="flex items-center gap-1.5">
              <Send className="w-3 h-3" />
              SSE STREAM · {selectedModel.toUpperCase()}
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}
