import { HttpClient } from '@ai-workspace/sdk'

// 全局共享的 HTTP 客户端，api.token 与登录态保持同步
export const api = new HttpClient('http://localhost:3000')

// 恢复本地会话 token，供 /auth/me 校验使用
// 兼容迁移：旧版本使用 aiws-token / aiws-user 键名，升级后自动搬到新键
try {
  const legacyToken = localStorage.getItem('aiws-token')
  const legacyUser = localStorage.getItem('aiws-user')
  if (legacyToken && !localStorage.getItem('auth_token')) {
    localStorage.setItem('auth_token', legacyToken)
    if (legacyUser && !localStorage.getItem('auth_user')) {
      localStorage.setItem('auth_user', legacyUser)
    }
    localStorage.removeItem('aiws-token')
    localStorage.removeItem('aiws-user')
  }
  api.token = localStorage.getItem('auth_token')
} catch {
  // ignore
}

// 组件在拿到 token 后调用，确保后续请求携带最新凭证
export const syncToken = (token: string | null) => {
  api.token = token
}
