import React, { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { HttpClient } from '@ai-workspace/sdk'
import { RootState } from '@/app/providers/store'
import { setSelectedModel } from '@/entities/chat/model/chatSlice'
import { Loader2, MessageSquare, Monitor, RefreshCw, Save, Server, UserCog } from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'

const api = new HttpClient('http://localhost:3000')

// Default model list used when no API endpoint exists
const DEFAULT_MODELS = [{ id: 'glm-4.5-air', name: 'GLM-4.5-Air' }]

export const SettingsPage: React.FC = () => {
  const { t } = useI18n()
  const dispatch = useDispatch()
  const currentModel = useSelector((state: RootState) => state.chat.selectedModel)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [savedKey, setSavedKey] = useState('')
  const [loadStatus, setLoadStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [models, setModels] = useState<{ id: string; name: string }[]>(DEFAULT_MODELS)
  const modelsLoaded = useRef(false)

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    try {
      await Promise.all([loadSettings(), loadModels()])
      setLoadStatus('loaded')
    } catch {
      setLoadStatus('error')
    }
  }

  const loadSettings = async () => {
    try {
      const res = await api.getSettings()
      const map: Record<string, string> = {}
      for (const item of res.data) {
        map[item.key] = item.value
      }
      setSettings(map)
    } catch {
      /* ignore */
    }
  }

  const loadModels = async () => {
    if (modelsLoaded.current) return
    modelsLoaded.current = true
    // No listModels endpoint in current SDK; use defaults
    setModels(DEFAULT_MODELS)
  }

  const handleModelChange = async (modelId: string) => {
    dispatch(setSelectedModel(modelId))
    await api.updateSettings({ LLM_MODEL: modelId })
  }

  const handleSave = async (key: string, value: string) => {
    setSaving(true)
    setSavedKey(key)
    try {
      await api.updateSettings({ [key]: value })
      setSettings((prev) => ({ ...prev, [key]: value }))
      setTimeout(() => setSavedKey(''), 1500)
    } catch {
      setSavedKey('')
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 transition-colors font-mono'

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-void)' }}>
      <div
        className="h-px w-full"
        style={{ background: 'linear-gradient(90deg,transparent,var(--glow-cyan),transparent)' }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 space-y-6">
          {/* Header */}
          <div className="flex items-center gap-3 fade-up">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg,rgba(34,211,238,.15),rgba(99,102,241,.1))',
                border: '1px solid rgba(34,211,238,.2)',
              }}
            >
              <UserCog className="w-5 h-5" style={{ color: 'var(--accent-cyan)' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-main)' }}>
                {t('settings.title')}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                管理 API 配置、默认模型和通用偏好设置
              </p>
            </div>
          </div>

          {/* ── API Connection ── */}
          <div
            className="rounded-2xl border p-5 fade-up fade-up-delay-1"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-4 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Server className="w-3.5 h-3.5" /> API 连接
            </div>
            <div className="space-y-3">
              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.apiKey')}
                </label>
                <input
                  type="password"
                  value={settings['API_KEY'] || ''}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['API_KEY']: e.target.value }))
                  }
                  placeholder="sk-..."
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>
              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.apiUrl')}
                </label>
                <input
                  type="text"
                  value={settings['API_URL'] || ''}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['API_URL']: e.target.value }))
                  }
                  placeholder="http://localhost:3000"
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>
              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.embeddingModel')}
                </label>
                <input
                  type="text"
                  value={settings['EMBEDDING_MODEL'] || ''}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['EMBEDDING_MODEL']: e.target.value }))
                  }
                  placeholder="text-embedding-ada-002"
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── General Settings ── */}
          <div
            className="rounded-2xl border p-5 fade-up fade-up-delay-2"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-4 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Monitor className="w-3.5 h-3.5" /> 通用设置
            </div>
            <div className="space-y-3">
              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.defaultModel')}
                </label>
                <select
                  value={currentModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={models.length === 0}
                  className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500/40 transition-colors ${
                    loadStatus === 'error' ? 'border-red-500/40' : ''
                  }`}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: loadStatus === 'error' ? 'rgba(239,68,68,.3)' : 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                >
                  {loadStatus === 'loading' && <option value="">加载中...</option>}
                  {loadStatus === 'error' && <option value="">加载失败，请检查后端</option>}
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {loadStatus === 'error' && (
                  <p className="text-[10px] text-red-400 mt-1.5">{t('settings.modelListError')}</p>
                )}
              </div>

              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.maxTokens')}
                </label>
                <input
                  type="number"
                  value={settings['MAX_TOKENS'] || '4096'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['MAX_TOKENS']: e.target.value }))
                  }
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.temperature')}
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={settings['TEMPERATURE'] || '0.7'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['TEMPERATURE']: e.target.value }))
                  }
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.topP')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={settings['TOP_P'] || '0.9'}
                  onChange={(e) => setSettings((prev) => ({ ...prev, ['TOP_P']: e.target.value }))}
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── Chat Settings ── */}
          <div
            className="rounded-2xl border p-5 fade-up fade-up-delay-3"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-4 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <MessageSquare className="w-3.5 h-3.5" /> 对话设置
            </div>
            <div className="space-y-3">
              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.maxMessages')}
                </label>
                <input
                  type="number"
                  value={settings['MAX_MESSAGES_IN_CONVERSATION'] || '50'}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      ['MAX_MESSAGES_IN_CONVERSATION']: e.target.value,
                    }))
                  }
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.ragThreshold')}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={settings['RAG_THRESHOLD'] || '0.25'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['RAG_THRESHOLD']: e.target.value }))
                  }
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>

              <div>
                <label
                  className="block text-xs mb-1.5 font-medium"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('settings.ragTopK')}
                </label>
                <input
                  type="number"
                  value={settings['RAG_TOP_K'] || '5'}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, ['RAG_TOP_K']: e.target.value }))
                  }
                  className={inputClass}
                  style={{
                    background: 'var(--input-bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text-main)',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center justify-end gap-3 fade-up">
            <button
              onClick={loadAll}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-80"
              style={{
                background: 'var(--input-bg)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}
            >
              <RefreshCw className="w-3.5 h-3.5" /> {t('settings.refresh')}
            </button>
            <button
              onClick={() => handleSave('', '')}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40 hover:opacity-90 active:scale-[0.97]"
              style={{
                background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
                boxShadow: '0 4px 16px rgba(34,211,238,.25)',
              }}
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('settings.saving')}
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" /> {t('settings.save')}
                </>
              )}
              {savedKey && <span className="ml-1 text-emerald-300">✓</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
