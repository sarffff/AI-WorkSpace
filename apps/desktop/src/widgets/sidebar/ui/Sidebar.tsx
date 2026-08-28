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
import { api, syncToken } from '@/shared/api/client'
import { NavTab } from '@servicedesk/sdk'
import {
  BookOpen,
  Sparkles,
  Settings,
  Plus,
  Database,
  Pin,
  PinOff,
  Trash2,
  Pencil,
  Activity,
  TicketCheck,
} from 'lucide-react'

// token 数量人性化：1.2k / 3.4M
const formatTokens = (n: number): string =>
  n >= 1000000
    ? `${(n / 1000000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

export const Sidebar: React.FC = () => {
  const dispatch = useDispatch()
  const { activeTab, sessions, currentChatId, selectedModel, serverStatus } = useSelector(
    (state: RootState) => state.chat,
  )
  const token = useSelector((state: RootState) => state.auth.token)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // token 变化时同步到共享客户端
  useEffect(() => {
    syncToken(token)
  }, [token])

  // 初始加载时从服务器获取会话列表
  useEffect(() => {
    if (!token) return
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
              tokens: c.tokens ?? { promptTokens: 0, completionTokens: 0 },
            })),
          ),
        )
      })
      .catch(() => {
        // 服务器不可用时使用本地数据
      })
  }, [dispatch, token])

  const navItems: { id: NavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'knowledge', label: '知识库', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'prompts', label: '提示词', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'tickets', label: '工单', icon: <TicketCheck className="w-4 h-4" /> },
    { id: 'settings', label: '设置', icon: <Settings className="w-4 h-4" /> },
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
    <aside className="w-72 border-r border-line bg-s1 flex flex-col h-full select-none backdrop-blur-xl">
      {/* 品牌区 */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400/90 to-teal-600/90 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Activity className="w-5 h-5 text-brand-on" strokeWidth={2.5} />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-brand border-2 border-s0 pulse-dot" />
          </div>
          <div>
            <h1 className="font-display font-bold text-[15px] text-t1 tracking-tight leading-none">
              ServiceDeck
            </h1>
            <span className="text-[10px] font-mono text-brand/80 tracking-wider mt-1 block">
              企业级智能服务台
            </span>
          </div>
        </div>
      </div>

      {/* 新建会话 */}
      <div className="px-4 pb-3">
        <button
          onClick={handleNewChat}
          className="w-full py-2.5 px-3 rounded-lg bg-brand/10 hover:bg-brand/20 border border-brand/30 hover:border-brand/50 text-brand text-xs font-semibold flex items-center justify-center gap-2 transition-all group"
        >
          <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
          新建对话
        </button>
      </div>

      {/* 导航 */}
      <div className="px-4 py-2 space-y-0.5">
        <div className="tag-telemetry text-[9px] text-t3 font-mono px-2 mb-1.5">功能模块</div>
        {navItems.map((item) => {
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => dispatch(setActiveTab(item.id))}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all relative ${
                active ? 'bg-s3 text-t1' : 'text-t3 hover:text-t2 hover:bg-s3/60'
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r bg-brand shadow-[0_0_8px_var(--brand-glow)]" />
              )}
              <span className={active ? 'text-brand' : ''}>{item.icon}</span>
              {item.label}
            </button>
          )
        })}
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-2 mt-1">
        <div className="tag-telemetry text-[9px] text-t3 font-mono px-2 mb-1.5 flex items-center justify-between">
          <span>会话列表</span>
          <span className="text-t4">{sorted.length.toString().padStart(2, '0')}</span>
        </div>
        <div className="space-y-0.5">
          {sorted.map((chat) => (
            <div
              key={chat.id}
              className={`group relative flex items-center gap-1 px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                currentChatId === chat.id ? 'bg-s3 text-t1' : 'text-t2 hover:bg-s3/60 hover:text-t1'
              }`}
              onClick={() => handleSelectChat(chat.id)}
            >
              {chat.pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0 fill-amber-500/80" />}

              {editingId === chat.id ? (
                <input
                  className="flex-1 bg-s4 text-xs text-t1 px-1.5 py-0.5 rounded border border-brand/60 outline-none min-w-0 font-medium"
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
                <span className="flex-1 truncate font-medium">{chat.title}</span>
              )}

              {/* token 用量徽标：hover 操作按钮出现时隐藏；0 表示历史会话（追踪前）置灰 */}
              {editingId !== chat.id && chat.tokens && (
                <span
                  className={`shrink-0 text-[9px] font-mono border border-line rounded px-1 py-px ${
                    chat.tokens.promptTokens + chat.tokens.completionTokens > 0
                      ? 'text-t3 bg-s2/60'
                      : 'text-t4/60 bg-transparent'
                  } group-hover:hidden`}
                  title={`输入 ${formatTokens(chat.tokens.promptTokens)} · 输出 ${formatTokens(chat.tokens.completionTokens)} · 合计 ${formatTokens(chat.tokens.promptTokens + chat.tokens.completionTokens)}`}
                >
                  {formatTokens(chat.tokens.promptTokens + chat.tokens.completionTokens)} tok
                </span>
              )}

              {editingId !== chat.id && (
                <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleTogglePin(chat.id)
                    }}
                    className="p-1 rounded hover:bg-s3 text-t3 hover:text-amber-500 transition-colors"
                    title={chat.pinned ? '取消固定' : '固定'}
                  >
                    {chat.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleStartRename(chat.id, chat.title)
                    }}
                    className="p-1 rounded hover:bg-s3 text-t3 hover:text-t1 transition-colors"
                    title="重命名"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(chat.id)
                    }}
                    className="p-1 rounded hover:bg-s3 text-t3 hover:text-rose-500 transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {sorted.length === 0 && (
            <p className="text-[11px] text-t4 px-3 py-4 font-mono text-center">暂无会话记录</p>
          )}
        </div>
      </div>

      {/* 运行时遥测面板 */}
      <div className="p-3 m-4 mt-2 rounded-xl panel space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="tag-telemetry text-[9px] text-t3 font-mono">运行状态</span>
          <span className="flex items-center gap-1.5 text-[9px] font-mono text-t3">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                serverStatus === 'online'
                  ? 'bg-brand pulse-dot'
                  : serverStatus === 'offline'
                    ? 'bg-rose-400 pulse-dot-red'
                    : 'bg-signal'
              }`}
            />
            {serverStatus === 'online'
              ? '服务在线'
              : serverStatus === 'offline'
                ? '服务离线'
                : '探测中'}
          </span>
        </div>
        <div className="text-[11px] text-t3 flex items-center justify-between">
          <span>AI 模型</span>
          <span className="text-brand font-mono text-[10px] px-1.5 py-0.5 bg-brand/10 border border-brand/20 rounded max-w-[130px] truncate">
            {selectedModel}
          </span>
        </div>
        <div className="text-[11px] text-t3 flex items-center justify-between">
          <span>通信协议</span>
          <span className="text-t2 font-mono text-[10px] px-1.5 py-0.5 bg-s3 rounded">
            HTTP · SSE
          </span>
        </div>
        <div className="text-[11px] text-t3 flex items-center justify-between">
          <span>数据存储</span>
          <span className="text-t2 font-mono text-[10px] px-1.5 py-0.5 bg-s3 rounded flex items-center gap-1">
            <Database className="w-2.5 h-2.5 text-brand" /> MySQL·Prisma
          </span>
        </div>
      </div>
    </aside>
  )
}
