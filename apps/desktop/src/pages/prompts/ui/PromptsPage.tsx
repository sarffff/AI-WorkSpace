import React from 'react'
import { Terminal, Sparkles } from 'lucide-react'

const CATEGORY_COLOR: Record<string, string> = {
  工程: 'text-brand border-brand/25 bg-brand/10',
  架构: 'text-sky-300 border-sky-500/25 bg-sky-500/10',
  数据库: 'text-amber-300 border-amber-500/25 bg-amber-500/10',
}

const prompts = [
  {
    title: '代码重构专家',
    category: '工程',
    desc: '审查代码的性能、可读性与 TypeScript 最佳实践，给出可落地的重构步骤。',
    role: 'SYSTEM // REFACTOR-EXPERT',
  },
  {
    title: 'Monorepo 架构规划师',
    category: '架构',
    desc: '设计可扩展的 pnpm workspace 分层，编排 Turborepo 任务与 NestJS 后端模块。',
    role: 'SYSTEM // ARCH-PLANNER',
  },
  {
    title: 'SQL & Prisma 查询优化器',
    category: '数据库',
    desc: '优化慢查询、分析索引策略，设计高效的 Prisma 关系模型与批量操作。',
    role: 'SYSTEM // QUERY-OPTIMIZER',
  },
]

export const PromptsPage: React.FC = () => {
  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="rise-in">
          <span className="tag-telemetry text-[9px] font-mono text-brand/70">// PROMPT HUB</span>
          <h3 className="font-display text-lg font-bold text-t1 mt-1">提示词</h3>
          <p className="text-xs text-t3 mt-1">
            预设系统级角色提示词，一键注入对话上下文，让 Agent 切换专业身份。
          </p>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {prompts.map((p, idx) => (
            <div
              key={p.title}
              className="rise-in p-5 rounded-xl panel card-hover flex flex-col justify-between gap-5 relative overflow-hidden group"
              style={{ animationDelay: `${80 + idx * 90}ms` }}
            >
              {/* 角标装饰 */}
              <div className="absolute top-0 right-0 w-16 h-16 bg-brand/5 rounded-bl-[40px] group-hover:bg-brand/10 transition-colors" />

              <div className="space-y-3 relative">
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[9px] font-mono px-2 py-0.5 rounded border tracking-wider ${
                      CATEGORY_COLOR[p.category]
                    }`}
                  >
                    {p.category}
                  </span>
                  <Sparkles className="w-3.5 h-3.5 text-t4 group-hover:text-brand transition-colors" />
                </div>
                <div>
                  <p className="text-[9px] font-mono text-t4 mb-1">{p.role}</p>
                  <h4 className="font-display text-sm font-semibold text-t1">{p.title}</h4>
                </div>
                <p className="text-xs text-t3 leading-relaxed">{p.desc}</p>
              </div>

              <button className="w-full py-2 bg-s3 hover:bg-emerald-500/15 border border-line hover:border-brand/40 text-t2 hover:text-brand text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2 relative">
                <Terminal className="w-3.5 h-3.5" />
                注入对话
              </button>
            </div>
          ))}
        </div>

        <div
          className="rise-in p-4 rounded-xl border border-dashed border-line flex items-center justify-between"
          style={{ animationDelay: '380ms' }}
        >
          <p className="text-[11px] text-t3">
            自定义提示词管理将在后续版本开放 —— 支持版本化模板与团队共享。
          </p>
          <span className="text-[9px] font-mono text-t4">COMING SOON</span>
        </div>
      </div>
    </div>
  )
}
