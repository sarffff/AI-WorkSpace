import React from 'react'
import { Key, Database, Save, RotateCcw, Palette, Globe, Bell } from 'lucide-react'

const settingSections = [
  {
    icon: <Key className="w-5 h-5 text-amber-400" />,
    title: 'AI 供应方',
    sub: 'API Key 与推理端点配置',
    iconBg: 'bg-amber-500/10 border-amber-700/20',
    fields: [
      {
        label: 'OpenAI API Key',
        value: 'sk-proj-****************************************',
        type: 'password',
        mono: true,
      },
      {
        label: '自定义推理端点（选填）',
        value: '',
        placeholder: 'https://api.example.com/v1',
        type: 'text',
      },
    ],
  },
  {
    icon: <Database className="w-5 h-5 text-emerald-400" />,
    title: '数据存储',
    sub: 'MySQL 连接与缓存层配置',
    iconBg: 'bg-emerald-500/10 border-emerald-700/20',
    fields: [
      {
        label: 'MySQL 连接串',
        value: 'mysql://root:root@localhost:3306/ai_workspace',
        type: 'text',
        mono: true,
      },
      { label: 'Redis 主机', value: 'redis://localhost:6379', type: 'text', mono: true },
    ],
  },
]

const appSettings = [
  {
    label: '深色主题',
    desc: '使用暖色调深色主题（当前为专属优化配色）',
    type: 'toggle',
    on: true,
    icon: Palette,
  },
  {
    label: '开机自启',
    desc: '系统启动时自动运行 AI 工作台',
    type: 'toggle',
    on: false,
    icon: Globe,
  },
  { label: '桌面通知', desc: '回复完成后发送系统通知提醒', type: 'toggle', on: true, icon: Bell },
]

export const SettingsPage: React.FC = () => {
  return (
    <div className="p-6 h-full overflow-y-auto space-y-5">
      {/* ===== 页面标题 ===== */}
      <div className="animate-fade-slide">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
          系统设置
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">配置 AI 供应方、数据存储与应用偏好</p>
      </div>

      {/* ===== API & 存储设置 ===== */}
      {settingSections.map((section, si) => (
        <div
          key={si}
          className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-color)] overflow-hidden animate-fade-slide"
          style={{ animationDelay: `${si * 0.1}s` }}
        >
          {/* 区块头 */}
          <div className="px-5 py-4 border-b border-[var(--border-color)]/60 flex items-center gap-3.5">
            <div
              className={`w-9 h-9 rounded-xl ${section.iconBg} border flex items-center justify-center shrink-0`}
            >
              {section.icon}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-[var(--text-primary)]">{section.title}</h4>
              <span className="text-[11px] text-[var(--text-dim)]">{section.sub}</span>
            </div>
          </div>

          {/* 字段 */}
          <div className="px-5 py-4 space-y-4">
            {section.fields.map((field, fi) => (
              <div key={fi}>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium">
                  {field.label}
                </label>
                <input
                  type={field.type}
                  defaultValue={field.value}
                  placeholder={field.placeholder}
                  className={`warm-input w-full rounded-xl px-3.5 py-2.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] ${field.mono ? 'font-mono' : ''}`}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ===== 应用偏好 ===== */}
      <div
        className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-color)] overflow-hidden animate-fade-slide"
        style={{ animationDelay: '0.2s' }}
      >
        <div className="px-5 py-4 border-b border-[var(--border-color)]/60 flex items-center gap-3.5">
          <div className="w-9 h-9 rounded-xl bg-violet-500/10 border-violet-700/20 border flex items-center justify-center shrink-0">
            <Globe className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">应用偏好</h4>
            <span className="text-[11px] text-[var(--text-dim)]">桌面端行为与通知设置</span>
          </div>
        </div>

        <div className="divide-y divide-[var(--border-color)]/50">
          {appSettings.map((s, si) => {
            const Icon = s.icon
            return (
              <div
                key={si}
                className="px-5 py-4 flex items-center justify-between hover:bg-[var(--bg-hover)]/40 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-[var(--text-muted)]" />
                  <div>
                    <p className="text-xs font-medium text-[var(--text-primary)]">{s.label}</p>
                    <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{s.desc}</p>
                  </div>
                </div>
                {/* 自定义切换按钮 */}
                <button
                  className={`relative w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer ${
                    s.on
                      ? 'bg-amber-600'
                      : 'bg-[var(--bg-hover)] border border-[var(--border-color)]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      s.on ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* ===== 操作按钮 ===== */}
      <div
        className="flex items-center justify-end gap-3 pt-2 animate-fade-slide"
        style={{ animationDelay: '0.3s' }}
      >
        <button className="px-4 py-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs font-medium flex items-center gap-2 transition-all">
          <RotateCcw className="w-3.5 h-3.5" />
          重置默认
        </button>
        <button className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md shadow-amber-900/25 transition-all">
          <Save className="w-3.5 h-3.5" />
          保存修改
        </button>
      </div>
    </div>
  )
}
