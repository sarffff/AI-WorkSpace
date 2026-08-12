import React, { useEffect, useState } from 'react'
import { HttpClient } from '@ai-workspace/sdk'
import type { Prompt } from '@ai-workspace/sdk'
import { Plus, Sparkles, Trash2, Edit3, Check, Copy, Zap } from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'

const api = new HttpClient('http://localhost:3000')

export const PromptsPage: React.FC = () => {
  const { t } = useI18n()
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [showAll, setShowAll] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [showEditor, setShowEditor] = useState(false)

  useEffect(() => {
    loadPrompts()
  }, [])

  const loadPrompts = async () => {
    try {
      const all = await api.getPrompts()
      setPrompts(all)
    } catch {
      /* ignore */
    }
  }

  const handleCreate = () => {
    setEditTitle('')
    setEditContent('')
    setShowEditor(true)
  }

  const handleSave = async (isEdit: boolean, id?: string) => {
    if (!editTitle.trim() || !editContent.trim()) return
    if (isEdit && id) {
      await api.updatePrompt(id, { name: editTitle.trim(), content: editContent.trim() })
      setPrompts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, name: editTitle.trim(), content: editContent.trim() } : p,
        ),
      )
    } else {
      const res = await api.createPrompt({
        name: editTitle.trim(),
        category: 'custom',
        description: '',
        content: editContent.trim(),
      })
      setPrompts((prev) => [res, ...prev])
    }
    setEditingId(null)
    setShowEditor(false)
  }

  const handleDelete = async (id: string) => {
    await api.deletePrompt(id)
    setPrompts((prev) => prev.filter((p) => p.id !== id))
  }

  const visible = showAll ? prompts : prompts.slice(0, 9)

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-void)' }}>
      <div
        className="h-px w-full"
        style={{ background: 'linear-gradient(90deg,transparent,var(--glow-amber),transparent)' }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8 space-y-6">
          <div className="flex items-center justify-between fade-up">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg,rgba(245,158,11,.15),rgba(239,68,68,.1))',
                  border: '1px solid rgba(245,158,11,.2)',
                }}
              >
                <Sparkles className="w-5 h-5" style={{ color: 'var(--accent-amber)' }} />
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ color: 'var(--text-main)' }}>
                  {t('prompts.library')}
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  精选提示词模板，助力高效对话 · 共 {prompts.length} 个模板
                </p>
              </div>
            </div>
            <button
              onClick={handleCreate}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg,#f59e0b,#ef4444)',
                boxShadow: '0 4px 16px rgba(245,158,11,.25)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('prompts.create')}
            </button>
          </div>

          {showEditor && (
            <div
              className="rounded-2xl border p-5 fade-up"
              style={{ background: 'var(--bg-panel)', borderColor: 'rgba(245,158,11,.2)' }}
            >
              <div
                className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
                style={{ color: 'var(--text-muted)' }}
              >
                <Edit3 className="w-3.5 h-3.5" />
                {editingId ? t('prompts.edit') : t('prompts.create')}
              </div>
              <div className="space-y-3">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={t('prompts.name')}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500/40 transition-colors input-placeholder"
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                  autoFocus
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder={t('prompts.content')}
                  rows={6}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500/40 transition-colors resize-none font-mono input-placeholder"
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowEditor(false)
                      setEditingId(null)
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    {t('prompts.cancel')}
                  </button>
                  <button
                    onClick={() => handleSave(!!editingId, editingId || undefined)}
                    disabled={!editTitle.trim() || !editContent.trim()}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all disabled:opacity-40"
                    style={{ background: 'linear-gradient(135deg,#f59e0b,#ef4444)' }}
                  >
                    <Check className="w-3.5 h-3.5" /> {t('prompts.save')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {visible.length === 0 ? (
            <div
              className="rounded-2xl border border-dashed p-12 text-center fade-up"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
            >
              <Sparkles className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-dim)' }} />
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {t('prompts.noPrompts')}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                {t('prompts.createTip')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {visible.map((prompt, index) => (
                <div
                  key={prompt.id}
                  className="rounded-2xl border p-4 transition-all hover:border-white/10 group fade-up"
                  style={{
                    background: 'var(--bg-panel)',
                    borderColor: 'var(--border)',
                    animationDelay: `${index * 0.04}s`,
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
                        style={{
                          background: 'rgba(245,158,11,.1)',
                          border: '1px solid rgba(245,158,11,.2)',
                          color: 'var(--accent-amber)',
                        }}
                      >
                        {index + 1}
                      </div>
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
                        {prompt.name}
                      </h3>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => navigator.clipboard.writeText(prompt.content)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: 'var(--text-dim)' }}
                        title={t('prompts.copy')}
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(prompt.id)
                          setEditTitle(prompt.name)
                          setEditContent(prompt.content)
                          setShowEditor(true)
                        }}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: 'var(--text-dim)' }}
                        title={t('prompts.edit')}
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => handleDelete(prompt.id)}
                        className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        style={{ color: 'var(--text-dim)' }}
                        title={t('prompts.delete')}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <p
                    className="text-xs leading-relaxed line-clamp-3 font-mono"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {prompt.content}
                  </p>

                  <div
                    className="flex items-center justify-between mt-3 pt-3 border-t"
                    style={{ borderColor: 'var(--border-soft)' }}
                  >
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                      {prompt.content.length} 字符
                    </span>
                    <button
                      onClick={() => {
                        const ev = new CustomEvent('insert-prompt', { detail: prompt.content })
                        window.dispatchEvent(ev)
                      }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors"
                      style={{ background: 'var(--input-bg)', color: 'var(--text-muted)' }}
                    >
                      <Zap className="w-3 h-3" /> {t('prompts.useInChat')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {prompts.length > 9 && (
            <div className="flex justify-center fade-up">
              <button
                onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                }}
              >
                {showAll ? '收起' : `查看全部 (${prompts.length - 9} 更多)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
