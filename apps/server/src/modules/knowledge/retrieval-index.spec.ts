import { cosineSimilarity } from '@/common/embeddings'
import { BM25, tokenize } from './bm25'
import {
  LeafInput,
  RetrievalIndex,
  RetrievalIndexCache,
  scopeKeyOf,
  toUnitVector,
} from './retrieval-index'

// 行为依据：
// - 本索引只做「构建期把一次性的准备工作做完」，检索结果必须与朴素实现一致：
//   归一化后的点积 === 余弦相似度；倒排 BM25 分数 === 逐文档遍历的原始算法
// - 缓存以代数（generation）为主失效手段，TTL 仅兜底跨进程场景

const leaf = (over: Partial<LeafInput> = {}): LeafInput => ({
  id: 'l1',
  parentId: 'p1',
  documentId: 'd1',
  documentName: 'vpn-manual.pdf',
  sectionPath: 'VPN 排查 > 连接失败',
  content: '连接失败时请检查账号是否被锁定',
  leafText: 'vpn-manual.pdf > VPN 排查 > 连接失败\n连接失败时请检查账号是否被锁定',
  embedding: [1, 0, 0],
  ...over,
})

describe('toUnitVector', () => {
  it('按 L2 模长归一化', () => {
    const u = toUnitVector([3, 4])
    expect(u).not.toBeNull()
    // Float32 存储：0.6/0.8 无法精确表示，误差量级 1e-8，对排序与阈值门控无影响
    expect(u?.[0]).toBeCloseTo(0.6, 6)
    expect(u?.[1]).toBeCloseTo(0.8, 6)
  })

  it('空向量与零模长返回 null（对齐 cosineSimilarity 返回 0 的旧语义）', () => {
    expect(toUnitVector([])).toBeNull()
    expect(toUnitVector([0, 0, 0])).toBeNull()
    expect(toUnitVector(null)).toBeNull()
    expect(toUnitVector(undefined)).toBeNull()
  })
})

describe('BM25 倒排实现与朴素遍历实现分数一致', () => {
  // 朴素实现：逐查询词扫描全部文档的 token 数组统计词频（改造前的算法）
  const K1 = 1.5
  const B = 0.75
  const naiveScores = (docs: string[][], queryTokens: string[]): number[] => {
    const n = docs.length
    const out = new Array<number>(n).fill(0)
    if (n === 0) return out
    const avgdl = docs.reduce((s, d) => s + d.length, 0) / n
    const df = new Map<string, number>()
    for (const doc of docs) {
      for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1)
    }
    for (const q of queryTokens) {
      const d = df.get(q) ?? 0
      if (d === 0) continue
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5))
      for (let i = 0; i < n; i++) {
        let f = 0
        for (const t of docs[i]) if (t === q) f++
        if (f === 0) continue
        const denom = f + K1 * (1 - B + B * (docs[i].length / avgdl))
        out[i] += idf * ((f * (K1 + 1)) / denom)
      }
    }
    return out
  }

  it('同词多次出现、跨文档重复词项的累加行为一致', () => {
    const docs = [
      tokenize('VPN VPN 连接失败 ERR-4012'),
      tokenize('打印机卡纸'),
      tokenize('VPN 连接'),
      tokenize('重置密码 vpn 账号锁定'),
    ]
    const query = tokenize('VPN VPN 连接失败')
    expect(new BM25(docs).score(query)).toEqual(naiveScores(docs, query))
  })

  it('空语料与全空文档都不报错', () => {
    expect(new BM25([]).score(tokenize('VPN'))).toEqual([])
    expect(new BM25([[], []]).score(tokenize('VPN'))).toEqual([0, 0])
  })
})

describe('RetrievalIndex.denseSearch', () => {
  const index = new RetrievalIndex([
    leaf({ id: 'a', embedding: [1, 0, 0] }),
    leaf({ id: 'b', embedding: [0, 2, 0] }),
    leaf({ id: 'c', embedding: [0, 0, 3] }),
  ])

  it('点积结果与直接算余弦一致（归一化不改变相似度，精度受 Float32 存储限制）', () => {
    const query = [0.5, 0.5, 0]
    const hits = index.denseSearch(query, -1, 10)
    const expected = new Map([
      ['a', cosineSimilarity(query, [1, 0, 0])],
      ['b', cosineSimilarity(query, [0, 2, 0])],
      ['c', cosineSimilarity(query, [0, 0, 3])],
    ])
    for (const h of hits) expect(h.score).toBeCloseTo(expected.get(h.id) ?? 0, 6)
  })

  it('按分数降序、受 minScore 门控与 limit 截断', () => {
    const hits = index.denseSearch([0, 1, 0], 0.25, 5)
    expect(hits.map((h) => h.id)).toEqual(['b'])
    expect(index.denseSearch([1, 0, 0], 0.9, 1)[0]?.id).toBe('a')
  })

  it('维度异常或零向量的块按 0 分参与：minScore 为负时仍进候选（保持改造前行为）', () => {
    const odd = new RetrievalIndex([
      leaf({ id: 'short', embedding: [1, 0] }),
      leaf({ id: 'zero', embedding: [0, 0, 0] }),
      leaf({ id: 'ok', embedding: [0, 0, 1] }),
    ])
    const ids = odd.denseSearch([0, 0, 2], -1, 10).map((h) => h.id)
    expect(ids).toContain('short')
    expect(ids).toContain('zero')
    expect(odd.denseSearch([0, 0, 1], 0, 10).map((h) => h.id)).toEqual(['ok'])
  })

  it('零模长查询向量不产生候选', () => {
    expect(index.denseSearch([0, 0, 0], -1, 10)).toEqual([])
  })
})

describe('RetrievalIndex.lexicalSearch', () => {
  const index = new RetrievalIndex([
    leaf({ id: 'a', leafText: 'ERR-4012 表示证书过期', content: 'ERR-4012 表示证书过期' }),
    leaf({ id: 'b', leafText: '打印机卡纸处理', content: '打印机卡纸处理' }),
  ])

  it('编号类查询走词法命中，稠密易漏的也能召回', () => {
    const hits = index.lexicalSearch(tokenize('ERR-4012'), 10)
    expect(hits.map((h) => h.id)).toEqual(['a'])
    expect(hits[0]?.score).toBeGreaterThan(0)
  })

  it('无任何词法命中时返回空（不再让全语料占位排名）', () => {
    expect(index.lexicalSearch(tokenize('不存在的词项zzz'), 10)).toEqual([])
  })

  it('空语料不报错', () => {
    expect(new RetrievalIndex([]).lexicalSearch(tokenize('VPN'), 10)).toEqual([])
  })
})

describe('scopeKeyOf', () => {
  it('管理员共用同一份全量索引', () => {
    expect(scopeKeyOf({ id: 'u1', role: 'admin', department: 'IT' })).toBe(
      scopeKeyOf({ id: 'u2', role: 'admin', department: null }),
    )
  })

  it('普通用户按本人 + 部门区分，不同部门不共用', () => {
    const a = scopeKeyOf({ id: 'u1', role: 'user', department: 'IT' })
    expect(a).toBe(scopeKeyOf({ id: 'u1', role: 'user', department: 'IT' }))
    expect(a).not.toBe(scopeKeyOf({ id: 'u1', role: 'user', department: 'HR' }))
    expect(a).not.toBe(scopeKeyOf({ id: 'u2', role: 'user', department: 'IT' }))
  })
})

describe('RetrievalIndexCache', () => {
  const loader = async () => new RetrievalIndex([leaf()])

  it('同代数同范围复用同一实例，不重复加载', async () => {
    const cache = new RetrievalIndexCache(30_000)
    let loads = 0
    const counting = async () => {
      loads++
      return new RetrievalIndex([leaf()])
    }
    const first = await cache.resolve('u:u1:IT', 0, counting)
    const second = await cache.resolve('u:u1:IT', 0, counting)
    expect(second).toBe(first)
    expect(loads).toBe(1)
  })

  it('代数一变即整体作废（覆盖「上传后立刻检索」不能被旧索引挡住）', async () => {
    const cache = new RetrievalIndexCache(60_000)
    const first = await cache.resolve('u:u1:IT', 0, loader)
    const rebuilt = await cache.resolve('u:u1:IT', 1, loader)
    expect(rebuilt).not.toBe(first)
  })

  it('超过 TTL 后重建（跨进程部署的兜底收敛）', async () => {
    const cache = new RetrievalIndexCache(1000)
    let t = 0
    const first = await cache.resolve('u:u1:IT', 0, loader, () => t)
    t = 999
    expect(await cache.resolve('u:u1:IT', 0, loader, () => t)).toBe(first)
    t = 1001
    expect(await cache.resolve('u:u1:IT', 0, loader, () => t)).not.toBe(first)
  })

  it('超出容量上限时淘汰最久未用的范围', async () => {
    const cache = new RetrievalIndexCache(60_000, 2)
    await cache.resolve('a', 0, loader)
    await cache.resolve('b', 0, loader)
    // 触碰 a，使 b 成为最久未用
    await cache.resolve('a', 0, loader)
    await cache.resolve('c', 0, loader)
    expect(cache.entryCount).toBe(2)
    let loads = 0
    await cache.resolve('a', 0, async () => {
      loads++
      return new RetrievalIndex([leaf()])
    })
    expect(loads).toBe(0)
  })
})
