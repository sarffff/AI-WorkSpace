import React, { useState, useEffect } from 'react'
import { KeyRound, Database, Cpu, CheckCircle2, XCircle, Loader2, Save } from 'lucide-react'
import type { AppSettings } from '@servicedesk/sdk'

import { api } from '@/shared/api/client'

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

export const SettingsPage: React.FC = () => {
  const [form, setForm] = useState<AppSettings>({
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')

  // 初始加载配置
  useEffect(() => {
    api
      .getSettings()
      .then((s) => setForm(s))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleChange = (key: keyof AppSettings, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await api.updateSettings(form)
      setForm(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // TODO: 展示错误提示（toast）
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTestStatus('testing')
    const ok = await api.ping()
    setTestStatus(ok ? 'ok' : 'fail')
    setTimeout(() => setTestStatus('idle'), 4000)
  }

  const inputCls =
    'w-full bg-s4 border border-line focus:border-brand/50 focus:shadow-[0_0_0_1px_rgba(52,211,153,0.12)] rounded-lg px-3 py-2.5 text-xs text-t2 font-mono outline-none transition-all placeholder:text-t4'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-t3 text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-brand" />
        加载配置中...
      </div>
    )
  }

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-2xl space-y-6">
        {/* 页头 + 保存 */}
        <div className="flex items-end justify-between rise-in">
          <div>
            <h3 className="font-display text-lg font-bold text-t1">系统配置</h3>
            <p className="text-xs text-t3 mt-1">
              配置持久化于 MySQL Setting 表（key-value），ChatService 每次调用时动态读取。
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg transition-all border ${
              saved
                ? 'bg-emerald-500/15 border-brand/40 text-brand'
                : 'bg-brand/10 hover:bg-emerald-500/20 border-brand/30 hover:border-brand/50 text-brand'
            } disabled:opacity-50`}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : saved ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saved ? '已写入 Setting 表' : '保存配置'}
          </button>
        </div>

        {/* LLM Provider 配置 */}
        <div className="rise-in p-5 rounded-xl panel space-y-4" style={{ animationDelay: '90ms' }}>
          <div className="flex items-center gap-3 pb-3 border-b border-line">
            <div className="w-9 h-9 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center">
              <KeyRound className="w-4 h-4 text-brand" />
            </div>
            <div>
              <h4 className="font-display text-sm font-semibold text-t1">AI 模型配置</h4>
              <span className="text-[11px] text-t3">
                兼容 OpenAI 协议的任意供应商（GLM、DeepSeek、本地 Ollama 等）
              </span>
            </div>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
                接口地址
              </label>
              <input
                type="text"
                value={form.llmBaseUrl}
                onChange={(e) => handleChange('llmBaseUrl', e.target.value)}
                placeholder="https://open.bigmodel.cn/api/paas/v4/"
                className={inputCls}
              />
            </div>

            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
                接口密钥
              </label>
              <input
                type="password"
                value={form.llmApiKey}
                onChange={(e) => handleChange('llmApiKey', e.target.value)}
                placeholder="sk-..."
                className={inputCls}
              />
            </div>

            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
                默认模型
              </label>
              <input
                type="text"
                value={form.llmModel}
                onChange={(e) => handleChange('llmModel', e.target.value)}
                placeholder="GLM-4-Flash"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* 后端连接 */}
        <div className="rise-in p-5 rounded-xl panel space-y-4" style={{ animationDelay: '180ms' }}>
          <div className="flex items-center gap-3 pb-3 border-b border-line">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Database className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h4 className="font-display text-sm font-semibold text-t1">后端连接</h4>
              <span className="text-[11px] text-t3">检测与 NestJS 后端服务（:3000）的连通性</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={handleTestConnection}
              disabled={testStatus === 'testing'}
              className="flex items-center gap-2 px-4 py-2.5 bg-s3 hover:bg-s3 disabled:opacity-50 text-t2 text-xs font-semibold rounded-lg transition-all border border-line"
            >
              {testStatus === 'testing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {testStatus === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 text-brand" />}
              {testStatus === 'fail' && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              {(testStatus === 'idle' || testStatus === 'testing') && (
                <Cpu className="w-3.5 h-3.5" />
              )}
              测试连接
            </button>

            {testStatus === 'ok' && (
              <span className="text-[11px] font-mono text-brand flex items-center gap-1.5 fade-in">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 pulse-dot" />
                API ONLINE — 后端在线
              </span>
            )}
            {testStatus === 'fail' && (
              <span className="text-[11px] font-mono text-rose-400 flex items-center gap-1.5 fade-in">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 pulse-dot-red" />
                CONNECTION REFUSED — 请确认后端已启动
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t4 mb-1.5 block">
                MySQL Connection
              </label>
              <p className="text-[11px] text-t3 font-mono bg-s4 px-3 py-2.5 rounded-lg border border-line truncate">
                DATABASE_URL @ server/.env
              </p>
            </div>
            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t4 mb-1.5 block">
                Redis Cache
              </label>
              <p className="text-[11px] text-t3 font-mono bg-s4 px-3 py-2.5 rounded-lg border border-line truncate">
                REDIS_URL @ server/.env
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
