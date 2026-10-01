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
  setMessageFeedback,
  setSessions,
  renameChat,
  setActiveTab,
  setActivePrompt,
  clearActivePrompt,
  setSelectedModel,
} from '@/entities/chat/model/chatSlice'
import { api, syncToken } from '@/shared/api/client'
import { TicketDetailModal } from '@/widgets/ticket-detail/ui/TicketDetailModal'
import type {
  MessageSource,
  MessageFeedback,
  MessageFeedbackReason,
  PromptItem,
  TicketDraft,
  TicketRef,
  ToolTraceStep,
  ChatAttachmentBrief,
} from '@servicedesk/sdk'
import { ApiError, FEEDBACK_REASON_OPTIONS, TICKET_CATEGORY_OPTIONS } from '@servicedesk/sdk'
import {
  Square,
  ArrowUp,
  Sparkles,
  X,
  BookMarked,
  Wrench,
  Search,
  TicketCheck,
  Check,
  ChevronDown,
  Loader2,
  ShieldQuestion,
  ThumbsUp,
  ThumbsDown,
  Paperclip,
} from 'lucide-react'

const FLUSH_INTERVAL = 60

// 优先级徽标（建单确认卡）
const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
}

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
            <code className="bg-s3 text-t1 px-1 py-0.5 rounded font-mono text-[11px]" {...props}>
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
              className="text-brand hover:opacity-80 underline underline-offset-2 decoration-brand/40"
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

// 引用溯源：RAG 命中的知识库片段（幽灵折叠行，不打断阅读）
const SourceCards: React.FC<{ sources: MessageSource[] }> = ({ sources }) => {
  const [open, setOpen] = useState(false)
  if (sources.length === 0) return null
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 -mx-2 py-1 rounded-lg text-xs text-t3 hover:text-t1 hover:bg-s3 transition-colors"
      >
        <BookMarked className="w-3.5 h-3.5" />
        {sources.length} 个知识库来源
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 fade-in">
          {sources.map((s, i) => (
            <div key={`${s.documentId}-${i}`} className="p-2.5 rounded-xl bg-s2 border border-line">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-t1 truncate">
                  {s.documentName}
                  {s.sectionPath ? ` · ${s.sectionPath}` : ''}
                </span>
                <span className="text-[10px] text-t4 shrink-0 tabular-nums">相关度 {s.score}</span>
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
  const [open, setOpen] = useState(live ?? false)
  if (steps.length === 0) return null
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 -mx-2 py-1 rounded-lg text-xs text-t3 hover:text-t1 hover:bg-s3 transition-colors"
      >
        <Wrench className="w-3.5 h-3.5" />
        {live ? '正在执行工具…' : `执行了 ${steps.length} 个步骤`}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 fade-in">
          {steps.map((s, i) => {
            const meta = TOOL_META[s.tool] || {
              label: s.tool,
              icon: <Wrench className="w-3.5 h-3.5" />,
            }
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-s2 border border-line"
              >
                <span className="text-t3 shrink-0">{meta.icon}</span>
                <span className="text-xs text-t2 font-medium shrink-0">{meta.label}</span>
                {s.summary && (
                  <span className="text-[11px] text-t4 truncate flex-1">{s.summary}</span>
                )}
                {s.status === 'start' ? (
                  <Loader2 className="w-3.5 h-3.5 text-t3 animate-spin shrink-0" />
                ) : (
                  <Check className="w-3.5 h-3.5 text-t3 shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 答案满意度反馈：👍/👎，点👎展开原因标签（可跳过直接提交）。
// 再次点击已选按钮 = 撤销评价。负例连同原因经 eval:collect 导出为评测候选用例。
const MessageFeedbackBar: React.FC<{
  feedback?: MessageFeedback | null
  feedbackReason?: MessageFeedbackReason | null
  onVote: (feedback: MessageFeedback | null, reason?: MessageFeedbackReason | null) => void
}> = ({ feedback, feedbackReason, onVote }) => {
  const [reasonOpen, setReasonOpen] = useState(false)

  const clickUp = () => {
    setReasonOpen(false)
    onVote(feedback === 'up' ? null : 'up')
  }
  const clickDown = () => {
    if (feedback === 'down') {
      // 已是👎：再次点击撤销
      setReasonOpen(false)
      onVote(null)
      return
    }
    // 先记下👎（不阻塞），再展开原因供可选补充
    onVote('down')
    setReasonOpen(true)
  }

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-0.5">
        <button
          onClick={clickUp}
          title="回答有帮助"
          className={`p-1.5 rounded-lg transition-colors ${
            feedback === 'up' ? 'text-t1 bg-s3' : 'text-t4 hover:text-t1 hover:bg-s3'
          }`}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={clickDown}
          title="回答没帮助"
          className={`p-1.5 rounded-lg transition-colors ${
            feedback === 'down' ? 'text-t1 bg-s3' : 'text-t4 hover:text-t1 hover:bg-s3'
          }`}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
        {feedback === 'down' && feedbackReason && !reasonOpen && (
          <span className="ml-1 text-[10px] text-t4">
            {FEEDBACK_REASON_OPTIONS.find((o) => o.value === feedbackReason)?.label}
          </span>
        )}
      </div>
      {/* 原因标签：可选，点任一即提交；「跳过」直接收起（👎 已记录） */}
      {reasonOpen && feedback === 'down' && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap fade-in">
          <span className="text-[11px] text-t4">哪里不好？（可跳过）</span>
          {FEEDBACK_REASON_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onVote('down', o.value)
                setReasonOpen(false)
              }}
              className={`px-2 py-0.5 rounded-full border text-[11px] transition-colors ${
                feedbackReason === o.value
                  ? 'text-t1 border-linestrong bg-s3'
                  : 'text-t3 border-line hover:text-t1 hover:border-linestrong'
              }`}
            >
              {o.label}
            </button>
          ))}
          <button
            onClick={() => setReasonOpen(false)}
            className="px-2 py-0.5 text-[11px] text-t4 hover:text-t1 transition-colors"
          >
            跳过
          </button>
        </div>
      )}
    </div>
  )
}

// Agent 自动创建的工单通知卡片：点击直接打开工单详情（时间线/评论/状态操作）
const TicketNotice: React.FC<{ ticket: TicketRef; onOpen: () => void }> = ({ ticket, onOpen }) => {
  const dispatch = useDispatch()
  return (
    <div
      className="mt-3 flex items-center justify-between gap-3 p-3 rounded-2xl border border-line bg-s2 fade-in cursor-pointer hover:border-linestrong transition-colors"
      onClick={onOpen}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-full bg-signal/10 text-signal flex items-center justify-center shrink-0">
          <TicketCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-t3">已升级为人工工单</p>
          <p className="text-xs text-t1 font-semibold truncate mt-0.5">{ticket.title}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={(e) => {
            e.stopPropagation()
            dispatch(setActiveTab('tickets'))
          }}
          className="px-2.5 py-1.5 rounded-full text-t2 hover:text-t1 text-[11px] border border-line hover:border-linestrong transition-colors"
        >
          工单页
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className="px-3 py-1.5 rounded-full bg-signal/15 hover:bg-signal/25 text-signal text-[11px] font-medium shrink-0 transition-colors"
        >
          查看详情
        </button>
      </div>
    </div>
  )
}

// HITL 建单确认卡：Agent 暂停中，用户决定是否创建该工单
const TicketConfirmCard: React.FC<{
  draft: TicketDraft & { resolved: boolean; approved?: boolean }
  onDecide: (approved: boolean) => void
}> = ({ draft, onDecide }) => {
  const [busy, setBusy] = useState(false)
  const pr = PRIORITY_LABEL[draft.priority] || '普通'
  // Agent 判定的分类：确认前让用户看到（判错时坐席可在工单详情纠正）
  const cg = TICKET_CATEGORY_OPTIONS.find((o) => o.value === (draft.category || 'other'))?.label

  const decide = async (approved: boolean) => {
    if (busy || draft.resolved) return
    setBusy(true)
    try {
      await onDecide(approved)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 p-4 rounded-2xl border border-line bg-s2 fade-in">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-full bg-signal/10 text-signal flex items-center justify-center shrink-0">
          <ShieldQuestion className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-t3">
            确认创建工单 · 优先级 {pr}
            {cg ? ` · ${cg}` : ''}
          </p>
          <p className="text-xs text-t1 font-semibold truncate">{draft.title}</p>
        </div>
      </div>
      <p className="text-[11px] text-t3 leading-relaxed line-clamp-4 whitespace-pre-wrap">
        {draft.content}
      </p>
      <div className="flex items-center justify-end gap-2 mt-3.5">
        {draft.resolved ? (
          <span className="text-[11px] text-t4">
            {draft.approved ? '已确认创建' : '已拒绝，AI 将继续对话'}
          </span>
        ) : (
          <>
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="px-3.5 py-1.5 rounded-full text-t2 hover:text-t1 text-xs border border-line hover:border-linestrong transition-colors disabled:opacity-50"
            >
              暂不创建
            </button>
            <button
              onClick={() => decide(true)}
              disabled={busy}
              className="px-4 py-1.5 rounded-full bg-signal hover:brightness-110 text-white text-xs font-medium transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              确认创建
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// 空状态的建议提问（贴合 IT 服务台场景）
const SUGGESTIONS = [
  '忘记域账号密码，如何重置？',
  '办公区 Wi-Fi 连不上怎么排查？',
  '如何申请安装设计类软件？',
  'VPN 权限申请的流程是什么？',
]

// 可选模型（与后端 OpenAI 兼容服务配置对应）
const MODELS = ['glm-4.5-air', 'glm-4.6v', 'glm-4.7', 'DeepSeek-V4-flash']

export const ChatPage: React.FC = () => {
  const dispatch = useDispatch()
  const { currentChatId, messagesBySession, sessions, selectedModel, isGenerating, activePrompt } =
    useSelector((state: RootState) => state.chat)
  const token = useSelector((state: RootState) => state.auth.token)
  const messages = currentChatId ? (messagesBySession[currentChatId] ?? []) : []
  const [input, setInput] = useState('')
  const [showThinking, setShowThinking] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [promptList, setPromptList] = useState<PromptItem[]>([])
  const [liveTrace, setLiveTrace] = useState<ToolTraceStep[]>([])
  const [ticketDetailId, setTicketDetailId] = useState<string | null>(null)
  // 本轮待发送的对话附件（已上传落盘，发送时随请求注入上下文）
  const [pendingAtts, setPendingAtts] = useState<ChatAttachmentBrief[]>([])
  const [attUploading, setAttUploading] = useState(false)
  const attInputRef = useRef<HTMLInputElement>(null)
  // HITL 建单确认卡（Agent 暂停中等待用户决定）
  const [confirmDraft, setConfirmDraft] = useState<
    (TicketDraft & { resolved: boolean; approved?: boolean }) | null
  >(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 用户对建单确认卡做出决定 → 恢复挂起的 Agent 循环（服务端继续生成）
  const handleConfirmDecision = async (approved: boolean) => {
    if (!confirmDraft || confirmDraft.resolved || !currentChatId) return
    try {
      await api.confirmTicket(currentChatId, confirmDraft.requestId, approved)
      setConfirmDraft({ ...confirmDraft, resolved: true, approved })
    } catch {
      // 失败保持可重试（不标记 resolved）
    }
  }

  // 断连或刷新后恢复未决的建单确认卡。
  // Agent 推到确认门时草稿已按 status=pending 落库，服务端也支持在内存注册表未命中时
  // 按草稿补建；但如果界面上不再把这张卡显示出来，用户就永远不知道有个请求等他拍板 ——
  // 工单要么悬着，要么被他重复提问再建一张。
  useEffect(() => {
    // 切会话总是先清：确认卡属于某一个会话，不能跟着用户跳过去
    setConfirmDraft(null)
    if (!currentChatId) return
    let cancelled = false
    api
      .listPendingTicketDrafts(currentChatId)
      .then((drafts) => {
        if (cancelled) return
        // 只恢复最近一条：确认是逐个决策的交互，堆叠多张卡反而看不清该点哪个
        const latest = drafts[0]
        if (latest) setConfirmDraft({ ...latest, resolved: false })
      })
      .catch(() => {
        // 拉不到就当没有：不该因为恢复失败而挡住正常提问
      })
    return () => {
      cancelled = true
    }
  }, [currentChatId])

  // 提示词选择器：打开时按需拉取列表
  useEffect(() => {
    if (!pickerOpen || promptList.length > 0) return
    api
      .listPrompts()
      .then(setPromptList)
      .catch(() => {})
  }, [pickerOpen, promptList.length])

  // 点击选择器外部时关闭（提示词 / 模型）
  useEffect(() => {
    if (!pickerOpen && !modelOpen) return
    const onClick = (e: MouseEvent) => {
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setPickerOpen(false)
      if (modelOpen && modelRef.current && !modelRef.current.contains(e.target as Node))
        setModelOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [pickerOpen, modelOpen])

  const bufferRef = useRef({ id: '', sessionId: '', content: '' })
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
    // 本轮刚创建的会话没有历史可拉：拉一次就用服务端的空快照盖掉刚乐观插入的用户气泡，
    // 消息列表退回空 → 界面回到欢迎页，而 HITL 确认卡渲染在非空分支里 —— 确认门再也按不到，
    // 生成器却正卡在门上。只读不清标记（流结束处还要用它刷新会话列表）
    if (isNewSessionRef.current) return
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
              attachments: m.attachments || undefined,
              // 恢复已评价状态（重载页面后按钮仍高亮）
              feedback: m.feedback || null,
              feedbackReason: m.feedbackReason || null,
            })),
          }),
        )
      })
      .catch(() => {})
  }, [currentChatId, dispatch])

  // 冲刷的目标会话取自 buffer 自身，不读 currentChatId：handleSend 在发送那一刻定格的
  // 闭包里，新会话的 currentChatId 仍是 null（setCurrentChat 之后本轮循环也取不到新值），
  // 用它会把内容写到 messagesBySession[''] 上被 reducer 静默丢弃 —— 新会话的首条回答
  // 因此卡在第一个分片，之后所有增量都落不到消息上。
  const flushBuffer = useCallback(() => {
    const { id, sessionId, content } = bufferRef.current
    if (!id || !sessionId || !content) return
    dispatch(updateMessageContent({ id, sessionId, content }))
  }, [dispatch])

  // 满意度反馈：先乐观更新（点击即有反馈），接口失败则回滚到原值
  const handleVote = useCallback(
    async (
      messageId: string,
      feedback: MessageFeedback | null,
      reason?: MessageFeedbackReason | null,
    ) => {
      if (!currentChatId) return
      const before = (messagesBySession[currentChatId] || []).find((m) => m.id === messageId)
      dispatch(
        setMessageFeedback({
          id: messageId,
          sessionId: currentChatId,
          feedback,
          feedbackReason: reason ?? null,
        }),
      )
      try {
        await api.setMessageFeedback(currentChatId, messageId, feedback, reason)
      } catch {
        dispatch(
          setMessageFeedback({
            id: messageId,
            sessionId: currentChatId,
            feedback: before?.feedback ?? null,
            feedbackReason: before?.feedbackReason ?? null,
          }),
        )
      }
    },
    [dispatch, currentChatId, messagesBySession],
  )

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
    // abort 只退订 SSE；取消后台泵要走 stop 端点（流与连接已解耦）
    if (currentChatId) api.stopStream(currentChatId).catch(() => {})
    abortRef.current?.abort()
    abortRef.current = null
    flushBuffer()
    stopFlushTimer()
    dispatch(setIsGenerating(false))
  }, [dispatch, flushBuffer, stopFlushTimer, currentChatId])

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

  // 附件必须挂在会话上：无当前会话时先建（与发送同一路径），
  // 新建标记同置位，首条回答到达时才会用提问内容重命名
  const ensureSessionId = useCallback(async (): Promise<string | null> => {
    if (currentChatId) return currentChatId
    try {
      const chat = await api.createChat()
      isNewSessionRef.current = true
      dispatch(setCurrentChat(chat.id))
      dispatch(
        setSessions([
          { id: chat.id, title: chat.title, date: chat.date, pinned: chat.pinned },
          ...sessions,
        ]),
      )
      return chat.id
    } catch {
      return null
    }
  }, [currentChatId, dispatch, sessions])

  // 纸夹选文件：立即上传落盘，芯片进入待发送列表
  const handlePickAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || attUploading) return
    const sessionId = await ensureSessionId()
    if (!sessionId) return
    setAttUploading(true)
    try {
      const brief = await api.uploadChatAttachment(sessionId, file, file.name)
      setPendingAtts((prev) => [...prev, brief])
    } catch {
      // 上传失败不入芯片，用户可重试
    } finally {
      setAttUploading(false)
    }
  }

  const handleRemoveAttachment = (att: ChatAttachmentBrief) => {
    if (currentChatId) api.deleteChatAttachment(currentChatId, att.id).catch(() => {})
    setPendingAtts((prev) => prev.filter((p) => p.id !== att.id))
  }

  // 历史消息里的附件芯片：下载字节转 object URL 打开
  const openAttachment = async (sessionId: string, a: ChatAttachmentBrief) => {
    try {
      const blob = await api.downloadChatAttachment(sessionId, a.id)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      // 字节丢失时不假装打开
    }
  }

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

      let sessionId = await ensureSessionId()
      if (!sessionId) return

      const userMsg = input.trim()
      const atts = pendingAtts
      setInput('')
      setPendingAtts([])
      // 新一轮提问：清空上一轮的建单确认卡
      setConfirmDraft(null)

      const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      dispatch(
        addMessage({
          id: Date.now().toString(),
          sessionId,
          role: 'user',
          content: userMsg,
          timestamp: ts,
          attachments: atts.length > 0 ? atts : undefined,
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
            attachments: atts.length > 0 ? atts.map((a) => a.id) : undefined,
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

          // HITL 建单确认请求：Agent 暂停等待用户决定 → 渲染确认卡
          if (chunk.confirm) {
            setConfirmDraft({ ...chunk.confirm, resolved: false })
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
            bufferRef.current = { id: '', sessionId: '', content: '' }
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
              bufferRef.current = { id: assistantMsgId, sessionId, content: chunk.content }
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
        // 429 / 409 是「拒绝」不是「这条链路坏了」：非流式旁路同样过闸门与互斥，
        // 回退过去只会再被拒一次，还把原因盖成了「无法连接到服务器」
        if (err instanceof ApiError && (err.status === 429 || err.status === 409)) {
          dispatch(
            addMessage({
              id: Date.now().toString(),
              sessionId,
              role: 'assistant',
              content: err.message,
              timestamp: ts,
            }),
          )
          dispatch(setIsGenerating(false))
          return
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
              // 回退路径不跑工具循环：引用来源要显示，降级标记要让用户看见
              sources: res.sources && res.sources.length > 0 ? res.sources : undefined,
              degraded: true,
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
      pendingAtts,
      ensureSessionId,
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
          /* ===== 空状态：印章 + 衬线问候 + 建议提问 ===== */
          <div className="h-full flex flex-col items-center justify-center px-6 pb-8">
            <div className="rise-in w-12 h-12 rounded-2xl bg-s2 border border-line shadow-sm flex items-center justify-center">
              <span className="font-display text-xl font-bold text-brand">台</span>
            </div>
            <h2
              className="rise-in font-display text-[28px] leading-snug font-semibold text-t1 mt-6 tracking-wide text-center"
              style={{ animationDelay: '80ms' }}
            >
              今天想解决什么问题？
            </h2>
            <p
              className="rise-in text-sm text-t3 mt-3 max-w-md text-center leading-relaxed"
              style={{ animationDelay: '140ms' }}
            >
              AI 会先检索企业知识库并给出带出处的解答；超出范围时，经你确认自动升级为人工工单。
            </p>
            <div
              className="rise-in flex flex-wrap justify-center gap-2 mt-8 max-w-2xl"
              style={{ animationDelay: '200ms' }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s)
                    textareaRef.current?.focus()
                  }}
                  className="px-3.5 py-2 rounded-full border border-line bg-s2 text-xs text-t2 hover:text-t1 hover:border-linestrong transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ===== 消息流 ===== */
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
            {messages.map((msg) =>
              msg.role === 'user' ? (
                /* 用户消息：右对齐圆角气泡，无头像 */
                <div key={msg.id} className="flex justify-end rise-in">
                  <div className="max-w-[80%] rounded-2xl bg-s2 border border-line px-4 py-2.5">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1.5">
                        {msg.attachments.map((a) => (
                          <button
                            key={a.id}
                            onClick={() => openAttachment(msg.sessionId, a)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-s3 text-[10px] text-t2 hover:text-t1 transition-colors max-w-full"
                            title={`下载 ${a.name}`}
                          >
                            <Paperclip className="w-3 h-3 shrink-0" />
                            <span className="truncate">{a.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed text-[15px] text-t1">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ) : (
                /* AI 消息：通栏平铺，无头像无标签，阅读优先 */
                <div key={msg.id} className="rise-in">
                  {/* 非流式回退：有 RAG 但没跑工具循环，不标注会被当成有升级保障的回答 */}
                  {msg.degraded && (
                    <div className="mb-2">
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[11px] border border-line bg-s2 text-t3"
                        title="实时通道中断，已改用一次性返回：仍基于知识库作答，但不会自动升级工单"
                      >
                        降级回答 · 不会自动升级工单
                      </span>
                    </div>
                  )}
                  {msg.toolTrace && msg.toolTrace.length > 0 && (
                    <AgentTrace steps={msg.toolTrace} />
                  )}
                  <div
                    className="text-[15px] text-t1"
                    title={`${msg.model || '智能助手'} · ${msg.timestamp}`}
                  >
                    <MarkdownMessage content={msg.content} />
                    {isGenerating &&
                      msg.id === messages[messages.length - 1].id &&
                      !showThinking && <span className="stream-cursor" />}
                  </div>
                  {msg.ticketRef && (
                    <TicketNotice
                      ticket={msg.ticketRef}
                      onOpen={() => setTicketDetailId(msg.ticketRef!.id)}
                    />
                  )}
                  {msg.sources && msg.sources.length > 0 && <SourceCards sources={msg.sources} />}
                  {/* 满意度反馈：生成中的最后一条不显示（回答未完成无从评价） */}
                  {!(isGenerating && msg.id === messages[messages.length - 1].id) && (
                    <MessageFeedbackBar
                      feedback={msg.feedback}
                      feedbackReason={msg.feedbackReason}
                      onVote={(feedback, reason) => handleVote(msg.id, feedback, reason)}
                    />
                  )}
                </div>
              ),
            )}

            {/* 思考中：Agent 轨迹实时展示 + 推理指示 */}
            {isGenerating && showThinking && (
              <div className="fade-in space-y-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center gap-1">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" style={{ animationDelay: '0.15s' }} />
                    <span className="thinking-dot" style={{ animationDelay: '0.3s' }} />
                  </div>
                  <span className="text-xs text-t3">
                    {liveTrace.length > 0 ? '正在执行工具…' : '正在思考…'}
                  </span>
                </div>
                {liveTrace.length > 0 && <AgentTrace steps={liveTrace} live />}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/*
          HITL 建单确认卡：刻意放在欢迎页/消息列表两个分支之外。
          Agent 是停在确认门上才产出正文的，此刻消息列表可能还是空的（首条提问尚未落库）；
          卡若在非空分支里，用户既看不到门也点不到门，而生成器会一直等到确认窗口超时。
        */}
        {confirmDraft && (
          <div className="fade-in max-w-3xl mx-auto px-1">
            <TicketConfirmCard draft={confirmDraft} onDecide={handleConfirmDecision} />
          </div>
        )}
      </div>

      {/* ===== 输入器：ChatGPT 式胶囊 Composer ===== */}
      <div className="px-4 pb-3 pt-1">
        <form onSubmit={handleSend} className="max-w-3xl mx-auto">
          {isGenerating && (
            <div className="flex justify-center pb-2.5">
              <button
                type="button"
                onClick={handleStop}
                className="px-3 py-1 rounded-full bg-s2 border border-line text-t2 hover:text-t1 hover:border-linestrong text-xs flex items-center gap-1.5 transition-colors"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                停止生成
              </button>
            </div>
          )}
          {/* 待发送附件芯片 */}
          {pendingAtts.length > 0 && (
            <div className="fade-in flex flex-wrap gap-1.5 pb-2">
              {pendingAtts.map((a) => (
                <span
                  key={a.id}
                  className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-s2 border border-line text-[11px] text-t2 max-w-[240px]"
                >
                  <Paperclip className="w-3 h-3 text-t4 shrink-0" />
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(a)}
                    className="p-0.5 rounded-full text-t4 hover:text-t1 hover:bg-s3 transition-colors shrink-0"
                    title="移除附件"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div
            className={`relative rounded-2xl bg-s2 border border-line shadow-sm transition-colors focus-within:border-linestrong ${
              isGenerating ? 'scanline' : ''
            }`}
          >
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
              placeholder="描述你遇到的问题…"
              rows={1}
              className="w-full bg-transparent border-none text-[15px] text-t1 placeholder:text-t4 focus:outline-none px-4 pt-3 pb-1 resize-none overflow-y-auto leading-relaxed"
              style={{
                boxSizing: 'border-box',
                minHeight: '24px',
                maxHeight: '192px',
                lineHeight: '22px',
              }}
            />
            {/* 坞内工具条：附件 / 提示词注入 / 角色 chip / 模型 / 发送 */}
            <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1">
              {/* 对话附件纸夹 */}
              <button
                type="button"
                onClick={() => attInputRef.current?.click()}
                disabled={attUploading || isGenerating}
                className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 transition-colors shrink-0 disabled:opacity-50"
                title="添加附件（日志/截图等；文本类 Agent 可读全文）"
              >
                {attUploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Paperclip className="w-4 h-4" />
                )}
              </button>
              <input
                ref={attInputRef}
                type="file"
                className="hidden"
                onChange={handlePickAttachment}
              />
              {/* 提示词选择器 */}
              <div ref={pickerRef} className="relative shrink-0">
                {pickerOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-72 rounded-xl bg-s2 border border-line shadow-xl fade-in overflow-hidden z-20">
                    <div className="px-3 py-2 border-b border-line">
                      <span className="text-[11px] text-t3">注入提示词</span>
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                      {promptList.length === 0 ? (
                        <div className="px-3 py-4 text-center text-[11px] text-t4">
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
                              p.id === activePrompt?.id ? 'bg-s3' : ''
                            }`}
                          >
                            <span
                              className={`w-1 h-1 rounded-full shrink-0 ${
                                p.id === activePrompt?.id ? 'bg-brand' : 'bg-linestrong'
                              }`}
                            />
                            <span className="text-xs text-t2 truncate flex-1">{p.title}</span>
                            <span className="text-[10px] text-t4 shrink-0">{p.category}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    activePrompt
                      ? 'text-brand bg-brand/10 hover:bg-brand/20'
                      : 'text-t3 hover:text-t1 hover:bg-s3'
                  }`}
                  title="注入提示词角色"
                >
                  <Sparkles className="w-4 h-4" />
                </button>
              </div>

              {/* 已注入的角色 chip */}
              {activePrompt && (
                <div className="fade-in flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-s3 max-w-[38%]">
                  <span className="text-[11px] text-t2 truncate">角色 · {activePrompt.title}</span>
                  <button
                    type="button"
                    onClick={() => dispatch(clearActivePrompt())}
                    className="p-0.5 rounded-full text-t4 hover:text-t1 hover:bg-s2 transition-colors shrink-0"
                    title="移除注入"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="flex-1" />

              {/* 模型选择器 */}
              <div ref={modelRef} className="relative shrink-0">
                {modelOpen && (
                  <div className="absolute bottom-full right-0 mb-2 w-52 rounded-xl bg-s2 border border-line shadow-xl fade-in overflow-hidden z-20 py-1">
                    <div className="px-3 py-1.5 text-[11px] text-t4">切换模型</div>
                    {MODELS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          dispatch(setSelectedModel(m))
                          setModelOpen(false)
                        }}
                        className="w-full px-3 py-1.5 flex items-center justify-between gap-2 text-xs text-t2 hover:bg-s3 transition-colors"
                      >
                        <span className="truncate">{m}</span>
                        {m === selectedModel && (
                          <Check className="w-3.5 h-3.5 text-brand shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setModelOpen((o) => !o)}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] text-t3 hover:text-t1 hover:bg-s3 transition-colors"
                  title="选择模型"
                >
                  {selectedModel}
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${modelOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              </div>

              {isGenerating ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-2 rounded-full bg-brand-strong text-brand-on transition-all shrink-0"
                  title="停止生成"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2 rounded-full bg-brand-strong hover:brightness-110 disabled:opacity-30 text-brand-on transition-all shrink-0"
                  title="发送"
                >
                  <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
          <p className="text-center text-[11px] text-t4 pt-2">
            AI 生成的内容可能不准确，重要操作请以工单流程为准。
          </p>
        </form>
      </div>

      {/* 会话内引用工单 → 直接打开详情弹窗（时间线/评论/状态操作） */}
      {ticketDetailId && (
        <TicketDetailModal ticketId={ticketDetailId} onClose={() => setTicketDetailId(null)} />
      )}
    </div>
  )
}
