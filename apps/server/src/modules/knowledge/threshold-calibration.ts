// ===== ragMinScore 定标：从标注分布里量出阈值，而不是拍一个数 =====
//
// 已知的缺陷（离线回归实测）：默认 0.25 挡不住无关查询 —— 负例的稠密分能到 0.36~0.42，
// 而正例只在 0.62~0.82。但换多少必须由**真实语料**说话：拿合成语料定出来的数，
// 换一批文档就作废。所以这里只做两件事 —— 把分布量出来、把取舍摊开给人看，
// 最终改不改、改成多少仍然是人的决定（本模块不写任何配置）。
//
// 门控作用在哪个量上也要说清楚：ragMinScore 比的是**叶子块的稠密余弦分**
// （coarseRank 的门 + 精排不可用时 fallbackRank 的门）。所以定标必须关掉 rerank 去读
// 稠密分 —— 精排开着时最终分数是 bge-reranker 的分（另一套刻度，门是另一个常量），
// 拿它来定 ragMinScore 会定出一个没有意义的数。

export interface ThresholdRow {
  minScore: number
  /** 期望片段仍被放行的比例。低于 1 就是在牺牲召回换清净 */
  positiveRecall: number
  /** 无关查询被正确挡掉的比例 */
  negativeReject: number
  /** 该阈值下平均每条查询会带进上下文的片段数（成本代理：越多越贵、越容易稀释答案） */
  avgHitsPerQuery: number
}

export interface CalibrationInput {
  /** 正例里「期望那篇文档的片段」的稠密分；正例一条都没命中时不进这个数组 */
  positiveScores: number[]
  /** 负例返回的最高稠密分（= 需要被挡掉的东西） */
  negativeScores: number[]
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4

/** 定标扫描的候选阈值网格：0 ~ 0.9，步长 0.05 */
export function defaultGrid(): number[] {
  const grid: number[] = []
  for (let v = 0; v <= 0.9 + 1e-9; v += 0.05) grid.push(round4(v))
  return grid
}

/**
 * 摊开取舍：每个候选阈值下的召回率、负例挡掉率、平均注入片段数。
 * 三个数组按查询对齐（同一下标是同一条查询），缺位用 null 表示「这条没给出该量」。
 */
export function calibrationTable(
  input: CalibrationInput,
  grid: number[] = defaultGrid(),
  perQueryHits: { score: number }[][] = [],
): ThresholdRow[] {
  const { positiveScores, negativeScores } = input
  return grid.map((minScore) => ({
    minScore,
    // 「正例一条都没命中」的查询不该拉低召回率 —— 那是语料缺文档，不是阈值太高
    positiveRecall: rate(positiveScores.filter((s) => s >= minScore).length, positiveScores.length),
    negativeReject: rate(negativeScores.filter((s) => s < minScore).length, negativeScores.length),
    avgHitsPerQuery:
      perQueryHits.length === 0
        ? 0
        : round4(
            perQueryHits.reduce(
              (sum, hits) => sum + hits.filter((h) => h.score >= minScore).length,
              0,
            ) / perQueryHits.length,
          ),
  }))
}

const rate = (n: number, d: number) => (d === 0 ? 1 : round4(n / d))

export interface ThresholdRecommendation {
  kind: 'recommend'
  minScore: number
  /** 观测到的分离区间：[负例最高分, 正例最低分]。两者之间才是要放阈值的地方 */
  gap: { maxNegative: number; minPositive: number }
  rationale: string
}

/** 定不出来的两种情况：样本太薄（数出来也没意义）、正负例重叠（门买不到东西） */
export interface ThresholdInsufficient {
  kind: 'insufficient'
  reason: string
  positives: number
  negatives: number
}

export type CalibrationVerdict = ThresholdRecommendation | ThresholdInsufficient

/**
 * 下结论所需的最小样本量。低于这个数就不给数字 —— 3 条标注量出来的"中点"
 * 换一批文档就作废，而它会被人当成量出来的结论抄进 env。
 * 阈值是全局生效的，宁可说"再去标几条"。
 */
export const MIN_SAMPLES = { positives: 5, negatives: 3 }

/**
 * 建议值：在「正例召回不低于 minRecall」的前提下，取能挡掉最多负例的那一档；
 * 并列时取更低的那个阈值（对没见过的查询更宽容）。
 * 观测到正负例完全可分时，直接给分离区间的中点 —— 比踩着边界更抗语料漂移。
 */
export function recommendThreshold(
  input: CalibrationInput,
  opts: { minRecall?: number; minSamples?: { positives: number; negatives: number } } = {},
): CalibrationVerdict {
  const { positiveScores, negativeScores } = input
  const minRecall = opts.minRecall ?? 1
  const need = opts.minSamples ?? MIN_SAMPLES

  if (positiveScores.length < need.positives || negativeScores.length < need.negatives) {
    return {
      kind: 'insufficient',
      reason:
        `样本不足：正例 ${positiveScores.length} 条（需 ≥${need.positives}）、` +
        `负例 ${negativeScores.length} 条（需 ≥${need.negatives}）。` +
        '代价表已经打出来了，可以据此判断方向，但别把这份数据量出的数写进配置。',
      positives: positiveScores.length,
      negatives: negativeScores.length,
    }
  }
  const maxNegative = Math.max(...negativeScores)
  const minPositive = Math.min(...positiveScores)

  const rows = calibrationTable(input)
  const eligible = rows.filter((r) => r.positiveRecall >= minRecall)
  if (eligible.length === 0) {
    return {
      kind: 'insufficient',
      reason: `没有任何阈值能满足正例召回 ${(minRecall * 100).toFixed(0)}%，先放宽召回要求或检查语料。`,
      positives: positiveScores.length,
      negatives: negativeScores.length,
    }
  }
  const bestReject = Math.max(...eligible.map((r) => r.negativeReject))
  // 保住召回就一个负例都挡不掉 → 稠密分这一路分不开它们，给个数字反而是假结论
  if (bestReject === 0) {
    return {
      kind: 'insufficient',
      reason:
        `正负例区间重叠（负例最高 ${round4(maxNegative)} ≥ 正例最低 ${round4(minPositive)}）：` +
        '任何能挡住负例的阈值都会先杀掉正例。该补标注或改走精排，而不是挑一个数。',
      positives: positiveScores.length,
      negatives: negativeScores.length,
    }
  }
  const candidates = eligible.filter((r) => r.negativeReject === bestReject)
  const onGrid = candidates.reduce((a, b) => (a.minScore <= b.minScore ? a : b))

  // 可分时取中点：网格只用来给出「代价多大」，真正的建议值踩着网格边界最脆
  const separated = minPositive > maxNegative
  const picked = separated
    ? clampToRange(round4((maxNegative + minPositive) / 2), 0, 1)
    : onGrid.minScore

  return {
    kind: 'recommend',
    minScore: picked,
    gap: { maxNegative: round4(maxNegative), minPositive: round4(minPositive) },
    rationale: separated
      ? `正负例可分：负例最高 ${round4(maxNegative)}，正例最低 ${round4(minPositive)}，取中点。` +
        `该阈值下正例召回 ${(onGrid.positiveRecall * 100).toFixed(1)}%、` +
        `负例挡掉 ${(bestReject * 100).toFixed(1)}%`
      : `保住 ${(minRecall * 100).toFixed(0)}% 召回的前提下最多挡掉 ${(bestReject * 100).toFixed(1)}% 负例，` +
        `建议 ${onGrid.minScore}（区间有重叠，这是带代价的折中）`,
  }
}

const clampToRange = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)

export interface LabeledProbe {
  query: string
  expectedDocs: string[]
  /** 该查询在「门全开 + 关精排」下返回的片段，按分数从高到低 */
  hits: { documentName: string; score: number }[]
}

/**
 * 把探针结果收成定标输入。规则里有两个容易搞错的地方，所以单独抽出来测：
 * - 正例取的是**期望那篇文档**的分数，不是 Top-1 的分数 —— 排第二的期望片段分数才是
 *   门必须放过的那个值，拿 Top-1 会系统性定高阈值
 * - 期望文档压根没进 Top-K 时不计入分布：那是语料缺文档/切块问题，算进正例会被
 *   误读成「阈值太高」，算进负例更是错上加错
 */
export function toCalibrationInput(labeled: LabeledProbe[]): {
  input: CalibrationInput
  positiveMiss: number
} {
  const positiveScores: number[] = []
  const negativeScores: number[] = []
  let positiveMiss = 0

  for (const item of labeled) {
    const top = item.hits[0]
    if (item.expectedDocs.length === 0) {
      if (top) negativeScores.push(top.score)
      continue
    }
    const expected = item.hits.find((h) => item.expectedDocs.includes(h.documentName))
    if (expected) positiveScores.push(expected.score)
    else positiveMiss++
  }
  return { input: { positiveScores, negativeScores }, positiveMiss }
}
