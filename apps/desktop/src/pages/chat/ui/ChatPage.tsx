import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useSelector, useDispatch } from 'react-redux'
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
import { HttpClient } from '@ai-workspace/sdk'
import { Send, Square, Paperclip, Hexagon, Wand2 } from 'lucide-react'

const API_BASE = 'http://localhost:3000'
const FLUSH_INTERVAL = 60

const api = new HttpClient(API_BASE)

export const ChatPage: React.FC = () => {
  const dispatch = useDispatch()
  const { currentChatId, messagesBySession, sessions, selectedModel, isGenerating } = useSelector(
    (state: RootState) => state.chat,
  )
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

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = '24px'
      const scrollHeight = textarea.scrollHeight
      textarea.style.height = `${Math.min(scrollHeight, 200)}px`
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

  // 空状态建议提示
  const suggestedPrompts = [
    { icon: '📚', label: '总结我知识库中的最新文档', hint: '调用 RAG 检索' },
    { icon: '💡', label: '给我一些有创意的项目灵感', hint: '头脑风暴' },
    { icon: '📝', label: '帮我优化一段提示词', hint: '提示词工程' },
    { icon: '🔍', label: '解释这段代码的工作原理', hint: '代码分析' },
  ]

  const handleSend = useCallback(
    async (e: React.FormEvent, overrideInput?: string) => {
      e.preventDefault()
      const text = overrideInput || input.trim()
      if (!text || isGenerating) return

      let sessionId = currentChatId
      if (!sessionId) {
        try {
          const chat = await api.createChat()
          sessionId = chat.id
          isNewSessionRef.current = true
          dispatch(setCurrentChat(chat.id))
          dispatch(
            setSessions([
              {
                id: chat.id,
                title: chat.title,
                date: chat.date,
                pinned: chat.pinned,
              },
              ...sessions,
            ]),
          )
        } catch {
          return
        }
      }

      const userMsg = text
      setInput('')
      if (textareaRef.current) {
        textareaRef.current.style.height = '24px'
      }

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
          { prompt: userMsg, model: selectedModel, useRag: true },
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
          const res = await api.sendMessage(sessionId, {
            prompt: userMsg,
            model: selectedModel,
            useRag: true,
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
              content: '无法连接到服务器，请确认后端已启动。',
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

  const isEmptyState = !currentChatId || messages.length === 0

  return (
    <div className="flex flex-col h-full bg-[var(--bg-base)] relative">
      {/* ===== 消息区域 ===== */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scroll-smooth"
      >
        {isEmptyState ? (
          /* ===== Claude 风格空状态 ===== */
          <div className="flex flex-col items-center justify-center h-full animate-fade-slide">
            {/* 主图标 */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-yellow-500 flex items-center justify-center shadow-xl shadow-amber-900/40 mb-6 relative overflow-hidden animate-pulse-glow">
              <div className="absolute inset-0 bg-gradient-to-tl from-white/15 to-transparent" />
              <Hexagon className="w-8 h-8 text-white relative" strokeWidth={1.4} />
            </div>

            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2 tracking-tight">
              开始新的对话
            </h2>
            <p className="text-sm text-[var(--text-muted)] max-w-sm text-center leading-relaxed mb-8">
              智能体兼具知识库检索与工具调用，` · `选择任意建议快速开始，或直接输入你的想法。
            </p>

            {/* 建议提示卡片 */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-md">
              {suggestedPrompts.map((p, i) => (
                <button
                  key={i}
                  onClick={(e) => handleSend(e as never, p.label)}
                  className="group p-3.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-amber-700/30 text-left transition-all duration-200 card-hover-glow"
                >
                  <span className="text-lg mb-2 block">{p.icon}</span>
                  <p className="text-xs font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] leading-snug transition-colors">
                    {p.label}
                  </p>
                  <span className="text-[10px] text-[var(--text-dim)] mt-1 block">{p.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ===== 消息列表 ===== */
          <>
            {messages.map((msg, idx) => (
              <div
                key={msg.id}
                className={`animate-fade-slide flex items-start gap-4 max-w-3xl ${
                  msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''
                }`}
                style={{ animationDelay: `${Math.min(idx * 0.03, 0.3)}s` }}
              >
                {/* 头像 */}
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white shadow-md ${
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-slate-300 to-slate-100 text-slate-800 font-bold text-xs'
                      : 'bg-gradient-to-br from-amber-600 to-orange-600 shadow-amber-900/25'
                  }`}
                >
                  {msg.role === 'user' ? (
                    (msg.content.charAt(0) || 'U').toUpperCase()
                  ) : (
                    <Hexagon className="w-4 h-4" strokeWidth={2} />
                  )}
                </div>

                {/* 消息体 */}
                <div
                  className={`rounded-2xl text-[13px] leading-[1.7] max-w-[78%] transition-all ${
                    msg.role === 'user'
                      ? 'bg-[var(--bg-hover)] border border-[var(--border-color)] text-[var(--text-primary)] rounded-tr-none px-4 py-3'
                      : 'bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)] rounded-tl-none overflow-hidden'
                  }`}
                >
                  {/* AI 消息头部装饰 */}
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 border-b border-[var(--border-color)]/60 mb-0.5">
                      <Hexagon className="w-3 h-3 text-amber-400 shrink-0" strokeWidth={2} />
                      <span className="text-[11px] font-semibold text-amber-400/80 tracking-wide">
                        AI 工作台
                      </span>
                      <span className="text-[10px] text-[var(--text-dim)] ml-auto shrink-0">
                        {msg.timestamp}
                      </span>
                    </div>
                  )}

                  {/* 用户消息头部 & 内容 */}
                  {msg.role === 'user' && (
                    <div className="flex items-center justify-between gap-4 mb-1.5 text-[11px] text-[var(--text-muted)]">
                      <span className="font-medium">我</span>
                      <span>{msg.timestamp}</span>
                    </div>
                  )}

                  <div className={msg.role === 'assistant' ? 'px-4 pb-3 pt-1' : ''}>
                    <p className="whitespace-pre-wrap break-words text-[var(--text-primary)]">
                      {msg.content}
                    </p>
                  </div>

                  {/* 正在生成 .光标 */}
                  {msg.role === 'assistant' &&
                    isGenerating &&
                    msg.content &&
                    !bufferRef.current.id && (
                      <span className="inline-block w-0.5 h-4 bg-amber-400/70 animate-pulse ml-0.5" />
                    )}
                </div>
              </div>
            ))}

            {/* 思考指示器 */}
            {isGenerating && showThinking && (
              <div className="flex items-start gap-4 max-w-3xl animate-fade-slide">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 flex items-center justify-center text-white shadow-md shadow-amber-900/25 shrink-0">
                  <Hexagon className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="rounded-2xl rounded-tl-none bg-[var(--bg-card)] border border-[var(--border-color)] overflow-hidden">
                  <div className="flex items-center gap-2.5 px-4 pt-3 pb-2 border-b border-[var(--border-color)]/60">
                    <Wand2 className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="text-[11px] font-semibold text-amber-400/80 tracking-wide">
                      AI 工作台
                    </span>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-2.5">
                    <div className="thinking-dots flex items-center">
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="text-[12px] text-[var(--text-muted)]">正在组织语言...</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 停止按钮 */}
      {isGenerating && (
        <div className="flex justify-center pb-2">
          <button
            onClick={handleStop}
            className="px-4 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium flex items-center gap-1.5 transition-all border border-red-500/20 hover:border-red-500/40"
          >
            <Square className="w-3 h-3" />
            停止生成
          </button>
        </div>
      )}

      {/* ===== 输入区 ===== */}
      <div className="shrink-0 px-6 pb-5 pt-1">
        <form onSubmit={handleSend} className="max-w-4xl mx-auto">
          <div
            className={`rounded-2xl border transition-all duration-300 bg-[var(--bg-panel)] backdrop-blur-sm ${'border-[var(--border-color)] focus-within:border-amber-500/50 focus-within:shadow-[0_0_0_3px_rgba(217,119,6,0.08),0_4px_24px_rgba(0,0,0,0.4)]'}`}
          >
            <div className="flex items-end gap-2 p-3">
              <button
                type="button"
                className="p-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] rounded-lg transition-all shrink-0 mb-0.5"
                title="上传附件"
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
                placeholder="输入你的问题或指令…"
                className="flex-1 bg-transparent border-none text-[13px] text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none px-1 py-1.5 resize-none overflow-y-auto leading-relaxed"
                style={{
                  height: '24px',
                  minHeight: '24px',
                  maxHeight: '200px',
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || isGenerating}
                className="p-2.5 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-40 disabled:pointer-events-none text-white transition-all shadow-md shadow-amber-900/25 shrink-0 mb-0.5"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between px-2 pt-2 text-[10px] text-[var(--text-dim)]">
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-color)] text-[9px] text-[var(--text-muted)] font-sans mr-1">
                Enter
              </kbd>
              发送
              <span className="mx-1.5 opacity-40">·</span>
              <kbd className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)] border border-[var(--border-color)] text-[9px] text-[var(--text-muted)] font-sans mr-1">
                Shift + Enter
              </kbd>
              换行
            </span>
            <span className="opacity-60">{selectedModel}</span>
          </div>
        </form>
      </div>
    </div>
  )
}
