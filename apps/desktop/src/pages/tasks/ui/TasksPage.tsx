import React, { useState, useEffect } from 'react'
import { HttpClient } from '@ai-workspace/sdk'
import type { AgentTask } from '@ai-workspace/sdk'
import { Play, Circle, Clock, CheckCircle2, XCircle, Loader2, Trash2, Zap } from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'
import { useTheme } from '@/entities/theme/model/themeContext'

const api = new HttpClient('http://localhost:3000')

type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

const STATUS_STYLE: Record<
  TaskStatus,
  { bgLight: string; bgDark: string; color: string; icon: typeof Circle }
> = {
  queued: {
    bgLight: 'rgba(100,116,139,.08)',
    bgDark: 'rgba(100,116,139,.1)',
    color: 'var(--text-muted)',
    icon: Circle,
  },
  running: {
    bgLight: 'rgba(34,211,238,.08)',
    bgDark: 'rgba(34,211,238,.1)',
    color: 'var(--accent-cyan)',
    icon: Loader2,
  },
  succeeded: {
    bgLight: 'rgba(34,197,94,.08)',
    bgDark: 'rgba(34,197,94,.1)',
    color: 'var(--accent-emerald)',
    icon: CheckCircle2,
  },
  failed: {
    bgLight: 'rgba(239,68,68,.08)',
    bgDark: 'rgba(239,68,68,.1)',
    color: 'var(--accent-red)',
    icon: XCircle,
  },
}

export const TasksPage: React.FC = () => {
  const { t } = useI18n()
  const { mode } = useTheme()
  const isDark = mode === 'dark'
  const [tasks, setTasks] = useState<AgentTask[]>([])
  const [agentPrompt, setAgentPrompt] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    loadTasks()
  }, [])

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setTick((prev) => prev + 1), 1000)
    return () => clearInterval(id)
  }, [isRunning])

  useEffect(() => {
    if (isRunning) setElapsedMs((prev) => prev + 1000)
  }, [tick])

  const loadTasks = async () => {
    try {
      const all = await api.getTasks()
      setTasks(Array.isArray(all) ? all : [])
    } catch {
      /* ignore */
    }
  }

  const fmtTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  const handleRun = async () => {
    if (!agentPrompt.trim() || isRunning) return
    setIsRunning(true)
    setElapsedMs(0)
    setTick(0)
    try {
      const res = await api.createTask(agentPrompt)
      setTasks((prev) => [res, ...prev])
    } catch {
      /* ignore */
    } finally {
      setIsRunning(false)
    }
  }

  const handleDelete = async (taskId: string) => {
    await api.deleteTask(taskId)
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
  }

  const handleRetry = async (taskId: string) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'queued' as const } : t)))
    await api.runTask(taskId)
  }

  const inputWrapStyle = isDark
    ? { background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }
    : { background: 'rgba(0,0,0,.03)', border: '1px solid rgba(0,0,0,.08)' }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-void)' }}>
      <div
        className="h-px w-full"
        style={{ background: 'linear-gradient(90deg,transparent,var(--glow-amber),transparent)' }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-8">
          {/* Header */}
          <div className="flex items-center gap-3 fade-up">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg,rgba(245,158,11,.15),rgba(239,68,68,.1))',
                border: '1px solid rgba(245,158,11,.2)',
              }}
            >
              <Zap className="w-5 h-5" style={{ color: 'var(--accent-amber)' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-main)' }}>
                {t('tasks.executor')}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {t('tasks.agentTip')}
              </p>
            </div>
          </div>

          {/* Input panel */}
          <div
            className="rounded-2xl border p-5 fade-up fade-up-delay-1"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Play className="w-3.5 h-3.5" /> 运行 Agent 任务
            </div>
            <div className="flex gap-2">
              <div
                className="flex-1 flex items-center gap-2 rounded-xl px-3 py-2.5 focus-within:border-amber-500/40 transition-colors"
                style={inputWrapStyle}
              >
                <Zap className="w-4 h-4 shrink-0" style={{ color: 'var(--text-dim)' }} />
                <input
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleRun()}
                  placeholder={t('tasks.runTask')}
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ color: 'var(--text-main)' }}
                />
              </div>
              <button
                onClick={handleRun}
                disabled={!agentPrompt.trim() || isRunning}
                className="px-4 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40 flex items-center gap-2"
                style={{
                  background: 'linear-gradient(135deg,#f59e0b,#ef4444)',
                  boxShadow: '0 4px 16px rgba(245,158,11,.25)',
                }}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('tasks.running')}
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" /> {t('tasks.runTask')}
                  </>
                )}
              </button>
            </div>
            {isRunning && (
              <div className="mt-3 flex items-center gap-2 text-xs font-mono text-amber-400">
                <Clock className="w-3.5 h-3.5" />
                {t('tasks.elapsed')}: {fmtTime(elapsedMs)}
              </div>
            )}
          </div>

          {/* History */}
          <div className="fade-up fade-up-delay-2">
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Clock className="w-3.5 h-3.5" />
              {t('tasks.history')}
              <span
                className="font-normal normal-case tracking-normal"
                style={{ color: 'var(--text-dim)' }}
              >
                ({tasks.length})
              </span>
            </div>

            {tasks.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed p-12 text-center"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
              >
                <Zap className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-dim)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('tasks.noTasks')}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                  {t('tasks.firstTask')}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task) => {
                  const s = STATUS_STYLE[task.status] ?? STATUS_STYLE.queued
                  const Icon = s.icon
                  const bg = isDark ? s.bgDark : s.bgLight
                  return (
                    <div
                      key={task.id}
                      className="flex items-center gap-4 px-4 py-3 rounded-xl border transition-all hover:border-white/10"
                      style={{
                        background: 'var(--bg-elevated)',
                        borderColor: 'var(--border-soft)',
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                        style={{ background: bg, color: s.color }}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-sm font-medium truncate"
                          style={{ color: 'var(--text-main)' }}
                        >
                          {task.title || task.prompt.slice(0, 60)}
                        </div>
                        <div
                          className="text-[10px] font-mono mt-0.5"
                          style={{ color: 'var(--text-dim)' }}
                        >
                          {task.createdAt}
                        </div>
                        {task.error && (
                          <div className="text-[10px] text-red-400 mt-0.5 font-mono truncate">
                            {task.error}
                          </div>
                        )}
                        {task.result && (
                          <div
                            className="text-xs mt-1 font-mono line-clamp-2"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {task.result}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className="text-[10px] font-mono px-2 py-1 rounded-lg capitalize"
                          style={{ background: bg, color: s.color }}
                        >
                          {task.status}
                        </span>
                        {task.status === 'failed' && (
                          <button
                            onClick={() => handleRetry(task.id)}
                            className="p-1.5 rounded-lg hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                            style={{ color: 'var(--text-dim)' }}
                            title={t('tasks.retry')}
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(task.id)}
                          className="p-1.5 rounded-lg hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          style={{ color: 'var(--text-dim)' }}
                          title={t('tasks.delete')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
