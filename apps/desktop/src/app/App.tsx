import React, { useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState } from './providers/store'
import { ThemeProvider } from './providers/ThemeContext'
import { logout } from '@/entities/auth/model/authSlice'
import { api } from '@/shared/api/client'
import { AUTH_UNAUTHORIZED_EVENT } from '@servicedesk/sdk'
import { Sidebar } from '@/widgets/sidebar/ui/Sidebar'
import { Header } from '@/widgets/header/ui/Header'
import { AuthPage } from '@/pages/auth/ui/AuthPage'
import { ChatPage } from '@/pages/chat/ui/ChatPage'
import { KnowledgePage } from '@/pages/knowledge/ui/KnowledgePage'
import { PromptsPage } from '@/pages/prompts/ui/PromptsPage'
import { TicketsPage } from '@/pages/tickets/ui/TicketsPage'
import { AnalyticsPage } from '@/pages/analytics/ui/AnalyticsPage'
import { SettingsPage } from '@/pages/settings/ui/SettingsPage'

function Workspace() {
  const activeTab = useSelector((state: RootState) => state.chat.activeTab)

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return <ChatPage />
      case 'knowledge':
        return <KnowledgePage />
      case 'prompts':
        return <PromptsPage />
      case 'tickets':
        return <TicketsPage />
      case 'analytics':
        return <AnalyticsPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <ChatPage />
    }
  }

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-s0 font-sans text-t2">
      {/* 全局氛围层：蓝图网格 + 遥测辉光 */}
      <div className="glow-field pointer-events-none absolute inset-0 z-0" />
      <div className="bg-blueprint pointer-events-none absolute inset-0 z-0" />
      {/* 颗粒噪点 */}
      <div className="noise-overlay" />

      {/* 侧边栏组件 */}
      <div className="relative z-10">
        <Sidebar />
      </div>

      {/* 主内容区域 */}
      <div className="relative z-10 flex-1 flex flex-col h-full min-w-0">
        <Header />
        <main className="flex-1 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  )
}

export function App() {
  const dispatch = useDispatch()
  const user = useSelector((state: RootState) => state.auth.user)
  const token = useSelector((state: RootState) => state.auth.token)

  // 启动时校验本地 token，失效则退出登录
  useEffect(() => {
    if (!token) return
    api.token = token
    api
      .me()
      .then(() => {})
      .catch(() => dispatch(logout()))
  }, [token, dispatch])

  // 任意接口返回 401（token 过期/被顶掉）时同步清空登录态，回到登录页
  useEffect(() => {
    const onUnauthorized = () => dispatch(logout())
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [dispatch])

  return <ThemeProvider>{user && token ? <Workspace /> : <AuthPage />}</ThemeProvider>
}

export default App
