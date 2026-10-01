import React, { useState, useEffect, useMemo, useRef } from 'react'
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
import { PenSquare, Search, Pin, PinOff, Trash2, Pencil, MoreHorizontal } from 'lucide-react'

// token 数量人性化：1.2k / 3.4M
const formatTokens = (n: number): string =>
  n >= 1000000
    ? `${(n / 1000000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

// 服务端 date 为人性化字符串（刚刚 / N 分钟前 / N 小时前 / M月D日），
// 按字面归入时间分组，顺序保持服务端返回的 updatedAt 倒序
const groupOf = (date: string): string => {
  if (/刚刚|分钟前|小时前/.test(date)) return '今天'
  const m = /(\d+)月(\d+)日/.exec(date)
  if (!m) return '更早'
  const now = new Date()
  const d = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]))
  const days = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - d.getTime()) / 86400000,
  )
  if (days <= 1) return '昨天'
  if (days <= 7) return '前 7 天'
  if (days <= 30) return '前 30 天'
  return '更早'
}

const GROUP_ORDER = ['今天', '昨天', '前 7 天', '前 30 天', '更早']

// 会话栏：仅对话页出现，承载新对话 / 搜索 / 时间分组历史
export const Sidebar: React.FC = () => {
  const dispatch = useDispatch()
  const { sessions, currentChatId } = useSelector((state: RootState) => state.chat)
  const token = useSelector((state: RootState) => state.auth.token)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [query, setQuery] = useState('')
  const [rowMenuId, setRowMenuId] = useState<string | null>(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)

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

  // 点击外部关闭行菜单
  useEffect(() => {
    if (!rowMenuId) return
    const onClick = (e: MouseEvent) => {
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) setRowMenuId(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [rowMenuId])

  const handleNewChat = () => {
    dispatch(setCurrentChat(null))
    dispatch(setActiveTab('chat'))
  }

  const handleSelectChat = (id: string) => {
    dispatch(setCurrentChat(id))
  }

  const handleStartRename = (id: string, title: string) => {
    setEditingId(id)
    setEditValue(title)
    setRowMenuId(null)
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
    setRowMenuId(null)
  }

  const handleTogglePin = (id: string) => {
    dispatch(togglePinAction(id))
    api.togglePinChat(id).catch(() => {})
    setRowMenuId(null)
  }

  // 搜索过滤 + 固定优先 + 时间分组
  const groups = useMemo(() => {
    const kw = query.trim().toLowerCase()
    const filtered = kw ? sessions.filter((s) => s.title.toLowerCase().includes(kw)) : sessions
    const sorted = [...filtered].sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1))
    const pinned = sorted.filter((s) => s.pinned)
    const rest = sorted.filter((s) => !s.pinned)
    const byGroup = new Map<string, typeof rest>()
    for (const s of rest) {
      const g = groupOf(s.date)
      if (!byGroup.has(g)) byGroup.set(g, [])
      byGroup.get(g)!.push(s)
    }
    const result: { label: string; items: typeof rest }[] = []
    if (pinned.length > 0) result.push({ label: '已固定', items: pinned })
    for (const g of GROUP_ORDER) {
      const items = byGroup.get(g)
      if (items && items.length > 0) result.push({ label: g, items })
    }
    return result
  }, [sessions, query])

  const renderRow = (chat: (typeof sessions)[number]) => {
    const active = currentChatId === chat.id
    return (
      <div
        key={chat.id}
        className={`group relative flex items-center rounded-lg pr-1 text-[13px] cursor-pointer transition-colors ${
          active ? 'bg-s3 text-t1' : 'text-t2 hover:bg-s3/60 hover:text-t1'
        }`}
        onClick={() => handleSelectChat(chat.id)}
      >
        {editingId === chat.id ? (
          <input
            className="flex-1 bg-s4 text-[13px] text-t1 px-2 py-1.5 mx-1 rounded-md border border-linestrong outline-none min-w-0"
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
          <span className="flex-1 truncate py-1.5 pl-2.5 pr-7">{chat.title}</span>
        )}

        {/* token 用量：hover 出操作钮时隐藏；0 表示历史会话（追踪前）置灰 */}
        {editingId !== chat.id && chat.tokens && rowMenuId !== chat.id && (
          <span
            className={`absolute right-1.5 text-[10px] tabular-nums group-hover:hidden ${
              chat.tokens.promptTokens + chat.tokens.completionTokens > 0 ? 'text-t4' : 'text-t4/50'
            }`}
            title={`输入 ${formatTokens(chat.tokens.promptTokens)} · 输出 ${formatTokens(chat.tokens.completionTokens)} · 合计 ${formatTokens(chat.tokens.promptTokens + chat.tokens.completionTokens)}`}
          >
            {formatTokens(chat.tokens.promptTokens + chat.tokens.completionTokens)}
          </span>
        )}

        {editingId !== chat.id && (
          <div
            className={`absolute right-0.5 items-center ${rowMenuId === chat.id ? 'flex' : 'hidden group-hover:flex'}`}
          >
            <div className="relative" ref={rowMenuId === chat.id ? rowMenuRef : undefined}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setRowMenuId(rowMenuId === chat.id ? null : chat.id)
                }}
                className="p-1 rounded-md hover:bg-s3 text-t3 hover:text-t1 transition-colors"
                title="更多操作"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
              {rowMenuId === chat.id && (
                <div
                  className="absolute right-0 top-full mt-1 w-36 rounded-xl bg-s2 border border-line shadow-xl fade-in overflow-hidden z-50 py-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleTogglePin(chat.id)}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-xs text-t2 hover:bg-s3 transition-colors"
                  >
                    {chat.pinned ? (
                      <PinOff className="w-3.5 h-3.5" />
                    ) : (
                      <Pin className="w-3.5 h-3.5" />
                    )}
                    {chat.pinned ? '取消固定' : '固定'}
                  </button>
                  <button
                    onClick={() => handleStartRename(chat.id, chat.title)}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-xs text-t2 hover:bg-s3 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    重命名
                  </button>
                  <button
                    onClick={() => handleDelete(chat.id)}
                    className="w-full px-3 py-1.5 flex items-center gap-2 text-xs text-rose-500 hover:bg-s3 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    删除
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <aside className="w-[264px] shrink-0 bg-s1 border-r border-line flex flex-col h-full select-none">
      {/* 新对话 + 搜索 */}
      <div className="px-3 pt-3 pb-2 space-y-2">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-line bg-s2 hover:border-linestrong text-[13px] text-t1 transition-colors"
        >
          <PenSquare className="w-4 h-4 text-t3" />
          新对话
        </button>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-s3/50 focus-within:bg-s3 transition-colors">
          <Search className="w-3.5 h-3.5 text-t4 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话"
            className="flex-1 bg-transparent border-none outline-none text-xs text-t1 placeholder:text-t4 min-w-0"
          />
        </div>
      </div>

      {/* 会话列表：按时间分组 */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {groups.length === 0 && (
          <p className="text-xs text-t4 px-2.5 py-4 text-center">
            {query ? '未找到匹配的对话' : '暂无会话记录'}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-1">
            <div className="px-2.5 pt-2.5 pb-1 text-[11px] text-t4">{group.label}</div>
            <div className="space-y-px">{group.items.map(renderRow)}</div>
          </div>
        ))}
      </div>
    </aside>
  )
}
