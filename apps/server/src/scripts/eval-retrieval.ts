/**
 * 检索评测脚本（P3）：对当前数据库中的知识库语料跑 ground-truth 问题集，
 * 输出 Top-K 命中率与 MRR，用于 RAG 检索质量的回归对比。
 *
 * 用法（在 apps/server 下）：
 *   pnpm eval:retrieval
 *   EVAL_USER_EMAIL=default@example.com pnpm eval:retrieval   # 指定评测视角（默认管理员，可见全部语料）
 *
 * 数据集：scripts/eval-dataset.json
 *   [{ "query": "...", "expectedDocs": ["文件名"], "topK"?: 4 }]
 *   expectedDocs 为空数组表示期望「无命中」（负例）。
 *
 * 注意：本脚本随 src 一起由 nest build 编译为 CJS 后用 node 执行，
 * 不走 tsx —— tsx 的 ESM/CJS 混合加载会把 @nestjs/* 拆成双实例导致 DI 失效。
 */
import { NestFactory } from '@nestjs/core'
import { readFile } from 'fs/promises'
import * as path from 'path'
import { AppModule } from '../app.module'
import { KnowledgeService } from '../modules/knowledge/knowledge.service'
import { PrismaService } from '../prisma/prisma.service'

interface EvalEntry {
  query: string
  expectedDocs: string[]
  topK?: number
  note?: string
}

// 数据集查找：优先仓库源码目录（cwd），其次编译产物同级
async function loadDataset(): Promise<EvalEntry[]> {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'eval-dataset.json'),
    path.join(__dirname, '..', '..', 'scripts', 'eval-dataset.json'),
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

async function main() {
  const entries = await loadDataset()
  if (entries.length === 0) {
    console.error('数据集为空，请先在 scripts/eval-dataset.json 中添加评测问题')
    process.exitCode = 1
    return
  }

  // 用 Nest 独立上下文复用真实服务（含行级权限过滤与相似度阈值），保证评测与线上行为一致
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  const knowledge = app.get(KnowledgeService)
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
  const scope = { id: user.id, role: user.role, department: user.department }

  let hits = 0
  let negativeCorrect = 0
  let negativeTotal = 0
  let mrrSum = 0
  let positiveTotal = 0

  console.log(`\n评测视角: ${email} (role=${user.role}, dept=${user.department || '无'})`)
  console.log(`数据集: ${entries.length} 条\n`)

  for (const entry of entries) {
    // topK 不传时由 Setting 表 ragTopK 决定（配置化评测）
    const topK = entry.topK
    const results = await knowledge.searchRelevant(scope, entry.query, topK)
    const names = results.map((r) => r.documentName)
    const isNegative = entry.expectedDocs.length === 0

    if (isNegative) {
      negativeTotal++
      const pass = results.length === 0
      if (pass) negativeCorrect++
      console.log(
        `[负例] ${pass ? '✓' : '✗'} "${entry.query}" → ${results.length === 0 ? '无命中（正确）' : `误召回: ${names.join(',')}`}`,
      )
    } else {
      positiveTotal++
      const rank = names.findIndex((n) => entry.expectedDocs.includes(n))
      const passed = rank >= 0
      if (passed) {
        hits++
        mrrSum += 1 / (rank + 1)
      }
      console.log(
        `[正例] ${passed ? '✓' : '✗'} "${entry.query}" → ${results.length > 0 ? names.map((n, i) => `${i + 1}.${n}${results[i].sectionPath ? `[${results[i].sectionPath}]` : ''}(${results[i].score})`).join(' ') : '无命中'}`,
      )
    }
  }

  const hitRate = positiveTotal > 0 ? (hits / positiveTotal) * 100 : 0
  const mrr = positiveTotal > 0 ? mrrSum / positiveTotal : 0
  const negRate = negativeTotal > 0 ? (negativeCorrect / negativeTotal) * 100 : 0

  console.log('\n===== 汇总 =====')
  console.log(`正例命中率 HitRate@K : ${hits}/${positiveTotal} = ${hitRate.toFixed(1)}%`)
  console.log(`平均倒数排名 MRR    : ${mrr.toFixed(3)}`)
  console.log(`负例不误召回        : ${negativeCorrect}/${negativeTotal} = ${negRate.toFixed(1)}%`)
  console.log(
    '\n提示: 命中率低时优先检查 ① 数据集问题与语料的语义相关性 ② 相似度阈值(ragMinScore) ③ 切块大小(RAG_PARENT_SIZE/RAG_LEAF_SIZE) ④ Rerank 是否可用(RAG_RERANK) ⑤ 查询改写是否开启(RAG_QUERY_REWRITE)；以上均可通过环境变量或 Setting 表调整，无需改代码',
  )

  await app.close()
  // 不用 process.exit()：Windows 管道下 stdout 异步，硬退出会吞掉输出
  process.exitCode = hitRate >= 60 ? 0 : 2 // 命中率低于 60% 视为回归失败（可按团队基线调整）
}

main().catch((err) => {
  console.error('评测执行失败:', err)
  process.exitCode = 1
})
