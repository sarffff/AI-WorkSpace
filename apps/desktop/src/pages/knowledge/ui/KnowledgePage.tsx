import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { KnowledgeDocument } from '@ai-workspace/sdk'
import { Upload, FileText, Search, Layers, Files, Database, Trash2, Loader2 } from 'lucide-react'

import { api } from '@/shared/api/client'

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${bytes} B`
}

// 与服务端 KnowledgeService 支持的扩展名保持一致
const SUPPORTED_EXTS = [
  'pdf',
  'docx',
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'ts',
  'js',
  'jsx',
  'tsx',
  'py',
  'java',
  'go',
  'html',
  'css',
  'yml',
  'yaml',
  'xml',
  'log',
  'sql',
  'sh',
  'bat',
  'ini',
  'toml',
]

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
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    return api
      .getDocuments()
      .then((docs) => setDocuments(docs))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    refresh()
  }, [])

  // 上传：前端先校验扩展名 → 调后端抽取/切块/向量化 → 刷新列表
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许连续上传同一个文件
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    if (!SUPPORTED_EXTS.includes(ext)) {
      setUploadError(
        `不支持的文件类型 .${ext}（支持: ${SUPPORTED_EXTS.slice(0, 8).join(', ')} 等）`,
      )
      return
    }

    setUploading(true)
    setUploadError('')
    try {
      await api.uploadDocument(file, file.name)
      await refresh()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDocument(id)
      setDocuments((prev) => prev.filter((d) => d.id !== id))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '删除失败')
    }
  }

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
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2.5 bg-brand/10 hover:bg-emerald-500/20 disabled:opacity-50 border border-brand/30 hover:border-brand/50 text-brand text-xs font-semibold rounded-lg flex items-center gap-2 transition-all shrink-0"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {uploading ? '索引中...' : '上传文档'}
          </button>
          {/* 隐藏的文件选择框 */}
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_EXTS.map((e) => '.' + e).join(',')}
            onChange={handleUpload}
            className="hidden"
          />
        </div>

        {/* 上传错误提示 */}
        {uploadError && (
          <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
            {uploadError}
          </div>
        )}

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
                  <button
                    onClick={() => handleDelete(doc.id)}
                    title="删除文档"
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-t4 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
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
