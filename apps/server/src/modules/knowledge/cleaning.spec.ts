import { cleanText, detectMojibake } from './cleaning'

// 行为依据（与实现一致）：
// - 页码/页脚噪声行（"第 3 页"/"Page 2 of 5"/"- 7 -"/裸数字行）整行移除
// - 相邻完全重复行折叠为一行；代码围栏内保持原样
// - HTML/XML 剥标签并解码常见实体，script/style 内容整体移除
// - 密钥/身份证脱敏（检索片段会随上下文发给外部 LLM）
// - 空白归一：折叠连续空格、统一换行，多余空行压成单个空行

describe('cleanText', () => {
  it('空字符串原样返回', () => {
    expect(cleanText('', 'txt')).toBe('')
  })

  it('移除页码/页脚噪声行', () => {
    expect(cleanText('标题\n第 3 页\n正文内容', 'txt')).toBe('标题\n\n正文内容')
    expect(cleanText('A\nPage 2 of 5\nB', 'txt')).toBe('A\n\nB')
    expect(cleanText('前文\n- 7 -\n后文', 'txt')).toBe('前文\n\n后文')
    // 单独成行的数字（页码样式）同样移除
    expect(cleanText('前文\n12\n后文', 'txt')).toBe('前文\n\n后文')
  })

  it('折叠相邻重复行（PDF/复制渲染伪影）', () => {
    expect(cleanText('VPN 设置\nVPN 设置\n\n下一步', 'txt')).toBe('VPN 设置\n\n下一步')
    // 不相邻的相同行不折叠
    expect(cleanText('A\nB\nA', 'txt')).toBe('A\nB\nA')
  })

  it('代码围栏内的重复行保持原样', () => {
    const code = '```\nx\nx\n```'
    expect(cleanText(code, 'txt')).toBe(code)
  })

  it('空白归一：统一 CRLF、折叠连续空格与多余空行', () => {
    expect(cleanText('a\r\nb', 'txt')).toBe('a\nb')
    expect(cleanText('a  \t b', 'txt')).toBe('a b')
    expect(cleanText('a\n\n\n\nb', 'txt')).toBe('a\n\nb')
  })

  it('html 扩展名剥标签、移除 script、解码实体', () => {
    expect(cleanText('<div>你好<strong>世界</strong></div>', 'html').trim()).toBe('你好 世界')
    expect(cleanText('<script>var a=1;</script>可见内容', 'html').trim()).toBe('可见内容')
    expect(cleanText('&amp;&lt;tag&gt;', 'html').trim()).toBe('&<tag>')
    // 非 html 扩展名不剥标签（txt 等格式标签可能是正文）
    expect(cleanText('<b>加粗</b>', 'txt')).toBe('<b>加粗</b>')
  })

  it('脱敏 API Key / sk- 令牌 / 身份证', () => {
    expect(cleanText('api_key: abc123def', 'txt')).toBe('api_key: ***')
    expect(cleanText('令牌 sk-abcdefghijklmnop1234', 'txt')).toBe('令牌 sk-***')
    expect(cleanText('身份证 110101199003077758', 'txt')).toBe('身份证 110101********7758')
  })
})

describe('detectMojibake', () => {
  it('正常中文文本返回 null', () => {
    expect(detectMojibake('这是一段正常的中文文本。')).toBeNull()
    expect(detectMojibake('')).toBeNull()
  })

  it('识别「锟斤拷」典型 GBK 乱码标记', () => {
    expect(detectMojibake('锟斤拷锟斤拷')).toContain('锟斤拷')
  })

  it('替换符占比超过阈值时告警', () => {
    const result = detectMojibake('a\uFFFD\uFFFD')
    expect(result).not.toBeNull()
    expect(result).toContain('替换符')
  })

  it('替换符占比极低时不误报', () => {
    const text = 'x'.repeat(1000) + '\uFFFD'
    expect(detectMojibake(text)).toBeNull()
  })
})
