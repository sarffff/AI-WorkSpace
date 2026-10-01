import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import {
  KeyRound,
  Database,
  Cpu,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  Users,
  UserPlus,
  KeySquare,
  Brain,
  Trash2,
} from 'lucide-react'
import type { AppSettings, ServerUser, ServerMemory } from '@servicedesk/sdk'

import { api, getApiBaseUrl, setApiBaseUrl } from '@/shared/api/client'
import { RootState } from '@/app/providers/store'

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'

const ROLE_LABEL: Record<string, string> = {
  employee: '员工',
  agent: '坐席',
  admin: '管理员',
}

const MEMORY_CATEGORY_LABEL: Record<string, string> = {
  preference: '偏好',
  fact: '事实',
  ticket: '工单记录',
}

// ===== 我的记忆：跨会话长期记忆的可见性与可删除性（合规最小闭环） =====
const MemoryPanel: React.FC = () => {
  const [memories, setMemories] = useState<ServerMemory[]>([])
  const [loading, setLoading] = useState(true)
  const [clearArm, setClearArm] = useState(false)

  const load = () => {
    api
      .listMemories()
      .then(setMemories)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const remove = (id: string) => {
    api
      .deleteMemory(id)
      .then(() => setMemories((prev) => prev.filter((m) => m.id !== id)))
      .catch(() => {})
  }

  const clear = () => {
    if (!clearArm) {
      setClearArm(true)
      setTimeout(() => setClearArm(false), 3000)
      return
    }
    api
      .clearMemories()
      .then(() => setMemories([]))
      .catch(() => {})
      .finally(() => setClearArm(false))
  }

  return (
    <div className="rise-in p-5 rounded-xl panel space-y-4" style={{ animationDelay: '270ms' }}>
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-s3 flex items-center justify-center">
            <Brain className="w-4 h-4 text-t2" />
          </div>
          <div>
            <h4 className="font-display text-sm font-semibold text-t1">我的记忆</h4>
            <span className="text-[11px] text-t3">
              Agent 跨会话记住的偏好与事实，会话开始时按相关性注入；可随时删除
            </span>
          </div>
        </div>
        {memories.length > 0 && (
          <button
            onClick={clear}
            className={`px-3 py-2 rounded-lg text-xs transition-colors shrink-0 border ${
              clearArm
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-500'
                : 'border-line text-t3 hover:text-t1'
            }`}
          >
            {clearArm ? '确认清空？' : '清空全部'}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-t3 py-4 text-center">加载记忆中...</p>
      ) : memories.length === 0 ? (
        <p className="text-xs text-t4 py-4 text-center">
          暂无记忆 —— 对话中透露的偏好会被自动记住并出现在这里
        </p>
      ) : (
        <div className="space-y-1.5">
          {memories.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-s4 border border-line"
            >
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-s3 text-t3 shrink-0">
                {MEMORY_CATEGORY_LABEL[m.category] ?? m.category}
              </span>
              <span className="flex-1 text-xs text-t2 truncate" title={m.content}>
                {m.content}
              </span>
              <button
                onClick={() => remove(m.id)}
                className="p-1.5 rounded-lg text-t4 hover:text-rose-500 hover:bg-rose-500/10 transition-colors shrink-0"
                title="删除这条记忆"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 成员管理（仅 admin）：关自助注册后的建号/角色/部门/重置密码入口 =====
const MembersPanel: React.FC = () => {
  const [users, setUsers] = useState<ServerUser[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    email: '',
    name: '',
    department: '',
    role: 'employee',
    password: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPwd, setResetPwd] = useState('')

  const load = () => {
    api
      .listUsers()
      .then((res) => {
        setUsers(res.users)
        setDepartments(res.departments)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!form.email.trim() || form.password.length < 8) {
      setError('需填写邮箱，且初始密码至少 8 位')
      return
    }
    setBusy(true)
    setError('')
    try {
      await api.createUser({
        email: form.email.trim(),
        password: form.password,
        name: form.name.trim() || undefined,
        department: form.department.trim() || undefined,
        role: form.role,
      })
      setCreateOpen(false)
      setForm({ email: '', name: '', department: '', role: 'employee', password: '' })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '开通失败')
    } finally {
      setBusy(false)
    }
  }

  const patchUser = async (id: string, input: Parameters<typeof api.updateUser>[1]) => {
    try {
      const updated = await api.updateUser(id, input)
      setUsers((prev) => prev.map((p) => (p.id === id ? updated : p)))
    } catch {
      load()
    }
  }

  const handleReset = async (id: string) => {
    if (resetPwd.length < 8) return
    try {
      await api.resetUserPassword(id, resetPwd)
      setResetId(null)
      setResetPwd('')
    } catch {
      // 失败保持输入态可重试
    }
  }

  const fieldCls =
    'bg-s4 border border-line focus:border-linestrong rounded-lg px-2.5 py-1.5 text-xs text-t1 outline-none transition-colors placeholder:text-t4'

  return (
    <div className="rise-in p-5 rounded-xl panel space-y-4" style={{ animationDelay: '270ms' }}>
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-s3 flex items-center justify-center">
            <Users className="w-4 h-4 text-t2" />
          </div>
          <div>
            <h4 className="font-display text-sm font-semibold text-t1">成员管理</h4>
            <span className="text-[11px] text-t3">
              自助注册已关闭：账号由管理员开通，角色决定知识库范围与坐席权限
            </span>
          </div>
        </div>
        <button
          onClick={() => setCreateOpen((o) => !o)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-strong hover:brightness-110 text-brand-on text-xs font-semibold transition-all shrink-0"
        >
          <UserPlus className="w-3.5 h-3.5" />
          开通账号
        </button>
      </div>

      {createOpen && (
        <div className="fade-in grid grid-cols-2 gap-2.5 p-3.5 rounded-lg bg-s4 border border-line">
          <input
            className={fieldCls}
            placeholder="邮箱 *"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            className={fieldCls}
            placeholder="昵称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className={fieldCls}
            list="dept-options"
            placeholder="部门"
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
          />
          <select
            className={fieldCls}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {Object.entries(ROLE_LABEL).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <input
            className={`${fieldCls} col-span-2`}
            type="password"
            placeholder="初始密码（至少 8 位）*"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          {error && <p className="col-span-2 text-[11px] text-rose-500">{error}</p>}
          <div className="col-span-2 flex justify-end gap-2">
            <button
              onClick={() => setCreateOpen(false)}
              className="px-3 py-1.5 rounded-lg text-xs text-t3 hover:text-t1 border border-line transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={busy}
              className="px-4 py-1.5 rounded-lg bg-brand-strong hover:brightness-110 text-brand-on text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              确认开通
            </button>
          </div>
          <datalist id="dept-options">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-t3 py-4 text-center">加载成员中...</p>
      ) : (
        <div className="space-y-1.5">
          {users.map((u) => (
            <div
              key={u.id}
              className="grid grid-cols-[1fr_120px_90px_auto] items-center gap-2 px-3 py-2 rounded-lg bg-s4 border border-line"
            >
              <div className="min-w-0">
                <p className="text-xs text-t1 truncate">
                  {u.name || u.email}
                  <span className="text-t4 ml-1.5">{u.name ? u.email : ''}</span>
                </p>
              </div>
              <input
                className={fieldCls}
                list="dept-options"
                defaultValue={u.department ?? ''}
                placeholder="部门"
                onBlur={(e) => {
                  if ((e.target.value || '') !== (u.department ?? ''))
                    patchUser(u.id, { department: e.target.value })
                }}
              />
              <select
                className={fieldCls}
                value={u.role}
                onChange={(e) => patchUser(u.id, { role: e.target.value })}
              >
                {Object.entries(ROLE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                {resetId === u.id ? (
                  <>
                    <input
                      className={`${fieldCls} w-28`}
                      type="password"
                      placeholder="新密码≥8位"
                      value={resetPwd}
                      onChange={(e) => setResetPwd(e.target.value)}
                    />
                    <button
                      onClick={() => handleReset(u.id)}
                      className="px-2 py-1.5 rounded-lg text-[11px] text-brand hover:bg-brand/10 transition-colors"
                    >
                      确认
                    </button>
                    <button
                      onClick={() => {
                        setResetId(null)
                        setResetPwd('')
                      }}
                      className="px-2 py-1.5 rounded-lg text-[11px] text-t4 hover:text-t1 transition-colors"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setResetId(u.id)}
                    className="p-1.5 rounded-lg text-t4 hover:text-t1 hover:bg-s3 transition-colors"
                    title="重置密码"
                  >
                    <KeySquare className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const SettingsPage: React.FC = () => {
  const user = useSelector((s: RootState) => s.auth.user)
  const isAdmin = user?.role === 'admin'
  const [form, setForm] = useState<AppSettings>({
    llmBaseUrl: '',
    llmApiKey: '',
    llmModel: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl())
  const [serverUrlEdited, setServerUrlEdited] = useState(false)
  const [serverUrlInvalid, setServerUrlInvalid] = useState(false)

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
                ? 'bg-brand/15 border-brand/40 text-brand'
                : 'bg-brand-strong hover:brightness-110 border-transparent text-brand-on'
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
              <span className="text-[11px] text-t3">配置 NestJS 后端服务地址并检测连通性</span>
            </div>
          </div>

          <div>
            <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
              服务器地址（http(s)://，保存后立即生效）
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => {
                setServerUrl(e.target.value)
                setServerUrlEdited(true)
                setServerUrlInvalid(false)
              }}
              placeholder="http://localhost:3000"
              className={`${inputCls} ${serverUrlInvalid ? 'border-rose-400/60' : ''}`}
            />
            {serverUrlInvalid && (
              <p className="text-[10px] font-mono text-rose-400 mt-1.5 fade-in">
                INVALID URL — 需以 http:// 或 https:// 开头
              </p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (!setApiBaseUrl(serverUrl)) {
                  setServerUrlInvalid(true)
                  return
                }
                setServerUrlEdited(false)
                handleTestConnection()
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-s3 hover:bg-s3 disabled:opacity-50 text-t2 text-xs font-semibold rounded-lg transition-all border border-line"
            >
              {testStatus === 'testing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {testStatus === 'ok' && <CheckCircle2 className="w-3.5 h-3.5 text-brand" />}
              {testStatus === 'fail' && <XCircle className="w-3.5 h-3.5 text-rose-400" />}
              {(testStatus === 'idle' || testStatus === 'testing') && (
                <Cpu className="w-3.5 h-3.5" />
              )}
              {serverUrlEdited ? '保存并测试连接' : '测试连接'}
            </button>

            {serverUrlEdited && testStatus !== 'testing' && (
              <span className="text-[11px] font-mono text-amber-400 fade-in">
                地址已修改，点击按钮保存后生效
              </span>
            )}

            {testStatus === 'ok' && (
              <span className="text-[11px] font-mono text-brand flex items-center gap-1.5 fade-in">
                <span className="w-1.5 h-1.5 rounded-full bg-brand pulse-dot" />
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

        {/* 成员管理：仅管理员可见 */}
        {isAdmin && <MembersPanel />}

        {/* 我的记忆：所有用户可见可删 */}
        <MemoryPanel />
      </div>
    </div>
  )
}
