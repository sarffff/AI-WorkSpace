import { chunkDocument, type ChunkConfig } from './chunking'

// 行为依据（与实现一致）：
// - markdown 按标题维护章节路径（"VPN 排查 > 连接失败"），父块归属其起始章节
// - 父块为段落聚合，目标 ~parentSize；仅当单块超过 parentSize*2 时才按句重切
// - 叶子块由父块切出：父块 ≤ leafSize 时直接整体成为 1 个叶子，否则按 leafSize/leafOverlap 切分
// - @langchain/textsplitters 在 keepSeparator: true 下以 '' 连接分片，故切出的块长度 ≤ 配置上限

const MD_DOC = [
  '# VPN 排查',
  '',
  '## 连接失败',
  '',
  '无法连接公司 VPN，错误码 ERR-4012。请检查网络设置、证书与账号状态，必要时重置网络配置并重启终端。',
  '',
  '## 速度慢',
  '',
  '连接成功后访问内网系统速度非常慢，页面加载超过十秒，影响日常办公效率。',
  '',
  '## 频繁掉线',
  '',
  '连接每隔几分钟就自动断开，需要反复重新连接才能恢复。检查日志发现是网关超时导致，尝试更换接入点并更新驱动后仍复现，已联系网络管理员排查。',
].join('\n')

const MD_CONFIG: ChunkConfig = { parentSize: 60, parentOverlap: 10, leafSize: 30, leafOverlap: 10 }

// 300 个无标点汉字：任何前置分隔符都不命中，最终按单字切分，
// 父块/叶子块的尺寸与 overlap 因此完全确定，便于精确断言
const PLAIN_TEXT = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('')

const PLAIN_CONFIG: ChunkConfig = {
  parentSize: 100,
  parentOverlap: 0,
  leafSize: 40,
  leafOverlap: 10,
}

describe('chunkDocument', () => {
  it('markdown 文档生成带章节路径的父块与叶子块', async () => {
    const { parents, leaves } = await chunkDocument(MD_DOC, 'md', MD_CONFIG)

    expect(parents).toHaveLength(3)
    expect(parents.map((p) => p.sectionPath)).toEqual([
      'VPN 排查 > 连接失败',
      'VPN 排查 > 速度慢',
      'VPN 排查 > 频繁掉线',
    ])
    // 叶子数不少于父块数，且至少有父块被进一步切分（Small-to-Big 检索粒度）
    expect(leaves.length).toBeGreaterThanOrEqual(parents.length + 3)
  })

  it('叶子块的 parentIndex 正确映射且内容包含于父块', async () => {
    const { parents, leaves } = await chunkDocument(MD_DOC, 'md', MD_CONFIG)

    for (const leaf of leaves) {
      expect(leaf.parentIndex).toBeGreaterThanOrEqual(0)
      expect(leaf.parentIndex).toBeLessThan(parents.length)
      // 叶子是父块内容的连续切片
      expect(parents[leaf.parentIndex].content).toContain(leaf.content)
    }
    // 最长的「频繁掉线」章节（parentIndex=2）应被切成多个叶子
    const fromLast = leaves.filter((l) => l.parentIndex === 2)
    expect(fromLast.length).toBeGreaterThanOrEqual(2)
  })

  it('块尺寸不超过配置上限', async () => {
    const { parents, leaves } = await chunkDocument(MD_DOC, 'md', MD_CONFIG)

    for (const leaf of leaves) {
      expect(leaf.content.length).toBeLessThanOrEqual(MD_CONFIG.leafSize)
    }
    // 实现约定：父块仅在超过 parentSize*2 时才按句重切
    for (const p of parents) {
      expect(p.content.length).toBeLessThanOrEqual(MD_CONFIG.parentSize * 2)
    }
  })

  it('无标点长文本按 leafSize 精确切分且相邻叶子有 leafOverlap 重叠', async () => {
    const { parents, leaves } = await chunkDocument(PLAIN_TEXT, 'txt', PLAIN_CONFIG)

    // 300 字 > 100*2，先切成 3 个 100 字父块（parentOverlap=0 → 连续窗口）
    expect(parents).toHaveLength(3)
    for (const p of parents) {
      expect(p.content).toHaveLength(PLAIN_CONFIG.parentSize)
      expect(p.sectionPath).toBeNull()
    }
    // 每个父块（100 字）切成 [0..39]/[30..69]/[60..99] 三个 40 字叶子
    expect(leaves).toHaveLength(9)
    for (let i = 0; i < leaves.length; i++) {
      expect(leaves[i].parentIndex).toBe(Math.floor(i / 3))
      expect(leaves[i].content).toHaveLength(PLAIN_CONFIG.leafSize)
      expect(parents[leaves[i].parentIndex].content).toContain(leaves[i].content)
    }
    // overlap 生效：同一父块内相邻叶子的开头 = 前一叶子的末尾 leafOverlap 字
    for (let i = 1; i < leaves.length; i++) {
      if (leaves[i].parentIndex === leaves[i - 1].parentIndex) {
        expect(
          leaves[i].content.startsWith(leaves[i - 1].content.slice(-PLAIN_CONFIG.leafOverlap)),
        ).toBe(true)
      }
    }
  })

  it('非 markdown 扩展名按空行分段（章节路径为 null）', async () => {
    const text = '第一段内容\n\n第二段内容\n\n第三段内容'
    const { parents, leaves } = await chunkDocument(text, 'txt', {
      parentSize: 1000,
      parentOverlap: 0,
      leafSize: 1000,
      leafOverlap: 0,
    })

    // 三段聚合进同一父块（总长 < parentSize），叶子即父块本身
    expect(parents).toHaveLength(1)
    expect(parents[0].sectionPath).toBeNull()
    expect(leaves).toHaveLength(1)
    expect(leaves[0].parentIndex).toBe(0)
    expect(leaves[0].content).toBe('第一段内容\n\n第二段内容\n\n第三段内容')
  })
})
