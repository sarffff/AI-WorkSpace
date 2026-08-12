import React, { useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { AppDispatch } from '@/app/providers/store'
import { RootState } from '@/app/providers/store'
import {
  createChat,
  setCurrentChat,
  deleteChat,
  renameChat,
  togglePinChat,
  setActiveTab,
} from '@/entities/chat/model/chatSlice'
import {
  MessageSquarePlus,
  Settings,
  MoreVertical,
  Pin,
  Trash2,
  Bot,
  TicketCheck,
  Database,
  Library,
  Workflow,
} from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'
import { useTheme } from '@/entities/theme/model/themeContext'
import { HttpClient } from '@ai-workspace/sdk'

const api = new HttpClient('http://localhost:3000')

interface SidebarChatItemProps {
  chat: { id: string; title: string; date: string; pinned: boolean }
  isActive: boolean
  isNew: boolean
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => void
  onPin: (id: string) => void
}

const SidebarChatItem: React.FC<SidebarChatItemProps> = ({
  chat,
  isActive,
  isNew,
  onRename,
  onDelete,
  onPin,
}) => {
  const { mode } = useTheme()
  const isDark = mode === 'dark'
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(chat.title)

  const handleSaveRename = async () => {
    if (editTitle.trim() !== chat.title) {
      await onRename(chat.id, editTitle.trim())
    }
    setEditing(false)
  }

  return (
    <div
      className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm cursor-pointer transition-all duration-200 ${isNew ? '' : ''}`}
      style={
        isActive
          ? {
              background: isDark ? 'rgba(34,211,238,.1)' : 'rgba(34,211,238,.08)',
              border: `1px solid ${isDark ? 'rgba(34,211,238,.2)' : 'rgba(34,211,238,.15)'}`,
              color: '#22d3ee',
            }
          : { color: isDark ? '#94a3b8' : '#64748b', border: '1px solid transparent' }
      }
      onClick={() => {
        if (!editing) setMenuOpen(!menuOpen)
      }}
    >
      <MessageSquarePlus className={`w-4 h-4 shrink-0 ${isActive ? '' : 'opacity-50'}`} />
      {editing ? (
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={handleSaveRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSaveRename()
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
          style={{ color: isActive ? '#22d3ee' : 'var(--text-main)' }}
          autoFocus
        />
      ) : (
        <span className="flex-1 min-w-0 truncate">{chat.title}</span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPin(chat.id)
          }}
          className="p-1 rounded hover:bg-white/5 transition-colors"
          style={{ color: chat.pinned ? 'var(--accent-cyan)' : 'var(--text-dim)' }}
        >
          <Pin className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          className="p-1 rounded hover:bg-white/5 transition-colors"
          style={{ color: 'var(--text-dim)' }}
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(chat.id)
          }}
          className="p-1 rounded hover:bg-red-500/10 transition-colors"
          style={{ color: 'var(--text-dim)' }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export const Sidebar: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>()
  const { t } = useI18n()
  const { sessions, currentChatId, activeTab } = useSelector((state: RootState) => state.chat)

  const navItems = [
    { id: 'tickets' as const, label: t('sidebar.tickets'), icon: TicketCheck },
    { id: 'knowledge' as const, label: t('sidebar.knowledge'), icon: Database },
    { id: 'prompts' as const, label: t('sidebar.prompts'), icon: Library },
    { id: 'tasks' as const, label: t('sidebar.tasks'), icon: Workflow },
  ]

  const sessionsList = useMemo(() => {
    const pinned = sessions.filter((s) => s.pinned).sort((a, b) => a.title.localeCompare(b.title))
    const unpinned = sessions.filter((s) => !s.pinned).sort((a, b) => b.date.localeCompare(a.date))
    return [...pinned, ...unpinned]
  }, [sessions])

  const handleNewChat = async () => {
    try {
      const res = await api.createChat('New Conversation')
      dispatch(createChat(res.id))
    } catch {
      const id = `chat_${Date.now()}`
      dispatch(createChat(id))
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteChat(id)
    dispatch(deleteChat(id))
  }

  const handleRename = async (id: string, title: string) => {
    await api.renameChat(id, title)
    dispatch(renameChat({ id, title }))
  }

  const handlePin = async (id: string) => {
    await api.togglePinChat(id)
    dispatch(togglePinChat(id))
  }

  const handleSelect = (id: string) => {
    dispatch(setCurrentChat(id))
  }

  return (
    <aside
      className="flex flex-col shrink-0 border-r"
      style={{
        width: 260,
        background: 'var(--bg-panel)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Brand */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg,#f59e0b,#ef4444)',
              boxShadow: '0 0 20px rgba(245,158,11,.3)',
            }}
          >
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold" style={{ color: 'var(--text-main)' }}>
              AI WS
            </h1>
            <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              v0.1.0
            </p>
          </div>
        </div>
      </div>

      {/* New Chat button */}
      <div className="px-3 mb-3">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg,#f59e0b,#ef4444)',
            color: '#fff',
            boxShadow: '0 4px 16px rgba(245,158,11,.25)',
          }}
        >
          <MessageSquarePlus className="w-4 h-4" />
          {t('sidebar.newChat')}
        </button>
      </div>

      <div className="px-3 mb-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => dispatch(setActiveTab(item.id))}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-all"
              style={
                active
                  ? {
                      background: 'rgba(245,158,11,.12)',
                      color: '#f59e0b',
                      border: '1px solid rgba(245,158,11,.18)',
                    }
                  : { color: 'var(--text-muted)', border: '1px solid transparent' }
              }
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          )
        })}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p
          className="text-[10px] font-mono uppercase tracking-widest mb-2"
          style={{ color: 'var(--text-dim)' }}
        >
          {t('sidebar.conversations')}
        </p>
        <div className="space-y-1">
          {sessionsList.map((chat) => (
            <div key={chat.id} onClick={() => handleSelect(chat.id)}>
              <SidebarChatItem
                chat={chat}
                isActive={currentChatId === chat.id}
                isNew={false}
                onRename={handleRename}
                onDelete={handleDelete}
                onPin={handlePin}
              />
            </div>
          ))}
          {sessionsList.length === 0 && (
            <p className="text-xs py-4 text-center" style={{ color: 'var(--text-dim)' }}>
              {t('chat.selectConv')}
            </p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => dispatch(setActiveTab('settings'))}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all hover:bg-white/5"
          style={{ color: 'var(--text-muted)' }}
        >
          <Settings className="w-4 h-4" />
          {t('sidebar.settings')}
        </button>
      </div>
    </aside>
  )
}
