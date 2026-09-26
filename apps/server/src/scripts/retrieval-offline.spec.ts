import { readFileSync } from 'fs'
import * as path from 'path'
import type { HitChunk, LeafInput } from '@/modules/knowledge/retrieval-index'
import {
  coarseRank,
  fallbackRank,
  rankCandidates,
  RetrievalIndex,
} from '@/modules/knowledge/retrieval-index'
import { tokenize } from '@/modules/knowledge/bm25'

// ===== 检索排序离线回归（进 CI 的那一道门禁）=====
//
// eval:retrieval 要真实 MySQL + embedding Key，CI 跑不了 —— 于是重写了 BM25、稠密
// 比较与融合排序之后，没有任何回归守着它。这里用录制好的语料与查询向量离线重跑
// coarseRank → rankCandidates → fallbackRank，与线上是同一组函数（不是抄一份排序，
// 那样测的只是抄本）。
//
// 覆盖范围：稠密门控、BM25 词法召回、RRF 融合、父子块折叠、无 reranker 回退门。
// 不覆盖 reranker 与查询改写 —— 那两个是网络调用，本门禁的价值正在于无网可跑。
//
// fixture 由 pnpm eval:record-corpus 生成。换 embedding 模型后向量不再同一空间，
// 本用例会失败并要求重录，这是正确行为而不是 bug。

interface FixtureParent extends HitChunk {
  id: string
}

interface Fixture {
  embeddingModel: string
  dims: number
  params: { minScore: number; coarseTopK: number; finalTopK: number }
  parents: FixtureParent[]
  leaves: LeafInput[]
  queries: Array<{
    query: string
    expectedDocs: string[]
    note?: string
    embedding: number[]
  }>
}

function loadFixture(): Fixture {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'eval-corpus-fixture.json'),
    path.join(__dirname, '..', '..', 'scripts', 'eval-corpus-fixture.json'),
  ]
  for (const p of candidates) {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Fixture
    } catch {
      // try next
    }
  }
  throw new Error(
    `找不到检索评测 fixture（试过的路径之一：${candidates[0]}）。` +
      '本地执行 pnpm eval:record-corpus 生成后随代码提交。',
  )
}

const fixture = loadFixture()
const index = new RetrievalIndex(fixture.leaves)
const parents = new Map<string, HitChunk>(fixture.parents.map((p) => [p.id, p]))

interface Ranked {
  documentName: string
  score: number
}

function retrieve(query: string, queryVector: number[]): Ranked[] {
  const coarse = coarseRank(
    index,
    queryVector,
    tokenize(query),
    fixture.params.minScore,
    fixture.params.coarseTopK,
  )
  return fallbackRank(rankCandidates(index, parents, coarse), {
    minScore: fixture.params.minScore,
    finalTopK: fixture.params.finalTopK,
  }).map((r) => ({ documentName: r.parent.documentName, score: r.score }))
}

describe('检索排序离线回归（录制语料）', () => {
  it('fixture 自身健康：向量维度一致、父块齐全', () => {
    expect(fixture.dims).toBeGreaterThan(0)
    const bad = fixture.leaves.find((l) => l.embedding?.length !== fixture.dims)
    expect(bad).toBeUndefined()
    const orphan = fixture.leaves.find((l) => !parents.has(l.parentId as string))
    expect(orphan).toBeUndefined()
    expect(fixture.queries.length).toBeGreaterThanOrEqual(8)
  })

  it('每个正例查询都命中期望文档（HitRate@K = 100%）', () => {
    const misses: string[] = []
    for (const q of fixture.queries.filter((x) => x.expectedDocs.length > 0)) {
      const hits = retrieve(q.query, q.embedding)
      if (!hits.some((h) => q.expectedDocs.includes(h.documentName))) {
        misses.push(
          `"${q.query}" 期望 ${q.expectedDocs.join('/')}，实际 ${hits.map((h) => h.documentName).join(',') || '无命中'}`,
        )
      }
    }
    expect(misses).toEqual([])
  })

  it('MRR 不低于 0.9（首位命中的排序质量）', () => {
    const positives = fixture.queries.filter((x) => x.expectedDocs.length > 0)
    let sum = 0
    const detail: string[] = []
    for (const q of positives) {
      const hits = retrieve(q.query, q.embedding)
      const rank = hits.findIndex((h) => q.expectedDocs.includes(h.documentName))
      sum += rank === -1 ? 0 : 1 / (rank + 1)
      detail.push(`${rank === -1 ? 'MISS' : `#${rank + 1}`} ${q.query}`)
    }
    const mrr = positives.length ? sum / positives.length : 0
    // 失败时把逐条名次打出来，否则只知道分数不知道是哪条掉的
    if (mrr < 0.9) console.error('MRR 明细:\n' + detail.join('\n'))
    expect(mrr).toBeGreaterThanOrEqual(0.9)
  })

  // 注意：这里断言的是「区分度」而不是「负例零命中」。
  // 实测：负例的最高稠密分 0.415 已经越过线上默认阈值 ragMinScore=0.25 ——
  // 也就是说语义门对完全无关的问题根本没拦住，线上看到的是 reranker 终筛（>0.01）
  // 兜住的。rerank 未配置或调用失败回退时，会把无关文档当知识库依据端出来。
  // 阈值属于调参（要拿真实语料定），不在这里改；这条用例守的是区分度不许塌。
  it('正负例分数区间不重叠（区分度回归门）', () => {
    const topScore = (q: (typeof fixture.queries)[number]) =>
      retrieve(q.query, q.embedding)[0]?.score ?? 0
    const positives = fixture.queries.filter((x) => x.expectedDocs.length > 0)
    const negatives = fixture.queries.filter((x) => x.expectedDocs.length === 0)
    const minPositive = Math.min(...positives.map(topScore))
    const maxNegative = Math.max(...negatives.map(topScore))
    // 录制时实测间隔 0.205（0.620 vs 0.415）；掉到 0.05 以下说明排序/归一化质量塌了
    expect(minPositive - maxNegative).toBeGreaterThanOrEqual(0.05)
  })

  it('负例首位得分必须显著低于最弱的正例（否则说明语义门已失效）', () => {
    const positives = fixture.queries.filter((x) => x.expectedDocs.length > 0)
    const negatives = fixture.queries.filter((x) => x.expectedDocs.length === 0)
    const weakestPositive = Math.min(
      ...positives.map((q) => retrieve(q.query, q.embedding)[0]?.score ?? 0),
    )
    for (const q of negatives) {
      expect(retrieve(q.query, q.embedding)[0]?.score ?? 0).toBeLessThan(weakestPositive)
    }
  })

  it('错误码类查询靠词法召回兜住（纯稠密检索会漏的那一类）', () => {
    // ERR-4012 这种编号在语义空间里几乎没有信号，混合检索的意义就在这
    const hits = retrieve('VPN 报 ERR-4012 怎么处理', fixture.queries[1].embedding)
    expect(hits[0]?.documentName).toBe('vpn-troubleshooting.md')
    const coarse = coarseRank(
      index,
      fixture.queries[1].embedding,
      tokenize('VPN 报 ERR-4012 怎么处理'),
      fixture.params.minScore,
      fixture.params.coarseTopK,
    )
    expect(coarse.some((c) => (c.bm25Rank ?? Infinity) <= 4)).toBe(true)
  })
})
