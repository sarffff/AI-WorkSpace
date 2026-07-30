import React from 'react'
import { useSelector } from 'react-redux'
import { RootState } from './providers/store'
import { Sidebar } from '@/widgets/sidebar/ui/Sidebar'
import { Header } from '@/widgets/header/ui/Header'
import { ChatPage } from '@/pages/chat/ui/ChatPage'
import { KnowledgePage } from '@/pages/knowledge/ui/KnowledgePage'
import { PromptsPage } from '@/pages/prompts/ui/PromptsPage'
import { SettingsPage } from '@/pages/settings/ui/SettingsPage'

export function App() {
  const activeTab = useSelector((state: RootState) => state.chat.activeTab)

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
      {/* 侧边栏组件 */}
      <Sidebar />

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        <Header />
        <main className="flex-1 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  )
}

export default App
