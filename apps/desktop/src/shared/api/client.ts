import { HttpClient } from '@ai-workspace/sdk'

// 全局共享的 HTTP 客户端，api.token 与登录态保持同步
export const api = new HttpClient('http://localhost:3000')

// 恢复本地会话 token，供 /auth/me 校验使用
try {
  api.token = localStorage.getItem('aiws-token')
} catch {
  // ignore
}

// 组件在拿到 token 后调用，确保后续请求携带最新凭证
export const syncToken = (token: string | null) => {
  api.token = token
}
