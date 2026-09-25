import React, { useEffect, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import type { TicketDetail } from '@servicedesk/sdk'
import {
  Activity,
  ChevronRight,
  Clock,
  History,
  Loader2,
  SendHorizonal,
  UserRound,
  X,
} from 'lucide-react'

import { api } from '@/shared/api/client'
import type { RootState } from '@/app/providers/store'

// 工单状态/优先级的展示元数据（详情弹窗与列表卡片共用）
export const STATUS_META: Record<string, { label: string; style: string; dot: string }> = {
  open: {
    label: '待处理',
    style: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    dot: 'bg-sky-400',
  },
  processing: {
    label: '处理中',
    style: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
    dot: 'bg-amber-400 animate-pulse',
  },
  resolved: {
    label: '已解决',
    style: 'bg-brand/10 text-brand border-brand/25',
    dot: 'bg-brand',
  },
  closed: {
    label: '已关闭',
    style: 'bg-s4 text-t3 border-line',
    dot: 'bg-linestrong',
  },
}

export const PRIORITY_META: Record<string, { label: string; style: string }> = {
  low: { label: '低', style: 'text-t3 border-line' },
  normal: { label: '普通', style: 'text-sky-300 border-sky-500/25 bg-sky-500/10' },
  high: { label: '高', style: 'text-amber-300 border-amber-500/25 bg-amber-500/10' },
  urgent: { label: '紧急', style: 'text-rose-300 border-rose-500/25 bg-rose-500/10' },
}

export const CATEGORY_META: Record<string, { label: string; style: string }> = {
  account: { label: '账号权限', style: 'text-violet-300 border-violet-500/25 bg-violet-500/10' },
  hardware: { label: '硬件设备', style: 'text-orange-300 border-orange-500/25 bg-orange-500/10' },
  network: { label: '网络访问', style: 'text-cyan-300 border-cyan-500/25 bg-cyan-500/10' },
  software: { label: '软件应用', style: 'text-indigo-300 border-indigo-500/25 bg-indigo-500/10' },
  process: { label: '制度流程', style: 'text-teal-300 border-teal-500/25 bg-teal-500/10' },
  other: { label: '其他', style: 'text-t3 border-line' },
}

export const CATEGORY_OPTIONS = [
  'account',
  'hardware',
  'network',
  'software',
  'process',
  'other',
] as const

export function formatTime(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// 工单详情弹窗：完整描述 + 处理时间线（评论/系统事件）+ 状态操作
// 聊天页的工单引用卡片与工单列表页共用（widgets 层供多页面复用）
export const TicketDetailModal: React.FC<{
  ticketId: string
  onClose: () => void
  /** 详情内状态流转/受理后回调（如同步列表卡片），聊天页可不传 */
  onChanged?: (t: TicketDetail | null) => void
}> = ({ ticketId, onClose, onChanged }) => {
  const user = useSelector((s: RootState) => s.auth.user)
  const isStaff = user?.role === 'agent' || user?.role === 'admin'
  const [detail, setDetail] = useState<TicketDetail | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const timelineRef = useRef<HTMLDivElement>(null)

  const load = () =>
    api
      .getTicketDetail(ticketId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))

  useEffect(() => {
    load()
  }, [ticketId])

  // 新评论后滚到底部
  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight })
  }, [detail?.comments.length])

  const submitComment = async () => {
    const content = draft.trim()
    if (!content || !detail) return
    setBusy(true)
    setError('')
    try {
      const comment = await api.addTicketComment(detail.id, content)
      setDetail((prev) => (prev ? { ...prev, comments: [...prev.comments, comment] } : prev))
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '评论失败')
    } finally {
      setBusy(false)
    }
  }

  const update = async (input: { status?: string; assigneeId?: string; category?: string }) => {
    if (!detail) return
    try {
      await api.updateTicket(detail.id, input)
      // 重新拉详情：系统事件由服务端写入时间线
      const fresh = await api.getTicketDetail(detail.id)
      setDetail(fresh)
      onChanged?.(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败')
    }
  }

  const st = detail ? STATUS_META[detail.status] || STATUS_META.open : null
  const pr = detail ? PRIORITY_META[detail.priority] || PRIORITY_META.normal : null
  const cg = CATEGORY_META[detail?.category || 'other'] || CATEGORY_META.other

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm fade-in p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-2xl panel border border-line shadow-2xl shadow-black/50 rise-in overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {!detail ? (
          <div className="flex items-center justify-center py-16 text-t3 text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-brand" />
            加载工单详情...
          </div>
        ) : (
          <>
            {/* 头部：标题 + 状态/优先级 + 操作 */}
            <div className="px-5 py-4 border-b border-line shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-sm font-bold text-t1">{detail.title}</h3>
                    {pr && (
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider ${pr.style}`}
                      >
                        {pr.label}
                      </span>
                    )}
                    {st && (
                      <span
                        className={`text-[9px] font-mono px-2 py-0.5 rounded border tracking-wider flex items-center gap-1.5 ${st.style}`}
                      >
                        <span className={`w-1 h-1 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    )}
                    {/* 分类：坐席可下拉纠正 Agent 判错的分类（变更写入时间线） */}
                    {isStaff ? (
                      <select
                        value={detail.category || 'other'}
                        onChange={(e) => update({ category: e.target.value })}
                        title="调整工单分类"
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider bg-transparent cursor-pointer outline-none hover:border-linestrong transition-colors ${cg.style}`}
                      >
                        {CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c} className="bg-s2 text-t1">
                            {CATEGORY_META[c].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider ${cg.style}`}
                      >
                        {cg.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-t4">
                    <span className="flex items-center gap-1">
                      <UserRound className="w-3 h-3" />
                      {detail.creator?.name || detail.creator?.email || '未知'}
                    </span>
                    <span className="flex items-center gap-1">
                      <ChevronRight className="w-3 h-3" />
                      {detail.assignee ? detail.assignee.name || detail.assignee.email : '未受理'}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatTime(detail.createdAt)} 创建
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isStaff && detail.status === 'open' && (
                    <button
                      onClick={() => update({ assigneeId: user?.id })}
                      className="px-2.5 py-1.5 rounded-lg bg-brand/10 hover:bg-emerald-500/20 text-brand text-[10px] font-mono border border-brand/20 hover:border-brand/40 transition-colors"
                    >
                      受理
                    </button>
                  )}
                  {isStaff && detail.status === 'processing' && (
                    <button
                      onClick={() => update({ status: 'resolved' })}
                      className="px-2.5 py-1.5 rounded-lg bg-brand/10 hover:bg-emerald-500/20 text-brand text-[10px] font-mono border border-brand/20 hover:border-brand/40 transition-colors"
                    >
                      标记解决
                    </button>
                  )}
                  {detail.status !== 'closed' && (
                    <button
                      onClick={() => update({ status: 'closed' })}
                      className="px-2.5 py-1.5 rounded-lg text-t3 hover:text-t2 text-[10px] font-mono border border-line hover:border-linestrong transition-colors"
                    >
                      关闭
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {error && (
                <div className="mt-3 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
                  {error}
                </div>
              )}
            </div>

            {/* 问题描述 */}
            <div className="px-5 py-3.5 border-b border-line shrink-0">
              <p className="text-[9px] font-mono text-t4 tracking-wider mb-1.5">问题描述</p>
              <p className="text-xs text-t2 leading-relaxed whitespace-pre-wrap">
                {detail.content}
              </p>
            </div>

            {/* 时间线 */}
            <div className="px-5 py-3.5 shrink-0 flex items-center gap-2">
              <History className="w-3.5 h-3.5 text-t3" />
              <p className="text-[9px] font-mono text-t3 tracking-wider">
                处理时间线 · {detail.comments.length} 条记录
              </p>
            </div>
            <div ref={timelineRef} className="px-5 flex-1 overflow-y-auto min-h-0 space-y-2.5">
              {detail.comments.map((c) =>
                c.kind === 'system' ? (
                  <div key={c.id} className="flex items-center gap-2 py-0.5">
                    <Activity className="w-3 h-3 text-t4 shrink-0" />
                    <p className="text-[10px] font-mono text-t4">
                      {c.content}
                      <span className="ml-2 text-t4/70">{formatTime(c.createdAt)}</span>
                    </p>
                  </div>
                ) : (
                  <div
                    key={c.id}
                    className={`flex flex-col rounded-lg border px-3 py-2 max-w-[85%] ${
                      c.author.id === user?.id
                        ? 'ml-auto bg-brand/8 border-brand/25'
                        : 'bg-s4 border-line'
                    }`}
                  >
                    <p className="text-[9px] font-mono text-t4 mb-1">
                      {c.author.name || c.author.email}
                      {(c.author.role === 'agent' || c.author.role === 'admin') && (
                        <span className="ml-1.5 text-brand/80">
                          {c.author.role === 'admin' ? 'ADMIN' : 'AGENT'}
                        </span>
                      )}
                      <span className="ml-2">{formatTime(c.createdAt)}</span>
                    </p>
                    <p className="text-xs text-t1 leading-relaxed whitespace-pre-wrap">
                      {c.content}
                    </p>
                  </div>
                ),
              )}
              {detail.comments.length === 0 && (
                <p className="text-[10px] font-mono text-t4 text-center py-4">
                  暂无处理记录 — 坐席受理后在此留言沟通
                </p>
              )}
            </div>

            {/* 评论输入 */}
            <div className="px-5 py-4 border-t border-line shrink-0 flex items-center gap-2.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitComment()
                }}
                maxLength={1000}
                placeholder={
                  isStaff ? '回复/追加处理说明（坐席与提问者可见）...' : '补充信息或追问处理进度...'
                }
                className="flex-1 bg-s4 border border-line rounded-lg px-3 py-2.5 text-xs text-t1 placeholder:text-t4 focus:outline-none focus:border-brand/50 transition-colors"
              />
              <button
                onClick={submitComment}
                disabled={busy || !draft.trim()}
                className="p-2.5 rounded-lg bg-brand-strong hover:brightness-110 disabled:opacity-40 text-brand-on transition-all shadow-md shadow-emerald-500/20"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <SendHorizonal className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
