import React, { useEffect } from 'react'
import { Provider } from 'react-redux'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from './providers/store'
import { store } from './providers/store'
import { AUTH_UNAUTHORIZED_EVENT } from '@ai-workspace/sdk'
import { logoutUser } from '@/entities/auth/model/authSlice'
import { LoginPage } from '@/pages/auth/ui/LoginPage'
import { Sidebar } from '@/widgets/sidebar/ui/Sidebar'
import { Header } from '@/widgets/header/ui/Header'
import { ChatPage } from '@/pages/chat/ui/ChatPage'
import { KnowledgePage } from '@/pages/knowledge/ui/KnowledgePage'
import { PromptsPage } from '@/pages/prompts/ui/PromptsPage'
import { TasksPage } from '@/pages/tasks/ui/TasksPage'
import { TicketsPage } from '@/pages/tickets/ui/TicketsPage'
import { SettingsPage } from '@/pages/settings/ui/SettingsPage'
import { ThemeProvider, useTheme } from '@/entities/theme/model/themeContext'
import { I18nProvider } from '@/entities/i18n/model/useI18n'

function NoiseOverlay() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] opacity-[0.025]"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat',
        backgroundSize: '256px 256px',
      }}
    />
  )
}

function AppContent() {
  const dispatch = useDispatch()
  const activeTab = useSelector((state: RootState) => state.chat.activeTab)
  const user = useSelector((state: RootState) => state.auth.user)
  const { mode } = useTheme()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode)
  }, [mode])

  useEffect(() => {
    const onUnauthorized = () => dispatch(logoutUser())
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [dispatch])

  if (!user) return <LoginPage />

  const renderContent = () => {
    switch (activeTab) {
      case 'chat':
        return <ChatPage />
      case 'tickets':
        return <TicketsPage />
      case 'knowledge':
        return <KnowledgePage />
      case 'prompts':
        return <PromptsPage />
      case 'tasks':
        return <TasksPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <ChatPage />
    }
  }

  return (
    <div
      className="h-screen w-screen flex overflow-hidden relative"
      style={{
        background: 'var(--bg-void)',
        color: 'var(--text-main)',
        transition: 'background .25s ease, color .25s ease',
      }}
    >
      <NoiseOverlay />
      <div className="absolute inset-0 dot-grid-bg opacity-[0.18] pointer-events-none" />
      <Sidebar />
      <div className="flex-1 flex flex-col h-full min-w-0 relative z-10">
        <Header />
        <main className="flex-1 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  )
}

export function App() {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <I18nProvider>
          <AppContent />
        </I18nProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default App
