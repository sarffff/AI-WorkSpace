// ===== 工单分类与反馈枚举：服务端单一真相 =====
//
// 分类同时被三处消费：CreateTicketDto/UpdateTicketDto 校验、create_ticket 工具 schema
// （给模型的 enum）、stats 分类分布聚合。集中在此避免各处硬编码漂移。

export const TICKET_CATEGORIES = [
  'account',
  'hardware',
  'network',
  'software',
  'process',
  'other',
] as const

export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

export const DEFAULT_TICKET_CATEGORY: TicketCategory = 'other'

export const CATEGORY_LABEL: Record<string, string> = {
  account: '账号权限',
  hardware: '硬件设备',
  network: '网络访问',
  software: '软件应用',
  process: '制度流程',
  other: '其他',
}

// 给模型的分类说明：描述要足够具体，否则模型倾向一律归入 other
export const CATEGORY_DESCRIPTION =
  '工单分类：account=账号权限（密码重置、权限开通/变更、账号锁定）；' +
  'hardware=硬件设备（电脑/外设报修、设备申领更换）；' +
  'network=网络访问（VPN、WiFi、内网访问、防火墙）；' +
  'software=软件应用（OA/邮箱/企微等系统故障与安装）；' +
  'process=制度流程（报销、入离职、审批等制度咨询）；' +
  'other=其他（无法归类）。判断不了时填 other。'

// ===== 答案满意度反馈 =====

export const FEEDBACK_VALUES = ['up', 'down'] as const
export type FeedbackValue = (typeof FEEDBACK_VALUES)[number]

// 👎 原因标签（可选，用户可跳过）：负例的失败模式标注，eval:collect 导出时带出
export const FEEDBACK_REASONS = ['wrong', 'unsolved', 'bad_citation', 'irrelevant'] as const
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number]

export const FEEDBACK_REASON_LABEL: Record<string, string> = {
  wrong: '答案错误',
  unsolved: '没解决我的问题',
  bad_citation: '引用来源不准',
  irrelevant: '答非所问',
}

export function isTicketCategory(v: unknown): v is TicketCategory {
  return typeof v === 'string' && (TICKET_CATEGORIES as readonly string[]).includes(v)
}
