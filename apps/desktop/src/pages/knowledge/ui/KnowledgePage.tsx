import React, { useEffect, useMemo, useState } from 'react'
import type { KnowledgeDocument } from '@ai-workspace/sdk'
import { Upload, FileText, Search, Layers, Files, Database } from 'lucide-react'

import { api } from '@/shared/api/client'

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

const STATUS_STYLE: Record<string, string> = {
  indexed: 'bg-brand/10 text-brand border-brand/25',
  processing: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  failed: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
}

const STATUS_LABEL: Record<string, string> = {
  indexed: 'INDEXED',
  processing: 'PROCESSING',
  failed: 'FAILED',
}

export const KnowledgePage: React.FC = () => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    api
      .getDocuments()
      .then((docs) => setDocuments(docs))
      .catch(() => {
        // fallback to empty
      })
      .finally(() => setLoading(false))
  }, [])

  const totalChunks = useMemo(() => documents.reduce((sum, d) => sum + d.chunks, 0), [documents])
  const filtered = useMemo(
    () => documents.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())),
    [documents, query],
  )

  const stats = [
    {
      label: 'DOCUMENTS',
      value: loading ? '--' : String(documents.length).padStart(2, '0'),
      icon: <Files className="w-4 h-4 text-t3" />,
      accent: 'text-t1',
    },
    {
      label: 'VECTOR CHUNKS',
      value: loading ? '--' : String(totalChunks).padStart(3, '0'),
      icon: <Layers className="w-4 h-4 text-brand" />,
      accent: 'text-brand',
    },
    {
      label: 'STORAGE',
      value: 'MySQL · Prisma',
      icon: <Database className="w-4 h-4 text-amber-400" />,
      accent: 'text-amber-300',
    },
  ]

  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 页头 */}
        <div className="flex items-end justify-between rise-in">
          <div>
            <span className="tag-telemetry text-[9px] font-mono text-brand/70">
              // RAG PIPELINE
            </span>
            <h3 className="font-display text-lg font-bold text-t1 mt-1">知识库</h3>
            <p className="text-xs text-t3 mt-1">
              文档经「上传 → 切片 → 向量化 → 索引」流水线处理，为 Agent 提供检索增强上下文。
            </p>
          </div>
          <button className="px-4 py-2.5 bg-brand/10 hover:bg-emerald-500/20 border border-brand/30 hover:border-brand/50 text-brand text-xs font-semibold rounded-lg flex items-center gap-2 transition-all shrink-0">
            <Upload className="w-4 h-4" />
            上传文档
          </button>
        </div>

        {/* 指标遥测 */}
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className="rise-in p-4 rounded-xl panel card-hover"
              style={{ animationDelay: `${80 + i * 70}ms` }}
            >
              <div className="flex items-center justify-between">
                <span className="tag-telemetry text-[9px] font-mono text-t3">{s.label}</span>
                {s.icon}
              </div>
              <div className={`font-display text-2xl font-bold mt-2 ${s.accent}`}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* 文档表格 */}
        <div
          className="rise-in rounded-xl panel overflow-hidden"
          style={{ animationDelay: '290ms' }}
        >
          <div className="p-4 border-b border-line flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 bg-s4 px-3 py-2 rounded-lg border border-line focus-within:border-emerald-500/50 transition-colors w-80">
              <Search className="w-3.5 h-3.5 text-t3" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="检索文档名称..."
                className="bg-transparent border-none text-xs text-t2 placeholder:text-t4 focus:outline-none w-full"
              />
            </div>
            <span className="text-[10px] font-mono text-t3">
              {filtered.length} / {documents.length} DOCS
            </span>
          </div>

          <div className="divide-y divide-line">
            {filtered.map((doc, i) => (
              <div
                key={doc.id}
                className="rise-in p-4 flex items-center justify-between hover:bg-s3 transition-colors group"
                style={{ animationDelay: `${340 + i * 60}ms` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-brand/10 border border-brand/15 text-brand flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-semibold text-t2 truncate">{doc.name}</h4>
                    <span className="text-[10px] font-mono text-t3">{formatSize(doc.size)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] font-mono text-t3">{doc.chunks} chunks</span>
                  <span
                    className={`text-[9px] font-mono px-2 py-1 rounded border tracking-wider ${
                      STATUS_STYLE[doc.status] || STATUS_STYLE.indexed
                    }`}
                  >
                    {STATUS_LABEL[doc.status] || doc.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
            {filtered.length === 0 && !loading && (
              <div className="p-10 text-center">
                <p className="text-xs font-mono text-t4">
                  {documents.length === 0
                    ? 'INDEX EMPTY — 上传第一份文档以构建向量索引'
                    : '未找到匹配的文档'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
