import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSelector } from 'react-redux'
import type { KnowledgeDocument } from '@servicedesk/sdk'
import {
  Upload,
  Search,
  Layers,
  Files,
  Database,
  Trash2,
  Loader2,
  FileText,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileArchive,
  File,
  CloudUpload,
  Users,
} from 'lucide-react'

import { api } from '@/shared/api/client'
import type { RootState } from '@/app/providers/store'

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

// 扩展名 → 图标 + 遥测色（延续甲板配色语义）
const FILE_ICON: Record<string, { icon: React.ReactNode; tint: string }> = {
  pdf: { icon: <FileText className="w-4 h-4" />, tint: 'text-rose-400' },
  docx: { icon: <FileText className="w-4 h-4" />, tint: 'text-sky-300' },
  md: { icon: <FileCode className="w-4 h-4" />, tint: 'text-brand' },
  markdown: { icon: <FileCode className="w-4 h-4" />, tint: 'text-brand' },
  json: { icon: <FileJson className="w-4 h-4" />, tint: 'text-amber-300' },
  csv: { icon: <FileSpreadsheet className="w-4 h-4" />, tint: 'text-emerald-300' },
  zip: { icon: <FileArchive className="w-4 h-4" />, tint: 'text-violet-300' },
  ts: { icon: <FileCode className="w-4 h-4" />, tint: 'text-sky-300' },
  tsx: { icon: <FileCode className="w-4 h-4" />, tint: 'text-sky-300' },
  js: { icon: <FileCode className="w-4 h-4" />, tint: 'text-amber-300' },
  jsx: { icon: <FileCode className="w-4 h-4" />, tint: 'text-amber-300' },
  py: { icon: <FileCode className="w-4 h-4" />, tint: 'text-sky-400' },
  sql: { icon: <Database className="w-4 h-4" />, tint: 'text-violet-300' },
}
const fileMeta = (name: string) =>
  FILE_ICON[name.split('.').pop()?.toLowerCase() || ''] || {
    icon: <File className="w-4 h-4" />,
    tint: 'text-t3',
  }

const STATUS_STYLE: Record<string, string> = {
  indexed: 'bg-brand/10 text-brand border-brand/25',
  processing: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  failed: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
}
const STATUS_DOT: Record<string, string> = {
  indexed: 'bg-brand',
  processing: 'bg-amber-400 animate-pulse',
  failed: 'bg-rose-400',
}
const STATUS_LABEL: Record<string, string> = {
  indexed: '已索引',
  processing: '处理中',
  failed: '失败',
}

// 异步索引阶段 → 中文标签
const STAGE_LABEL: Record<string, string> = {
  queued: '排队中',
  extracting: '提取文本',
  chunking: '切块',
  embedding: '向量化',
  storing: '写入索引',
  done: '完成',
  failed: '失败',
}

export const KnowledgePage: React.FC = () => {
  const user = useSelector((s: RootState) => s.auth.user)
  const isAdmin = user?.role === 'admin'
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [shareToDept, setShareToDept] = useState(false)
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

  // 存在处理中的文档时轮询刷新（进度条实时更新，全部完成后自动停止）
  const hasProcessing = documents.some((d) => d.status === 'processing')
  useEffect(() => {
    if (!hasProcessing) return
    const timer = setInterval(() => {
      api
        .getDocuments()
        .then(setDocuments)
        .catch(() => {})
    }, 2500)
    return () => clearInterval(timer)
  }, [hasProcessing])

  // 上传：前端先校验扩展名 → 调后端抽取/切块/向量化 → 刷新列表
  const upload = async (file: File) => {
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
      // 上传立即返回 processing 状态的文档条目，先入列表给即时反馈，进度靠轮询更新
      const doc = await api.uploadDocument(
        file,
        file.name,
        shareToDept ? user?.department || undefined : undefined,
      )
      setDocuments((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)])
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许连续上传同一个文件
    if (file) await upload(file)
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
  const totalSize = useMemo(() => documents.reduce((sum, d) => sum + d.size, 0), [documents])
  const filtered = useMemo(
    () => documents.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())),
    [documents, query],
  )

  const stats = [
    {
      label: '文档总数',
      value: loading ? '--' : String(documents.length).padStart(2, '0'),
      icon: <Files className="w-4 h-4 text-t3" />,
      accent: 'text-t1',
    },
    {
      label: '向量切片',
      value: loading ? '--' : String(totalChunks).padStart(3, '0'),
      icon: <Layers className="w-4 h-4 text-brand" />,
      accent: 'text-brand',
    },
    {
      label: '语料体积',
      value: loading ? '--' : formatSize(totalSize),
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
            <h3 className="font-display text-lg font-bold text-t1">知识库</h3>
            <p className="text-xs text-t3 mt-1">
              文档经「上传 → 切片 → 向量化 → 索引」流水线处理，为 Agent 提供检索增强上下文。
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* 部门共享开关（有部门的用户可见） */}
            {user?.department && (
              <label className="flex items-center gap-1.5 text-[10px] font-mono text-t3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={shareToDept}
                  onChange={(e) => setShareToDept(e.target.checked)}
                  className="accent-emerald-500 w-3 h-3"
                />
                <Users className="w-3 h-3" />
                共享至 {user.department}
              </label>
            )}
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
          </div>
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
          <div className="px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono fade-in">
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

        {/* 文档列表（支持拖拽上传） */}
        <div
          className={`rise-in rounded-xl panel overflow-hidden transition-all ${
            dragOver
              ? 'border-brand/60 shadow-[0_0_0_1px_var(--brand-ring),0_8px_30px_-12px_var(--brand-glow)]'
              : ''
          }`}
          style={{ animationDelay: '290ms' }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file && !uploading) upload(file)
          }}
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

          <div className="divide-y divide-line relative min-h-[120px]">
            {/* 拖拽提示浮层 */}
            {dragOver && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-s0/80 backdrop-blur-sm border-2 border-dashed border-brand/50 m-3 rounded-lg fade-in">
                <CloudUpload className="w-6 h-6 text-brand" />
                <p className="text-xs font-mono text-brand mt-2 tracking-wider">
                  DROP TO INDEX · 释放开始上传索引
                </p>
              </div>
            )}

            {loading ? (
              [0, 1, 2].map((i) => <div key={i} className="p-4 h-[68px] animate-pulse bg-s3/40" />)
            ) : (
              <>
                {filtered.map((doc, i) => {
                  const meta = fileMeta(doc.name)
                  return (
                    <div
                      key={doc.id}
                      className="rise-in p-4 flex items-center justify-between hover:bg-s3 transition-colors group"
                      style={{ animationDelay: `${340 + i * 60}ms` }}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-lg bg-s4 border border-line flex items-center justify-center shrink-0 group-hover:scale-105 group-hover:border-linestrong transition-all">
                          <span className={meta.tint}>{meta.icon}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-semibold text-t2 truncate">{doc.name}</h4>
                          <span className="text-[10px] font-mono text-t3">
                            {formatSize(doc.size)}
                          </span>
                          {/* 异步索引进度条：阶段 + 百分比 */}
                          {doc.status === 'processing' && doc.progress && (
                            <div className="mt-1.5 max-w-[280px]">
                              <div className="flex items-center justify-between text-[9px] font-mono text-t4 mb-1">
                                <span>
                                  {STAGE_LABEL[doc.progress.stage] || doc.progress.stage}
                                  {doc.progress.chunks ? ` · ${doc.progress.chunks} chunks` : ''}
                                </span>
                                <span>{doc.progress.percent}%</span>
                              </div>
                              <div className="h-1 rounded-full bg-s4 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                                  style={{ width: `${doc.progress.percent}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {doc.department && (
                          <span
                            className="text-[9px] font-mono px-2 py-1 rounded border tracking-wider text-amber-300 border-amber-500/25 bg-amber-500/10 flex items-center gap-1"
                            title={`已共享至部门「${doc.department}」的检索范围`}
                          >
                            <Users className="w-2.5 h-2.5" />
                            {doc.department}
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-t3">{doc.chunks} chunks</span>
                        <span
                          className={`text-[9px] font-mono px-2 py-1 rounded border tracking-wider flex items-center gap-1.5 ${
                            STATUS_STYLE[doc.status] || STATUS_STYLE.indexed
                          }`}
                        >
                          <span
                            className={`w-1 h-1 rounded-full ${STATUS_DOT[doc.status] || STATUS_DOT.indexed}`}
                          />
                          {STATUS_LABEL[doc.status] || doc.status.toUpperCase()}
                        </span>
                        {(isAdmin || !doc.ownerId || doc.ownerId === user?.id) && (
                          <button
                            onClick={() => handleDelete(doc.id)}
                            title="删除文档"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-t4 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
                {filtered.length === 0 && (
                  <div className="p-12 text-center">
                    <CloudUpload className="w-6 h-6 text-t4 mx-auto" />
                    <p className="text-xs font-mono text-t4 mt-3">
                      {documents.length === 0
                        ? 'INDEX EMPTY — 拖入或上传第一份文档以构建向量索引'
                        : '未找到匹配的文档'}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
