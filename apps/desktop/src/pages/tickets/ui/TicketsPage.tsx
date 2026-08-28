import React, { useEffect, useMemo, useState } from 'react'
import { useSelector } from 'react-redux'
import type { TicketItem, TicketStaff, TicketStats } from '@servicedesk/sdk'
import {
  Plus,
  TicketCheck,
  Trash2,
  Loader2,
  X,
  CircleDot,
  UserRound,
  Clock,
  ChevronRight,
  UserCog,
  Activity,
  History,
  BarChart3,
  Gauge,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react'

import { api } from '@/shared/api/client'
import type { RootState } from '@/app/providers/store'
import {
  STATUS_META,
  PRIORITY_META,
  formatTime,
  TicketDetailModal,
} from '@/widgets/ticket-detail/ui/TicketDetailModal'

const PRIORITIES = ['low', 'normal', 'high', 'urgent']
const PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
}

// ===== 新建工单弹窗 =====
const TicketCreator: React.FC<{ onClose: () => void; onSaved: () => void }> = ({
  onClose,
  onSaved,
}) => {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [priority, setPriority] = useState('normal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      setError('标题与问题描述不能为空')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.createTicket({ title: title.trim(), content: content.trim(), priority })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl panel border border-line shadow-2xl shadow-black/50 rise-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-t1">创建工单</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-mono text-t3 tracking-wider">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="一句话概括问题"
              autoFocus
              className="mt-1.5 w-full bg-s4 border border-line rounded-lg px-3 py-2 text-sm text-t1 placeholder:text-t4 focus:outline-none focus:border-brand/50 transition-colors"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-t3 tracking-wider">问题描述</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              placeholder="描述问题现象、影响范围与期望结果..."
              rows={5}
              className="mt-1.5 w-full bg-s4 border border-line rounded-lg px-3 py-2.5 text-sm text-t1 placeholder:text-t4 focus:outline-none focus:border-brand/50 transition-colors resize-none leading-relaxed"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-t3 tracking-wider">优先级</label>
            <div className="mt-1.5 flex items-center gap-2">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-mono border transition-all ${
                    priority === p ? PRIORITY_META[p].style : 'text-t3 border-line hover:text-t2'
                  }`}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-t3 hover:text-t1 hover:bg-s3 transition-colors"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-brand-strong hover:brightness-110 disabled:opacity-50 text-brand-on text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            提交工单
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 转派弹窗（坐席/管理员）=====
const TicketAssigner: React.FC<{
  ticket: TicketItem
  staff: TicketStaff[]
  onClose: () => void
  onSaved: (t: TicketItem) => void
}> = ({ ticket, staff, onClose, onSaved }) => {
  const [assigneeId, setAssigneeId] = useState(ticket.assignee?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!assigneeId) {
      setError('请选择受理人')
      return
    }
    setBusy(true)
    setError('')
    try {
      const updated = await api.updateTicket(ticket.id, { assigneeId })
      onSaved(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '转派失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl panel border border-line shadow-2xl shadow-black/50 rise-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="font-display text-sm font-bold text-t1">转派工单</h3>
            <p className="text-[10px] font-mono text-t4 truncate mt-0.5">{ticket.title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-72 overflow-y-auto">
          {staff.map((s) => (
            <button
              key={s.id}
              onClick={() => setAssigneeId(s.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                assigneeId === s.id
                  ? 'bg-brand/10 border-brand/40'
                  : 'border-line hover:border-linestrong hover:bg-s3'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-s4 border border-line flex items-center justify-center shrink-0">
                <UserRound className="w-3.5 h-3.5 text-t3" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-t1 truncate">{s.name || s.email}</p>
                <p className="text-[10px] font-mono text-t4 truncate">{s.email}</p>
              </div>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-line text-t3 tracking-wider shrink-0">
                {s.role === 'admin' ? 'ADMIN' : 'AGENT'}
              </span>
            </button>
          ))}
          {staff.length === 0 && (
            <p className="text-xs font-mono text-t4 text-center py-4">暂无可分派的坐席</p>
          )}
          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs text-t3 hover:text-t1 hover:bg-s3 transition-colors"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-brand-strong hover:brightness-110 disabled:opacity-50 text-brand-on text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <UserCog className="w-3.5 h-3.5" />
            )}
            确认转派
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 坐席统计看板：偏转率 / SLA / 响应时长（仅坐席/管理员） =====
const TicketStatsPanel: React.FC = () => {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<TicketStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .getTicketStats(days)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [days])

  if (!stats && !loading) return null

  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 1000) / 10}%`)
  const fmtHours = (n: number | null) =>
    n === null ? '—' : n >= 48 ? `${(n / 24).toFixed(1)} 天` : `${n} 小时`

  const statusBars = (['open', 'processing', 'resolved', 'closed'] as const).map((s) => ({
    key: s,
    meta: STATUS_META[s],
    count: stats?.tickets[s] ?? 0,
  }))
  const maxStatus = Math.max(1, ...statusBars.map((b) => b.count))

  const cards = [
    {
      icon: <Gauge className="w-4 h-4 text-brand" />,
      label: 'AI 偏转率',
      value: pct(stats?.deflectRate ?? null),
      sub: stats ? `活跃会话 ${stats.sessions} · AI 升级 ${stats.tickets.escalated}` : '',
      accent: 'text-brand',
    },
    {
      icon: <ShieldCheck className="w-4 h-4 text-sky-400" />,
      label: 'SLA 达标率',
      value: pct(stats?.sla.rate ?? null),
      sub: stats ? `已解决 ${stats.sla.met}/${stats.sla.total} 按优先级阈值` : '',
      accent: 'text-sky-300',
    },
    {
      icon: <Timer className="w-4 h-4 text-amber-400" />,
      label: '平均解决时长',
      value: fmtHours(stats?.sla.avgResolutionHours ?? null),
      sub: stats ? `未完结存量 ${stats.backlog}` : '',
      accent: 'text-amber-300',
    },
    {
      icon: <Zap className="w-4 h-4 text-signal" />,
      label: '平均首次响应',
      value: fmtHours(stats?.sla.avgFirstResponseHours ?? null),
      sub: '受理时间线事件统计',
      accent: 'text-signal',
    },
  ]

  return (
    <div className="rise-in p-5 rounded-xl panel" style={{ animationDelay: '40ms' }}>
      {/* 标题 + 期间切换 */}
      <div className="flex items-center justify-between pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h4 className="font-display text-sm font-semibold text-t1">坐席看板</h4>
            <span className="text-[11px] text-t3">AI 偏转率与人工处理 SLA 概览</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {[7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-all ${
                days === d
                  ? 'bg-brand/15 text-brand border-brand/40'
                  : 'text-t3 border-line hover:text-t2'
              }`}
            >
              近 {d} 天
            </button>
          ))}
        </div>
      </div>

      {loading && !stats ? (
        <div className="h-24 mt-4 rounded-lg bg-s4 animate-pulse" />
      ) : stats ? (
        <>
          {/* 核心指标卡 */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded-lg bg-s4 border border-line px-3.5 py-3">
                <div className="flex items-center gap-1.5 text-t3">
                  {c.icon}
                  <span className="text-[9px] font-mono tracking-wider">{c.label}</span>
                </div>
                <p className={`font-display text-xl font-bold mt-1.5 ${c.accent}`}>{c.value}</p>
                <p className="text-[9px] font-mono text-t4 mt-1 truncate">{c.sub}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 mt-4">
            {/* 状态分布 */}
            <div className="rounded-lg bg-s4 border border-line p-3.5">
              <p className="text-[9px] font-mono text-t4 tracking-wider mb-2.5">
                工单状态分布（期内新建 {stats.tickets.total}）
              </p>
              <div className="space-y-2">
                {statusBars.map((b) => (
                  <div key={b.key} className="flex items-center gap-2.5">
                    <span className="text-[10px] font-mono text-t3 w-12 shrink-0">
                      {b.meta.label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
                      <div
                        className={`h-full rounded-full ${b.meta.dot} transition-all`}
                        style={{ width: `${(b.count / maxStatus) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-t2 w-6 text-right shrink-0">
                      {b.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 优先级 × SLA */}
            <div className="rounded-lg bg-s4 border border-line p-3.5">
              <p className="text-[9px] font-mono text-t4 tracking-wider mb-2.5">
                优先级分布（其中 AI 升级 / SLA 达标）
              </p>
              <div className="space-y-1.5">
                {stats.byPriority.map((p) => (
                  <div
                    key={p.priority}
                    className="flex items-center justify-between text-[10px] font-mono"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded border ${PRIORITY_META[p.priority].style}`}
                    >
                      {PRIORITY_LABEL[p.priority]}
                    </span>
                    <span className="text-t3">
                      共 {p.total} · <span className="text-signal/80">AI {p.escalated}</span> ·
                      已解决 {p.resolved}
                    </span>
                    <span
                      className={
                        p.total && p.slaMet === p.resolved && p.resolved > 0
                          ? 'text-brand'
                          : 'text-t4'
                      }
                    >
                      SLA {p.slaMet}/{p.resolved}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-[9px] font-mono text-t4 mt-3 leading-relaxed">
            偏转率 = 1 − AI 升级工单数 / 期间活跃会话数 · SLA 阈值 紧急 4h / 高 8h / 普通 24h / 低
            48h · 解决时间取时间线事件（旧工单回退最后更新时间）
          </p>
        </>
      ) : null}
    </div>
  )
}

// ===== 页面 =====
export const TicketsPage: React.FC = () => {
  const user = useSelector((s: RootState) => s.auth.user)
  const isStaff = user?.role === 'agent' || user?.role === 'admin'
  const [tickets, setTickets] = useState<TicketItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)
  const [assigning, setAssigning] = useState<TicketItem | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [staff, setStaff] = useState<TicketStaff[]>([])
  const [error, setError] = useState('')

  const refresh = () =>
    api
      .listTickets()
      .then(setTickets)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
  }, [])

  // 坐席进入页面时预加载可分派名单
  useEffect(() => {
    if (isStaff) {
      api
        .listTicketStaff()
        .then(setStaff)
        .catch(() => {})
    }
  }, [isStaff])

  const filtered = useMemo(
    () => (filter === 'all' ? tickets : tickets.filter((t) => t.status === filter)),
    [tickets, filter],
  )
  const openCount = tickets.filter((t) => t.status === 'open' || t.status === 'processing').length

  const setStatus = async (t: TicketItem, status: string) => {
    try {
      const updated = await api.updateTicket(t.id, { status })
      setTickets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败')
    }
  }

  const claim = async (t: TicketItem) => {
    try {
      const updated = await api.updateTicket(t.id, { assigneeId: user?.id })
      setTickets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '受理失败')
    }
  }

  // 优先级循环调整（仅坐席/管理员）
  const cyclePriority = async (t: TicketItem) => {
    const next = PRIORITIES[(PRIORITIES.indexOf(t.priority) + 1) % PRIORITIES.length]
    try {
      const updated = await api.updateTicket(t.id, { priority: next })
      setTickets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : '优先级调整失败')
    }
  }

  const remove = async (id: string) => {
    try {
      await api.deleteTicket(id)
      setTickets((prev) => prev.filter((t) => t.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  const filters = [
    { id: 'all', label: `全部 · ${tickets.length}` },
    { id: 'open', label: '待处理' },
    { id: 'processing', label: '处理中' },
    { id: 'resolved', label: '已解决' },
    { id: 'closed', label: '已关闭' },
  ]

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页头 */}
        <div className="flex items-end justify-between rise-in">
          <div>
            <h3 className="font-display text-lg font-bold text-t1">
              {isStaff ? '工单服务台' : '我的工单'}
            </h3>
            <p className="text-xs text-t3 mt-1">
              {isStaff
                ? 'AI 无法自动解决的问题在此升级人工处理，形成服务闭环。'
                : '提交问题工单，服务台坐席将跟进处理。'}
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="px-4 py-2.5 bg-brand/10 hover:bg-emerald-500/20 border border-brand/30 hover:border-brand/50 text-brand text-xs font-semibold rounded-lg flex items-center gap-2 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            新建工单
          </button>
        </div>

        {/* 坐席看板（仅坐席/管理员） */}
        {isStaff && <TicketStatsPanel />}

        {error && (
          <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono fade-in">
            {error}
          </div>
        )}

        {/* 状态过滤 + 待办统计 */}
        <div
          className="rise-in flex items-center gap-2 flex-wrap"
          style={{ animationDelay: '70ms' }}
        >
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-mono border transition-all ${
                filter === f.id
                  ? 'bg-brand/15 text-brand border-brand/40'
                  : 'text-t3 border-line hover:text-t2 hover:border-linestrong'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] font-mono text-t3 flex items-center gap-1.5">
            <CircleDot className="w-3 h-3 text-amber-400" />
            进行中 {openCount}
          </span>
        </div>

        {/* 工单列表 */}
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="h-24 rounded-xl panel animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div
            className="rise-in rounded-xl panel p-12 text-center"
            style={{ animationDelay: '140ms' }}
          >
            <TicketCheck className="w-6 h-6 text-t4 mx-auto" />
            <p className="text-xs font-mono text-t4 mt-3">
              暂无工单 — 对话中 AI 建议升级时或在此手动创建工单
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((t, i) => {
              const st = STATUS_META[t.status] || STATUS_META.open
              const pr = PRIORITY_META[t.priority] || PRIORITY_META.normal
              return (
                <div
                  key={t.id}
                  className="rise-in rounded-xl panel card-hover p-4 group cursor-pointer"
                  style={{ animationDelay: `${110 + i * 60}ms` }}
                  onClick={() => setDetailId(t.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-xs font-semibold text-t1 truncate group-hover:text-brand transition-colors">
                          {t.title}
                        </h4>
                        {isStaff ? (
                          <button
                            onClick={() => cyclePriority(t)}
                            title="点击调整优先级"
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider transition-transform hover:scale-105 ${pr.style}`}
                          >
                            {pr.label}
                          </button>
                        ) : (
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider ${pr.style}`}
                          >
                            {pr.label}
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-mono px-2 py-0.5 rounded border tracking-wider flex items-center gap-1.5 ${st.style}`}
                        >
                          <span className={`w-1 h-1 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                      </div>
                      <p className="text-xs text-t3 mt-1.5 leading-relaxed line-clamp-2">
                        {t.content}
                      </p>
                      {/* 最新时间线预览 */}
                      {t.comments && t.comments.length > 0 && (
                        <p className="mt-1.5 text-[10px] font-mono text-t4 flex items-center gap-1.5 truncate">
                          {t.comments[0].kind === 'system' ? (
                            <Activity className="w-3 h-3 shrink-0" />
                          ) : (
                            <History className="w-3 h-3 shrink-0" />
                          )}
                          <span className="truncate">{t.comments[0].content}</span>
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-t4">
                        <span className="flex items-center gap-1">
                          <UserRound className="w-3 h-3" />
                          {t.creator?.name || t.creator?.email || '未知'}
                        </span>
                        <span className="flex items-center gap-1">
                          <ChevronRight className="w-3 h-3" />
                          {t.assignee ? t.assignee.name || t.assignee.email : '未受理'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatTime(t.createdAt)}
                        </span>
                      </div>
                    </div>

                    {/* 操作区（点击不冒泡，避免误开详情） */}
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isStaff && t.status !== 'closed' && (
                        <button
                          onClick={() => setAssigning(t)}
                          title="转派给其他坐席"
                          className="px-2.5 py-1.5 rounded-lg text-t3 hover:text-t2 text-[10px] font-mono border border-line hover:border-linestrong transition-colors"
                        >
                          <span className="flex items-center gap-1">
                            <UserCog className="w-3 h-3" />
                            转派
                          </span>
                        </button>
                      )}
                      {isStaff && t.status === 'open' && (
                        <button
                          onClick={() => claim(t)}
                          className="px-2.5 py-1.5 rounded-lg bg-brand/10 hover:bg-emerald-500/20 text-brand text-[10px] font-mono border border-brand/20 hover:border-brand/40 transition-colors"
                        >
                          受理
                        </button>
                      )}
                      {isStaff && t.status === 'processing' && (
                        <button
                          onClick={() => setStatus(t, 'resolved')}
                          className="px-2.5 py-1.5 rounded-lg bg-brand/10 hover:bg-emerald-500/20 text-brand text-[10px] font-mono border border-brand/20 hover:border-brand/40 transition-colors"
                        >
                          标记解决
                        </button>
                      )}
                      {(t.status === 'resolved' || t.status === 'processing') && (
                        <button
                          onClick={() => setStatus(t, 'closed')}
                          className="px-2.5 py-1.5 rounded-lg text-t3 hover:text-t2 text-[10px] font-mono border border-line hover:border-linestrong transition-colors"
                        >
                          关闭
                        </button>
                      )}
                      <button
                        onClick={() => remove(t.id)}
                        title="删除工单"
                        className="p-1.5 rounded-lg text-t4 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {creating && <TicketCreator onClose={() => setCreating(false)} onSaved={refresh} />}
      {detailId && (
        <TicketDetailModal
          ticketId={detailId}
          onClose={() => setDetailId(null)}
          // 详情内状态流转/受理后同步列表卡片（时间线预览、状态、受理人）
          onChanged={(t) =>
            setTickets((prev) => prev.map((x) => (t && x.id === t.id ? { ...x, ...t } : x)))
          }
        />
      )}
      {assigning && (
        <TicketAssigner
          ticket={assigning}
          staff={staff}
          onClose={() => setAssigning(null)}
          onSaved={(updated) =>
            setTickets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
          }
        />
      )}
    </div>
  )
}
