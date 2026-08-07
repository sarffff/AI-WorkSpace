import React from 'react'
import { Sparkles, Terminal, Code2, Database, Workflow, ArrowRight } from 'lucide-react'

const promptIcons: Record<string, { icon: React.ReactNode; bg: string; border: string }> = {
  Engineering: {
    icon: <Code2 className="w-5 h-5 text-blue-400" />,
    bg: 'bg-blue-500/10',
    border: 'border-blue-700/20',
  },
  Architecture: {
    icon: <Workflow className="w-5 h-5 text-violet-400" />,
    bg: 'bg-violet-500/10',
    border: 'border-violet-700/20',
  },
  Database: {
    icon: <Database className="w-5 h-5 text-emerald-400" />,
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-700/20',
  },
}

export const PromptsPage: React.FC = () => {
  const prompts = [
    {
      title: '代码重构专家',
      category: 'Engineering',
      desc: '审查代码性能、可读性以及 TypeScript 最佳实践，给出可执行的改进方案。',
      gradient: 'from-blue-600 to-cyan-600',
    },
    {
      title: 'Monorepo 架构师',
      category: 'Architecture',
      desc: '用 pnpm workspaces + Turborepo 设计可扩展的 Monorepo，搭配 NestJS 后端与共享 SDK。',
      gradient: 'from-violet-600 to-purple-600',
    },
    {
      title: 'SQL 查询优化师',
      category: 'Database',
      desc: '优化缓慢 MySQL 查询，设计高效的 Prisma 关系模型，精确定位 N+1 问题与索引瓶颈。',
      gradient: 'from-emerald-600 to-teal-600',
    },
  ]

  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">
      {/* ===== 页面标题 ===== */}
      <div className="animate-fade-slide">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
          提示词车间
        </h3>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          精心设计的角色提示，让智能体精准扮演特定角色
        </p>
      </div>

      {/* ===== 提示词卡片网格 ===== */}
      <div className="grid grid-cols-3 gap-5">
        {prompts.map((p, idx) => {
          const iconCfg = promptIcons[p.category] || {
            icon: <Sparkles className="w-5 h-5 text-amber-400" />,
            bg: 'bg-amber-500/10',
            border: 'border-amber-700/20',
          }
          return (
            <div
              key={idx}
              className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-color)] overflow-hidden card-hover-glow animate-fade-slide flex flex-col"
              style={{ animationDelay: `${idx * 0.1}s` }}
            >
              {/* 顶部彩色条 */}
              <div className={`h-1 bg-gradient-to-r ${p.gradient} opacity-70`} />

              <div className="p-5 flex flex-col flex-1">
                {/* 类别标签 */}
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={`text-[10px] px-2 py-1 rounded-full ${iconCfg.bg} ${iconCfg.border} border font-medium text-[var(--text-secondary)]`}
                  >
                    {p.category}
                  </span>
                  <div
                    className={`w-8 h-8 rounded-lg ${iconCfg.bg} ${iconCfg.border} border flex items-center justify-center`}
                  >
                    {iconCfg.icon}
                  </div>
                </div>

                {/* 标题与描述 */}
                <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2 leading-snug">
                  {p.title}
                </h4>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed flex-1">{p.desc}</p>

                {/* 使用按钮 */}
                <button className="mt-4 w-full py-2.5 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] hover:border-amber-700/30 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-amber-200 text-xs font-medium flex items-center justify-center gap-2 transition-all group">
                  <Terminal className="w-3.5 h-3.5 text-amber-500/70 group-hover:text-amber-400 transition-colors" />
                  使用提示词
                  <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ===== 底部提示区 ===== */}
      <div
        className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-color)] p-6 animate-fade-slide"
        style={{ animationDelay: '0.4s' }}
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-700/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              自定义系统提示词
            </h4>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-3">
              在对话中粘贴系统提示词，智能体将立即进入对应角色，为你提供更专业的回答。
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-2 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-dim)] font-mono">
                Shift + Tab 快速插入
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
