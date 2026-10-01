import React, { useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState } from '@/app/providers/store'
import { setServerStatus } from '@/entities/chat/model/chatSlice'
import { api } from '@/shared/api/client'

// 对话页上下文条：当前会话标题 + 服务连通状态（模型切换在输入坞内）
export const Header: React.FC = () => {
  const dispatch = useDispatch()
  const { currentChatId, sessions, serverStatus } = useSelector((state: RootState) => state.chat)

  useEffect(() => {
    api.ping().then((online) => {
      dispatch(setServerStatus(online ? 'online' : 'offline'))
    })
  }, [dispatch])

  const title = sessions.find((s) => s.id === currentChatId)?.title ?? '新对话'

  return (
    <header className="h-11 px-4 flex items-center justify-between select-none shrink-0 relative z-10">
      <span className="font-display text-sm text-t2 truncate tracking-wide">{title}</span>
      <span className="flex items-center gap-1.5 text-[11px] text-t4 shrink-0">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            serverStatus === 'online'
              ? 'bg-brand'
              : serverStatus === 'offline'
                ? 'bg-rose-500 pulse-dot-red'
                : 'bg-t4'
          }`}
        />
        {serverStatus === 'online'
          ? '服务在线'
          : serverStatus === 'offline'
            ? '服务离线'
            : '探测中'}
      </span>
    </header>
  )
}
