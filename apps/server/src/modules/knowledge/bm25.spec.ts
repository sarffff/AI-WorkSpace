import { BM25, tokenize } from './bm25'

// 行为依据（与实现一致）：
// - 拉丁词/数字（含 -_. 连字符）转小写整体成词
// - 中文连续段不引入分词器，切成双字组（单字段保留单字）
// - BM25 按「是否包含」计 df，返回与文档对齐的分数数组

describe('tokenize', () => {
  it('拉丁词与数字整体成词并转小写', () => {
    expect(tokenize('Hello World 123')).toEqual(['hello', 'world', '123'])
  })

  it('含连字符/下划线的专有名词保持整体（如 IT 编号）', () => {
    expect(tokenize('VPN-SLM_v2.0')).toEqual(['vpn-slm_v2.0'])
  })

  it('中文连续段切成双字组', () => {
    expect(tokenize('VPN连接失败')).toEqual(['vpn', '连接', '接失', '失败'])
    expect(tokenize('中文分词测试')).toEqual(['中文', '文分', '分词', '词测', '测试'])
  })

  it('单个汉字保留单字', () => {
    expect(tokenize('测')).toEqual(['测'])
  })

  it('空文本返回空数组', () => {
    expect(tokenize('')).toEqual([])
  })
})

describe('BM25', () => {
  const docs = [tokenize('VPN 连接失败'), tokenize('打印机 卡纸'), tokenize('VPN 连接')]
  const bm25 = new BM25(docs)

  it('相关文档得分高于不相关文档，缺失词项文档为 0', () => {
    const scores = bm25.score(tokenize('VPN 连接'))

    expect(scores[1]).toBe(0) // 打印机文档不含任何查询词项
    // 两篇相关文档中更短（词项更集中）的得分更高
    expect(scores[2]).toBeGreaterThan(scores[0])
    expect(scores[0]).toBeGreaterThan(0)
  })

  it('查询词项完全未出现时全为 0', () => {
    expect(new BM25([['a'], ['b']]).score(['zzz'])).toEqual([0, 0])
  })

  it('空查询/空文档边界', () => {
    expect(bm25.score([])).toEqual([0, 0, 0])
    expect(new BM25([]).score(['a'])).toEqual([])
  })

  it('同一查询在不同文档集上得分可复现（确定性）', () => {
    const again = new BM25(docs)
    expect(again.score(tokenize('VPN 连接'))).toEqual(bm25.score(tokenize('VPN 连接')))
  })
})
