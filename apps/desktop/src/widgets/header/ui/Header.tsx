import React, { useEffect, useRef, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState } from '@/app/providers/store'
import { setSelectedModel, setServerStatus } from '@/entities/chat/model/chatSlice'
import { logout } from '@/entities/auth/model/authSlice'
import { api } from '@/shared/api/client'
import { useTheme } from '@/app/providers/ThemeContext'
import { ChevronDown, Sun, Moon, LogOut, CircleUserRound } from 'lucide-react'

export const Header: React.FC = () => {
  const dispatch = useDispatch()
  const { selectedModel, activeTab, serverStatus, sessions } = useSelector(
    (state: RootState) => state.chat,
  )
  const user = useSelector((state: RootState) => state.auth.user)
  const { theme, toggleTheme } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [appVersion] = React.useState<string>('0.1.0')

  useEffect(() => {
    api.ping().then((online) => {
      dispatch(setServerStatus(online ? 'online' : 'offline'))
    })
  }, [dispatch])

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const models = ['glm-4.5-air', 'glm-4.6v', 'glm-4.7', 'DeepSeek-V4-flash']

  const modules: Record<string, { code: string; title: string }> = {
    chat: { code: '01', title: '智能对话' },
    knowledge: { code: '02', title: '知识库' },
    prompts: { code: '03', title: '提示词' },
    tickets: { code: '04', title: '工单服务台' },
    settings: { code: '05', title: '系统配置' },
  }

  const mod = modules[activeTab] || modules.chat

  const online = serverStatus === 'online'
  const checking = serverStatus === 'checking'

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <header className="h-14 relative z-10 border-b border-line bg-s1 backdrop-blur px-6 flex items-center justify-between select-none">
      <div className="flex items-center gap-3 rise-in">
        <span className="font-mono text-[10px] text-brand/80 bg-brand/5 border border-brand/15 rounded px-1.5 py-0.5">
          模块 {mod.code}
        </span>
        <div className="flex items-baseline gap-2.5">
          <h2 className="font-display text-[15px] font-semibold text-t1 tracking-tight">
            {mod.title}
          </h2>
        </div>
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-line text-t3">
          v{appVersion}
        </span>
      </div>

      <div className="flex items-center gap-3 rise-in" style={{ animationDelay: '80ms' }}>
        {/* 模型选择器 */}
        <div className="relative group">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-brand pulse-dot pointer-events-none" />
          <select
            value={selectedModel}
            onChange={(e) => dispatch(setSelectedModel(e.target.value))}
            className="appearance-none bg-s3 hover:bg-s3/80 text-brand text-[11px] font-mono rounded-lg pl-6 pr-7 py-1.5 border border-line hover:border-brand/40 focus:outline-none focus:border-brand/60 cursor-pointer transition-all"
            title="选择 LLM 模型"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-s2 text-t1 font-sans">
                {m}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 text-t3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-brand transition-colors" />
        </div>

        {/* 服务状态 */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[10px] font-mono transition-colors ${
            online
              ? 'bg-brand/5 border-brand/25 text-brand'
              : checking
                ? 'bg-signal/5 border-signal/25 text-signal'
                : 'bg-rose-500/5 border-rose-500/25 text-rose-500'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              online ? 'bg-brand pulse-dot' : checking ? 'bg-signal' : 'bg-rose-400 pulse-dot-red'
            }`}
          />
          {online ? `服务在线 · ${sessions.length} 个会话` : checking ? '探测中...' : '服务离线'}
        </div>

        {/* 主题切换 */}
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-lg bg-s3 border border-line flex items-center justify-center text-t2 hover:text-brand hover:border-brand/40 transition-all"
          title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
        </button>

        {/* 用户菜单 */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-lg bg-s3 border border-line hover:border-brand/40 transition-all"
            title="账户菜单"
          >
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center text-[10px] font-bold text-brand-on">
              {initial}
            </div>
            <span className="text-[11px] font-medium text-t1 max-w-[80px] truncate">
              {user?.name || '操作员'}
            </span>
            <ChevronDown
              className={`w-3 h-3 text-t3 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-xl panel shadow-xl fade-in overflow-hidden z-50">
              <div className="p-3.5 border-b border-line">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center text-sm font-bold text-brand-on">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-t1 truncate">
                      {user?.name || '操作员'}
                    </p>
                    <p className="text-[10px] font-mono text-t3 truncate">{user?.email}</p>
                  </div>
                </div>
              </div>
              <div className="p-1.5">
                <div className="px-2.5 py-1.5 flex items-center gap-2 text-[10px] font-mono text-t4">
                  <CircleUserRound className="w-3 h-3" />
                  用户编号 · {user?.id?.slice(0, 8) ?? '--------'}
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    dispatch(logout())
                  }}
                  className="w-full px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs text-rose-500 hover:bg-rose-500/10 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  退出登录
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部信号渐变线 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand/25 to-transparent" />
    </header>
  )
}
