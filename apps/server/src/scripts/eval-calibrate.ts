/**
 * ragMinScore 定标：把「语义门该放多少」从拍脑袋变成量出来的数 + 摊开的代价。
 *
 * 用法（在 apps/server 下，前置与 eval:retrieval 相同：真实 MySQL + embedding Key）：
 *   pnpm eval:calibrate
 *   EVAL_USER_EMAIL=xxx@y.com pnpm eval:calibrate     # 换评测视角（默认管理员=全量语料）
 *   CALIBRATE_MIN_RECALL=0.9 pnpm eval:calibrate      # 允许牺牲一点召回换清净（缺省 1=不牺牲）
 *
 * 数据集：scripts/eval-dataset.json（与 eval:retrieval 共用）
 *   expectedDocs 非空 → 正例，取「期望那篇文档的片段」的稠密分
 *   expectedDocs 为空 → 负例（无关查询），取它返回的最高稠密分 = 需要被挡掉的东西
 *
 * 本脚本只读数、只建议，不写任何配置：改不改、改成多少仍然是人的决定。
 *
 * 注意：随 src 一起由 nest build 编译为 CJS 后用 node 执行，不走 tsx
 * （tsx 的 ESM/CJS 混合加载会把 @nestjs/* 拆成双实例导致 DI 失效）。
 */
import { NestFactory } from '@nestjs/core'
import { readFile } from 'fs/promises'
import * as path from 'path'
import { AppModule } from '../app.module'
import { KnowledgeService } from '../modules/knowledge/knowledge.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  LabeledProbe,
  calibrationTable,
  defaultGrid,
  recommendThreshold,
  toCalibrationInput,
} from '../modules/knowledge/threshold-calibration'

interface EvalEntry {
  query: string
  expectedDocs: string[]
}

// 探针取到 10 条：门开到底之后，需要看见的是分布的全貌而不是线上的 Top-4
const PROBE_TOP_K = 10

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
    console.error('数据集为空')
    process.exitCode = 1
    return
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const knowledge = app.get(KnowledgeService)
    const prisma = app.get(PrismaService)
    const email = process.env.EVAL_USER_EMAIL || 'default@example.com'
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      console.error(`评测用户不存在: ${email}`)
      process.exitCode = 1
      return
    }
    const scope = { id: user.id, role: user.role, department: user.department }

    // 关掉精排：ragMinScore 比的是叶子块的稠密余弦分，而精排开着时最终分数是
    // bge-reranker 的分（另一套刻度）。拿后者定前者会定出一个没有意义的数
    const probe = (q: string) =>
      knowledge.searchRelevant(scope, q, PROBE_TOP_K, { minScore: 0, rerank: false })

    const labeled: LabeledProbe[] = []
    const perQueryHits: { score: number }[][] = []

    console.log(
      `\n视角: ${email} (role=${user.role})，数据集 ${entries.length} 条，探针 topK=${PROBE_TOP_K}`,
    )
    console.log('门开到底（minScore=0）+ 关精排，逐条取稠密分：\n')

    for (const entry of entries) {
      const hits = await probe(entry.query)
      perQueryHits.push(hits.map((h) => ({ score: h.score })))
      labeled.push({
        query: entry.query,
        expectedDocs: entry.expectedDocs,
        hits: hits.map((h) => ({ documentName: h.documentName, score: h.score })),
      })
      // 只如实打印观测到的分数；判定规则交给被测过的 toCalibrationInput，
      // 在这里再写一遍就会有两套口径
      const preview = hits
        .slice(0, 3)
        .map((h) => `${h.documentName}:${h.score.toFixed(4)}`)
        .join(' ')
      console.log(
        `${entry.expectedDocs.length ? '[正例]' : '[负例]'} "${entry.query}" → ${preview || '无命中'}`,
      )
    }

    const { input, positiveMiss } = toCalibrationInput(labeled)

    console.log('\n===== 代价表 =====')
    console.log('minScore  正例召回  负例挡掉  平均注入片段数')
    for (const row of calibrationTable(input, defaultGrid(), perQueryHits)) {
      console.log(
        row.minScore.toFixed(2).padEnd(9) +
          `${(row.positiveRecall * 100).toFixed(1)}%`.padEnd(10) +
          `${(row.negativeReject * 100).toFixed(1)}%`.padEnd(10) +
          row.avgHitsPerQuery,
      )
    }

    const minRecall = parseFloat(process.env.CALIBRATE_MIN_RECALL || '1')
    const rec = recommendThreshold(input, {
      minRecall: Number.isFinite(minRecall) && minRecall > 0 ? minRecall : 1,
    })
    const current = process.env.RAG_MIN_SCORE || '0.25'

    console.log('\n===== 结论 =====')
    console.log(
      `样本：正例 ${input.positiveScores.length} 条（另 ${positiveMiss} 条期望文档没进 Top-${PROBE_TOP_K}）、` +
        `负例 ${input.negativeScores.length} 条`,
    )
    if (rec.kind === 'insufficient') {
      console.log(`\n定不出来：${rec.reason}`)
      process.exitCode = 2
      return
    }
    console.log(`\n建议 RAG_MIN_SCORE = ${rec.minScore}（当前 env 默认 ${current}）`)
    console.log(`观测分离区间：负例最高 ${rec.gap.maxNegative} ~ 正例最低 ${rec.gap.minPositive}`)
    console.log(rec.rationale)
    console.log(
      '\n本脚本不写配置。认可就用下面的任一方式生效（Setting 表按用户覆盖优先）：\n' +
        `  RAG_MIN_SCORE=${rec.minScore}                # env 全局默认\n` +
        `  或 Setting 表 key=ragMinScore value=${rec.minScore}   # 按用户`,
    )
    console.log('\n生效后建议再跑一次 pnpm eval:retrieval 对比 HitRate@K / MRR。')
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error('定标失败:', err)
  process.exitCode = 1
})
