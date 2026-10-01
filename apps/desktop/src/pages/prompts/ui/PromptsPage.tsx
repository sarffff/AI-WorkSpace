import React, { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { PromptItem } from '@servicedesk/sdk'
import {
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  Zap,
  X,
  Loader2,
  Terminal,
  ChevronRight,
} from 'lucide-react'

import { api } from '@/shared/api/client'
import { setActivePrompt } from '@/entities/chat/model/chatSlice'
import type { RootState } from '@/app/providers/store'

// 分类 → 遥测配色（未知分类按名称散列到固定色板）
const PALETTE = [
  'text-brand border-brand/25 bg-brand/10',
  'text-sky-300 border-sky-500/25 bg-sky-500/10',
  'text-amber-300 border-amber-500/25 bg-amber-500/10',
  'text-violet-300 border-violet-500/25 bg-violet-500/10',
  'text-rose-300 border-rose-500/25 bg-rose-500/10',
]
const KNOWN_CATEGORY: Record<string, string> = {
  工程: PALETTE[0],
  架构: PALETTE[1],
  数据库: PALETTE[2],
  通用: PALETTE[3],
}
const categoryColor = (c: string) =>
  KNOWN_CATEGORY[c] || PALETTE[[...c].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETTE.length]

function formatDate(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 86400000) return '今天'
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// ===== 新建 / 编辑弹窗 =====
const PromptEditor: React.FC<{
  initial?: PromptItem | null
  onClose: () => void
  onSaved: () => void
}> = ({ initial, onClose, onSaved }) => {
  const [title, setTitle] = useState(initial?.title || '')
  const [category, setCategory] = useState(initial?.category || '')
  const [content, setContent] = useState(initial?.content || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      setError('标题与内容不能为空')
      return
    }
    setBusy(true)
    setError('')
    try {
      const input = { title: title.trim(), content: content.trim(), category: category.trim() }
      if (initial) await api.updatePrompt(initial.id, input)
      else await api.createPrompt(input)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
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
        className="w-full max-w-xl rounded-2xl panel border border-line shadow-2xl rise-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 弹窗头 */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold text-t1">
              {initial ? '编辑提示词' : '新建提示词'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-t3 hover:text-t1 hover:bg-s3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="p-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-mono text-t3 tracking-wider">标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                placeholder="如：代码重构专家"
                autoFocus
                className="mt-1.5 w-full bg-s4 border border-line rounded-lg px-3 py-2 text-sm text-t1 placeholder:text-t4 focus:outline-none focus:border-brand/50 transition-colors"
              />
            </div>
            <div className="w-36">
              <label className="text-[10px] font-mono text-t3 tracking-wider">分类</label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={20}
                placeholder="通用"
                className="mt-1.5 w-full bg-s4 border border-line rounded-lg px-3 py-2 text-sm text-t1 placeholder:text-t4 focus:outline-none focus:border-brand/50 transition-colors"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono text-t3 tracking-wider">角色设定内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={5000}
              placeholder="描述这个角色的人设、专长与回答方式，将作为系统角色注入对话..."
              className="mt-1.5 w-full bg-s4 border border-line rounded-lg px-3 py-2.5 text-sm text-t1 placeholder:text-t4 focus:outline-none focus:border-brand/50 transition-colors resize-none leading-relaxed"
              rows={7}
            />
            <div className="text-right text-[10px] font-mono text-t4">{content.length} / 5000</div>
          </div>
          {error && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
              {error}
            </div>
          )}
        </div>

        {/* 操作条 */}
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
            className="px-4 py-2 rounded-lg bg-brand-strong hover:brightness-110 disabled:opacity-50 text-brand-on text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Zap className="w-3.5 h-3.5" />
            )}
            {initial ? '保存修改' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 页面 =====
export const PromptsPage: React.FC = () => {
  const dispatch = useDispatch()
  const activePromptId = useSelector((s: RootState) => s.chat.activePrompt?.id)
  const [prompts, setPrompts] = useState<PromptItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('全部')
  const [editorFor, setEditorFor] = useState<{ open: boolean; item: PromptItem | null }>({
    open: false,
    item: null,
  })
  const [error, setError] = useState('')

  const refresh = () =>
    api
      .listPrompts()
      .then(setPrompts)
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false))

  useEffect(() => {
    refresh()
  }, [])

  const categories = useMemo(
    () => ['全部', ...Array.from(new Set(prompts.map((p) => p.category)))],
    [prompts],
  )
  const filtered = useMemo(
    () => (filter === '全部' ? prompts : prompts.filter((p) => p.category === filter)),
    [prompts, filter],
  )

  const handleDelete = async (id: string) => {
    try {
      await api.deletePrompt(id)
      setPrompts((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页头 */}
        <div className="flex items-end justify-between rise-in">
          <div>
            <h3 className="font-display text-lg font-bold text-t1">提示词广场</h3>
            <p className="text-xs text-t3 mt-1">
              预设角色提示词，一键注入对话上下文，让智能助手切换专业身份。
            </p>
          </div>
          <button
            onClick={() => setEditorFor({ open: true, item: null })}
            className="px-4 py-2.5 bg-brand-strong hover:brightness-110 text-brand-on text-xs font-semibold rounded-lg flex items-center gap-2 transition-all shrink-0"
          >
            <Plus className="w-4 h-4" />
            新建提示词
          </button>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
            {error}
          </div>
        )}

        {/* 分类过滤 */}
        <div
          className="rise-in flex items-center gap-2 flex-wrap"
          style={{ animationDelay: '70ms' }}
        >
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-mono border transition-all ${
                filter === c
                  ? 'bg-brand/15 text-brand border-brand/40'
                  : 'text-t3 border-line hover:text-t2 hover:border-linestrong'
              }`}
            >
              {c === '全部' ? `全部 · ${prompts.length}` : c}
            </button>
          ))}
        </div>

        {/* 卡片网格 */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-xl panel animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rise-in rounded-xl panel p-12 text-center"
            style={{ animationDelay: '140ms' }}
          >
            <Terminal className="w-6 h-6 text-t4 mx-auto" />
            <p className="text-xs font-mono text-t4 mt-3">
              PROMPT BANK EMPTY — 创建第一个角色提示词
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {filtered.map((p, i) => {
              const active = p.id === activePromptId
              return (
                <div
                  key={p.id}
                  className={`rise-in relative p-5 rounded-xl panel card-hover flex flex-col gap-3.5 group overflow-hidden ${
                    active ? 'border-brand/60' : ''
                  }`}
                  style={{ animationDelay: `${110 + i * 70}ms` }}
                >
                  {/* 角标装饰 */}
                  <div className="absolute top-0 right-0 w-20 h-20 bg-brand/5 rounded-bl-[44px] group-hover:bg-brand/10 transition-colors pointer-events-none" />

                  <div className="flex items-center justify-between relative">
                    <span
                      className={`text-[9px] font-mono px-2 py-0.5 rounded border tracking-wider ${categoryColor(p.category)}`}
                    >
                      {p.category}
                    </span>
                    {active && (
                      <span className="flex items-center gap-1 text-[9px] font-mono text-brand">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand pulse-dot" />
                        ACTIVE
                      </span>
                    )}
                  </div>

                  <div className="relative">
                    <h4 className="font-display text-sm font-bold text-t1 leading-snug">
                      {p.title}
                    </h4>
                    <p className="text-xs text-t3 mt-1.5 leading-relaxed line-clamp-3">
                      {p.content}
                    </p>
                  </div>

                  {/* 操作条 */}
                  <div className="relative mt-auto pt-1 flex items-center justify-between border-t border-line/60">
                    <span className="text-[10px] font-mono text-t4">{formatDate(p.updatedAt)}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          dispatch(
                            setActivePrompt({ id: p.id, title: p.title, content: p.content }),
                          )
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-brand/10 hover:bg-brand/20 text-brand text-[10px] font-semibold flex items-center gap-1 transition-colors border border-brand/25 hover:border-brand/40"
                        title="注入当前对话"
                      >
                        <ChevronRight className="w-3 h-3" />
                        注入对话
                      </button>
                      <button
                        onClick={() => setEditorFor({ open: true, item: p })}
                        title="编辑"
                        className="p-1.5 rounded-lg text-t4 hover:text-t2 hover:bg-s3 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        title="删除"
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

        {/* 底部说明 */}
        <div
          className="rise-in flex items-center gap-2 px-4 py-3 rounded-xl bg-s4/50 border border-line/60"
          style={{ animationDelay: '300ms' }}
        >
          <Sparkles className="w-3.5 h-3.5 text-brand/70 shrink-0" />
          <p className="text-[11px] text-t3 leading-relaxed">
            「注入对话」会把该提示词作为系统角色加入下一次会话上下文，可在对话输入台上方随时移除。
          </p>
        </div>
      </div>

      {editorFor.open && (
        <PromptEditor
          initial={editorFor.item}
          onClose={() => setEditorFor({ open: false, item: null })}
          onSaved={refresh}
        />
      )}
    </div>
  )
}
