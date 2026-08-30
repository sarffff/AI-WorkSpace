/**
 * Agent 端到端评测脚本：评测 Agent 的工具决策行为 ——
 * 该检索时是否检索（search_knowledge）、该建单时是否建单（create_ticket）、
 * 问工单状态时是否查工单（lookup_my_tickets / get_ticket）、是否编造引用。
 *
 * 走 ChatService.evalToolDecision（无副作用评测入口）：create_ticket 仅记录建单意图、
 * 不真正建单，检索/查工单为纯读 —— 不会污染线上数据；评测视角与线上一致
 * （同人设/工具注册表/模型降级链/行级权限）。
 *
 * 用法（在 apps/server 下）：
 *   pnpm eval:agent
 *   EVAL_USER_EMAIL=default@example.com pnpm eval:agent   # 指定评测视角（默认管理员）
 *
 * 数据集：scripts/eval-agent-dataset.json
 *   [{ "query": "...", "expectSearch": bool, "expectTicket": bool,
 *      "expectTicketLookup": bool, "expectedDocs": ["文档名"], "note"?: "..." }]
 *   expectedDocs 为文档名数组，sources 中任一 documentName 命中即算检索命中；
 *   expectedDocs 为空数组表示期望「无知识库命中」（负例，sources 应为空、不编造引用）。
 *   当前数据集为示例数据，文档名为占位示例，真实使用请替换为实际知识库文档名。
 *
 * 注意：本脚本随 src 一起由 nest build 编译为 CJS 后用 node 执行，
 * 不走 tsx —— tsx 的 ESM/CJS 混合加载会把 @nestjs/* 拆成双实例导致 DI 失效。
 */
import { NestFactory } from '@nestjs/core'
import { readFile } from 'fs/promises'
import * as path from 'path'
import { AppModule } from '../app.module'
import { ChatService } from '../modules/chat/chat.service'
import { PrismaService } from '../prisma/prisma.service'

interface EvalEntry {
  query: string
  expectSearch: boolean
  expectTicket: boolean
  expectTicketLookup: boolean
  expectedDocs: string[]
  note?: string
}

interface EntryResult {
  entry: EvalEntry
  toolCalls: string[]
  searched: boolean
  ticketRequested: boolean
  ticketLookupRequested: boolean
  hit: boolean
  /** 检索命中判定是否符合期望（正例=命中，负例=sources 为空） */
  hitOk: boolean
  rounds: number
  pass: boolean
  error?: string
}

// 数据集查找：优先仓库源码目录（cwd），其次编译产物同级
async function loadDataset(): Promise<EvalEntry[]> {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'eval-agent-dataset.json'),
    path.join(__dirname, '..', '..', 'scripts', 'eval-agent-dataset.json'),
  ]
  for (const p of candidates) {
    try {
      return JSON.parse(await readFile(p, 'utf-8'))
    } catch {
      // try next
    }
  }
  throw new Error(`找不到评测数据集，尝试过: ${candidates.join(', ')}`)
}

// 精确率/召回率：正例=期望行为发生，负例=期望行为不发生；无正例时记 0 避免除零
function precisionRecall(
  tp: number,
  fp: number,
  fn: number,
): { precision: number; recall: number } {
  return {
    precision: tp + fp > 0 ? tp / (tp + fp) : 0,
    recall: tp + fn > 0 ? tp / (tp + fn) : 0,
  }
}

const ok = (v: boolean) => (v ? '✓' : '✗')

async function main() {
  const entries = await loadDataset()
  if (entries.length === 0) {
    console.error('数据集为空，请先在 scripts/eval-agent-dataset.json 中添加评测用例')
    process.exitCode = 1
    return
  }

  // 用 Nest 独立上下文复用真实服务，保证评测与线上行为一致
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const chat = app.get(ChatService)
  const prisma = app.get(PrismaService)

  // 评测视角：默认管理员（全量语料）；可用 EVAL_USER_EMAIL 切换为某部门员工视角
  const email = process.env.EVAL_USER_EMAIL || 'default@example.com'
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.error(`评测用户不存在: ${email}`)
    await app.close()
    process.exitCode = 1
    return
  }

  console.log(`\n评测视角: ${email} (role=${user.role}, dept=${user.department || '无'})`)
  console.log(`数据集: ${entries.length} 条\n`)

  const results: EntryResult[] = []
  for (const entry of entries) {
    console.log(`"${entry.query}"${entry.note ? `  (${entry.note})` : ''}`)
    try {
      const res = await chat.evalToolDecision(user.id, entry.query)
      // 检索命中判定：sources 里 documentName 与 expectedDocs 任一匹配即算命中
      const hit = res.sources.some((s) => entry.expectedDocs.includes(s.documentName))
      const decisionsOk =
        res.searched === entry.expectSearch &&
        res.ticketRequested === entry.expectTicket &&
        res.ticketLookupRequested === entry.expectTicketLookup
      // expectedDocs 为空 = 期望「无知识库命中」：sources 必须为空才判对（不编造引用）
      const hitOk = entry.expectedDocs.length > 0 ? hit : res.sources.length === 0
      const pass = decisionsOk && hitOk
      const tools = res.toolCalls.length > 0 ? res.toolCalls.join(',') : '（无）'
      const docs =
        res.sources.length > 0 ? res.sources.map((s) => s.documentName).join(',') : '无命中'
      console.log(
        `  [${pass ? '✓ 通过' : '✗ 未过'}] tools=[${tools}] ` +
          `search=${ok(res.searched)}/期望${ok(entry.expectSearch)} ` +
          `ticket=${ok(res.ticketRequested)}/期望${ok(entry.expectTicket)} ` +
          `lookup=${ok(res.ticketLookupRequested)}/期望${ok(entry.expectTicketLookup)} ` +
          `检索=${ok(hit)}/期望${ok(hitOk)} (sources: ${docs}) rounds=${res.rounds}`,
      )
      results.push({
        entry,
        toolCalls: res.toolCalls,
        searched: res.searched,
        ticketRequested: res.ticketRequested,
        ticketLookupRequested: res.ticketLookupRequested,
        hit,
        hitOk,
        rounds: res.rounds,
        pass,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`  ✗ 执行失败: ${message}`)
      results.push({
        entry,
        toolCalls: [],
        searched: false,
        ticketRequested: false,
        ticketLookupRequested: false,
        hit: false,
        hitOk: false,
        rounds: 0,
        pass: false,
        error: message,
      })
    }
  }

  // 三个布尔决策的混淆矩阵统计（按「期望=是/否」分类）
  const cm = (pick: (r: EntryResult) => { expect: boolean; actual: boolean }) => {
    let tp = 0
    let fp = 0
    let fn = 0
    for (const r of results) {
      const { expect, actual } = pick(r)
      if (expect && actual) tp++
      else if (!expect && actual) fp++
      else if (expect && !actual) fn++
    }
    return { tp, fp, fn }
  }
  const search = cm((r) => ({ expect: r.entry.expectSearch, actual: r.searched }))
  const ticket = cm((r) => ({ expect: r.entry.expectTicket, actual: r.ticketRequested }))
  const lookup = cm((r) => ({
    expect: r.entry.expectTicketLookup,
    actual: r.ticketLookupRequested,
  }))

  // 检索命中率：正例（期望命中）命中比例；负例（期望无命中）sources 为空比例
  const positive = results.filter((r) => r.entry.expectedDocs.length > 0)
  const negative = results.filter((r) => r.entry.expectedDocs.length === 0)
  const hitCount = positive.filter((r) => r.hit).length
  const negCorrect = negative.filter((r) => r.hitOk).length

  const passed = results.filter((r) => r.pass).length
  const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) : '-')

  console.log('\n===== 汇总 =====')
  console.log(`总用例数 : ${entries.length}`)
  console.log(
    `通过用例 : ${passed} (${pct(passed, entries.length)}%)  通过=三个决策全对且检索命中判定符合期望`,
  )
  console.log('--- 决策 精确率/召回率 ---')
  for (const [label, m] of [
    ['search      ', search],
    ['ticket      ', ticket],
    ['ticketLookup', lookup],
  ] as const) {
    const { precision, recall } = precisionRecall(m.tp, m.fp, m.fn)
    console.log(
      `${label}: P=${(precision * 100).toFixed(1)}% R=${(recall * 100).toFixed(1)}% ` +
        `(TP=${m.tp} FP=${m.fp} FN=${m.fn})`,
    )
  }
  console.log(`检索命中率: ${hitCount}/${positive.length} = ${pct(hitCount, positive.length)}%`)
  console.log(
    `负例不误召回: ${negCorrect}/${negative.length} = ${pct(negCorrect, negative.length)}%`,
  )
  console.log(
    '\n提示: 决策不通过时优先检查 ① 数据集期望与 AGENT_PERSONA 策略是否一致 ② 主模型能力/温度 ' +
      '③ ragAgentMaxRounds 上限 ④ 知识库语料与 expectedDocs 文档名是否匹配；',
  )

  await app.close()
  // 不用 process.exit()：Windows 管道下 stdout 异步，硬退出会吞掉输出
  process.exitCode = 0
}

main().catch((err) => {
  console.error('评测执行失败:', err)
  process.exitCode = 1
})
