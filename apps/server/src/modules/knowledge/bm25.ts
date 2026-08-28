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

  private readonly docs: string[][]
  private readonly avgdl: number
  private readonly df = new Map<string, number>()

  constructor(docs: string[][]) {
    this.docs = docs
    const totalLen = docs.reduce((sum, doc) => sum + doc.length, 0)
    this.avgdl = docs.length > 0 ? totalLen / docs.length : 0
    // 文档频率按「是否包含」计数（BM25 的 df 语义）
    const seen = new Set<string>()
    for (const doc of docs) {
      seen.clear()
      for (const t of doc) {
        if (!seen.has(t)) {
          seen.add(t)
          this.df.set(t, (this.df.get(t) ?? 0) + 1)
        }
      }
    }
  }

  // 返回与 docs 对齐的 BM25 分数数组
  score(queryTokens: string[]): number[] {
    const n = this.docs.length
    const out = new Array<number>(n).fill(0)
    if (n === 0) return out
    for (const q of queryTokens) {
      const df = this.df.get(q) ?? 0
      if (df === 0) continue
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
      for (let i = 0; i < n; i++) {
        let f = 0
        for (const t of this.docs[i]) if (t === q) f++
        if (f === 0) continue
        const dl = this.docs[i].length
        const denom = f + BM25.K1 * (1 - BM25.B + BM25.B * (dl / this.avgdl))
        out[i] += idf * ((f * (BM25.K1 + 1)) / denom)
      }
    }
    return out
  }
}
