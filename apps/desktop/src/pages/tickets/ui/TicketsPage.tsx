import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Clock3,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  TicketCheck,
  X,
} from 'lucide-react'
import { HttpClient } from '@ai-workspace/sdk'
import type {
  SupportTicket,
  TicketPriority,
  TicketStatus,
  TicketSuggestion,
} from '@ai-workspace/sdk'

const api = new HttpClient('http://localhost:3000')

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: '待处理',
  analyzing: '分析中',
  pending_approval: '待审批',
  resolved: '已回复',
  closed: '已关闭',
}

const STATUS_COLOR: Record<TicketStatus, string> = {
  open: '#60a5fa',
  analyzing: '#a78bfa',
  pending_approval: '#f59e0b',
  resolved: '#34d399',
  closed: '#94a3b8',
}

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const TicketsPage: React.FC = () => {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupportTicket | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [replyDraft, setReplyDraft] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    customerName: '',
    customerEmail: '',
    externalRef: '',
    priority: 'medium' as TicketPriority,
  })

  const pending = useMemo(
    () => detail?.suggestions.find((item) => item.status === 'pending') || null,
    [detail],
  )

  const loadTickets = async (preferredId?: string) => {
    setLoading(true)
    setError('')
    try {
      const list = await api.getTickets()
      setTickets(list)
      const nextId = preferredId || selectedId || list[0]?.id || null
      setSelectedId(nextId)
      if (nextId) {
        const item = await api.getTicket(nextId)
        setDetail(item)
      } else {
        setDetail(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载工单失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTickets()
  }, [])

  useEffect(() => {
    setReplyDraft(pending?.reply || '')
  }, [pending?.id])

  const selectTicket = async (id: string) => {
    setSelectedId(id)
    setError('')
    try {
      setDetail(await api.getTicket(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载工单失败')
    }
  }

  const createTicket = async () => {
    if (!form.title.trim() || !form.description.trim() || !form.customerName.trim()) return
    setWorking(true)
    setError('')
    try {
      const created = await api.createTicket(form)
      setShowCreate(false)
      setForm({
        title: '',
        description: '',
        customerName: '',
        customerEmail: '',
        externalRef: '',
        priority: 'medium',
      })
      await loadTickets(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建工单失败')
    } finally {
      setWorking(false)
    }
  }

  const generateSuggestion = async () => {
    if (!detail) return
    setWorking(true)
    setError('')
    try {
      await api.generateTicketSuggestion(detail.id)
      await loadTickets(detail.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成建议失败')
      await loadTickets(detail.id)
    } finally {
      setWorking(false)
    }
  }

  const decide = async (suggestion: TicketSuggestion, approved: boolean) => {
    if (!detail) return
    setWorking(true)
    setError('')
    try {
      const updated = await api.decideTicketSuggestion(detail.id, suggestion.id, {
        approved,
        content: approved ? replyDraft : undefined,
      })
      setDetail(updated)
      await loadTickets(detail.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '审批失败')
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="px-6 py-4 border-b flex items-center justify-between"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
          >
            <TicketCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold">企业工单助手</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              知识检索生成建议，人工审批后形成正式回复
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void loadTickets()}
            className="p-2 rounded-xl border"
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
          >
            <Plus className="w-4 h-4" /> 新建工单
          </button>
        </div>
      </div>

      {error && (
        <div
          className="mx-6 mt-3 px-4 py-2 rounded-xl text-sm flex items-center gap-2 text-red-300"
          style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.2)' }}
        >
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="ticket-layout flex-1 min-h-0 grid">
        <aside
          className="border-r overflow-y-auto p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-panel)' }}
        >
          {loading && tickets.length === 0 ? (
            <div className="p-8 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center">
              <TicketCheck className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-dim)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                暂无工单
              </p>
            </div>
          ) : (
            tickets.map((ticket) => (
              <button
                key={ticket.id}
                onClick={() => void selectTicket(ticket.id)}
                className="w-full text-left p-3 mb-2 rounded-xl border transition-all"
                style={
                  selectedId === ticket.id
                    ? { background: 'rgba(245,158,11,.09)', borderColor: 'rgba(245,158,11,.3)' }
                    : { background: 'var(--bg-elevated)', borderColor: 'var(--border-soft)' }
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold line-clamp-2">{ticket.title}</span>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-dim)' }} />
                </div>
                <div className="flex items-center justify-between mt-3 text-[10px] font-mono">
                  <span style={{ color: STATUS_COLOR[ticket.status] }}>
                    ● {STATUS_LABEL[ticket.status]}
                  </span>
                  <span style={{ color: 'var(--text-dim)' }}>{formatDate(ticket.updatedAt)}</span>
                </div>
                <div className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                  {ticket.externalRef || ticket.customerName} · 优先级{' '}
                  {PRIORITY_LABEL[ticket.priority]}
                </div>
              </button>
            ))
          )}
        </aside>

        <main className="overflow-y-auto p-6">
          {!detail ? (
            <div
              className="h-full flex items-center justify-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              选择一条工单查看详情
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-4">
              <section
                className="rounded-2xl border p-5"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div
                      className="flex items-center gap-2 text-xs mb-2"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span>{detail.externalRef || detail.id.slice(0, 8)}</span>
                      <span>·</span>
                      <span>{detail.customerName}</span>
                      {detail.customerEmail && (
                        <>
                          <span>·</span>
                          <span>{detail.customerEmail}</span>
                        </>
                      )}
                    </div>
                    <h2 className="text-xl font-bold">{detail.title}</h2>
                  </div>
                  <span
                    className="px-3 py-1 rounded-full text-xs font-mono"
                    style={{
                      color: STATUS_COLOR[detail.status],
                      background: `${STATUS_COLOR[detail.status]}18`,
                    }}
                  >
                    {STATUS_LABEL[detail.status]}
                  </span>
                </div>
                <p
                  className="mt-4 text-sm leading-7 whitespace-pre-wrap"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {detail.description}
                </p>
              </section>

              <section
                className="rounded-2xl border overflow-hidden"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
              >
                <div
                  className="px-5 py-4 border-b flex items-center justify-between"
                  style={{ borderColor: 'var(--border-soft)' }}
                >
                  <div className="flex items-center gap-2">
                    <Bot className="w-4 h-4 text-amber-400" />
                    <span className="font-semibold text-sm">AI 处理建议</span>
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ color: 'var(--text-muted)', background: 'var(--input-bg)' }}
                    >
                      需人工审批
                    </span>
                  </div>
                  <button
                    onClick={generateSuggestion}
                    disabled={working || detail.status === 'closed'}
                    className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-40"
                    style={{ background: 'rgba(245,158,11,.12)', color: '#f59e0b' }}
                  >
                    {working ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Bot className="w-3.5 h-3.5" />
                    )}
                    {pending ? '重新生成' : '生成处理建议'}
                  </button>
                </div>

                {pending ? (
                  <div className="p-5 space-y-5">
                    <div>
                      <p
                        className="text-[11px] uppercase tracking-widest mb-2"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        处理摘要
                      </p>
                      <p className="text-sm leading-6 whitespace-pre-wrap">{pending.summary}</p>
                    </div>
                    <div>
                      <p
                        className="text-[11px] uppercase tracking-widest mb-2"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        拟回复客户
                      </p>
                      <textarea
                        value={replyDraft}
                        onChange={(e) => setReplyDraft(e.target.value)}
                        rows={9}
                        className="w-full rounded-xl border p-4 text-sm leading-6 resize-y focus:outline-none"
                        style={{
                          background: 'var(--input-bg)',
                          borderColor: 'var(--border)',
                          color: 'var(--text-main)',
                        }}
                      />
                    </div>
                    {pending.sources && pending.sources.length > 0 && (
                      <div>
                        <p
                          className="text-[11px] uppercase tracking-widest mb-2 flex items-center gap-2"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          <FileText className="w-3.5 h-3.5" />
                          知识引用
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {pending.sources.map((source, index) => (
                            <span
                              key={`${source.documentId}-${source.chunkIndex}-${index}`}
                              className="px-2.5 py-1.5 rounded-lg text-xs"
                              style={{ background: 'var(--input-bg)', color: 'var(--text-muted)' }}
                            >
                              {source.documentName} · 片段 {source.chunkIndex + 1} ·{' '}
                              {Math.round(source.score * 100)}%
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        disabled={working}
                        onClick={() => void decide(pending, false)}
                        className="px-4 py-2 rounded-xl text-sm flex items-center gap-2 text-red-300"
                        style={{ background: 'rgba(239,68,68,.1)' }}
                      >
                        <X className="w-4 h-4" /> 驳回
                      </button>
                      <button
                        disabled={working || !replyDraft.trim()}
                        onClick={() => void decide(pending, true)}
                        className="px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 text-white disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}
                      >
                        <Send className="w-4 h-4" /> 批准并回复
                      </button>
                    </div>
                  </div>
                ) : detail.finalReply ? (
                  <div className="p-5">
                    <div className="flex items-center gap-2 text-emerald-400 mb-3">
                      <ShieldCheck className="w-4 h-4" />
                      <span className="text-sm font-semibold">已审批并形成正式回复</span>
                    </div>
                    <p className="text-sm leading-7 whitespace-pre-wrap">{detail.finalReply}</p>
                  </div>
                ) : (
                  <div className="p-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                    <Bot className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-dim)' }} />
                    点击“生成处理建议”，系统将检索你的企业知识库。
                  </div>
                )}
              </section>

              {detail.auditEvents && detail.auditEvents.length > 0 && (
                <section
                  className="rounded-2xl border p-5"
                  style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <Clock3 className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-sm font-semibold">审计轨迹</span>
                  </div>
                  <div className="space-y-3">
                    {detail.auditEvents.slice(0, 8).map((event) => (
                      <div key={event.id} className="flex items-center gap-3 text-xs">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-mono">{event.action}</span>
                        <span className="ml-auto" style={{ color: 'var(--text-dim)' }}>
                          {formatDate(event.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </main>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(8px)' }}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border p-5"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold">新建客户工单</h2>
              <button onClick={() => setShowCreate(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                placeholder="客户名称 *"
                className="ticket-input"
              />
              <input
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                placeholder="客户邮箱"
                className="ticket-input"
              />
              <input
                value={form.externalRef}
                onChange={(e) => setForm({ ...form, externalRef: e.target.value })}
                placeholder="外部工单号"
                className="ticket-input"
              />
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as TicketPriority })}
                className="ticket-input"
              >
                <option value="low">低优先级</option>
                <option value="medium">中优先级</option>
                <option value="high">高优先级</option>
                <option value="urgent">紧急</option>
              </select>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="工单标题 *"
                className="ticket-input col-span-2"
              />
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="详细描述客户问题、环境和已尝试操作 *"
                rows={7}
                className="ticket-input col-span-2 resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-xl text-sm"
                style={{ color: 'var(--text-muted)' }}
              >
                取消
              </button>
              <button
                disabled={
                  working ||
                  !form.title.trim() ||
                  !form.description.trim() ||
                  !form.customerName.trim()
                }
                onClick={() => void createTicket()}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-40 flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
              >
                {working && <Loader2 className="w-4 h-4 animate-spin" />} 创建工单
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
