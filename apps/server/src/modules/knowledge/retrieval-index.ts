import { BM25, tokenize } from './bm25'

// ===== 语料检索索引（纯数据结构，不依赖 Nest 与数据库，便于单测）=====
//
// 背景：此前每次检索都要把可见叶子块全量从 MySQL 读回（含 content TEXT 与 Json
// 向量）、现场解析上千维数组、现场分词重建 BM25，再做带开方的余弦。语料增长时
// 这四笔开销同时线性放大，且每次查询都重付一遍。
//
// 本模块把一次性准备工作收敛到构建期：词项化、向量 L2 归一化。归一化后余弦
// 相似度退化为点积（省掉每次比较的两边开方），代价是构建时多一遍归一化。
//
// 向量以 Float32Array 驻留：比 Float64 省一半内存（万级 1024 维约 40MB vs 80MB），
// 代价是相似度精度降到约 1e-8 量级 —— 远小于 minScore 阈值粒度，不影响排序。

// 命中片段（叶子块或父块）在检索流水线中需要的最小字段集。
// 叶子来自本索引、父块来自数据库，用同一形状才能在去重/精排阶段无差别处理。
export interface HitChunk {
  id: string
  documentId: string
  documentName: string
  sectionPath: string | null
  content: string
}

export interface LeafInput extends HitChunk {
  parentId: string | null
  /** 上下文前缀 + 正文，与索引侧 embedDocuments 的输入完全一致 */
  leafText: string
  embedding: number[] | null
}

interface IndexedLeaf extends LeafInput {
  tokens: string[]
  /** L2 归一化后的向量；空向量或维度异常时为 null（相似度按 0 处理） */
  unit: Float32Array | null
}
export interface ScoredHit {
  id: string
  score: number
}

// L2 归一化。零模长返回 null —— 与 cosineSimilarity「模长为 0 返回 0」的旧行为对齐，
// 而不是返回一个全 0 向量参与点积（结果虽同为 0，但 null 能让维度校验显式成立）
export function toUnitVector(v: number[] | null | undefined): Float32Array | null {
  if (!v || v.length === 0) return null
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  if (sum === 0) return null
  const norm = Math.sqrt(sum)
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm
  return out
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

// 按分数降序取前 limit 个；分数相同时保持入参顺序（Array.sort 稳定）
function topHits(hits: ScoredHit[], limit: number): ScoredHit[] {
  if (limit <= 0) return []
  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

export class RetrievalIndex {
  private readonly leaves: IndexedLeaf[]
  private readonly byId = new Map<string, IndexedLeaf>()
  private readonly bm25: BM25

  constructor(inputs: LeafInput[]) {
    this.leaves = inputs.map((input) => ({
      ...input,
      tokens: tokenize(input.leafText),
      unit: toUnitVector(input.embedding),
    }))
    for (const leaf of this.leaves) this.byId.set(leaf.id, leaf)
    this.bm25 = new BM25(this.leaves.map((l) => l.tokens))
  }

  get size(): number {
    return this.leaves.length
  }

  leaf(id: string): LeafInput | undefined {
    return this.byId.get(id)
  }

  // 稠密检索：与归一化后的查询向量做点积。
  // 维度不一致或零向量按 0 分处理（保留旧 cosineSimilarity 的返回语义），
  // 因此 minScore 为负数时它们仍会进入候选 —— 与改造前一致。
  denseSearch(query: number[], minScore: number, limit: number): ScoredHit[] {
    const q = toUnitVector(query)
    if (!q) return []
    const hits: ScoredHit[] = []
    for (const leaf of this.leaves) {
      const unit = leaf.unit
      const score = unit && unit.length === q.length ? dot(q, unit) : 0
      if (score > minScore) hits.push({ id: leaf.id, score })
    }
    return topHits(hits, limit)
  }

  // 稀疏检索：只返回真正有词法命中的块。
  // 无命中的块此前也会占一个 BM25 名次并通过 RRF 拿到极小的加分，而该名次取决于
  // 数据库返回顺序；剔除后融合序不再受这种任意 tie-break 影响。
  lexicalSearch(queryTokens: string[], limit: number): ScoredHit[] {
    if (this.leaves.length === 0) return []
    const scores = this.bm25.score(queryTokens)
    const hits: ScoredHit[] = []
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > 0) hits.push({ id: this.leaves[i].id, score: scores[i] })
    }
    return topHits(hits, limit)
  }
}

// 可见范围键：管理员一份全量，其余按「本人 ∪ 本部门」各自一份。
// 权限判定仍由加载时的 SQL 过滤完成，键只用于复用同范围下结果一致的索引。
export function scopeKeyOf(user: { id: string; role: string; department: string | null }): string {
  return user.role === 'admin' ? 'admin' : `u:${user.id}:${user.department ?? '-'}`
}

// RRF 融合（结果序融合，抗分数尺度差异）：k 越大，名次差异对分数影响越平缓
const RRF_K = 60

function rrfFuse(lists: ScoredHit[][]): ScoredHit[] {
  const acc = new Map<string, number>()
  for (const list of lists) {
    list.forEach((item, i) => {
      acc.set(item.id, (acc.get(item.id) ?? 0) + 1 / (RRF_K + i + 1))
    })
  }
  return [...acc.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}

export interface CoarseHit {
  leafId: string
  /** 该叶子归属的父块；旧版单级块为 null（命中即返回自身） */
  parentId: string | null
  denseScore: number
  fusedScore: number
  bm25Rank?: number
}

// 粗排：稠密语义门控 + 稀疏 BM25 → RRF 融合 → 折叠到父块（Small-to-Big，同父多个叶子
// 只留融合分最高者）。
//
// 抽成不依赖 Nest/数据库的纯函数，是为了让「线上跑的排序」和「离线评测跑的排序」
// 是同一段代码。评测若另抄一份排序，它测的就只是那份抄本。
export function coarseRank(
  index: RetrievalIndex,
  queryVector: number[],
  queryTokens: string[],
  minScore: number,
  coarseTopK: number,
): CoarseHit[] {
  if (index.size === 0) return []

  const denseList = index.denseSearch(queryVector, minScore, coarseTopK)
  const bm25List = index.lexicalSearch(queryTokens, coarseTopK)
  const candidates = rrfFuse([denseList, bm25List]).slice(0, coarseTopK)
  if (candidates.length === 0) return []

  const bm25RankById = new Map(bm25List.map((x, i) => [x.id, i + 1]))
  const denseById = new Map(denseList.map((d) => [d.id, d.score]))

  // 按融合分降序遍历，故每个父块首次出现的那条就是它融合分最高的叶子
  const byParent = new Map<string, CoarseHit>()
  for (const c of candidates) {
    const leaf = index.leaf(c.id)
    if (!leaf) continue
    const key = leaf.parentId ?? leaf.id
    const existing = byParent.get(key)
    if (existing) {
      existing.fusedScore = Math.max(existing.fusedScore, c.score)
      continue
    }
    byParent.set(key, {
      leafId: leaf.id,
      parentId: leaf.parentId,
      denseScore: denseById.get(leaf.id) ?? 0,
      fusedScore: c.score,
      bm25Rank: bm25RankById.get(leaf.id),
    })
  }
  return [...byParent.values()]
}

// 折叠后的候选：带上父块正文（供 reranker 打分）与稠密分（供展示与回退排序）
export interface RankedCandidate {
  leaf: LeafInput
  parent: HitChunk
  denseScore: number
  fusedScore: number
  bm25Rank?: number
}

/**
 * 把粗排结果映射到父块正文。
 * parents 由调用方提供（线上按候选 id 精确查库；离线评测用 fixture 里的固定父块），
 * 取不到父块时退回叶子本身 —— 与改造前一致，避免候选被整个丢掉。
 *
 * coarseRank 与父块查询之间有依赖（要先知道取哪些父块），所以拆成两步由调用方串起来，
 * 而不是包成一个函数去内部回调查库 —— 那样纯函数就名存实亡了。
 */
export function rankCandidates(
  index: RetrievalIndex,
  parents: Map<string, HitChunk>,
  coarse: CoarseHit[],
): RankedCandidate[] {
  return coarse.map((c) => {
    const leaf = index.leaf(c.leafId) as LeafInput
    const parent = c.parentId ? (parents.get(c.parentId) ?? leaf) : leaf
    return {
      leaf,
      parent,
      denseScore: c.denseScore,
      fusedScore: c.fusedScore,
      bm25Rank: c.bm25Rank,
    }
  })
}

// 无 Reranker 时的回退排序：语义相关（稠密过阈值）或词法命中靠前才保留，
// 按融合分降序取 Top-K。分数展示优先用稠密分（0-1 语义可比），无稠密分才用融合分。
export function fallbackRank(
  candidates: RankedCandidate[],
  params: { minScore: number; finalTopK: number },
): { parent: HitChunk; score: number }[] {
  return candidates
    .filter((d) => d.denseScore > params.minScore || (d.bm25Rank ?? Infinity) <= params.finalTopK)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, params.finalTopK)
    .map((d) => ({ parent: d.parent, score: d.denseScore || d.fusedScore }))
}

export interface CacheEntry {
  index: RetrievalIndex
  generation: number
  builtAt: number
}

// ===== 语料索引缓存 =====
//
// 代数（generation）由持有方在任何语料变更后自增，本缓存见到代数变化即整体丢弃：
// 同一进程内「上传 → 立刻检索」必定读到新索引。跨进程部署时本进程收不到对方的
// 变更通知，靠 TTL 兜底收敛，故 TTL 不宜设长。
export class RetrievalIndexCache {
  private readonly entries = new Map<string, CacheEntry>()
  private cachedGeneration = 0

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 12,
  ) {}

  async resolve(
    key: string,
    generation: number,
    load: () => Promise<RetrievalIndex>,
    now: () => number = Date.now,
  ): Promise<RetrievalIndex> {
    if (generation !== this.cachedGeneration) {
      this.entries.clear()
      this.cachedGeneration = generation
    }
    const hit = this.entries.get(key)
    if (hit && now() - hit.builtAt < this.ttlMs) {
      // 重新插入以体现最近使用（Map 迭代序即插入序，尾元素为最新）
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit.index
    }
    if (hit) this.entries.delete(key)

    const index = await load()
    this.entries.set(key, { index, generation, builtAt: now() })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return index
  }

  get entryCount(): number {
    return this.entries.size
  }
}
