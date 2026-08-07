import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { loginSuccess } from '@/entities/auth/model/authSlice'
import { Hexagon, Mail, Lock, User, Eye, EyeOff, Loader2, AtSign } from 'lucide-react'

const AuthPage: React.FC = () => {
  const dispatch = useDispatch()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const body =
        mode === 'login' ? { email, password } : { email, password, name: name || undefined }
      const res = await fetch(`http://localhost:3000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg.includes('邮箱') ? msg : '操作失败，请重试')
      }
      const data = await res.json()
      dispatch(loginSuccess({ user: data, token: data.token }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const quickLogin = async (e: string, p: string) => {
    setEmail(e)
    setPassword(p)
    setError('')
    setLoading(true)
    try {
      const res = await fetch('http://localhost:3000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e, password: p }),
      })
      if (!res.ok) throw new Error('登录失败')
      const data = await res.json()
      dispatch(loginSuccess({ user: data, token: data.token }))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex h-screen w-screen bg-[var(--bg-base)] font-sans items-center justify-center overflow-hidden">
      {/* ===== 氛围背景层 ===== */}
      {/* 底部巨大暖光 */}
      <div
        className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(217,119,6,0.10) 0%, transparent 62%)',
        }}
      />
      {/* 顶部微弱冷光 */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(251,146,60,0.06) 0%, transparent 65%)',
        }}
      />
      {/* 左右两侧淡色角标 */}
      <div className="absolute -left-24 top-1/3 w-56 h-56 rounded-full bg-amber-900/[0.05] blur-3xl pointer-events-none" />
      <div className="absolute -right-28 bottom-1/4 w-72 h-72 rounded-full bg-orange-900/[0.04] blur-3xl pointer-events-none" />
      {/* 细腻网格纹理 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* ===== 主卡片 ===== */}
      <div className="relative z-10 w-full max-w-[420px] px-6 animate-fade-slide">
        {/* Logo & 标题 */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-600 via-orange-600 to-yellow-500 flex items-center justify-center shadow-xl shadow-amber-900/40 mb-5 relative overflow-hidden animate-pulse-glow">
            <div className="absolute inset-0 bg-gradient-to-tl from-white/15 to-transparent" />
            <Hexagon className="w-8 h-8 text-white relative" strokeWidth={1.4} />
          </div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight leading-tight">
            AI 工作台
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-2 tracking-wide">智能助手 · 高效执行</p>
        </div>

        {/* 主卡片 */}
        <div className="rounded-2xl bg-[var(--bg-panel)]/80 border border-[var(--border-color)] backdrop-blur-md overflow-hidden shadow-2xl shadow-black/40">
          {/* 登录/注册切换胶囊 */}
          <div className="px-5 pt-5">
            <div className="flex rounded-xl bg-[var(--bg-card)] p-1 border border-[var(--border-color)]">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m)
                    setError('')
                  }}
                  className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
                    mode === m
                      ? 'bg-gradient-to-br from-amber-600/25 to-orange-600/18 text-amber-200 shadow-inner border border-amber-700/25'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {m === 'login' ? '登 录' : '注 册'}
                </button>
              ))}
            </div>
          </div>

          {/* 表单 */}
          <form onSubmit={handleSubmit} className="px-5 pt-4 pb-2 space-y-3.5">
            {mode === 'register' && (
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)] pointer-events-none" />
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="昵称（选填）"
                  className="warm-input w-full rounded-xl pl-10 pr-4 py-3 text-[13px] text-[var(--text-primary)] placeholder-[var(--text-dim)]"
                />
              </div>
            )}
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)] pointer-events-none" />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="邮箱"
                type="email"
                required
                className="warm-input w-full rounded-xl pl-10 pr-4 py-3 text-[13px] text-[var(--text-primary)] placeholder-[var(--text-dim)]"
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)] pointer-events-none" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码"
                type={showPwd ? 'text' : 'password'}
                required
                className="warm-input w-full rounded-xl pl-10 pr-11 py-3 text-[13px] text-[var(--text-primary)] placeholder-[var(--text-dim)]"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {error && (
              <p className="text-[11px] text-red-400 px-1 flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-red-400 shrink-0" />
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:opacity-50 disabled:pointer-events-none text-white text-[13px] font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-900/30 tracking-wide"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? '进入工作台' : '创建工作区'}
            </button>
          </form>

          {/* 分割线 */}
          <div className="flex items-center gap-3 px-5 py-3">
            <div className="flex-1 h-px bg-[var(--border-color)]" />
            <span className="text-[10px] text-[var(--text-dim)] uppercase tracking-widest select-none">
              或
            </span>
            <div className="flex-1 h-px bg-[var(--border-color)]" />
          </div>

          {/* 快捷登录 & 第三方 */}
          <div className="px-5 pb-5 space-y-2.5">
            <button
              onClick={() => quickLogin('default@ai-workspace.local', '123456')}
              className="w-full py-2.5 rounded-xl bg-[rgba(20,20,30,0.8)] hover:bg-[rgba(26,26,36,0.9)] border border-[var(--border-color)] hover:border-amber-600/35 text-[13px] font-medium flex items-center justify-center gap-2.5 transition-all group"
            >
              <div className="w-5 h-5 rounded-md bg-gradient-to-br from-amber-600/20 to-orange-600/20 border border-amber-700/30 flex items-center justify-center text-[10px] font-bold text-amber-400 group-hover:scale-110 transition-transform">
                <AtSign className="w-3 h-3" />
              </div>
              <span className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                快速体验（默认账户）
              </span>
            </button>
          </div>
        </div>

        {/* 页脚。
            低调的版权与备用提示，Claude 风格 */}
        <p className="text-center text-[11px] text-[var(--text-dim)] mt-6 tracking-wide">
          AI 工作台 · 桌面版 &nbsp;·&nbsp; 数据存储于本地环境
        </p>
      </div>
    </div>
  )
}

export default AuthPage
