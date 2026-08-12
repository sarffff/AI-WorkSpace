import React, { useEffect, useState } from 'react'
import { HttpClient } from '@ai-workspace/sdk'
import type { KnowledgeDocument, KnowledgeHit } from '@ai-workspace/sdk'
import { Database, FileText, Loader2, Plus, Search, Trash2, Upload, Atom } from 'lucide-react'
import { useI18n } from '@/entities/i18n/model/useI18n'

const api = new HttpClient('http://localhost:3000')

export const KnowledgePage: React.FC = () => {
  const { t } = useI18n()
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<KnowledgeHit[]>([])
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  useEffect(() => {
    loadDocuments()
  }, [])

  const loadDocuments = async () => {
    try {
      const res = await api.getDocuments(1, 50)
      setDocuments(res.items || [])
    } catch {
      /* ignore */
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setSelectedFile(file)
  }

  const handleUpload = async () => {
    if (!selectedFile || uploading) return
    setUploading(true)
    setUploadMsg('')
    try {
      const result = await api.uploadDocument(selectedFile, selectedFile.name)
      setUploadMsg(`已上传并索引: ${result.name} (${result.chunks} chunks)`)
      setSelectedFile(null)
      loadDocuments()
    } catch (err) {
      setUploadMsg((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    await api.deleteDocument(id)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) return
    try {
      const res = await api.searchKnowledge(searchQuery, 5)
      if (res.success) {
        setSearchResults(res.data || [])
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-void)' }}>
      <div
        className="h-px w-full"
        style={{ background: 'linear-gradient(90deg,transparent,var(--glow-cyan),transparent)' }}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-8 py-8 space-y-8">
          <div className="flex items-center gap-3 fade-up">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg,rgba(34,211,238,.15),rgba(245,158,11,.1))',
                border: '1px solid rgba(34,211,238,.2)',
              }}
            >
              <Atom className="w-5 h-5" style={{ color: 'var(--accent-cyan)' }} />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--text-main)' }}>
                {t('knowledge.base')}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                上传文档以构建 RAG 知识库 · 已索引 {documents.length} 个文件
              </p>
            </div>
          </div>

          <div
            className="rounded-2xl border p-5 fade-up fade-up-delay-1"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Search className="w-3.5 h-3.5" /> 语义搜索
            </div>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/[0.07] rounded-xl px-3 py-2.5 focus-within:border-cyan-500/40 transition-colors input-placeholder">
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder={t('knowledge.search')}
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ color: 'var(--text-main)' }}
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={!searchQuery.trim()}
                className="px-4 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
                  boxShadow: '0 4px 16px rgba(34,211,238,.25)',
                }}
              >
                搜索
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>
                  {searchResults.length} 条结果 · 相似度阈值: 0.25
                </div>
                {searchResults.map((r: KnowledgeHit, i: number) => (
                  <div
                    key={i}
                    className="rounded-xl border p-3 cursor-pointer transition-all hover:border-cyan-500/20"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-soft)' }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(34,211,238,.1)', color: 'var(--accent-cyan)' }}
                      >
                        {(r.score * 100).toFixed(0)}% 匹配
                      </span>
                      <span
                        className="text-[10px] font-mono truncate"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        {r.documentName}
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {r.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div
            className="rounded-2xl border p-5 fade-up fade-up-delay-2"
            style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
          >
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Upload className="w-3.5 h-3.5" /> 上传文档
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <label
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium cursor-pointer transition-all hover:opacity-90"
                style={{
                  background: 'rgba(34,211,238,.08)',
                  border: '1px solid rgba(34,211,238,.2)',
                  color: 'var(--accent-cyan)',
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                {selectedFile ? selectedFile.name : t('knowledge.upload')}
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.md,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-40"
                style={{
                  background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)',
                  boxShadow: '0 4px 16px rgba(34,211,238,.25)',
                }}
              >
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t('knowledge.processing')}
                  </span>
                ) : (
                  '上传并索引'
                )}
              </button>
              {uploadMsg && (
                <span
                  className="text-xs font-mono px-3 py-1.5 rounded-lg"
                  style={{
                    color:
                      uploadMsg.includes('Error') || uploadMsg.includes('HTTP')
                        ? '#ef4444'
                        : '#22c55e',
                    background:
                      uploadMsg.includes('Error') || uploadMsg.includes('HTTP')
                        ? 'rgba(239,68,68,.08)'
                        : 'rgba(34,197,94,.08)',
                  }}
                >
                  {uploadMsg}
                </span>
              )}
            </div>
            <p className="text-[10px] mt-2" style={{ color: 'var(--text-dim)' }}>
              支持格式: PDF, DOCX, MD, TXT · 最大约 50MB
            </p>
          </div>

          <div className="fade-up fade-up-delay-3">
            <div
              className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <Database className="w-3.5 h-3.5" /> 已索引文档
              <span
                className="font-normal normal-case tracking-normal"
                style={{ color: 'var(--text-dim)' }}
              >
                ({documents.length})
              </span>
            </div>

            {documents.length === 0 ? (
              <div
                className="rounded-2xl border border-dashed p-12 text-center"
                style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
              >
                <FileText className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-dim)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t('knowledge.noDocs')}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                  {t('knowledge.uploadTip')}
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 px-4 py-3 rounded-xl border transition-all hover:border-white/10"
                    style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-soft)' }}
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: 'rgba(34,211,238,.08)',
                        border: '1px solid rgba(34,211,238,.12)',
                      }}
                    >
                      <FileText className="w-4 h-4" style={{ color: 'var(--accent-cyan)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: 'var(--text-main)' }}
                      >
                        {doc.name}
                      </div>
                      <div
                        className="text-[10px] font-mono mt-0.5"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        {doc.chunks ?? 0} chunks · {(doc.size / 1024).toFixed(0)}KB
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className="text-[10px] font-mono px-2 py-1 rounded-lg capitalize"
                        style={{
                          background:
                            doc.status === 'indexed'
                              ? 'rgba(34,197,94,.08)'
                              : 'rgba(245,158,11,.08)',
                          color: doc.status === 'indexed' ? '#22c55e' : '#f59e0b',
                        }}
                      >
                        {doc.status}
                      </span>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        className="p-1.5 rounded-lg hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        style={{ color: 'var(--text-dim)' }}
                        title={t('knowledge.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
