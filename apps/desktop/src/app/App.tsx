import React, { useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState } from './providers/store'
import { logout } from '@/entities/auth/model/authSlice'
import { AUTH_UNAUTHORIZED_EVENT } from '@ai-workspace/sdk'
import { Sidebar } from '@/widgets/sidebar/ui/Sidebar'
import { Header } from '@/widgets/header/ui/Header'
import { ChatPage } from '@/pages/chat/ui/ChatPage'
import { KnowledgePage } from '@/pages/knowledge/ui/KnowledgePage'
import { PromptsPage } from '@/pages/prompts/ui/PromptsPage'
import { SettingsPage } from '@/pages/settings/ui/SettingsPage'
import AuthPage from '@/pages/auth/ui/AuthPage'

export function App() {
  const dispatch = useDispatch()
  const user = useSelector((state: RootState) => state.auth.user)
  const activeTab = useSelector((state: RootState) => state.chat.activeTab)

  // token 失效（任意接口返回 401）时同步清空 Redux 登录态，回到登录页
  useEffect(() => {
    const onUnauthorized = () => dispatch(logout())
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [dispatch])

  if (!user) return <AuthPage />

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return <ChatPage />
      case 'knowledge':
        return <KnowledgePage />
      case 'prompts':
        return <PromptsPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <ChatPage />
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090d16] font-sans">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full min-w-0">
        <Header />
        <main className="flex-1 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  )
}

export default App
