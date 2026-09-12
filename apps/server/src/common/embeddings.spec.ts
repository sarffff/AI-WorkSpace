import { cosineSimilarity } from './embeddings'

// 行为依据（与实现一致）：
// - 维度不一致或任一向量为空/零模长 → 0
// - 同向 = 1、正交 = 0、反向 < 0，且与模长无关（按方向归一）

describe('cosineSimilarity', () => {
  it('相同向量为 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10)
  })

  it('正交向量为 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('反向向量为负', () => {
    expect(cosineSimilarity([-1, 0], [1, 0])).toBeCloseTo(-1, 10)
  })

  it('同向但模长不同的向量仍为 1', () => {
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1, 10)
  })

  it('空向量或维度不一致返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([1], [1, 1])).toBe(0)
  })

  it('零向量（零模长）返回 0', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0)
  })
})
