// 索引前数据清洗（抽取 → 清洗 → 切块）：
// 目的：进入向量与 LLM 上下文的文本必须干净——脏文本会污染余弦相似度、
// 挤占 Top-K 槽位与 token 预算，且检索片段会随 prompt 发送给外部 LLM，密钥会泄露。
// 1) 控制字符/BOM/行尾归一 → 消除嵌入噪声（按 token 计费，垃圾字符是纯浪费）
// 2) 页码/页眉页脚去噪 → PDF 每页重复出现，产生大量近重复块稀释检索槽位
// 3) 相邻重复行折叠 → 清除 PDF/复制渲染伪影；代码围栏内保持原样
// 4) HTML/XML 剥标签 → 标签文本原样嵌入语义极差，script/style 一并移除
// 5) 密钥/身份证脱敏 → 防止随上下文泄露给 LLM（邮箱/电话是知识内容，保留）
// 6) 乱码标记检测 → 编码错误时提前告警，避免垃圾向量入库

// 页码/页脚噪声行：单独成行的 "第 3 页" / "Page 12" / "Page 2 of 5" / "- 7 -" / "12"
const PAGE_NOISE =
  /^\s*(第\s*[0-9一二三四五六七八九十百千]+\s*页|page\s*\d+\s*(of\s*\d+|\/\s*\d+)?|-?\s*\d+\s*-?)\s*$/i

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export function cleanText(text: string, ext: string): string {
  if (!text) return text
  let out = text.replace(/^\uFEFF/, '') // BOM
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // 控制字符
  if (ext === 'html' || ext === 'xml' || ext === 'htm') {
    out = stripTags(out)
  }
  out = transformLinesOutsideCode(out, (line) => (PAGE_NOISE.test(line.trim()) ? '' : line))
  out = collapseDuplicateLines(out)
  out = maskSecrets(out)
  return normalizeWhitespace(out)
}

// 仅在代码围栏外做行级变换（代码块内的重复行/特殊行是合法内容）
function transformLinesOutsideCode(text: string, fn: (line: string) => string): string {
  let inFence = false
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
      return inFence ? line : fn(line)
    })
    .join('\n')
}

// 相邻完全重复的行折叠为一行（PDF/复制渲染伪影；代码块跳过）
function collapseDuplicateLines(text: string): string {
  let prev = ''
  return transformLinesOutsideCode(text, (line) => {
    const t = line.trim()
    if (t && t === prev) return ''
    prev = t
    return line
  })
}

// 剥离 HTML/XML 标签与 script/style 内容，解码常见实体
function stripTags(html: string): string {
  return html
    .replace(/<(script|style|template|noscript)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+);/g, (m, name: string) =>
      name.startsWith('#')
        ? String.fromCodePoint(parseInt(name.slice(1), 10)) || m
        : (HTML_ENTITIES[name] ?? m),
    )
}

// 明文密钥/令牌/身份证脱敏（检索片段会随上下文发给外部 LLM）
function maskSecrets(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[私钥已脱敏]',
    )
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, 'sk-***')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[JWT已脱敏]')
    .replace(/\b\d{17}[\dXx]\b/g, (m) => `${m.slice(0, 6)}********${m.slice(14)}`)
    .replace(/((?:api[_-]?key|apikey|token|secret|password|passwd)\s*[:=]\s*)[^\s,;]+/gi, '$1***')
}

// 空白归一：统一行尾、折叠连续空格与多余空行（保留段落结构，空行即段落边界）
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

// 乱码标记检测：返回说明或 null（供日志告警，不阻断索引）
export function detectMojibake(text: string): string | null {
  if (!text) return null
  const fffd = (text.match(/\uFFFD/g) || []).length
  if (fffd / text.length > 0.01) {
    return `包含 ${fffd} 个替换符(U+FFFD)，疑似编码错误（已尝试 GBK 回退解码）`
  }
  if (text.includes('锟斤拷')) return '包含「锟斤拷」典型 GBK 乱码标记'
  return null
}
