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
})

// 失败时也必须关掉进程：泄漏的 Electron 会占着窗口与 mock 闸门干扰后续用例
test.afterEach(async () => {
  await app?.close().catch(() => undefined)
})

// 启动放在用例内而不是 beforeEach：恢复场景需要"先把服务端置成有待决草稿，再启动客户端"
async function boot() {
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
}

async function ask() {
  await win.locator('textarea[placeholder="向智能助手发送指令..."]').fill(PROMPT)
  await win.locator('button[title="发送"]').click()
  // Agent 暂停在确认门上：此时还没有正文（正文在用户拍板之后才生成）
  await expect(win.locator('text=确认创建工单 · 优先级 高 · 网络访问')).toBeVisible()
  await expect(win.locator(`text=${DRAFT_TITLE}`).first()).toBeVisible()
}

test('确认建单：草稿挂起等待用户拍板，通过后工单落进工单页', async () => {
  await boot()
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
  await boot()
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

test('流式中断走非流式回退：仍给引用来源，并标注不会自动升级工单', async () => {
  await boot()
  // 「触发中断」是替身的约定触发词：让流式端点返回 500，逼出客户端的 catch 回退分支
  await win
    .locator('textarea[placeholder="向智能助手发送指令..."]')
    .fill('帮我看看 VPN 连不上 触发中断')
  await win.locator('button[title="发送"]').click()

  // 降级答案与引用来源
  await expect(win.locator('text=（非流式）VPN 连接失败请联系 IT 解锁账号。')).toBeVisible()
  await expect(win.locator('text=内容溯源 · 1 个知识库片段')).toBeVisible()
  // 明确标注：这条回答绕过了 Agent 工具循环，不会升级工单
  await expect(win.locator('text=降级回答 · 不会自动升级工单')).toBeVisible()
  await expect(win.locator('text=已升级 · 自动创建工单')).toHaveCount(0)

  expect(backend.requestLog).toContain('POST /chats/chat-e2e-1/completions')
  expect(backend.tickets).toHaveLength(0)
})

test('断连后重新进入会话：未决的建单确认卡被恢复并可继续决策', async () => {
  // 场景：Agent 推到确认门时 SSE 断了。草稿在服务端以 pending 落库，
  // 用户重开客户端进到这个会话 —— 若界面不再显示这张卡，那个请求就永远悬着
  backend.seedPendingDraft()
  await boot()

  // 侧边栏进入既有会话即触发恢复拉取
  await win.getByText('我的 VPN 连不上...').click()
  await expect
    .poll(() => backend.requestLog.includes('GET /chats/chat-e2e-1/ticket-drafts'))
    .toBe(true)

  await expect(win.locator('text=确认创建工单 · 优先级 高 · 网络访问')).toBeVisible()

  // 恢复出来的卡与实时卡行为一致：确认后走同一个 confirm-ticket 端点
  await win.getByRole('button', { name: '确认创建', exact: true }).click()
  await expect(win.locator('text=已确认创建')).toBeVisible()
  expect(backend.confirmations).toEqual([
    { requestId: expect.stringContaining('chat-e2e-1:'), approved: true },
  ])
})

test('今日 token 预算用尽：展示服务端原因，不走非流式回退', async () => {
  // 预算/并发/会话忙属于「拒绝」而不是「这条链路坏了」。回退到非流式端点只会再被拒一次，
  // 并且把真实原因盖成「无法连接到服务器」，还会贴上误导性的「降级回答」标记
  backend.setMode('budget-exhausted')
  await boot()

  await win.locator('textarea[placeholder="向智能助手发送指令..."]').fill(PROMPT)
  await win.locator('button[title="发送"]').click()

  await expect(win.locator('text=今天的模型用量已达预算上限 10000 tokens')).toBeVisible()
  expect(backend.requestLog.filter((r) => r.endsWith('/completions'))).toEqual([])
  await expect(win.locator('text=降级回答 · 不会自动升级工单')).toHaveCount(0)
  await expect(win.locator('text=无法连接到服务器')).toHaveCount(0)
})

test('运营看板的偏转率面板真的渲染出来（数字、缺口、口径脚注）', async () => {
  // 类型检查过不等于渲染得出来：这块面板有 null 率、空缺口数组两个容易炸的形状
  backend.setRole('agent')
  await boot()

  await win.getByRole('button', { name: /运营看板/ }).click()

  // 面板内断言（不能全页找 "75%"：KPI 卡的检索命中率也是 75%，会假通过）
  const panel = win.locator('div.rounded-lg', {
    has: win.getByText('偏转率（近 30 天 · 按会话）'),
  })
  await expect(panel).toHaveCount(1)

  // 头条数字 + 分母说明（12 个接住会话里 9 个没落成工单 → 75%）
  await expect(panel.getByText('75%', { exact: true })).toBeVisible()
  await expect(panel.getByText('12 个有 AI 回答的会话中，9 个没落成人工工单')).toBeVisible()

  // 低置信与未获回答各自单列，不混进比率（exact：这两个词在口径脚注里也出现）
  await expect(panel.getByText('低置信偏转', { exact: true })).toBeVisible()
  await expect(panel.getByText('未获回答', { exact: true })).toBeVisible()

  // 知识缺口：分类标签要被翻成中文，且按升级数排（网络访问 2 > 账号权限 1）
  await expect(panel.getByText('知识缺口（AI 升级的工单按分类）')).toBeVisible()
  const gapRows = panel.getByText(/^(网络访问|账号权限)$/)
  expect(await gapRows.allTextContents()).toEqual(['网络访问', '账号权限'])

  // 脚注里必须把「追不回归属的老数据没进分子」说出来
  await expect(panel.getByText(/追不回会话归属/)).toBeVisible()
  expect(backend.requestLog).toContain('GET /analytics/deflection')
})
