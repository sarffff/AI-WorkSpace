import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { AppDispatch } from '@/app/providers/store'
import { setAuthUser } from '@/entities/auth/model/authSlice'
import { setActiveTab } from '@/entities/chat/model/chatSlice'
import { HttpClient } from '@ai-workspace/sdk'
import type { LoginResponse } from '@ai-workspace/sdk'
import { Bot, Eye, EyeOff, KeyRound, ShieldCheck, Mail, Lock, UserCircle } from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'

const api = new HttpClient('http://localhost:3000')

export const LoginPage: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>()
  const { t } = useI18n()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [magicEmail, setMagicEmail] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setError(t('login.fillFields'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const res: LoginResponse = await api.login(email, password)
      dispatch(setAuthUser(res))
      dispatch(setActiveTab('chat'))
    } catch (err) {
      setError((err as Error).message || t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password || !name) {
      setError(t('login.fillFields'))
      return
    }
    setLoading(true)
    setError('')
    try {
      const res: LoginResponse = await api.register({ email, password, name })
      dispatch(setAuthUser(res))
      dispatch(setActiveTab('chat'))
    } catch (err) {
      setError((err as Error).message || t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleMagicLink = async () => {
    if (!magicEmail || !magicEmail.includes('@')) {
      setError(t('login.emailInvalid'))
      return
    }
    setError('')
    try {
      // Simulate magic link: use login with empty password as placeholder
      // Real implementation would call a dedicated /auth/magic endpoint
      await api.login(magicEmail, '')
      setMagicSent(true)
    } catch {
      setError(t('login.sendFailed'))
    }
  }

  const inputBase =
    'w-full pl-10 pr-4 py-3 rounded-xl text-sm transition-all focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20'

  return (
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: 'var(--bg-void)' }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--dot-color) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />
      <div
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-[128px] opacity-20 animate-orb-float"
        style={{ background: '#f59e0b' }}
      />
      <div
        className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-[128px] opacity-20 animate-orb-float"
        style={{ animationDelay: '1s', background: '#22d3ee' }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-[160px] opacity-10 animate-orb-pulse"
        style={{ background: 'linear-gradient(135deg,#f59e0b,#22d3ee)' }}
      />

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="text-center mb-8 fade-up">
          <div
            className="w-20 h-20 rounded-3xl mx-auto mb-4 flex items-center justify-center animate-glow-pulse"
            style={{
              background: 'linear-gradient(135deg,#f59e0b 0%,#ef4444 40%,#22d3ee 70%,#0ea5e9 100%)',
              boxShadow: '0 0 60px rgba(245,158,11,.4),0 0 120px rgba(34,211,238,.2)',
            }}
          >
            <Bot className="w-10 h-10 text-white" />
          </div>
          <h1
            className="text-3xl font-black tracking-tight"
            style={{
              background: 'linear-gradient(135deg,#f59e0b,#22d3ee)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AI Workspace
          </h1>
          <p className="text-sm mt-1.5 font-medium" style={{ color: 'var(--text-muted)' }}>
            {t('app.subtitle')}
          </p>
        </div>

        {/* Tab nav */}
        <div
          className="flex rounded-2xl p-1 mb-6 fade-up"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
        >
          {(
            [
              { key: 'login', label: t('login.login') },
              { key: 'signup', label: t('login.signup') },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setTab(key)
                setError('')
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
              style={
                tab === key
                  ? {
                      background: 'linear-gradient(135deg,#f59e0b,#ef4444)',
                      color: '#fff',
                      boxShadow: '0 4px 12px rgba(245,158,11,.3)',
                    }
                  : {
                      color: tab === key ? 'var(--accent-cyan)' : 'var(--text-muted)',
                      background: 'transparent',
                    }
              }
            >
              {label}
            </button>
          ))}
        </div>

        {/* Card body */}
        <div
          className="rounded-3xl border p-8 fade-up"
          style={{
            background: 'var(--bg-panel)',
            borderColor: 'var(--border)',
            boxShadow: '0 32px 64px rgba(0,0,0,.3)',
          }}
        >
          {tab === 'login' ? (
            <form onSubmit={handleLogin}>
              <div className="space-y-4">
                <div className="relative">
                  <UserCircle
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--text-dim)' }}
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.email')}
                    className={`${inputBase}`}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-main)',
                    }}
                  />
                </div>
                <div className="relative">
                  <KeyRound
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--text-dim)' }}
                  />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.password')}
                    className={`${inputBase} pr-10`}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-main)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    {showPwd ? (
                      <EyeOff className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                    ) : (
                      <Eye className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                  style={{
                    background: 'rgba(239,68,68,.08)',
                    border: '1px solid rgba(239,68,68,.2)',
                    color: '#f87171',
                  }}
                >
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-red-400" />
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full mt-5 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg,#f59e0b,#ef4444)',
                  boxShadow: '0 4px 20px rgba(245,158,11,.3)',
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('login.signingIn')}
                  </span>
                ) : (
                  t('login.login')
                )}
              </button>

              {/* Magic link */}
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById('magic-link-section')?.classList.toggle('hidden')
                  }
                  className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                  }}
                >
                  <span className="flex items-center justify-center gap-2">
                    <Mail className="w-4 h-4" />
                    {t('login.magicLink')}
                  </span>
                </button>
                <div id="magic-link-section" className="hidden mt-3 space-y-3">
                  <input
                    type="email"
                    value={magicEmail}
                    onChange={(e) => setMagicEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    className={`w-full px-4 py-3 rounded-xl text-sm ${inputBase}`}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-main)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleMagicLink}
                    disabled={!magicEmail}
                    className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                    style={{
                      background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
                      boxShadow: '0 4px 20px rgba(34,211,238,.25)',
                    }}
                  >
                    <span className="flex items-center justify-center gap-2">
                      <Mail className="w-4 h-4" />
                      {t('login.sendMagicLink')}
                    </span>
                  </button>
                  {magicSent && (
                    <div
                      className="text-center py-3 rounded-xl"
                      style={{
                        background: 'rgba(34,197,94,.08)',
                        border: '1px solid rgba(34,197,94,.2)',
                      }}
                    >
                      <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-emerald-400" />
                      <p className="text-sm font-medium text-emerald-300">
                        {t('login.checkEmail')}
                      </p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {magicEmail}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignup}>
              <div className="space-y-4">
                <div className="relative">
                  <UserCircle
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--text-dim)' }}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('login.name')}
                    className={`${inputBase}`}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-main)',
                    }}
                  />
                </div>
                <div className="relative">
                  <UserCircle
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--text-dim)' }}
                  />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.email')}
                    className={`${inputBase}`}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-main)',
                    }}
                  />
                </div>
                <div className="relative">
                  <Lock
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: 'var(--text-dim)' }}
                  />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('login.password')}
                    className={`${inputBase} pr-10`}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-main)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                  >
                    {showPwd ? (
                      <EyeOff className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                    ) : (
                      <Eye className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <div
                  className="mt-3 px-3 py-2 rounded-lg text-xs"
                  style={{
                    background: 'rgba(239,68,68,.08)',
                    border: '1px solid rgba(239,68,68,.2)',
                    color: '#f87171',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password || !name}
                className="w-full mt-5 py-3 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg,#22c55e,#0ea5e9)',
                  boxShadow: '0 4px 20px rgba(34,197,94,.3)',
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t('login.signingUp')}
                  </span>
                ) : (
                  t('login.continue')
                )}
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 text-center text-xs" style={{ color: 'var(--text-dim)' }}>
          {t('login.or')} · <span style={{ color: 'var(--accent-cyan)' }}>v0.1.0</span>
        </div>
      </div>
    </div>
  )
}
