// 结构感知切块（替代原「固定 600 字符」单级切块）：
// 1. markdown 按标题层级切分，记录章节路径（"VPN 排查 > 连接失败"）供检索/引用
// 2. 表格（| 行）与代码块（``` 围栏）保持原子，避免被拦腰截断
// 3. 双级结构：父块（~parentSize，段落聚合）→ 叶子块（~leafSize），
//    叶子带上下文前缀参与检索，命中后返回父块给 LLM（Small-to-Big）
// 4. 其他格式按空行分段聚合（代码/JSON 等无结构文本同样受益于双级切块）
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

export interface ChunkConfig {
  parentSize: number
  parentOverlap: number
  leafSize: number
  leafOverlap: number
}

export interface ParentChunk {
  sectionPath: string | null
  content: string
}

export interface LeafChunk {
  parentIndex: number
  sectionPath: string | null
  content: string
}

interface Unit {
  path: string | null
  text: string
}

// 中文优先的分隔符：句末标点保留在块尾（keepSeparator: true），避免切块吞掉标点
const SEPARATORS = ['\n\n', '\n', '。', '！', '？', '；', ';', '!', '?', '. ', '、', ',', ' ', '']

interface RawBlock {
  path: string | null
  type: 'code' | 'table' | 'text'
  lines: string[]
}

// markdown → 带章节路径的原始块序列
function parseMarkdownBlocks(text: string): RawBlock[] {
  const lines = text.split('\n')
  const blocks: RawBlock[] = []
  const stack: string[] = []
  let buf: string[] = []
  let type: 'code' | 'table' | 'text' = 'text'
  let inCode = false

  const flush = () => {
    const content = buf.join('\n').trim()
    if (content)
      blocks.push({ path: stack.length ? stack.join(' > ') : null, type, lines: buf.slice() })
    buf = []
  }
  const setType = (t: 'code' | 'table' | 'text') => {
    if (t !== type) {
      flush()
      type = t
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    // 代码围栏：整块保持原子
    if (inCode) {
      buf.push(line)
      if (/^\s*(```|~~~)/.test(line)) {
        inCode = false
        flush()
      }
      continue
    }
    if (/^\s*(```|~~~)/.test(line)) {
      setType('code')
      inCode = true
      buf.push(line)
      continue
    }
    // 标题：重置/维护章节路径栈
    const h = /^#{1,6}\s+(.+)$/.exec(line)
    if (h) {
      flush()
      type = 'text'
      const level = h[0].match(/^#+/)![0].length
      stack.length = level - 1
      stack.push(h[1].trim())
      continue
    }
    // 表格行：连续 | 行聚合成一个原子块
    if (/^\s*\|/.test(line)) {
      setType('table')
      buf.push(line)
      continue
    }
    // 普通文本：空行为段落边界
    setType('text')
    if (line.trim() === '') {
      flush()
      continue
    }
    buf.push(line)
  }
  flush()
  return blocks
}

// 非 markdown：按空行分段
function parsePlainUnits(text: string): Unit[] {
  const units: Unit[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const t = block.trim()
    if (t) units.push({ path: null, text: t })
  }
  return units
}

// 段落聚合为父块：target ~parentSize；单块超长（>2×）时按句重切为多个父块
async function buildParents(units: Unit[], cfg: ChunkConfig): Promise<ParentChunk[]> {
  const parents: ParentChunk[] = []
  const longSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: cfg.parentSize,
    chunkOverlap: cfg.parentOverlap,
    separators: SEPARATORS,
    keepSeparator: true,
  })
  let cur: Unit[] = []
  let curLen = 0

  const flush = async () => {
    if (cur.length === 0) return
    const content = cur.map((u) => u.text).join('\n\n')
    // 章节路径取块内首个非空（父块归属其起始章节）
    const path = cur.find((u) => u.path)?.path ?? null
    if (content.length <= cfg.parentSize * 2) {
      parents.push({ sectionPath: path, content })
    } else {
      for (const piece of await longSplitter.splitText(content)) {
        const t = piece.trim()
        if (t) parents.push({ sectionPath: path, content: t })
      }
    }
    cur = []
    curLen = 0
  }

  for (const u of units) {
    if (cur.length > 0 && curLen + u.text.length > cfg.parentSize) flush()
    cur.push(u)
    curLen += u.text.length
  }
  await flush()
  return parents
}

// 父块 → 叶子块（Small-to-Big 的检索粒度）
async function buildLeaves(parents: ParentChunk[], cfg: ChunkConfig): Promise<LeafChunk[]> {
  const leaves: LeafChunk[] = []
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: cfg.leafSize,
    chunkOverlap: cfg.leafOverlap,
    separators: SEPARATORS,
    keepSeparator: true,
  })
  for (let i = 0; i < parents.length; i++) {
    const p = parents[i]
    if (p.content.length <= cfg.leafSize) {
      leaves.push({ parentIndex: i, sectionPath: p.sectionPath, content: p.content })
      continue
    }
    for (const piece of await splitter.splitText(p.content)) {
      const t = piece.trim()
      if (t) leaves.push({ parentIndex: i, sectionPath: p.sectionPath, content: t })
    }
  }
  return leaves
}

export async function chunkDocument(
  text: string,
  ext: string,
  cfg: ChunkConfig,
): Promise<{ parents: ParentChunk[]; leaves: LeafChunk[] }> {
  const isMd = ext === 'md' || ext === 'markdown'
  const units = isMd
    ? parseMarkdownBlocks(text).map((b) => ({ path: b.path, text: b.lines.join('\n').trim() }))
    : parsePlainUnits(text)
  const parents = await buildParents(units, cfg)
  return { parents, leaves: await buildLeaves(parents, cfg) }
}
