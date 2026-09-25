import { defineConfig } from '@playwright/test'

// Electron 冒烟测试配置。与后端单测（jest）互不影响，需先构建渲染层（见 package.json test:e2e）。
export default defineConfig({
  testDir: './e2e',
  // Electron 冷启动 + 首屏加载明显慢于浏览器，整体放宽
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // 每个用例都要起一个 Electron 进程，串行跑避免抢同一 mock 端口的全局闸门状态
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    trace: 'off',
    video: 'off',
  },
})
