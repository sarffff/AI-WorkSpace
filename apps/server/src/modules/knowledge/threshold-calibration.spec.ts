import {
  calibrationTable,
  defaultGrid,
  recommendThreshold,
  toCalibrationInput,
  type CalibrationInput,
} from './threshold-calibration'

// 行为依据（与实现一致）：
// - 正负例可分时建议取分离区间中点，而不是踩着某一条观测值的边界
// - 保住召回就一个负例都挡不掉 → 判定为「定不出来」，返回 null 而不是给个假数
// - 「正例本身没命中」的查询不拉低召回率（那是语料缺文档，不是阈值太高）
// - minRecall 放宽后才谈得上牺牲召回：默认要求正例召回 100%

const input = (over: Partial<CalibrationInput> = {}): CalibrationInput => ({
  positiveScores: [0.62, 0.75, 0.82],
  negativeScores: [0.36, 0.415],
  ...over,
})

describe('calibrationTable', () => {
  it('网格覆盖 0 ~ 0.9，步长 0.05', () => {
    const grid = defaultGrid()
    expect(grid[0]).toBe(0)
    expect(grid[grid.length - 1]).toBe(0.9)
    expect(grid).toHaveLength(19)
  })

  it('阈值升高：召回单调不升、负例挡掉率单调不降', () => {
    const rows = calibrationTable(input())
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].positiveRecall).toBeLessThanOrEqual(rows[i - 1].positiveRecall)
      expect(rows[i].negativeReject).toBeGreaterThanOrEqual(rows[i - 1].negativeReject)
    }
  })

  it('阈值 0 不挡任何东西；高于全部观测值则全挡', () => {
    const rows = calibrationTable(input())
    expect(rows[0]).toMatchObject({ minScore: 0, positiveRecall: 1, negativeReject: 0 })
    const top = rows[rows.length - 1]
    expect(top.positiveRecall).toBe(0)
    expect(top.negativeReject).toBe(1)
  })

  it('平均注入片段数随阈值下降：这就是阈值的成本口径', () => {
    const perQuery = [[{ score: 0.9 }, { score: 0.5 }, { score: 0.2 }], [{ score: 0.7 }]]
    const rows = calibrationTable(input(), defaultGrid(), perQuery)
    const at0 = rows.find((r) => r.minScore === 0)!
    const at06 = rows.find((r) => r.minScore === 0.6)!
    expect(at0.avgHitsPerQuery).toBe(2) // (3 + 1) / 2
    expect(at06.avgHitsPerQuery).toBe(1) // (2 + 1) / 2
  })
})

describe('toCalibrationInput', () => {
  const hit = (documentName: string, score: number) => ({ documentName, score })

  it('正例取期望文档的分，不是 Top-1 的分', () => {
    // 期望文档排第二：门必须放过的是 0.62 而不是 0.88，否则定出来的阈值会误杀它
    const { input } = toCalibrationInput([
      {
        query: 'vpn',
        expectedDocs: ['vpn.md'],
        hits: [hit('misc.md', 0.88), hit('vpn.md', 0.62), hit('misc2.md', 0.4)],
      },
    ])
    expect(input.positiveScores).toEqual([0.62])
    expect(input.negativeScores).toEqual([])
  })

  it('负例取它返回的最高分（= 必须被挡掉的那个值）', () => {
    const { input } = toCalibrationInput([
      { query: '量子纠缠', expectedDocs: [], hits: [hit('vpn.md', 0.41), hit('hr.md', 0.2)] },
    ])
    expect(input.negativeScores).toEqual([0.41])
    expect(input.positiveScores).toEqual([])
  })

  it('期望文档没进 Top-K：不进任何分布，单独计数', () => {
    const { input, positiveMiss } = toCalibrationInput([
      { query: '报销', expectedDocs: ['hr.md'], hits: [hit('vpn.md', 0.7)] },
    ])
    expect(positiveMiss).toBe(1)
    expect(input.positiveScores).toEqual([])
    // 也绝不能被当成负例 —— 它是"该命中而没命中"，不是"该挡住"
    expect(input.negativeScores).toEqual([])
  })

  it('负例毫无命中：不贡献观测值（本来就挡得住，不该拉低建议阈值）', () => {
    const { input } = toCalibrationInput([{ query: 'x', expectedDocs: [], hits: [] }])
    expect(input.negativeScores).toEqual([])
  })

  it('期望文档按集合匹配（一篇查询可有多个可接受来源）', () => {
    const { input } = toCalibrationInput([
      {
        query: '账号',
        expectedDocs: ['a.md', 'b.md'],
        hits: [hit('x.md', 0.9), hit('b.md', 0.55)],
      },
    ])
    expect(input.positiveScores).toEqual([0.55])
  })
})

describe('recommendThreshold', () => {
  // 满足 MIN_SAMPLES（正例 ≥5、负例 ≥3）的一组分得开的观测值
  const separated = () => ({
    positiveScores: [0.62, 0.75, 0.82, 0.66, 0.71],
    negativeScores: [0.36, 0.415, 0.3],
  })
  // 正例里掺了一条比负例还低的：稠密分这一路分不开
  const overlapped = () => ({
    positiveScores: [0.3, 0.9, 0.85, 0.8, 0.95],
    negativeScores: [0.5, 0.55, 0.45],
  })

  it('可分时取分离区间中点', () => {
    const rec = recommendThreshold(separated())
    if (rec.kind !== 'recommend') throw new Error(`应为 recommend，实为 ${rec.kind}`)
    // 负例最高 0.415、正例最低 0.62 → 中点 0.5175
    expect(rec.minScore).toBe(0.5175)
    expect(rec.gap).toEqual({ maxNegative: 0.415, minPositive: 0.62 })
    expect(rec.rationale).toContain('正负例可分')
    expect(rec.rationale).toContain('100.0%')
  })

  it('样本太薄就拒绝给数：3 条标注量出来的中点会被当结论抄进 env', () => {
    const rec = recommendThreshold(input())
    if (rec.kind !== 'insufficient') throw new Error(`应为 insufficient，实为 ${rec.kind}`)
    expect(rec.reason).toContain('样本不足')
    expect(rec).toMatchObject({ positives: 3, negatives: 2 })
  })

  it('保住召回就挡不掉负例：判为重叠，不给假数', () => {
    const rec = recommendThreshold(overlapped())
    if (rec.kind !== 'insufficient') throw new Error(`应为 insufficient，实为 ${rec.kind}`)
    expect(rec.reason).toContain('重叠')
  })

  it('放宽 minRecall 后才给出带代价的折中', () => {
    const rec = recommendThreshold(overlapped(), { minRecall: 0.8 })
    if (rec.kind !== 'recommend') throw new Error(`应为 recommend，实为 ${rec.kind}`)
    // 挡掉全部负例要 >0.55，那样正例只剩 4/5；满足 0.8 召回时最多挡掉 2/3
    expect(rec.minScore).toBeGreaterThan(0.5)
    expect(rec.minScore).toBeLessThanOrEqual(0.8)
    expect(rec.rationale).toContain('带代价的折中')
  })

  it('空数据集：判样本不足，而不是算出 NaN', () => {
    const rec = recommendThreshold({ positiveScores: [], negativeScores: [] })
    expect(rec.kind).toBe('insufficient')
  })

  it('建议值不会跑到观测区间外面去', () => {
    const rec = recommendThreshold(separated())
    if (rec.kind !== 'recommend') throw new Error(`应为 recommend，实为 ${rec.kind}`)
    expect(rec.minScore).toBeGreaterThan(0.415)
    expect(rec.minScore).toBeLessThan(0.62)
  })
})
