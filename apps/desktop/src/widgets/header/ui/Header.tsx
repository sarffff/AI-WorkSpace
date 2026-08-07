import React, { useEffect, useState } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState } from '@/app/providers/store'
import { setSelectedModel, setServerStatus } from '@/entities/chat/model/chatSlice'
import { logout } from '@/entities/auth/model/authSlice'
import { HttpClient } from '@ai-workspace/sdk'
import {
  ChevronDown,
  CircleUser as UserCircle,
  LogOut,
  Activity,
  Zap,
  SlidersHorizontal,
} from 'lucide-react'

const api = new HttpClient('http://localhost:3000')

export const Header: React.FC = () => {
  const dispatch = useDispatch()
  const { selectedModel, activeTab, serverStatus, sessions } = useSelector(
    (state: RootState) => state.chat,
  )
  const user = useSelector((state: RootState) => state.auth.user)
  const [showMenu, setShowMenu] = useState(false)
  const [appVersion] = React.useState<string>('0.1.0')

  useEffect(() => {
    api.ping().then((online) => {
      dispatch(setServerStatus(online ? 'online' : 'offline'))
    })
  }, [dispatch])

  const models = ['glm-4.5-air', 'gpt-6', 'Claude-Opus-5', 'DeepSeek-V4', 'Gemini-3.5-Pro']

  const titles: Record<string, { title: string; sub: string }> = {
    chat: { title: '对话工作台', sub: '对流引擎 · 流式回复' },
    knowledge: { title: '知识库 & RAG', sub: '向量检索 · 语料自信注入' },
    prompts: { title: '提示词车间', sub: '角色预设 · 行为校准' },
    settings: { title: '系统设置', sub: '账户 · 模型 · 连接' },
  }

  const current = titles[activeTab] || titles.chat

  const statusColor =
    serverStatus === 'online'
      ? 'text-emerald-400'
      : serverStatus === 'offline'
        ? 'text-red-400'
        : 'text-amber-400'
  const statusDotColor =
    serverStatus === 'online'
      ? 'bg-emerald-400'
      : serverStatus === 'offline'
        ? 'bg-red-400'
        : 'bg-amber-400'
  const statusLabel =
    serverStatus === 'online'
      ? `在线 · ${sessions.length} 对话`
      : serverStatus === 'offline'
        ? '已离线'
        : '正在检查…'

  return (
    <header
      className="h-16 shrink-0 border-b border-[rgba(217,119,6,0.10)] bg-gradient-to-b from-[rgba(16,16,24,0.92)] to-[rgba(10,10,15,0.96)] px-6 flex items-center justify-between select-none backdrop-blur"
      style={{ WebkitAppRegion: 'drag' } as never}
    >
      {/* 左侧：标题 + 版本徽章 */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-[var(--text-primary)] tracking-tight leading-tight truncate">
              {current.title}
            </h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/[0.10] text-amber-400 border border-amber-500/20 font-medium tracking-wide shrink-0">
              v{appVersion}
            </span>
          </div>
          <span className="text-[11px] text-[var(--text-dim)] mt-1 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-amber-500/70" />
            {current.sub}
          </span>
        </div>
      </div>

      {/* 右侧控制区 */}
      <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as never}>
        {/* 模型选择器 */}
        <div className="relative group">
          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-500/60 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            value={selectedModel}
            onChange={(e) => dispatch(setSelectedModel(e.target.value))}
            className="appearance-none bg-[rgba(20,20,30,0.80)] hover:bg-[rgba(26,26,36,0.9)] border border-[var(--border-color)] hover:border-amber-600/40 text-[12px] text-[var(--text-primary)] rounded-lg pl-8 pr-8 py-2 focus:outline-none focus:ring-1 focus:ring-amber-500/50 cursor-pointer font-medium transition-all duration-150"
          >
            {models.map((m) => (
              <option key={m} value={m} className="bg-[#14141c] text-[#f1f1f4]">
                {m}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-amber-500/60 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-amber-400 transition-colors" />
        </div>

        {/* 服务端状态 */}
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-medium ${
            serverStatus === 'online'
              ? 'bg-emerald-500/[0.06] border-emerald-500/20'
              : serverStatus === 'offline'
                ? 'bg-red-500/[0.06] border-red-500/20'
                : 'bg-amber-500/[0.06] border-amber-500/20'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor} status-dot`} />
          <span className={statusColor}>{statusLabel}</span>
          <Activity className={`w-3 h-3 ${statusColor} opacity-70`} />
        </div>

        {/* 用户区块 + 下拉 */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-[var(--border-color)] bg-[rgba(20,20,30,0.80)] hover:border-amber-600/40 hover:bg-[rgba(26,26,36,0.9)] transition-all duration-150"
          >
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-amber-600 via-orange-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-amber-900/30">
              <UserCircle className="w-3.5 h-3.5" />
            </div>
            <span className="text-[12px] text-[var(--text-secondary)] max-w-[90px] truncate font-medium">
              {user?.name || '用户'}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200 ${showMenu ? 'rotate-180' : ''}`}
            />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-2 z-20 w-56 rounded-xl bg-[#16161e] border border-[var(--border-color)] shadow-2xl shadow-black/60 overflow-hidden animate-fade-slide">
                <div className="px-4 py-3.5 border-b border-[var(--border-color)] bg-gradient-to-br from-amber-500/[0.04] to-transparent flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-600 via-orange-600 to-amber-500 flex items-center justify-center text-white">
                    <UserCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] text-[var(--text-primary)] font-semibold truncate">
                      {user?.name}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate">{user?.email}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    dispatch(logout())
                    setShowMenu(false)
                  }}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[12px] text-red-400 hover:bg-red-500/[0.08] transition-colors font-medium"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
