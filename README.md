# AI Workspace Monorepo

> 一个基于现代化技术栈构建的高性能跨平台智能 AI 工作台，采用 Monorepo 架构。

---

## 📖 项目介绍

**AI Workspace** 是一个集成了大语言模型对话、本地/云端 RAG 知识库检索、实时通信以及桌面端交互的智能化生产力工作台。项目采用 **pnpm Workspace + Turborepo** 进行高效的 Monorepo 工程化管理，前端基于 **React 19 + Electron + Vite + Tailwind CSS (FSD 架构)**，后端基于 **NestJS + Prisma + MySQL + Redis**。

---

## 🛠️ 技术栈

| 模块                  | 技术选型                                             | 说明                         |
| :-------------------- | :--------------------------------------------------- | :--------------------------- |
| **Monorepo**          | pnpm Workspace + Turborepo                           | 高效包管理与增量构建缓存     |
| **桌面端 (Client)**   | Electron + React 19 + TypeScript + Vite              | 跨平台桌面客户端，FSD 架构   |
| **UI & 样式**         | Tailwind CSS + Lucide React                          | 现代美观的 UI 设计与图标库   |
| **状态管理**          | Redux Toolkit + TanStack Query                       | 客户端状态与服务端状态管理   |
| **后端服务 (Server)** | NestJS (`@nestjs/core`, `ws`, etc.)                  | 企业级 Node.js 后端架构      |
| **ORM & 数据库**      | Prisma ORM + MySQL                                   | 类型安全数据库交互与关系建模 |
| **缓存**              | Redis (`ioredis`)                                    | 高性能缓存与会话状态管理     |
| **实时通信**          | WebSocket + SSE                                      | 实时流式 AI 对话与事件推送   |
| **AI 能力**           | OpenAI SDK (可扩展多 Provider)                       | LLM 模型接入与 Prompt 工程   |
| **工程化**            | ESLint + Prettier + Husky + lint-staged + Commitlint | 代码规范与提交校验           |

---

## 📂 目录结构

```text
AI-Workspace/
├── apps/
│   ├── desktop/              # Electron + React 桌面端 (遵循 FSD 架构)
│   │   ├── electron/         # Electron 主进程与预加载脚本
│   │   └── src/              # FSD 分层源码 (app, pages, widgets, entities, shared)
│   └── server/               # NestJS 后端服务
│       ├── prisma/           # Prisma Schema & 数据库迁移 (MySQL)
│       └── src/              # 后端源码 (modules/chat, modules/knowledge, prisma, redis)
├── packages/                 # 共享包
│   ├── ui/                   # 共享 UI 组件库
│   ├── sdk/                  # AI/API SDK 封装
│   ├── shared/               # 公共工具函数
│   ├── types/                # 公共 TypeScript 类型定义
│   └── config/               # 公共配置 (ESLint, TSConfig 等)
├── package.json              # 根项目工作空间配置
├── pnpm-workspace.yaml       # pnpm 工作空间声明
└── turbo.json                # Turborepo 构建任务编排
```

---

## 🗺️ Roadmap & 开发计划

### Phase 1: 基础设施与架构搭建 (已完成 ✅)

- [x] 初始化 pnpm Workspace 与 Turborepo Monorepo 结构
- [x] 配置根目录工程化工具 (ESLint, Prettier, Husky, Commitlint)
- [x] 搭建 `apps/desktop` (Electron + React 19 + Vite + Tailwind, FSD 架构)
- [x] 搭建 `apps/server` (NestJS + Prisma + MySQL + Redis + WebSocket)
- [x] 统一安装及校验所有技术栈依赖

### Phase 2: 核心功能开发 (进行中 🚧)

- [-] **AI 聊天模块**：实现桌面端与 NestJS 后端流式对话 (OpenAI / DeepSeek)
- [ ] **RAG 知识库**：文档上传、切片、向量化存储与检索
- [ ] **Prompt 提示词广场**：预设模板与自定义提示词管理
- [ ] **系统设置**：API Key 配置、MySQL/Redis 链接测试与管理

### Phase 3: 高级特性与多 Provider 扩展 (待启动 ⏳)

- [ ] 扩展支持 Anthropic Claude、DeepSeek、Ollama 本地模型
- [ ] 知识库向量索引与语义搜索优化
- [ ] Electron 自动更新 (`electron-updater`) 与打包发布配置
- [ ] 端到端测试 (E2E) 与性能调优

---

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 启动开发模式 (Turbo)

```bash
pnpm dev
```
