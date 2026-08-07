import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '@/app/providers/store'
import {
  setSessions,
  setCurrentChat,
  setActiveTab,
  deleteChat as deleteChatAction,
  togglePinChat as togglePinAction,
  renameChat as renameAction,
} from '@/entities/chat/model/chatSlice'
import { HttpClient } from '@ai-workspace/sdk'
import { NavTab } from '@ai-workspace/sdk'
import {
  BookOpen,
  Sparkles,
  Settings,
  Plus,
  Database,
  Cpu,
  Pin,
  PinOff,
  Trash2,
  Pencil,
  MessageSquare,
  Hexagon,
} from 'lucide-react'

const api = new HttpClient('http://localhost:3000')

export const Sidebar: React.FC = () => {
  const dispatch = useDispatch()
  const { activeTab, sessions, currentChatId, selectedModel } = useSelector(
    (state: RootState) => state.chat,
  )

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    api
      .getChats()
      .then((chats) => {
        dispatch(
          setSessions(
            chats.map((c) => ({
              id: c.id,
              title: c.title,
              date: c.date,
              pinned: c.pinned,
            })),
          ),
        )
      })
      .catch(() => {})
  }, [dispatch])

  const navItems: { id: NavTab; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: 'knowledge', label: '知识库', icon: <BookOpen className="w-4 h-4" />, desc: 'RAG 文档' },
    { id: 'prompts', label: '提示词', icon: <Sparkles className="w-4 h-4" />, desc: '角色工场' },
    { id: 'settings', label: '设置', icon: <Settings className="w-4 h-4" />, desc: '偏好配置' },
  ]

  const handleNewChat = () => {
    dispatch(setCurrentChat(null))
    dispatch(setActiveTab('chat'))
  }

  const handleSelectChat = (id: string) => {
    dispatch(setCurrentChat(id))
    dispatch(setActiveTab('chat'))
  }

  const handleStartRename = (id: string, title: string) => {
    setEditingId(id)
    setEditValue(title)
  }

  const handleSaveRename = (id: string) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      dispatch(renameAction({ id, title: trimmed }))
      api.renameChat(id, trimmed).catch(() => {})
    }
    setEditingId(null)
    setEditValue('')
  }

  const handleDelete = (id: string) => {
    dispatch(deleteChatAction(id))
    api.deleteChat(id).catch(() => {})
  }

  const handleTogglePin = (id: string) => {
    dispatch(togglePinAction(id))
    api.togglePinChat(id).catch(() => {})
  }

  const sorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return 0
  })

  return (
    <aside className="w-64 bg-[var(--bg-panel)] border-r border-[var(--border-color)] flex flex-col h-full select-none relative overflow-hidden">
      {/* 背景微光 */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-amber-500/[0.03] to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* 品牌区 */}
      <div className="p-4 border-b border-[var(--border-color)]/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-600 via-orange-600 to-yellow-600 flex items-center justify-center shadow-lg shadow-amber-900/30 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tl from-white/10 to-transparent" />
            <Hexagon className="w-5 h-5 text-white relative" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-[var(--text-primary)] tracking-wide">
              AI 工作区
            </h1>
            <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 status-dot" />
              智能体在线
            </span>
          </div>
        </div>
      </div>

      {/* 新建按钮 */}
      <div className="p-3">
        <button
          onClick={handleNewChat}
          className="w-full py-2.5 px-3 rounded-xl bg-[var(--bg-hover)] hover:bg-amber-900/30 border border-[var(--border-color)] hover:border-amber-700/30 text-[var(--text-secondary)] hover:text-amber-200 text-xs font-medium flex items-center justify-center gap-2 transition-all duration-200 group"
        >
          <Plus className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-200" />
          新建聊天
        </button>
      </div>

      {/* 导航 */}
      <div className="px-3 py-2 space-y-0.5">
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-dim)] font-semibold px-2 mb-2">
          功能
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => dispatch(setActiveTab(item.id))}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all duration-200 ${
              activeTab === item.id
                ? 'bg-amber-500/10 text-amber-200 border border-amber-700/20'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span
              className={`${activeTab === item.id ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}
            >
              {item.icon}
            </span>
            <span className="flex-1 text-left">{item.label}</span>
            {activeTab === item.id && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-2 mt-1">
        <div className="text-[10px] uppercase tracking-widest text-[var(--text-dim)] font-semibold px-2 mb-2 flex items-center justify-between">
          <span>最近对话</span>
          {sessions.length > 0 && (
            <span className="text-[var(--text-dim)] font-normal">{sessions.length}</span>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="px-2 py-6 text-center">
            <MessageSquare className="w-5 h-5 text-[var(--text-dim)] mx-auto mb-2 opacity-50" />
            <p className="text-[11px] text-[var(--text-dim)]">暂无对话记录</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {sorted.map((chat) => (
              <div
                key={chat.id}
                className={`group relative flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition-all duration-150 cursor-pointer ${
                  currentChatId === chat.id
                    ? 'bg-amber-500/10 text-amber-100 border border-amber-700/20'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
                onClick={() => handleSelectChat(chat.id)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {chat.pinned && (
                    <Pin className="w-3 h-3 text-amber-400 shrink-0 fill-amber-400/50" />
                  )}
                  {editingId === chat.id ? (
                    <input
                      className="flex-1 bg-[var(--bg-hover)] text-xs text-[var(--text-primary)] px-1.5 py-0.5 rounded border border-amber-500/50 outline-none min-w-0"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRename(chat.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={() => handleSaveRename(chat.id)}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate font-medium">{chat.title}</span>
                  )}
                </div>

                {editingId !== chat.id && (
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleTogglePin(chat.id)
                      }}
                      className="p-1 rounded-md hover:bg-amber-700/20 text-[var(--text-muted)] hover:text-amber-400 transition-colors"
                      title={chat.pinned ? '取消固定' : '固定'}
                    >
                      {chat.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleStartRename(chat.id, chat.title)
                      }}
                      className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                      title="重命名"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(chat.id)
                      }}
                      className="p-1 rounded-md hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部状态 */}
      <div className="p-3">
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] p-3 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            <span>运行时</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
            <span>模型</span>
            <span className="text-[var(--text-primary)] font-mono text-[10px] px-2 py-0.5 bg-[var(--bg-hover)] rounded-md border border-[var(--border-color)]">
              {selectedModel}
            </span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] flex items-center justify-between">
            <span>存储</span>
            <span className="text-[var(--text-primary)] font-mono text-[10px] px-2 py-0.5 bg-[var(--bg-hover)] rounded-md border border-[var(--border-color)] flex items-center gap-1">
              <Database className="w-2.5 h-2.5 text-emerald-400" />
              MySQL
            </span>
          </div>
        </div>
      </div>
    </aside>
  )
}
