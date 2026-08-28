import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'

// electron-updater 为可选依赖形态引入：仅在打包产物中启用，避免开发期报错
let autoUpdater: {
  checkForUpdatesAndNotify: () => Promise<unknown>
} | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  autoUpdater = require('electron-updater').autoUpdater
} catch {
  // 依赖缺失时跳过自动更新
}

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('app:ping', () => 'pong from Electron main process')

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(process.env.DIST as string, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  createWindow()
  // 打包产物启动后检查更新（需在 electron-builder 中配置 publish，如 github releases）
  if (app.isPackaged && autoUpdater) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // 无发布源/离线时静默忽略
    })
  }
})
