import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { resolve } from 'node:path'
import { startMockBackend, type MockBackend } from './mock-backend'

// 主链路冒烟：登录 → 提问 → SSE 流式回答（工具轨迹 + 引用溯源）
//             → Agent 判定超范围推建单草稿 → HITL 确认 → 工单在工单页可见
//
// 后端由同源的 mock 替身托管（见 mock-backend.ts），因此这里验证的是「前端契约与交互闭环」，
// 不含真实模型与数据库；SSE 帧序列按服务端实际写法手工构造，服务端改协议时这里会失败。

const PROMPT = '我的 VPN 连不上，证书也重新装过了'
const DRAFT_TITLE = 'VPN 账号疑似被锁定，需管理员解锁'

let backend: MockBackend
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  backend = await startMockBackend()
})

test.afterAll(async () => {
  await backend.close()
})

test.beforeEach(async () => {
  backend.reset()

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronBinary = require('electron') as string
  app = await electron.launch({
    executablePath: electronBinary,
    // 受限环境（无独立 GPU、沙箱不可用）下不加这两个标志，渲染进程直接 Target crashed。
    // 冒烟测试要的是「可启动」，不是完整安全边界。
    args: [resolve(__dirname, '../dist-electron/main.js'), '--no-sandbox', '--disable-gpu'],
    // 用 mock 地址顶替 dev server：主进程走 loadURL，渲染层与 API 同源，无跨源问题
    env: { ...process.env, VITE_DEV_SERVER_URL: backend.url },
  })
  win = await app.firstWindow()

  // 渲染层在模块初始化时就固化了后端地址（localStorage > VITE_API_BASE_URL > 默认值），
  // 首次加载来不及注入，因此写入 localStorage 后重载一次 —— 顺带覆盖这条地址解析优先级
  await win.evaluate((url) => {
    localStorage.setItem('api_base_url', url)
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
  }, backend.url)
  await win.reload()

  // 登录
  await win.getByRole('button', { name: '登录工作台' }).waitFor()
  await win.locator('input[type="email"]').fill('e2e@servicedeck.test')
  await win.locator('input[type="password"]').fill('e2e-password')
  await win.getByRole('button', { name: '登录工作台' }).click()
  await expect(win.locator('text=ServiceDeck 智能服务台助手')).toBeVisible()
})

// 失败时也必须关掉进程：泄漏的 Electron 会占着窗口与 mock 闸门干扰后续用例
test.afterEach(async () => {
  await app?.close().catch(() => undefined)
})

async function ask() {
  await win.locator('textarea[placeholder="向智能助手发送指令..."]').fill(PROMPT)
  await win.locator('button[title="发送"]').click()
  // Agent 暂停在确认门上：此时还没有正文（正文在用户拍板之后才生成）
  await expect(win.locator('text=确认创建工单 · 优先级 高 · 网络访问')).toBeVisible()
  await expect(win.locator(`text=${DRAFT_TITLE}`).first()).toBeVisible()
}

test('确认建单：草稿挂起等待用户拍板，通过后工单落进工单页', async () => {
  await ask()

  const confirmButton = win.getByRole('button', { name: '确认创建', exact: true })
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()

  // 决策落定后卡片转为已确认态
  await expect(win.locator('text=已确认创建')).toBeVisible()

  // 正文在确认之后才流出来：证明生成器是被确认门唤醒，而不是提前收尾
  await expect(win.locator('text=已为你升级工单')).toBeVisible()
  // 回答消息携带引用溯源与工具轨迹
  await expect(win.locator('text=内容溯源 · 1 个知识库片段')).toBeVisible()
  await expect(win.locator('text=执行轨迹')).toBeVisible()

  // 工单卡片
  await expect(win.locator('text=已升级 · 自动创建工单')).toBeVisible()

  // HITL 往返真的发生，且 requestId 归属本会话
  expect(backend.confirmations).toEqual([
    { requestId: expect.stringContaining(':'), approved: true },
  ])
  expect(backend.emittedEvents.slice(-2)).toEqual(['content', 'done'])
  expect(backend.tickets).toHaveLength(1)

  // 会话卡片直达工单详情：时间线来自 GET /tickets/:id
  await win.getByRole('button', { name: '查看详情 →' }).click()
  await expect(win.locator('text=工单由 AI 对话升级创建')).toBeVisible()
  // 点遮罩空白处收起。文案为「关闭」的按钮是关闭工单的状态操作，不是收起 ——
  // 收起按钮是无障碍名的 X 图标，只能从遮罩下手
  await win.locator('div.fixed.inset-0').click({ position: { x: 8, y: 8 } })
  await expect(win.locator('text=工单由 AI 对话升级创建')).toHaveCount(0)

  // 会话卡片跳工单页，新建的工单在列表里
  await win.getByRole('button', { name: '工单页' }).click()
  await expect(win.locator('text=我的工单')).toBeVisible()
  await expect(win.getByText(DRAFT_TITLE)).toHaveCount(1)

  // 全程没有误触工单的状态流转
  expect(backend.requestLog.filter((r) => r.startsWith('PATCH /tickets'))).toEqual([])
})

test('拒绝建单：不产生工单，AI 继续对话', async () => {
  await ask()

  await win.getByRole('button', { name: '暂不创建', exact: true }).click()

  await expect(win.locator('text=已拒绝，AI 将继续对话')).toBeVisible()
  await expect(win.locator('text=先不升级工单')).toBeVisible()
  await expect(win.locator('text=已升级 · 自动创建工单')).toHaveCount(0)

  expect(backend.confirmations).toEqual([
    { requestId: expect.stringContaining(':'), approved: false },
  ])
  expect(backend.tickets).toHaveLength(0)
})
