import React, { useState } from 'react'
import { useDispatch } from 'react-redux'
import { setUser } from '@/entities/auth/model/authSlice'
import { Bot, Mail, Lock, User, Github, Chrome, Eye, EyeOff, Loader2 } from 'lucide-react'

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
      dispatch(setUser(data))
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
      dispatch(setUser(data))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen w-screen bg-[#090d16] font-sans items-center justify-center">
      <div className="w-full max-w-md px-6">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-blue-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/30 mb-4">
            <Bot className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-slate-100">AI 工作区</h1>
          <p className="text-xs text-slate-400 mt-1">登录以继续使用</p>
        </div>

        {/* 登录 / 注册切换 */}
        <div className="flex mb-6 bg-slate-900 rounded-xl p-1 border border-slate-800">
          <button
            onClick={() => {
              setMode('login')
              setError('')
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
              mode === 'login'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            登录
          </button>
          <button
            onClick={() => {
              setMode('register')
              setError('')
            }}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
              mode === 'register'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            注册
          </button>
        </div>

        {/* 表单 */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="昵称（选填）"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 transition-all"
              />
            </div>
          )}
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱"
              type="email"
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 transition-all"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              type={showPwd ? 'text' : 'password'}
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-9 pr-9 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPwd(!showPwd)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && <p className="text-xs text-red-400 px-1">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/20"
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        {/* 分隔线 */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-slate-800" />
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">或</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        {/* 第三方登录（UI 展示） */}
        <div className="space-y-2.5">
          <button
            onClick={() => quickLogin('default@ai-workspace.local', '123456')}
            className="w-full py-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-medium flex items-center justify-center gap-2.5 transition-all group"
          >
            <span className="w-5 h-5 rounded bg-slate-800 flex items-center justify-center text-[10px] font-bold text-indigo-400 group-hover:bg-indigo-600/20 transition-colors">
              D
            </span>
            默认账号快速登录
          </button>
          <button
            className="w-full py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-xs font-medium flex items-center justify-center gap-2.5 transition-all cursor-not-allowed opacity-60"
            title="GitHub 登录暂未开放"
          >
            <Github className="w-4 h-4" />
            GitHub 登录
          </button>
          <button
            className="w-full py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 text-xs font-medium flex items-center justify-center gap-2.5 transition-all cursor-not-allowed opacity-60"
            title="Google 登录暂未开放"
          >
            <Chrome className="w-4 h-4" />
            Google 登录
          </button>
        </div>
      </div>
    </div>
  )
}

export default AuthPage
