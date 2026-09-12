import React, { useCallback, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import type { AgentRunDetail, AgentRunItem, AgentRunOverview, AgentRunStep } from '@servicedesk/sdk'
import {
  BarChart3,
  Bot,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Cpu,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Target,
  TicketCheck,
  Wrench,
} from 'lucide-react'

import { api } from '@/shared/api/client'
import type { RootState } from '@/app/providers/store'
import { formatTime } from '@/widgets/ticket-detail/ui/TicketDetailModal'

// ===== 展示格式化 =====

const fmtTokens = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

const fmtMs = (ms: number): string =>
  ms >= 60_000
    ? `${(ms / 60_000).toFixed(1)} min`
    : ms >= 1000
      ? `${(ms / 1000).toFixed(1)}s`
      : `${ms}ms`

const pct = (n: number | null): string => (n === null ? '—' : `${Math.round(n * 1000) / 10}%`)

// 工具名 → 中文标签 + 分布条颜色（未知名灰色兜底）
const TOOL_META: Record<string, { label: string; bar: string }> = {
  search_knowledge: { label: '知识检索', bar: 'bg-brand' },
  create_ticket: { label: '创建工单', bar: 'bg-sky-400' },
  lookup_my_tickets: { label: '查询我的工单', bar: 'bg-amber-400' },
  get_ticket: { label: '工单详情', bar: 'bg-rose-400' },
}

const toolLabel = (tool: string): string => TOOL_META[tool]?.label ?? tool
const toolBar = (tool: string): string => TOOL_META[tool]?.bar ?? 'bg-t3'

// ===== 每日 token 趋势（纯 CSS 柱状图：输出叠加在输入之上） =====
const DailyTrend: React.FC<{ daily: AgentRunOverview['daily'] }> = ({ daily }) => {
  if (daily.length === 0) {
    return <p className="text-[10px] font-mono text-t4 py-10 text-center">期内无运行数据</p>
  }
  const maxTok = Math.max(1, ...daily.map((d) => d.promptTokens + d.completionTokens))
  const labelStep = Math.max(1, Math.ceil(daily.length / 10))
  return (
    <div>
      <div className="flex items-end gap-1 h-28">
        {daily.map((d) => (
          <div
            key={d.date}
            className="flex-1 h-full flex flex-col justify-end gap-px group"
            title={`${d.date} · 运行 ${d.runs} · 输入 ${fmtTokens(d.promptTokens)} · 输出 ${fmtTokens(d.completionTokens)}`}
          >
            <div
              className="w-full rounded-sm bg-sky-400/70 group-hover:bg-sky-300 transition-colors"
              style={{ height: `${(d.completionTokens / maxTok) * 100}%` }}
            />
            <div
              className="w-full rounded-sm bg-brand/70 group-hover:bg-brand transition-colors"
              style={{ height: `${(d.promptTokens / maxTok) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        {daily.map((d, i) => (
          <span key={d.date} className="flex-1 text-center text-[8px] font-mono text-t4 truncate">
            {i % labelStep === 0 ? d.date.slice(5) : ''}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-end gap-3 mt-1 text-[9px] font-mono text-t4">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-brand/70" />
          输入
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-sky-400/70" />
          输出
        </span>
      </div>
    </div>
  )
}

// ===== 运行步骤时间线（decision/tool/generate 按序渲染） =====
const RunSteps: React.FC<{ steps: AgentRunStep[] }> = ({ steps }) => {
  const kindMeta = (kind: AgentRunStep['kind']) => {
    switch (kind) {
      case 'decision':
        return {
          label: '决策',
          icon: <Brain className="w-3 h-3" />,
          badge: 'text-sky-300 border-sky-500/25 bg-sky-500/10',
        }
      case 'tool':
        return {
          label: '工具',
          icon: <Wrench className="w-3 h-3" />,
          badge: 'text-brand border-brand/25 bg-brand/10',
        }
      case 'generate':
        return {
          label: '生成',
          icon: <Sparkles className="w-3 h-3" />,
          badge: 'text-signal border-signal/25 bg-signal/10',
        }
      default:
        return {
          label: '未知',
          icon: <Clock className="w-3 h-3" />,
          badge: 'text-t3 border-line bg-s3',
        }
    }
  }

  return (
    <ol className="space-y-1.5">
      {steps
        .filter((s) => s && typeof s === 'object')
        .map((step, i) => {
          const meta = kindMeta(step.kind)
          return (
            <li key={i} className="relative pl-7">
              {i < steps.length - 1 && (
                <span className="absolute left-[9px] top-4 bottom-[-6px] w-px bg-line" />
              )}
              <span className="absolute left-0 top-0.5 w-[19px] h-[19px] rounded-full bg-s4 border border-line flex items-center justify-center text-t3">
                {meta.icon}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider flex items-center gap-1 ${meta.badge}`}
                >
                  {meta.icon}
                  {meta.label}
                </span>
                {step.kind === 'decision' && (
                  <span className="text-[10px] font-mono text-t3">
                    第 {step.round} 轮 · {step.model} · 输入 {step.promptTokens} · 输出{' '}
                    {step.completionTokens} · {fmtMs(step.ms)}
                  </span>
                )}
                {step.kind === 'tool' && (
                  <span className="text-[10px] font-mono text-t3">
                    {toolLabel(step.tool)} · 第 {step.round} 轮
                    {step.status === 'done' ? (
                      <span className="text-brand"> · 完成</span>
                    ) : (
                      <span className="text-signal"> · 开始</span>
                    )}
                    {typeof step.ms === 'number' && <span> · {fmtMs(step.ms)}</span>}
                  </span>
                )}
                {step.kind === 'generate' && (
                  <span className="text-[10px] font-mono text-t3">
                    {step.model} · 输入 {step.promptTokens} · 输出 {step.completionTokens} ·{' '}
                    {fmtMs(step.ms)} · 流式
                  </span>
                )}
              </div>
              {step.kind === 'tool' && step.summary && (
                <p className="mt-0.5 text-[10px] font-mono text-t4 leading-relaxed">
                  {step.summary}
                </p>
              )}
            </li>
          )
        })}
      {steps.length === 0 && (
        <li className="text-[10px] font-mono text-t4 text-center py-3">无轨迹明细（steps 为空）</li>
      )}
    </ol>
  )
}

// ===== 运行明细行（点击展开步骤时间线） =====
const RunRow: React.FC<{ run: AgentRunItem }> = ({ run }) => {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<AgentRunDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !detail) {
      setLoading(true)
      setError('')
      api
        .getAgentRunDetail(run.id)
        .then(setDetail)
        .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
        .finally(() => setLoading(false))
    }
  }

  const completed = run.status === 'completed'
  return (
    <div className="rounded-xl panel card-hover">
      <button onClick={toggle} className="w-full text-left px-4 py-3 flex items-center gap-3 group">
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-t4 shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-t4 shrink-0" />
        )}
        <span
          className={`text-[9px] font-mono px-1.5 py-0.5 rounded border tracking-wider shrink-0 ${
            completed
              ? 'text-brand border-brand/25 bg-brand/10'
              : 'text-amber-300 border-amber-500/25 bg-amber-500/10'
          }`}
        >
          {completed ? '完成' : '中断'}
        </span>
        <span className="font-mono text-[10px] text-t4 shrink-0">{run.id.slice(0, 8)}</span>
        <span className="text-xs font-semibold text-t1 truncate min-w-0 flex-1 group-hover:text-brand transition-colors">
          {run.ticketTitle || '无建单'}
        </span>
        <span className="text-[10px] font-mono text-t3 shrink-0 hidden md:block">
          模型 {run.model || 'unknown'} · 轮次 {run.rounds} · 工具 {run.toolCalls} · 命中{' '}
          {run.sources}
        </span>
        <span className="text-[10px] font-mono text-t3 shrink-0 hidden lg:block">
          输入 {fmtTokens(run.promptTokens)} · 输出 {fmtTokens(run.completionTokens)} ·{' '}
          {fmtMs(run.totalMs)}
        </span>
        <span className="text-[10px] font-mono text-t4 shrink-0 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(run.createdAt)}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-line">
          <div className="pt-3 space-y-2">
            <div className="flex items-center gap-3 text-[10px] font-mono text-t4 flex-wrap">
              <span>会话 {run.chatId.slice(0, 8)}</span>
              <span>用户 {run.userId.slice(0, 8)}</span>
              {run.ticketId && <span className="text-brand">工单 {run.ticketId.slice(0, 8)}</span>}
            </div>
            {loading && (
              <div className="flex items-center gap-2 text-[10px] font-mono text-t3 py-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                加载轨迹…
              </div>
            )}
            {error && <p className="text-[10px] font-mono text-rose-300">{error}</p>}
            {detail && !loading && (
              <RunSteps steps={Array.isArray(detail.steps) ? detail.steps : []} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 运行明细列表（分页 + 可展开步骤时间线） =====
const PAGE_SIZE = 20

const RunsPanel: React.FC = () => {
  const [runs, setRuns] = useState<AgentRunItem[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((p: number) => {
    setLoading(true)
    // 多取 1 条探测是否还有下一页
    api
      .listAgentRuns(PAGE_SIZE + 1, p * PAGE_SIZE)
      .then((rows) => {
        setHasMore(rows.length > PAGE_SIZE)
        setRuns(rows.slice(0, PAGE_SIZE))
        setError('')
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(page)
  }, [page, load])

  return (
    <div className="rise-in" style={{ animationDelay: '120ms' }}>
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-s3 border border-line flex items-center justify-center">
            <Clock className="w-4 h-4 text-t2" />
          </div>
          <div>
            <h4 className="font-display text-sm font-semibold text-t1">运行明细</h4>
            <span className="text-[11px] text-t3">点击展开查看决策/工具/生成步骤时间线</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            title="上一页"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-mono text-t3 px-1">第 {page + 1} 页</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore || loading}
            className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            title="下一页"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono mb-3">
          {error}
        </div>
      )}

      {loading ? (
        [0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-xl panel animate-pulse mb-2" />
        ))
      ) : runs.length === 0 ? (
        <div className="rounded-xl panel p-12 text-center">
          <BarChart3 className="w-6 h-6 text-t4 mx-auto" />
          <p className="text-xs font-mono text-t4 mt-3">暂无运行记录 — Agent 对话完成后自动落库</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 概览看板（KPI / 每日趋势 / 工具与模型分布，仅坐席/管理员） =====
const OverviewPanel: React.FC = () => {
  const [days, setDays] = useState(30)
  const [overview, setOverview] = useState<AgentRunOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    setLoading(true)
    setOverview(null)
    api
      .getAgentRunOverview(days)
      .then((o) => {
        setOverview(o)
        setError('')
      })
      .catch((e) => {
        setOverview(null)
        setError(e instanceof Error ? e.message : '加载失败')
      })
      .finally(() => setLoading(false))
  }, [days, nonce])

  const cards = [
    {
      icon: <Bot className="w-4 h-4 text-brand" />,
      label: '总运行数',
      value: overview ? String(overview.totalRuns) : '—',
      sub: overview ? `期内工具调用 ${overview.totalToolCalls} 次` : '',
      accent: 'text-t1',
    },
    {
      icon: <Cpu className="w-4 h-4 text-sky-400" />,
      label: '总 Token',
      value: fmtTokens((overview?.totalPromptTokens ?? 0) + (overview?.totalCompletionTokens ?? 0)),
      sub: overview
        ? `输入 ${fmtTokens(overview.totalPromptTokens)} · 输出 ${fmtTokens(overview.totalCompletionTokens)}`
        : '',
      accent: 'text-sky-300',
    },
    {
      icon: <RefreshCw className="w-4 h-4 text-amber-400" />,
      label: '平均轮次',
      value: overview && overview.avgRounds !== null ? String(overview.avgRounds) : '—',
      sub: overview && overview.avgTotalMs !== null ? `平均耗时 ${fmtMs(overview.avgTotalMs)}` : '',
      accent: 'text-amber-300',
    },
    {
      icon: <Target className="w-4 h-4 text-brand" />,
      label: '检索命中率',
      value: pct(overview?.searchHitRate ?? null),
      sub: 'RAG 命中片段的运行占比',
      accent: 'text-brand',
    },
    {
      icon: <TicketCheck className="w-4 h-4 text-signal" />,
      label: '工单转化率',
      value: pct(overview?.ticketConversionRate ?? null),
      sub: '运行中自动建单占比',
      accent: 'text-signal',
    },
  ]

  return (
    <div className="rise-in p-5 rounded-xl panel">
      {/* 标题 + 期间切换 */}
      <div className="flex items-center justify-between pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-brand" />
          </div>
          <div>
            <h4 className="font-display text-sm font-semibold text-t1">运行看板</h4>
            <span className="text-[11px] text-t3">Agent 运行量与 token 成本概览</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {[7, 30, 90].map((d) => (
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

      {error && !overview && (
        <div className="mt-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setNonce((n) => n + 1)}
            className="px-2.5 py-1 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-300 transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {loading && !overview ? (
        <div className="h-24 mt-4 rounded-lg bg-s4 animate-pulse" />
      ) : overview ? (
        <>
          {/* 核心指标卡 */}
          <div className="grid grid-cols-5 gap-3 mt-4">
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
            {/* 每日 token 趋势 */}
            <div className="rounded-lg bg-s4 border border-line p-3.5">
              <p className="text-[9px] font-mono text-t4 tracking-wider mb-2.5">
                每日 token 趋势（输入/输出，按天聚合）
              </p>
              <DailyTrend daily={overview.daily} />
            </div>

            <div className="space-y-4">
              {/* 工具调用分布 */}
              <div className="rounded-lg bg-s4 border border-line p-3.5">
                <p className="text-[9px] font-mono text-t4 tracking-wider mb-2.5">工具调用分布</p>
                {overview.toolDistribution.length === 0 ? (
                  <p className="text-[10px] font-mono text-t4 py-4 text-center">
                    期内无工具调用记录
                  </p>
                ) : (
                  <div className="space-y-2">
                    {overview.toolDistribution.map((t) => {
                      const max = overview.toolDistribution[0]?.count ?? 1
                      return (
                        <div key={t.tool} className="flex items-center gap-2.5">
                          <span className="text-[10px] font-mono text-t3 w-20 shrink-0 truncate">
                            {toolLabel(t.tool)}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-line overflow-hidden">
                            <div
                              className={`h-full rounded-full ${toolBar(t.tool)} transition-all`}
                              style={{ width: `${(t.count / max) * 100}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-t2 w-6 text-right shrink-0">
                            {t.count}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 模型使用分布 */}
              <div className="rounded-lg bg-s4 border border-line p-3.5">
                <p className="text-[9px] font-mono text-t4 tracking-wider mb-2.5">模型使用分布</p>
                {overview.modelDistribution.length === 0 ? (
                  <p className="text-[10px] font-mono text-t4 py-4 text-center">期内无运行记录</p>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {overview.modelDistribution.map((m) => (
                      <span
                        key={m.model}
                        className="px-2 py-1 rounded-lg border border-line bg-s3 text-[10px] font-mono text-t2"
                      >
                        {m.model} · <span className="text-brand">{m.runs}</span> 次
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="text-[9px] font-mono text-t4 mt-3 leading-relaxed">
            命中率 = 检索命中（sources &gt; 0）运行占比 · 转化率 = 自动建单（ticketId 非空）运行占比
            · 分布基于运行轨迹 steps 明细 · 单次聚合最多取最近 1000 条记录
          </p>
        </>
      ) : null}
    </div>
  )
}

// ===== 页面 =====
export const AnalyticsPage: React.FC = () => {
  const user = useSelector((s: RootState) => s.auth.user)
  const isStaff = user?.role === 'agent' || user?.role === 'admin'

  // 与工单页坐席看板一致：普通员工不渲染看板内容（侧边栏已隐藏入口，此处兜底）
  if (!isStaff) {
    return (
      <div className="p-8 h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          <div className="rise-in rounded-xl panel p-12 text-center">
            <ShieldAlert className="w-6 h-6 text-t4 mx-auto" />
            <p className="text-xs font-mono text-t4 mt-3">运营看板仅对坐席/管理员开放</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* 页头 */}
        <div className="flex items-end justify-between rise-in">
          <div>
            <h3 className="font-display text-lg font-bold text-t1">运营看板</h3>
            <p className="text-xs text-t3 mt-1">
              Agent 运行轨迹、token 成本与建单转化的可观测视图。
            </p>
          </div>
        </div>

        <OverviewPanel />
        <RunsPanel />
      </div>
    </div>
  )
}
