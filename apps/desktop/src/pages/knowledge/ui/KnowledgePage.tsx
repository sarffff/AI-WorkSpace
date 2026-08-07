import React, { useEffect, useState } from 'react'
import { HttpClient } from '@ai-workspace/sdk'
import type { KnowledgeDocument } from '@ai-workspace/sdk'
import {
  Upload,
  FileText,
  Search,
  Layers,
  Database,
  FileSpreadsheet,
  FileJson,
  FileArchive,
  FileCode,
  File,
  Hexagon,
} from 'lucide-react'

const api = new HttpClient('http://localhost:3000')

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, React.ReactNode> = {
    pdf: <FileText className="w-4 h-4 text-red-400" />,
    txt: <FileText className="w-4 h-4 text-slate-400" />,
    md: <FileCode className="w-4 h-4 text-blue-400" />,
    json: <FileJson className="w-4 h-4 text-yellow-400" />,
    csv: <FileSpreadsheet className="w-4 h-4 text-green-400" />,
    zip: <FileArchive className="w-4 h-4 text-purple-400" />,
    ts: <FileCode className="w-4 h-4 text-cyan-400" />,
    js: <FileCode className="w-4 h-4 text-yellow-400" />,
    py: <FileCode className="w-4 h-4 text-blue-500" />,
  }
  return iconMap[ext] || <File className="w-4 h-4 text-slate-400" />
}

export const KnowledgePage: React.FC = () => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [totalDocs, setTotalDocs] = useState(0)
  const [totalChunks, setTotalChunks] = useState(0)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    api
      .getDocuments()
      .then((docs) => {
        setDocuments(docs)
        setTotalDocs(docs.length)
        setTotalChunks(docs.reduce((sum, d) => sum + d.chunks, 0))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filteredDocs = searchQuery
    ? documents.filter((d) => d.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : documents

  const statCards = [
    {
      label: '文档总数',
      value: loading ? '—' : totalDocs,
      icon: <FileText className="w-5 h-5 text-amber-400" />,
      accent: 'from-amber-600/20 to-orange-600/10',
      border: 'border-amber-700/20',
      iconBg: 'bg-amber-500/10',
    },
    {
      label: '向量索引',
      value: loading ? '—' : totalChunks,
      icon: <Layers className="w-5 h-5 text-violet-400" />,
      accent: 'from-violet-600/20 to-purple-600/10',
      border: 'border-violet-700/20',
      iconBg: 'bg-violet-500/10',
    },
    {
      label: '存储引擎',
      value: 'MySQL',
      icon: <Database className="w-5 h-5 text-emerald-400" />,
      accent: 'from-emerald-600/20 to-teal-600/10',
      border: 'border-emerald-700/20',
      iconBg: 'bg-emerald-500/10',
      badge: 'Prisma ORM',
    },
  ]

  return (
    <div className="p-6 h-full overflow-y-auto space-y-6">
      {/* ===== 页面标题 ===== */}
      <div className="flex items-center justify-between animate-fade-slide">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] tracking-tight">
            知识库与检索
          </h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            管理文档向量，为智能体提供自定义上下文
          </p>
        </div>
        <button className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white text-xs font-semibold flex items-center gap-2 shadow-md shadow-amber-900/25 transition-all">
          <Upload className="w-4 h-4" />
          上传文档
        </button>
      </div>

      {/* ===== 统计卡片 ===== */}
      <div className="grid grid-cols-3 gap-4">
        {statCards.map((card, i) => (
          <div
            key={i}
            className={`rounded-xl bg-[var(--bg-panel)] border border-[var(--border-color)] p-5 card-hover-glow animate-fade-slide`}
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            <div className={`flex items-center gap-3.5`}>
              <div
                className={`w-11 h-11 rounded-xl ${card.iconBg} border ${card.border} flex items-center justify-center shrink-0`}
              >
                {card.icon}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-xl font-bold text-[var(--text-primary)] leading-tight">
                    {card.value}
                  </p>
                  {card.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                      {card.badge}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ===== 文档列表卡片 ===== */}
      <div
        className="rounded-xl bg-[var(--bg-panel)] border border-[var(--border-color)] overflow-hidden animate-fade-slide"
        style={{ animationDelay: '0.25s' }}
      >
        {/* 列表头部 */}
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`relative flex items-center w-72 bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl px-3 py-2`}
            >
              <Search className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0 mr-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索文档…"
                className="bg-transparent border-none text-xs text-[var(--text-primary)] placeholder-[var(--text-dim)] focus:outline-none w-full"
              />
            </div>
            <span className="text-[11px] text-[var(--text-dim)]">
              {filteredDocs.length} / {totalDocs} 个文档
            </span>
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
            >
              清除
            </button>
          )}
        </div>

        {/* 列表内容 */}
        <div className="divide-y divide-[var(--border-color)]/60">
          {filteredDocs.length > 0 ? (
            filteredDocs.map((doc, idx) => (
              <div
                key={doc.id}
                className="px-5 py-4 flex items-center justify-between hover:bg-[var(--bg-hover)]/60 transition-colors cursor-pointer animate-fade-slide"
                style={{ animationDelay: `${0.3 + idx * 0.05}s` }}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center shrink-0">
                    {getFileIcon(doc.name)}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {doc.name}
                    </h4>
                    <span className="text-[10px] text-[var(--text-dim)]">
                      {formatSize(doc.size)} · {doc.chunks} 向量块
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span className="text-[11px] text-[var(--text-muted)] hidden sm:block">
                    {doc.chunks} chunks
                  </span>
                  <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-medium capitalize border border-emerald-500/20">
                    {doc.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            /* 空状态 */
            <div className="py-16 flex flex-col items-center animate-fade-slide">
              <div className="w-12 h-12 rounded-xl bg-[var(--bg-card)] border border-[var(--border-color)] flex items-center justify-center mb-4 opacity-60">
                <Hexagon className="w-5 h-5 text-[var(--text-dim)]" strokeWidth={1.5} />
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-1">
                {searchQuery ? '没有找到匹配的文档' : '知识库是空的'}
              </p>
              <p className="text-[11px] text-[var(--text-dim)]">
                {searchQuery ? '尝试使用不同的关键词' : '上传你的第一个文档开始使用'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
