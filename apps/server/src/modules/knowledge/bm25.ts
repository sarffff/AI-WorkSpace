// 轻量 BM25 实现：本地稀疏检索，与稠密向量做 RRF 融合（无外部依赖，离线可复现）。
// 中文不做分词（避免引入 jieba 等重依赖），采用「拉丁词/数字 + 中文双字组」近似词项：
// 对 IT 编号（ERR-4012）、专有名词（VPN/SLM）等稠密检索易漏的查询，词法匹配更可靠。

// 词项化：拉丁词/数字（含 -_. 连字符）转小写 + 中文连续段切成双字组
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9_.\-]*/g)) {
    tokens.push(m[0].toLowerCase())
  }
  for (const m of text.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]+/g)) {
    const run = m[0]
    if (run.length === 1) tokens.push(run)
    else for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

export class BM25 {
  private static readonly K1 = 1.5
  private static readonly B = 0.75

  private readonly docCount: number
  private readonly lengths: number[]
  private readonly avgdl: number

  // 倒排表：词项 → 扁平交替存储的 [文档下标, 该词在该文档中的词频]。
  // 此前逐查询词遍历全部文档的 token 数组打分，复杂度为 O(查询词数 × 语料 token 总数)，
  // 万级语料下每次检索都要重复这笔开销；倒排表让它只落在真正含该词的文档上。
  // 每个词项在同一文档只出现一条记录，故 df 即该 posting 列表的长度 / 2。
  private readonly postings = new Map<string, number[]>()

  constructor(docs: string[][]) {
    this.docCount = docs.length
    this.lengths = docs.map((doc) => doc.length)
    const totalLen = this.lengths.reduce((sum, len) => sum + len, 0)
    this.avgdl = docs.length > 0 ? totalLen / docs.length : 0

    for (let i = 0; i < docs.length; i++) {
      // 先聚合本文档词频：df 的语义是「是否包含」，同词多次出现只计一次
      const tf = new Map<string, number>()
      for (const t of docs[i]) tf.set(t, (tf.get(t) ?? 0) + 1)
      for (const [term, freq] of tf) {
        let list = this.postings.get(term)
        if (!list) {
          list = []
          this.postings.set(term, list)
        }
        list.push(i, freq)
      }
    }
  }

  // 返回与 docs 对齐的 BM25 分数数组
  score(queryTokens: string[]): number[] {
    const out = new Array<number>(this.docCount).fill(0)
    for (const q of queryTokens) {
      const list = this.postings.get(q)
      if (!list) continue
      const df = list.length / 2
      const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5))
      for (let k = 0; k < list.length; k += 2) {
        const docIndex = list[k]
        const f = list[k + 1]
        const denom = f + BM25.K1 * (1 - BM25.B + BM25.B * (this.lengths[docIndex] / this.avgdl))
        out[docIndex] += idf * ((f * (BM25.K1 + 1)) / denom)
      }
    }
    return out
  }
}
