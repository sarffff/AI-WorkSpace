import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { api } from '@/shared/api/client'
import { loginSuccess } from '@/entities/auth/model/authSlice'
import { useTheme } from '@/app/providers/ThemeContext'
import {
  Activity,
  Github,
  Chrome,
  Loader2,
  Eye,
  EyeOff,
  Zap,
  BookOpen,
  Settings2,
  Sun,
  Moon,
} from 'lucide-react'

type Mode = 'login' | 'register'

const FEATURES = [
  { icon: <Zap className="w-3.5 h-3.5" />, label: 'SSE 流式对话', sub: 'STREAM' },
  { icon: <BookOpen className="w-3.5 h-3.5" />, label: 'RAG 知识库检索', sub: 'RETRIEVAL' },
  { icon: <Settings2 className="w-3.5 h-3.5" />, label: '动态 LLM 配置', sub: 'RUNTIME' },
]

export const AuthPage: React.FC = () => {
  const dispatch = useDispatch()
  const { theme, toggleTheme } = useTheme()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (m: Mode) => {
    if (busy || m === mode) return
    setMode(m)
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res =
        mode === 'login'
          ? await api.login({ email: email.trim(), password })
          : await api.register({ email: email.trim(), password, name: name.trim() || undefined })
      api.token = res.token
      dispatch(loginSuccess({ token: res.token, user: res.user }))
    } catch (err) {
      setError((err as Error).message || '操作失败，请重试')
      setBusy(false)
    }
  }

  // 第三方登录：仅展示，未接入
  const handleThirdParty = (provider: string) => {
    setToast(`${provider} 登录即将开放，敬请期待`)
    setTimeout(() => setToast(''), 2600)
  }

  const inputCls =
    'w-full bg-s3 border border-line focus:border-brand/60 focus:shadow-[0_0_0_1px_var(--brand-ring)] rounded-lg px-3.5 py-2.5 text-xs text-t1 placeholder:text-t4 outline-none transition-all'

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-s0 font-sans">
      {/* 氛围层 */}
      <div className="glow-field pointer-events-none absolute inset-0 z-0" />
      <div className="bg-blueprint pointer-events-none absolute inset-0 z-0" />
      <div className="noise-overlay" />

      {/* 主题切换 */}
      <button
        onClick={toggleTheme}
        className="absolute top-5 right-5 z-20 w-9 h-9 rounded-lg panel flex items-center justify-center text-t2 hover:text-brand hover:border-brand/40 transition-all"
        title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>

      {/* 轻提示 */}
      {toast && (
        <div className="absolute top-5 left-1/2 -translate-x-1/2 z-30 fade-in px-4 py-2 rounded-lg panel text-xs text-signal font-mono">
          {toast}
        </div>
      )}

      {/* ===== 左侧：品牌宣言面板 ===== */}
      <div className="hidden lg:flex relative z-10 w-[46%] flex-col justify-between p-12 border-r border-line bg-s1 backdrop-blur-xl">
        <div className="rise-in flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Activity className="w-6 h-6 text-brand-on" strokeWidth={2.5} />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand border-2 border-s0 pulse-dot" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg text-t1 tracking-tight leading-none">
              AI Workspace
            </h1>
            <span className="text-[10px] font-mono text-brand/80 tracking-wider mt-1 block">
              ENTERPRISE AGENT CONSOLE
            </span>
          </div>
        </div>

        <div className="max-w-md">
          <h2
            className="rise-in font-display text-4xl font-bold text-t1 leading-tight tracking-tight"
            style={{ animationDelay: '100ms' }}
          >
            你的企业级
            <br />
            <span className="text-brand">Agent 工作台</span>
          </h2>
          <p
            className="rise-in text-sm text-t3 leading-relaxed mt-5"
            style={{ animationDelay: '180ms' }}
          >
            统一的智能对话、知识检索与提示词工程入口。 基于 NestJS + Prisma + SSE
            构建，会话与配置实时持久化。
          </p>

          <div className="rise-in mt-8 space-y-3" style={{ animationDelay: '260ms' }}>
            {FEATURES.map((f) => (
              <div key={f.label} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-brand/10 border border-brand/25 text-brand flex items-center justify-center">
                  {f.icon}
                </div>
                <span className="text-xs font-medium text-t2">{f.label}</span>
                <span className="text-[9px] font-mono text-t4 tag-telemetry">{f.sub}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="rise-in flex items-center gap-4 text-[9px] font-mono text-t4 tag-telemetry"
          style={{ animationDelay: '340ms' }}
        >
          <span>NESTJS</span>
          <span className="w-1 h-1 rounded-full bg-line" />
          <span>PRISMA · MYSQL</span>
          <span className="w-1 h-1 rounded-full bg-line" />
          <span>SSE STREAMING</span>
          <span className="w-1 h-1 rounded-full bg-line" />
          <span>REDIS</span>
        </div>
      </div>

      {/* ===== 右侧：认证表单 ===== */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* 移动端品牌（窄屏时显示） */}
          <div className="lg:hidden rise-in flex items-center gap-2.5 mb-8 justify-center">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center">
              <Activity className="w-5 h-5 text-brand-on" strokeWidth={2.5} />
            </div>
            <span className="font-display font-bold text-t1">AI Workspace</span>
          </div>

          {/* 模式切换 */}
          <div className="rise-in grid grid-cols-2 p-1 rounded-xl bg-s3 border border-line mb-6 relative">
            <span
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-s2 border border-line transition-transform duration-300 ease-out shadow-sm"
              style={{
                transform: mode === 'login' ? 'translateX(4px)' : 'translateX(calc(100% + 4px))',
              }}
            />
            <button
              onClick={() => switchMode('login')}
              className={`relative z-10 py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'login' ? 'text-t1' : 'text-t3 hover:text-t2'
              }`}
            >
              登录
            </button>
            <button
              onClick={() => switchMode('register')}
              className={`relative z-10 py-2 text-xs font-semibold rounded-lg transition-colors ${
                mode === 'register' ? 'text-t1' : 'text-t3 hover:text-t2'
              }`}
            >
              注册
            </button>
          </div>

          <div className="rise-in" style={{ animationDelay: '80ms' }}>
            <h3 className="font-display text-lg font-bold text-t1">
              {mode === 'login' ? '欢迎回来' : '创建账户'}
            </h3>
            <p className="text-[11px] font-mono text-t4 mt-1 tracking-wide">
              {mode === 'login' ? '// AUTHENTICATE TO CONTINUE' : '// PROVISION NEW OPERATOR'}
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rise-in mt-6 space-y-4"
            style={{ animationDelay: '150ms' }}
          >
            {mode === 'register' && (
              <div className="fade-in">
                <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
                  昵称（可选）
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如何称呼你？"
                  maxLength={40}
                  className={inputCls}
                />
              </div>
            )}

            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className={inputCls}
              />
            </div>

            <div>
              <label className="tag-telemetry text-[9px] font-mono text-t3 mb-1.5 block">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? '至少 6 位' : '••••••••'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className={`${inputCls} pr-10`}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-t3 hover:text-t1 transition-colors"
                  title={showPwd ? '隐藏密码' : '显示密码'}
                >
                  {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="fade-in text-[11px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/25 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-3 rounded-lg bg-brand-strong hover:brightness-110 disabled:opacity-50 text-brand-on text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/20"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === 'login' ? (
                <Activity className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              {busy ? '验证中...' : mode === 'login' ? '登录工作台' : '注册并进入'}
            </button>
          </form>

          {/* 第三方登录（展示） */}
          <div className="rise-in mt-7" style={{ animationDelay: '220ms' }}>
            <div className="divider-label mb-4">SSO · 第三方登录</div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleThirdParty('GitHub')}
                className="py-2.5 rounded-lg bg-s2 border border-line hover:border-t3 text-t2 hover:text-t1 text-xs font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Github className="w-4 h-4" />
                GitHub
              </button>
              <button
                onClick={() => handleThirdParty('Google')}
                className="py-2.5 rounded-lg bg-s2 border border-line hover:border-t3 text-t2 hover:text-t1 text-xs font-medium flex items-center justify-center gap-2 transition-all"
              >
                <Chrome className="w-4 h-4" />
                Google
              </button>
            </div>
          </div>

          <p
            className="rise-in text-center text-[10px] font-mono text-t4 mt-8"
            style={{ animationDelay: '300ms' }}
          >
            {mode === 'login' ? '还没有账户？' : '已有账户？'}
            <button
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              className="text-brand hover:underline underline-offset-2 ml-1"
            >
              {mode === 'login' ? '立即注册' : '直接登录'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
