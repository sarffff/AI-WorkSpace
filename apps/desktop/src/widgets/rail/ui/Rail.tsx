import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '@/app/providers/store'
import { setActiveTab, setCurrentChat } from '@/entities/chat/model/chatSlice'
import { logout } from '@/entities/auth/model/authSlice'
import { useTheme } from '@/app/providers/ThemeContext'
import { api } from '@/shared/api/client'
import type { ServerNotification } from '@servicedesk/sdk'
import { NavTab } from '@servicedesk/sdk'
import {
  MessageSquare,
  BookOpen,
  Sparkles,
  TicketCheck,
  BarChart3,
  Settings,
  Sun,
  Moon,
  LogOut,
  Bell,
  CheckCheck,
} from 'lucide-react'

// 通知时间的相对展示：铃铛列表只关心"多久前"
const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

// 图标轨：模块级导航（对话/知识库/提示词/工单/看板），
// 底部收拢主题、设置与账户；对话会话列表由 Sidebar 承担
export const Rail: React.FC = () => {
  const dispatch = useDispatch()
  const activeTab = useSelector((state: RootState) => state.chat.activeTab)
  const user = useSelector((state: RootState) => state.auth.user)
  const { theme, toggleTheme } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [bellOpen, setBellOpen] = useState(false)
  const [notifications, setNotifications] = useState<ServerNotification[]>([])
  const [unread, setUnread] = useState(0)
  const bellRef = useRef<HTMLDivElement>(null)
  const token = useSelector((state: RootState) => state.auth.token)

  // 铃铛轮询：30s 拉一次未读与列表（桌面形态本就在线轮询，不引入推送长连接）
  const refreshNotifications = useCallback(() => {
    api
      .listNotifications()
      .then((res) => {
        setNotifications(res.items)
        setUnread(res.unreadCount)
      })
      .catch(() => {
        // 后端不可用时静默：铃铛不是关键路径
      })
  }, [])

  useEffect(() => {
    if (!token) return
    refreshNotifications()
    const timer = setInterval(refreshNotifications, 30_000)
    return () => clearInterval(timer)
  }, [token, refreshNotifications])

  // 点击外部关闭账户菜单与铃铛面板
  useEffect(() => {
    if (!menuOpen && !bellOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false)
      if (bellOpen && bellRef.current && !bellRef.current.contains(e.target as Node))
        setBellOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen, bellOpen])

  const handleClickNotification = (n: ServerNotification) => {
    if (!n.read) {
      api.markNotificationRead(n.id).catch(() => {})
      setNotifications((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)))
      setUnread((u) => Math.max(0, u - 1))
    }
    // 工单类通知跳转到工单服务台
    if (n.payload?.ticketId) dispatch(setActiveTab('tickets'))
    setBellOpen(false)
  }

  const handleReadAll = () => {
    api.markAllNotificationsRead().catch(() => {})
    setNotifications((prev) => prev.map((p) => ({ ...p, read: true })))
    setUnread(0)
  }

  const navItems: { id: NavTab; label: string; icon: React.ReactNode; staffOnly?: boolean }[] = [
    { id: 'chat', label: '智能对话', icon: <MessageSquare className="w-4 h-4" /> },
    { id: 'knowledge', label: '知识库', icon: <BookOpen className="w-4 h-4" /> },
    { id: 'prompts', label: '提示词', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'tickets', label: '工单服务台', icon: <TicketCheck className="w-4 h-4" /> },
    {
      id: 'analytics',
      label: '运营看板',
      icon: <BarChart3 className="w-4 h-4" />,
      staffOnly: true,
    },
  ]

  // 运营看板仅坐席/管理员可见
  const isStaff = user?.role === 'agent' || user?.role === 'admin'
  const visibleNavItems = navItems.filter((item) => !item.staffOnly || isStaff)

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <aside className="w-14 shrink-0 bg-s1 border-r border-line flex flex-col items-center py-3 gap-1 select-none relative z-20">
      {/* 朱砂印章：回首页并新建对话 */}
      <button
        onClick={() => {
          dispatch(setCurrentChat(null))
          dispatch(setActiveTab('chat'))
        }}
        className="w-9 h-9 rounded-[10px] bg-brand text-brand-on font-display text-base font-bold flex items-center justify-center mb-2 hover:brightness-110 transition-all"
        title="ServiceDeck · 开始新对话"
      >
        台
      </button>

      {visibleNavItems.map((item) => {
        const active = activeTab === item.id
        return (
          <button
            key={item.id}
            onClick={() => dispatch(setActiveTab(item.id))}
            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              active ? 'bg-s3 text-t1' : 'text-t3 hover:text-t1 hover:bg-s3/60'
            }`}
            title={item.label}
          >
            {item.icon}
          </button>
        )
      })}

      <div className="flex-1" />

      {/* 通知铃铛 */}
      <div className="relative" ref={bellRef}>
        <button
          onClick={() => {
            setBellOpen((o) => !o)
            if (!bellOpen) refreshNotifications()
          }}
          className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
            bellOpen ? 'bg-s3 text-t1' : 'text-t3 hover:text-t1 hover:bg-s3/60'
          }`}
          title="通知"
        >
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-brand text-brand-on text-[9px] font-semibold flex items-center justify-center">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
        {bellOpen && (
          <div className="absolute left-full bottom-0 ml-2 w-80 rounded-xl bg-s2 border border-line shadow-xl fade-in overflow-hidden z-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-line">
              <span className="text-xs font-semibold text-t1">通知</span>
              {unread > 0 && (
                <button
                  onClick={handleReadAll}
                  className="flex items-center gap-1 text-[11px] text-t3 hover:text-t1 transition-colors"
                >
                  <CheckCheck className="w-3 h-3" />
                  全部已读
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {notifications.length === 0 && (
                <p className="px-3 py-6 text-center text-[11px] text-t4">暂无通知</p>
              )}
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClickNotification(n)}
                  className={`w-full text-left px-3 py-2 hover:bg-s3 transition-colors flex gap-2 ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <span
                    className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                      n.read ? 'bg-transparent' : 'bg-brand'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-t1 font-medium truncate">{n.title}</span>
                    <span className="block text-[11px] text-t3 mt-0.5 line-clamp-2">{n.body}</span>
                    <span className="block text-[10px] text-t4 mt-1">{timeAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        onClick={toggleTheme}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-t3 hover:text-t1 hover:bg-s3/60 transition-colors"
        title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
      >
        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
      <button
        onClick={() => dispatch(setActiveTab('settings'))}
        className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          activeTab === 'settings' ? 'bg-s3 text-t1' : 'text-t3 hover:text-t1 hover:bg-s3/60'
        }`}
        title="系统配置"
      >
        <Settings className="w-4 h-4" />
      </button>

      {/* 账户 */}
      <div className="relative mt-1" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className={`w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-semibold transition-colors ${
            menuOpen
              ? 'bg-s3 border-linestrong text-t1'
              : 'bg-s2 border-line text-t2 hover:text-t1 hover:border-linestrong'
          }`}
          title="账户菜单"
        >
          {initial}
        </button>
        {menuOpen && (
          <div className="absolute left-full bottom-0 ml-2 w-56 rounded-xl bg-s2 border border-line shadow-xl fade-in overflow-hidden z-50">
            <div className="p-3 border-b border-line">
              <p className="text-xs font-semibold text-t1 truncate">{user?.name || '操作员'}</p>
              <p className="text-[10px] text-t3 truncate mt-0.5">{user?.email}</p>
              <p className="text-[10px] text-t4 mt-1">
                角色 ·{' '}
                {user?.role === 'admin' ? '管理员' : user?.role === 'agent' ? '坐席' : '员工'}
              </p>
            </div>
            <div className="p-1.5">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  dispatch(logout())
                }}
                className="w-full px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs text-rose-500 hover:bg-s3 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                退出登录
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
