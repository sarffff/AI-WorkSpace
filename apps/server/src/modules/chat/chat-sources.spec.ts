import type { RagHit } from '@/modules/knowledge/knowledge.service'
import { sourceKey } from './chat.service'

// 行为依据（与实现一致）：
// 引用片段的身份 = 文档 + 章节 + 正文前缀。
// 同一父块被多轮检索命中 → 键相同 → 折叠（此前重复 push，引用面板出现重复条目、
// [n] 脚注编号与实际片段错位）；同章节的不同父块 → 正文不同 → 各占一条。

const hit = (over: Partial<RagHit> = {}): RagHit => ({
  content: 'VPN 连接失败时请先确认账号未被锁定。',
  score: 0.81,
  documentId: 'doc-1',
  documentName: 'vpn.md',
  sectionPath: 'VPN 排查 > 连接失败',
  ...over,
})

describe('sourceKey', () => {
  it('同一父块重复命中（分数变化也不影响身份）折叠为一条', () => {
    expect(sourceKey(hit())).toBe(sourceKey(hit({ score: 0.42 })))
  })

  it('同文档同章节的不同父块保留为两条', () => {
    expect(sourceKey(hit({ content: '第一段正文' }))).not.toBe(
      sourceKey(hit({ content: '第二段正文' })),
    )
  })

  it('不同文档、不同章节都算不同片段', () => {
    expect(sourceKey(hit())).not.toBe(sourceKey(hit({ documentId: 'doc-2' })))
    expect(sourceKey(hit())).not.toBe(sourceKey(hit({ sectionPath: 'VPN 排查 > 证书过期' })))
  })

  it('章节缺失（旧版单级块）与空串归一，不会一会被折叠一会被拆开', () => {
    expect(sourceKey(hit({ sectionPath: null }))).toBe(sourceKey(hit({ sectionPath: undefined })))
    expect(sourceKey(hit({ sectionPath: null }))).not.toBe(sourceKey(hit()))
  })

  it('正文差异出现在前缀之后仍视为同一块（200 字窗口，避免长文本整段进键）', () => {
    const head = 'x'.repeat(210)
    expect(sourceKey(hit({ content: head + 'A' }))).toBe(sourceKey(hit({ content: head + 'B' })))
  })
})
