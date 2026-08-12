import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState, AppDispatch } from '@/app/providers/store'
import { setSelectedModel, setActiveTab, setServerStatus } from '@/entities/chat/model/chatSlice'
import { logoutUser } from '@/entities/auth/model/authSlice'
import { Sun, Moon, LogOut, Settings, Bot } from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'
import { useTheme } from '@/entities/theme/model/themeContext'

export const Header: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>()
  const { t } = useI18n()
  const { mode, toggleTheme } = useTheme()
  const isDark = mode === 'dark'
  const selectedModel = useSelector((state: RootState) => state.chat.selectedModel)
  const models = useSelector((state: RootState) => state.chat.models)
  const currentChatId = useSelector((state: RootState) => state.chat.currentChatId)
  const messagesBySession = useSelector((state: RootState) => state.chat.messagesBySession)
  const [serverState, setServerState] = useState<'checking' | 'online' | 'offline'>('checking')

  const lastMsg = currentChatId
    ? (messagesBySession[currentChatId] || []).filter((m) => m.role === 'user').at(-1)
    : null

  const sessionTitle = lastMsg
    ? lastMsg.content?.slice(0, 48) || t('chat.selectConv')
    : t('chat.selectConv')

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('http://localhost:3000/health', {
          signal: AbortSignal.timeout(2500),
        })
        setServerState(res.ok ? 'online' : 'offline')
        void dispatch(setServerStatus(res.ok ? 'online' : 'offline'))
      } catch {
        setServerState('offline')
        void dispatch(setServerStatus('offline'))
      }
    }
    checkHealth()
    const id = setInterval(checkHealth, 30000)
    return () => clearInterval(id)
  }, [dispatch])

  return (
    <header
      className="flex items-center justify-between px-4 py-2.5 shrink-0"
      style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-2 h-2 rounded-full shrink-0 transition-colors"
          style={{
            background: serverState === 'online' ? 'var(--accent-emerald)' : 'var(--accent-red)',
            boxShadow: `0 0 8px ${serverState === 'online' ? 'rgba(34,197,94,.6)' : 'rgba(239,68,68,.6)'}`,
          }}
        />
        <h1 className="text-sm font-semibold truncate" style={{ color: 'var(--text-main)' }}>
          {sessionTitle}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? t('chat.ragOn') : t('chat.ragOff')}
          className="p-1.5 rounded-lg transition-all hover:bg-white/5"
          style={{ color: 'var(--text-muted)' }}
        >
          {isDark ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        </button>

        {/* Model pill */}
        <div
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono cursor-pointer transition-all hover:opacity-80"
          style={{
            background: 'var(--input-bg)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border-soft)',
          }}
        >
          <Bot className="w-3.5 h-3.5" style={{ color: 'var(--accent-cyan)' }} />
          <select
            value={selectedModel}
            onChange={(e) => dispatch(setSelectedModel(e.target.value))}
            className="bg-transparent focus:outline-none appearance-none cursor-pointer"
            style={{ color: 'var(--text-main)' }}
          >
            {models.map((m: string) => (
              <option
                key={m}
                value={m}
                style={{ background: 'var(--bg-panel)', color: 'var(--text-main)' }}
              >
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px h-5" style={{ background: 'var(--border-soft)' }} />

        <button
          onClick={() => dispatch(setActiveTab('settings'))}
          className="p-2 rounded-lg transition-all hover:bg-white/5"
          style={{ color: 'var(--text-dim)' }}
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={() => dispatch(logoutUser())}
          title={t('header.logout')}
          className="p-2 rounded-lg transition-all hover:bg-red-500/10"
          style={{ color: 'var(--text-dim)' }}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
