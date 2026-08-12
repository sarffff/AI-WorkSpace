import React, { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '@/app/providers/store'
import {
  addMessage,
  updateMessageContent,
  updateMessageTools,
  setIsGenerating,
  setCurrentChat,
  setRagEnabled,
  setMessages as setSessionMessages,
  updateMessageSources,
  promoteChat,
} from '@/entities/chat/model/chatSlice'
import { HttpClient } from '@ai-workspace/sdk'
import type { StreamChunk } from '@ai-workspace/sdk/src/http-client'
import type { ToolActivityInfo } from '@ai-workspace/sdk'
import {
  ArrowRight,
  Bot,
  Clock,
  Code2,
  Files,
  Loader2,
  Send,
  Sparkles,
  StopCircle,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'

const api = new HttpClient('http://localhost:3000')

export const ChatPage: React.FC = () => {
  const { t } = useI18n()
  const dispatch = useDispatch()
  const {
    currentChatId,
    messagesBySession,
    selectedModel,
    ragEnabled: autoRagEnabled,
    isGenerating,
  } = useSelector((state: RootState) => state.chat)
  const [inputText, setInputText] = React.useState('')
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [approval, setApproval] = React.useState<{
    toolCallId: string
    name: string
    args: Record<string, unknown>
    isAllowed: boolean
  } | null>(null)
  const [messages, setMessages] = React.useState<RootState['chat']['messagesBySession'][string]>([])
  const [feedbackState, setFeedbackState] = React.useState<
    Record<string, 'up' | 'down' | undefined>
  >({})

  const contentBufferRef = useRef(new Map<string, string>())
  const toolCallsBufferRef = useRef(new Map<string, ToolActivityInfo[]>())
  const abortControllerRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const msgs = currentChatId ? messagesBySession[currentChatId] || [] : []
    setMessages(msgs)
  }, [currentChatId, messagesBySession])

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return ''
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  useEffect(scrollToBottom, [messages])

  useEffect(() => {
    const initSession = async () => {
      if (!currentChatId || sessionId === currentChatId) return
      try {
        const msgs = await api.getMessages(currentChatId)
        setSessionId(currentChatId)
        dispatch(setCurrentChat(currentChatId))
        const converted = msgs.map((m) => ({
          id: m.id,
          sessionId: currentChatId,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          timestamp: m.createdAt,
          model: m.model,
          sources: m.sources ?? undefined,
          tools: m.tools ?? undefined,
        }))
        dispatch(setSessionMessages({ sessionId: currentChatId, messages: converted }))
      } catch {
        const res = await api.createChat('New Conversation')
        setSessionId(res.id)
        dispatch(setCurrentChat(res.id))
      }
    }
    initSession().catch(() => {})
  }, [currentChatId, sessionId, dispatch])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 160) + 'px'
    }
  }, [inputText])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail) {
        setInputText(detail)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('insert-prompt', handler)
    return () => window.removeEventListener('insert-prompt', handler)
  }, [])

  const isStreamActive = isGenerating || !!approval

  const stopStreaming = () => {
    abortControllerRef.current?.abort()
    dispatch(setIsGenerating(false))
  }

  const sendMessage = async (text: string) => {
    const promptText = text.trim()
    if (!promptText || !sessionId || isStreamActive) return
    if (approval) return

    contentBufferRef.current.clear()
    toolCallsBufferRef.current.clear()
    dispatch(setIsGenerating(true))
    dispatch(updateMessageTools({ id: '', sessionId, tools: [] }))

    const userMsg = {
      id: `user-${Date.now()}`,
      sessionId,
      role: 'user' as const,
      content: promptText,
      timestamp: new Date().toISOString(),
    }
    const assistantMsg = {
      id: `assistant-${Date.now()}`,
      sessionId,
      role: 'assistant' as const,
      content: '',
      timestamp: new Date().toISOString(),
    }
    dispatch(addMessage(userMsg))
    dispatch(addMessage(assistantMsg))
    dispatch(updateMessageContent({ id: assistantMsg.id, sessionId, content: '' }))
    setInputText('')

    if (inputRef.current) inputRef.current.style.height = 'auto'

    const runStream = async () => {
      for await (const chunk of api.streamMessage(
        sessionId,
        {
          prompt: promptText,
          model: selectedModel,
          useRag: autoRagEnabled,
        },
        abortControllerRef.current?.signal,
      )) {
        const c = chunk as StreamChunk

        if (c.content !== undefined) {
          const buf = contentBufferRef.current.get(assistantMsg.id) || ''
          const updated = buf + c.content
          contentBufferRef.current.set(assistantMsg.id, updated)
          dispatch(updateMessageContent({ id: assistantMsg.id, sessionId, content: updated }))
        }

        if (c.toolCall) {
          const buf = toolCallsBufferRef.current.get(assistantMsg.id) || []
          const updated = [
            ...buf,
            {
              id: c.toolCall.id,
              name: c.toolCall.name,
              args: c.toolCall.args,
              output: '',
              status: 'ok' as const,
            },
          ]
          toolCallsBufferRef.current.set(assistantMsg.id, updated)
          dispatch(updateMessageTools({ id: assistantMsg.id, sessionId, tools: updated }))
        }

        if (c.approval) {
          setApproval({
            toolCallId: c.approval.toolCallId,
            name: c.approval.name,
            args: c.approval.args,
            isAllowed: false,
          })
        }

        if (c.done) {
          dispatch(setIsGenerating(false))
          dispatch(promoteChat(sessionId))
          dispatch(
            updateMessageTools({
              id: assistantMsg.id,
              sessionId,
              tools: toolCallsBufferRef.current.get(assistantMsg.id) || [],
            }),
          )
        }

        if (c.error) {
          dispatch(
            updateMessageContent({ id: assistantMsg.id, sessionId, content: `错误: ${c.error}` }),
          )
          dispatch(setIsGenerating(false))
        }

        if (c.sources) {
          dispatch(updateMessageSources({ id: assistantMsg.id, sessionId, sources: c.sources }))
        }
      }
    }

    ;(async () => {
      try {
        await runStream()
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const fallbackMsg = {
            id: `assistant-fallback-${Date.now()}`,
            sessionId,
            role: 'assistant' as const,
            content: '流中断，正在重试...',
            timestamp: new Date().toISOString(),
          }
          dispatch(addMessage(fallbackMsg))
          try {
            const res = await api.sendMessage(sessionId, {
              prompt: promptText,
              model: selectedModel,
              useRag: autoRagEnabled,
            })
            if (res.success) {
              dispatch(updateMessageContent({ id: fallbackMsg.id, sessionId, content: res.data }))
              dispatch(promoteChat(sessionId))
              if (res.sources)
                dispatch(
                  updateMessageSources({ id: fallbackMsg.id, sessionId, sources: res.sources }),
                )
              if (res.tools)
                dispatch(updateMessageTools({ id: fallbackMsg.id, sessionId, tools: res.tools }))
            }
          } catch {
            dispatch(
              updateMessageContent({ id: fallbackMsg.id, sessionId, content: '获取响应失败。' }),
            )
          }
          dispatch(setIsGenerating(false))
        }
      }
    })()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  const handleApprovalDecision = async (approved: boolean) => {
    if (!approval) return
    await api.approveToolCall(sessionId!, approval.toolCallId, approved)
    setApproval(null)
  }

  if (!currentChatId && !sessionId) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ background: 'var(--bg-void)' }}
      >
        <div className="text-center space-y-4 fade-up">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
            style={{
              background: 'linear-gradient(135deg,#0ea5e9,#22d3ee,#f59e0b)',
              boxShadow: '0 0 40px rgba(34,211,238,.35)',
            }}
          >
            <Bot className="w-8 h-8 text-white" />
          </div>
          <p className="text-slate-500 text-sm">{t('chat.selectConv')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex flex-col h-full" style={{ background: 'var(--bg-void)' }}>
      <div
        className="absolute top-0 left-0 right-0 h-48 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% 0%, var(--glow-cyan) 0%, transparent 70%)',
        }}
      />

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 z-10">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 fade-up">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center animate-agent-ring"
              style={{
                background: 'linear-gradient(135deg,#0ea5e9 0%,#22d3ee 60%,#f59e0b 100%)',
                boxShadow: '0 0 60px rgba(34,211,238,.3)',
              }}
            >
              <Bot className="w-10 h-10 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-main)' }}>
                {t('chat.howCanHelp')}
              </h2>
              <p className="text-sm mt-1 max-w-sm" style={{ color: 'var(--text-muted)' }}>
                随时提问 — 代码、研究、分析或一般性问题。Agent 会自动调用工具并检索知识库。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-md mt-4">
              {[
                { icon: <Code2 className="w-3.5 h-3.5" />, label: '调试代码问题' },
                { icon: <Files className="w-3.5 h-3.5" />, label: '总结文档内容' },
                { icon: <Sparkles className="w-3.5 h-3.5" />, label: '生成提示词' },
                { icon: <ArrowRight className="w-3.5 h-3.5" />, label: '解释概念' },
              ].map((s, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInputText(s.label)
                    inputRef.current?.focus()
                  }}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs transition-colors text-left input-placeholder"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-soft)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span style={{ color: 'var(--accent-cyan)' }}>{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.id === 'init') return null
            const toolCalls = msg.tools || []
            return (
              <div
                key={msg.id}
                className={`fade-up flex gap-3 group ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div className="shrink-0 pt-0.5">
                  {msg.role === 'user' ? (
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-bold"
                      style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
                    >
                      {'U'.toUpperCase()}
                    </div>
                  ) : (
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{
                        background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
                        boxShadow: '0 0 12px rgba(34,211,238,.3)',
                      }}
                    >
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 w-fit max-w-[780px]">
                  <div
                    className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${msg.role === 'user' ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
                    style={
                      msg.role === 'user'
                        ? {
                            background: 'rgba(34,211,238,.08)',
                            border: '1px solid rgba(34,211,238,.12)',
                            color: 'var(--text-main)',
                          }
                        : {
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-main)',
                          }
                    }
                  >
                    {msg.role === 'assistant' ? (
                      <>
                        {toolCalls.length > 0 && (
                          <div className="mb-3 space-y-2">
                            {toolCalls.map((tc: ToolActivityInfo, idx: number) => (
                              <div
                                key={idx}
                                className="flex items-center gap-2 text-[11px] font-mono px-2.5 py-1.5 rounded-lg"
                                style={{
                                  background: 'rgba(245,158,11,.08)',
                                  border: '1px solid rgba(245,158,11,.15)',
                                  color: '#fbbf24',
                                }}
                              >
                                <Clock className="w-3 h-3 shrink-0" />
                                <span className="font-semibold">{tc.name}</span>
                                <span className="text-slate-500 truncate">
                                  {JSON.stringify(tc.args)}
                                </span>
                                {isStreamActive &&
                                  idx === toolCalls.length - 1 &&
                                  tc.status === 'ok' && (
                                    <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                                  )}
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.content}
                        {isStreamActive && !msg.content && (
                          <span className="inline-block w-0.5 h-4 bg-cyan-400 animate-pulse ml-0.5 align-middle" />
                        )}
                      </>
                    ) : (
                      msg.content
                    )}
                  </div>

                  <div className="flex items-center gap-2 mt-1.5 px-1">
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                      {formatTime(msg.timestamp)}
                    </span>
                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: 'var(--accent-cyan)' }}
                      >
                        · {msg.sources.length} 来源
                      </span>
                    )}
                    {msg.role === 'assistant' && (
                      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {[
                          { icon: <ThumbsUp className="w-3 h-3" />, val: 'up' as const },
                          { icon: <ThumbsDown className="w-3 h-3" />, val: 'down' as const },
                        ].map(({ icon, val }) => (
                          <button
                            key={val}
                            onClick={() =>
                              setFeedbackState((prev) => {
                                const k = msg.id
                                return { ...prev, [k]: prev[k] === val ? undefined : val }
                              })
                            }
                            className={`p-1 rounded hover:bg-white/5 transition-colors ${(feedbackState[msg.id] || '') === val ? 'text-cyan-400' : 'text-slate-600'}`}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {approval && !approval.isAllowed && (
        <div
          className="mx-6 mb-3 rounded-xl border p-3 flex items-center gap-3 fade-up"
          style={{ background: 'rgba(245,158,11,.06)', borderColor: 'rgba(245,158,11,.2)' }}
        >
          <Clock className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-amber-200">{t('chat.waitingApproval')}</div>
            <div className="text-[11px] text-amber-400/70 font-mono mt-0.5 truncate">
              {approval.name} · {JSON.stringify(approval.args)}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => handleApprovalDecision(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
            >
              {t('chat.denied')}
            </button>
            <button
              onClick={() => handleApprovalDecision(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20 transition-colors"
              style={{ background: 'rgba(34,211,238,.1)', borderColor: 'rgba(34,211,238,.2)' }}
            >
              {t('chat.approved')}
            </button>
          </div>
        </div>
      )}

      <div className="px-6 pb-5 pt-3 z-10">
        <div
          className="rounded-2xl border relative overflow-hidden transition-all focus-within:border-cyan-500/40"
          style={{
            borderColor: approval ? 'rgba(245,158,11,.3)' : 'var(--border)',
            background: 'var(--bg-panel)',
            boxShadow: '0 4px 24px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.04)',
          }}
        >
          <div
            className="h-px w-full"
            style={{
              background: approval
                ? 'linear-gradient(90deg,transparent,rgba(245,158,11,.4),transparent)'
                : 'linear-gradient(90deg,transparent,var(--glow-cyan),transparent)',
            }}
          />

          <div className="flex items-end gap-3 px-4 py-3">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={approval ? t('chat.waitingApproval') : '给 AI Workspace 发消息...'}
              disabled={!!approval}
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm focus:outline-none leading-relaxed max-h-40"
              style={{ minHeight: 24, color: 'var(--text-main)' }}
            />

            {isStreamActive ? (
              <button
                onClick={stopStreaming}
                className="p-2 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                title={t('chat.stopGen')}
              >
                <StopCircle className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage(inputText)}
                disabled={!inputText.trim() || !sessionId}
                className="p-2 rounded-xl transition-all shrink-0 disabled:opacity-30 hover:scale-105 active:scale-95"
                style={{
                  background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
                  boxShadow: '0 4px 16px rgba(34,211,238,.3)',
                }}
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            )}
          </div>

          <div className="flex items-center justify-between px-4 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                {selectedModel}
              </span>
              <span className="text-slate-700">·</span>
              <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {messages.filter((m) => m.role === 'assistant' && m.id !== 'init').length} 条回复
              </span>
            </div>
            <button
              onClick={() => {
                dispatch(setRagEnabled(!autoRagEnabled))
                api.updateSettings({ AUTO_RAG_ENABLED: String(!autoRagEnabled) }).catch(() => {})
              }}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium transition-all`}
              style={
                autoRagEnabled
                  ? {
                      background: 'rgba(34,211,238,.1)',
                      color: 'var(--accent-cyan)',
                      border: '1px solid rgba(34,211,238,.2)',
                    }
                  : {
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border-soft)',
                      color: 'var(--text-muted)',
                    }
              }
            >
              <Sparkles className="w-3 h-3" />
              RAG {autoRagEnabled ? t('chat.ragOn') : t('chat.ragOff')}
            </button>
          </div>
        </div>

        <p className="text-center text-[10px] mt-2" style={{ color: 'var(--text-dim)' }}>
          AI 可能会产生错误信息，请核实重要内容。
        </p>
      </div>
    </div>
  )
}
