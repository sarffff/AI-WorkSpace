import { HttpClient } from '@servicedesk/sdk'

// 后端地址解析优先级：localStorage 用户配置 > 构建期 VITE_API_BASE_URL > 本地开发默认值
const DEFAULT_API_BASE_URL = 'http://localhost:3000'
const API_BASE_URL_STORAGE_KEY = 'api_base_url'

function resolveApiBaseUrl(): string {
  try {
    const saved = localStorage.getItem(API_BASE_URL_STORAGE_KEY)
    if (saved) return saved
  } catch {
    // 本地存储不可用时忽略
  }
  const fromEnv = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (fromEnv) return fromEnv
  return DEFAULT_API_BASE_URL
}

// 全局共享的 HTTP 客户端，api.token 与登录态保持同步
export const api = new HttpClient(resolveApiBaseUrl())

export const getApiBaseUrl = (): string => api.getBaseUrl()

// 设置页“服务器地址”入口：持久化并立即生效（无需重启）
export const setApiBaseUrl = (url: string): boolean => {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(trimmed)) return false
  try {
    localStorage.setItem(API_BASE_URL_STORAGE_KEY, trimmed)
  } catch {
    // 本地存储不可用时忽略
  }
  api.setBaseUrl(trimmed)
  return true
}

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
  // 本地存储不可用时忽略
}

// 组件在拿到 token 后调用，确保后续请求携带最新凭证
export const syncToken = (token: string | null) => {
  api.token = token
}
