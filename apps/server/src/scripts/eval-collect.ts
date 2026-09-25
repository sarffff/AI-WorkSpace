/**
 * 反馈 → 评测候选用例导出脚本。
 *
 * 把线上真实的 👎 反馈（含原因标签）连同该次运行的工具轨迹，导出为评测候选用例，
 * 补足手写数据集覆盖不到的真实分布。
 *
 * 用法（在 apps/server 下）：
 *   pnpm eval:collect
 *   EVAL_COLLECT_DAYS=7 pnpm eval:collect     # 只取近 7 天（默认 30）
 *
 * 产物：scripts/eval-agent-candidates.json
 *
 * 重要：产物是**候选**，不会自动并入 eval-agent-dataset.json。
 * expect* 字段填的是模型「实际」做了什么，而负例恰恰意味着实际行为可能是错的 ——
 * 自动并入等于把错误行为固化成评测基线。必须人工逐条复核、把 expect* 改成
 * 真正的期望行为后，再手动并入数据集。
 *
 * 依赖真实 MySQL（读 Message/AgentRun），与 eval:retrieval / eval:agent 一致不纳入 CI。
 *
 * 注意：本脚本随 src 一起由 nest build 编译为 CJS 后用 node 执行，不走 tsx。
 */
import { NestFactory } from '@nestjs/core'
import { writeFile } from 'fs/promises'
import * as path from 'path'
import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { FEEDBACK_REASON_LABEL } from '../modules/tickets/ticket-taxonomy'
import { dedupeCandidates, toCandidate, type FeedbackRow } from './eval-collect-mapping'

// Message.sources 存的是 RagHit[]，取其中的文档名（去重）
function documentNamesOf(sources: unknown): string[] {
  if (!Array.isArray(sources)) return []
  const names = new Set<string>()
  for (const s of sources) {
    if (s && typeof s === 'object') {
      const name = (s as { documentName?: unknown }).documentName
      if (typeof name === 'string' && name.trim()) names.add(name)
    }
  }
  return [...names]
}

async function main() {
  const days = Math.min(Math.max(parseInt(process.env.EVAL_COLLECT_DAYS || '30', 10) || 30, 1), 365)
  const since = new Date(Date.now() - days * 86400_000)

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const prisma = app.get(PrismaService)

  // 期内被点👎的 assistant 消息
  const downs = await prisma.message.findMany({
    where: { feedback: 'down', feedbackAt: { gte: since } },
    orderBy: { feedbackAt: 'desc' },
    select: {
      id: true,
      chatId: true,
      sources: true,
      feedbackReason: true,
      createdAt: true,
    },
  })

  console.log(`\n近 ${days} 天 👎 反馈: ${downs.length} 条`)
  if (downs.length === 0) {
    console.log('无负反馈可导出。')
    await app.close()
    return
  }

  // 关联轨迹：AgentRun.messageId → 该次运行的工具调用与建单结果
  const runs = await prisma.agentRun.findMany({
    where: { messageId: { in: downs.map((m) => m.id) } },
    select: { messageId: true, steps: true, sources: true, ticketId: true },
  })
  const runByMessage = new Map(runs.map((r) => [r.messageId, r]))

  const rows: FeedbackRow[] = []
  let missingQuery = 0
  for (const msg of downs) {
    // 用户提问 = 同会话中该回答之前最近的一条 user 消息
    const question = await prisma.message.findFirst({
      where: { chatId: msg.chatId, role: 'user', createdAt: { lt: msg.createdAt } },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    if (!question?.content.trim()) {
      missingQuery++
      continue
    }
    const run = runByMessage.get(msg.id)
    rows.push({
      query: question.content.trim(),
      feedbackReason: msg.feedbackReason,
      run: run ? { steps: run.steps, sources: run.sources, ticketId: run.ticketId } : null,
      documentNames: documentNamesOf(msg.sources),
    })
  }

  const candidates = dedupeCandidates(rows.map(toCandidate))

  // 原因分布：看清主要失败模式
  const reasonCount: Record<string, number> = {}
  for (const r of rows) {
    const key = r.feedbackReason ?? 'unspecified'
    reasonCount[key] = (reasonCount[key] || 0) + 1
  }

  const outPath = path.join(process.cwd(), 'scripts', 'eval-agent-candidates.json')
  await writeFile(outPath, JSON.stringify(candidates, null, 2) + '\n', 'utf-8')

  console.log(`有轨迹关联: ${rows.filter((r) => r.run).length}/${rows.length}`)
  if (missingQuery > 0) console.log(`跳过（找不到对应提问）: ${missingQuery} 条`)
  console.log('--- 不满原因分布 ---')
  for (const [reason, count] of Object.entries(reasonCount).sort((a, b) => b[1] - a[1])) {
    const label = reason === 'unspecified' ? '未选原因' : (FEEDBACK_REASON_LABEL[reason] ?? reason)
    console.log(`  ${label}: ${count}`)
  }
  console.log(`\n已写入 ${candidates.length} 条候选用例 → ${outPath}`)
  console.log(
    '⚠ expect* 填的是模型「实际行为」，需人工复核改成「期望行为」后再并入 eval-agent-dataset.json',
  )

  await app.close()
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
