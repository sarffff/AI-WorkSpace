import { createContext, useContext } from 'react'

type TranslationKeys =
  | 'app.title'
  | 'app.subtitle'
  | 'app.poweredby'
  | 'login.login'
  | 'login.signup'
  | 'login.email'
  | 'login.password'
  | 'login.name'
  | 'login.continue'
  | 'login.signingUp'
  | 'login.signingIn'
  | 'login.or'
  | 'login.tokenPlaceholder'
  | 'login.checkEmail'
  | 'login.forgotPwd'
  | 'login.sendMagicLink'
  | 'login.emailInvalid'
  | 'login.sendFailed'
  | 'login.authenticating'
  | 'login.ready'
  | 'login.error'
  | 'login.magicLink'
  | 'login.emailPlaceholder'
  | 'login.fillFields'
  | 'sidebar.newChat'
  | 'sidebar.conversations'
  | 'sidebar.settings'
  | 'sidebar.tickets'
  | 'sidebar.knowledge'
  | 'sidebar.prompts'
  | 'sidebar.tasks'
  | 'chat.selectConv'
  | 'chat.howCanHelp'
  | 'chat.toolCall'
  | 'chat.waitingApproval'
  | 'chat.approved'
  | 'chat.denied'
  | 'chat.thinking'
  | 'chat.stopping'
  | 'chat.stopGen'
  | 'chat.ragToggle'
  | 'chat.ragOn'
  | 'chat.ragOff'
  | 'knowledge.base'
  | 'knowledge.search'
  | 'knowledge.noDocs'
  | 'knowledge.uploadTip'
  | 'knowledge.upload'
  | 'knowledge.processing'
  | 'knowledge.searchResult'
  | 'knowledge.delete'
  | 'knowledge.cancelUpload'
  | 'prompts.library'
  | 'prompts.noPrompts'
  | 'prompts.createTip'
  | 'prompts.create'
  | 'prompts.edit'
  | 'prompts.copy'
  | 'prompts.useInChat'
  | 'prompts.name'
  | 'prompts.category'
  | 'prompts.content'
  | 'prompts.save'
  | 'prompts.cancel'
  | 'prompts.delete'
  | 'prompts.updateSuccess'
  | 'prompts.created'
  | 'tasks.executor'
  | 'tasks.agentTip'
  | 'tasks.runTask'
  | 'tasks.running'
  | 'tasks.history'
  | 'tasks.noTasks'
  | 'tasks.firstTask'
  | 'tasks.retry'
  | 'tasks.delete'
  | 'tasks.elapsed'
  | 'settings.title'
  | 'settings.config'
  | 'settings.aiKey'
  | 'settings.save'
  | 'settings.saving'
  | 'settings.saveSuccess'
  | 'settings.model'
  | 'settings.models'
  | 'settings.server'
  | 'settings.connected'
  | 'settings.database'
  | 'settings.ok'
  | 'settings.embeddings'
  | 'settings.proxy'
  | 'settings.apiKeyPlaceholder'
  | 'settings.apiKey'
  | 'settings.apiUrl'
  | 'settings.embeddingModel'
  | 'settings.defaultModel'
  | 'settings.modelListError'
  | 'settings.maxTokens'
  | 'settings.temperature'
  | 'settings.topP'
  | 'settings.maxMessages'
  | 'settings.ragThreshold'
  | 'settings.ragTopK'
  | 'settings.refresh'
  | 'header.logout'

const zhCN: Record<TranslationKeys, string> = {
  'app.title': 'AI Workspace',
  'app.subtitle': 'Agent Workbench · 智能代码工作台',
  'app.poweredby': '由 AI 驱动的智能协作空间',
  'login.login': '登录',
  'login.signup': '注册',
  'login.email': '邮箱地址',
  'login.password': '密码',
  'login.name': '昵称(可选)',
  'login.continue': '继续',
  'login.signingUp': '注册中...',
  'login.signingIn': '登录中...',
  'login.or': '或',
  'login.tokenPlaceholder': '输入 Token 或密码...',
  'login.checkEmail': '检查邮箱，登录链接已发送！',
  'login.forgotPwd': '忘记密码？请联系管理员重置。',
  'login.sendMagicLink': '发送登录链接',
  'login.emailInvalid': '请输入有效的邮箱地址',
  'login.sendFailed': '发送失败，请重试',
  'login.authenticating': '身份验证中...',
  'login.ready': '准备就绪',
  'login.error': '认证失败',
  'login.magicLink': '无密码登录',
  'login.emailPlaceholder': 'your@email.com',
  'login.fillFields': '请填写所有必填字段',
  'sidebar.newChat': '新建对话',
  'sidebar.conversations': '会话列表',
  'sidebar.settings': '系统设置',
  'sidebar.tickets': '工单助手',
  'sidebar.knowledge': '企业知识库',
  'sidebar.prompts': '提示词库',
  'sidebar.tasks': 'Agent 任务',
  'chat.selectConv': '选择或创建一个会话开始对话',
  'chat.howCanHelp': '有什么可以帮到你?',
  'chat.toolCall': '工具调用',
  'chat.waitingApproval': '等待你的审批...',
  'chat.approved': '已批准 ✓',
  'chat.denied': '已拒绝 ✗',
  'chat.thinking': '思考中...',
  'chat.stopping': '正在停止...',
  'chat.stopGen': '停止生成',
  'chat.ragToggle': 'RAG 知识库检索',
  'chat.ragOn': '开启 RAG',
  'chat.ragOff': '关闭 RAG',
  'knowledge.base': '知识库',
  'knowledge.search': '搜索知识库...',
  'knowledge.noDocs': '暂无文档',
  'knowledge.uploadTip': '上传文件开始构建知识库',
  'knowledge.upload': '上传文档',
  'knowledge.processing': '处理中...',
  'knowledge.searchResult': '搜索结果',
  'knowledge.delete': '删除文档',
  'knowledge.cancelUpload': '取消上传',
  'prompts.library': '提示词库',
  'prompts.noPrompts': '暂无提示词',
  'prompts.createTip': '创建第一个提示词模板开始使用',
  'prompts.create': '新建提示词',
  'prompts.edit': '编辑提示词',
  'prompts.copy': '复制',
  'prompts.useInChat': '在对话中使用',
  'prompts.name': '提示词名称',
  'prompts.category': '分类',
  'prompts.content': '提示词内容',
  'prompts.save': '保存',
  'prompts.cancel': '取消',
  'prompts.delete': '删除',
  'prompts.updateSuccess': '已更新',
  'prompts.created': '创建成功',
  'tasks.executor': 'Agent 执行器',
  'tasks.agentTip': '运行带工具调用和 RAG 的 AI Agent 任务',
  'tasks.runTask': '运行任务',
  'tasks.running': '运行中...',
  'tasks.history': '历史记录',
  'tasks.noTasks': '暂无任务',
  'tasks.firstTask': '在上面运行你的第一个 Agent 任务',
  'tasks.retry': '重试',
  'tasks.delete': '删除',
  'tasks.elapsed': '已耗时',
  'settings.title': '系统设置',
  'settings.config': '配置管理',
  'settings.aiKey': 'API Key',
  'settings.save': '保存',
  'settings.saving': '保存中...',
  'settings.saveSuccess': '已保存',
  'settings.model': '模型选择',
  'settings.models': '可用模型',
  'settings.server': '服务器',
  'settings.connected': '已连接',
  'settings.database': '数据库',
  'settings.ok': '正常',
  'settings.embeddings': 'Embeddings',
  'settings.proxy': '代理模式',
  'settings.apiKeyPlaceholder': 'sk-...',
  'settings.apiKey': 'API 密钥',
  'settings.apiUrl': 'API 地址',
  'settings.embeddingModel': 'Embedding 模型',
  'settings.defaultModel': '默认模型',
  'settings.modelListError': '无法获取模型列表，请检查后端服务是否正常运行。',
  'settings.maxTokens': '最大 Token 数',
  'settings.temperature': 'Temperature',
  'settings.topP': 'Top-P',
  'settings.maxMessages': '最大消息数',
  'settings.ragThreshold': 'RAG 相似度阈值',
  'settings.ragTopK': 'RAG Top-K',
  'settings.refresh': '刷新',
  'header.logout': '退出登录',
}

const t = (key: TranslationKeys): string => zhCN[key]

interface I18nContextType {
  t: (key: TranslationKeys) => string
}

const I18nContext = createContext<I18nContextType>({ t })

export function I18nProvider({ children }: { children: React.ReactNode }) {
  return <I18nContext.Provider value={{ t }}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
