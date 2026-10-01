/**
 * 运营指标实跑报告：偏转率 + 自动派单回测/预演，一次命令出数字。
 *
 * 用法（apps/server 下，需要真实 MySQL）：
 *   pnpm metrics:report
 *   METRICS_DAYS=180 pnpm metrics:report          # 换窗口（缺省 90 天）
 *   DISPATCH_MIN_EVIDENCE=3 pnpm metrics:report   # 换"多少证据才敢放手"
 *   DISPATCH_MAX_LOAD=5 pnpm metrics:report       # 换"几个人手算饱和"
 *
 * 视角取库里第一个坐席/管理员账号 —— 只为过 service 的权限判定，不读也不校验任何凭据。
 * 全脚本只读：不改工单、不写受理人、不碰配置。
 *
 * 与 HTTP 端点跑的是同一套 service 方法，区别只在没经过 JWT（那两个端点的鉴权与路由
 * 已在集成侧验证）。所以这里的数字等价于坐席在界面上会看到的数字。
 *
 * 注意：随 src 一起由 nest build 编译为 CJS 后用 node 执行，不走 tsx
 * （ConfigModule 在这一步才把 .env 里的 DATABASE_URL 灌进进程，直连 PrismaClient 会拿不到库）。
 */
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { AnalyticsService } from '../modules/analytics/analytics.service'
import { TicketsService } from '../modules/tickets/tickets.service'
import type { SafeUser } from '../modules/auth/auth.service'
import type { DispatchBacktest, DispatchSuggestion } from '../modules/tickets/dispatch-preview'

/** 命中率是百分数，样本不到这个数就报"结论不成立"，不给可执行的读数 */
const MIN_BACKTEST_SAMPLES = 20

function envInt(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}

const pct = (v: number | null): string => (v === null ? '—（无样本）' : `${(v * 100).toFixed(1)}%`)
const line = (label: string, v: number | null | string): string =>
  `  ${label.padEnd(22, ' ')}${typeof v === 'number' ? v : (v ?? '—')}`
const hr = (title: string) => `\n===== ${title} =====`

/** 坐席 id 直接打出来没人看得懂（老数据里管理员的 id 就是 '000000'），一律换成名字 */
function makeWho(rows: Array<{ id: string; name: string | null; email: string }>) {
  const names = new Map(rows.map((r) => [r.id, r.name || r.email]))
  return (id: string | null) => (id ? (names.get(id) ?? id) : '—')
}

function printSuggestion(s: DispatchSuggestion, who: (id: string | null) => string): void {
  const cand = s.candidates
    .map(
      (c) =>
        `${who(c.agentId)}${c.affinity ? `(${c.affinity}单/在办${c.inFlight})` : `(在办${c.inFlight})`}`,
    )
    .join(' ')
  console.log(
    `  [${s.priority}] ${s.category}｜${s.title.slice(0, 24)} → ${s.assigneeId ? who(s.assigneeId) : '（无人可派）'} ` +
      `依据=${s.basis} 证据=${s.evidence} 份额=${pct(s.confidence)}${cand ? ` 候选: ${cand}` : ''}`,
  )
}

function verdict(bt: DispatchBacktest): string[] {
  if (bt.evaluated < MIN_BACKTEST_SAMPLES) {
    return [
      `样本不足：只有 ${bt.evaluated} 张已派过人的单（门槛 ${MIN_BACKTEST_SAMPLES}）。`,
      '现在任何命中率都是噪声，别据此决定是否上自动派单。',
    ]
  }
  if (bt.decided === 0) {
    return [
      '一条都不敢自动派：分类维度上没有可学的经验（多为 no_signal / other 不可路由）。',
      '先解决分类判得准不准，再谈派单。',
    ]
  }
  if (bt.accuracy === null) return ['无法判定：没有可统计的派单决策。']
  if (bt.baselineAccuracy !== null && bt.accuracy <= bt.baselineAccuracy) {
    return [
      `分类信号没赢过基线（${pct(bt.accuracy)} ≤ 谁最闲给谁 ${pct(bt.baselineAccuracy)}）。`,
      '自动派单不该上：现在的"依据"不比按负载轮转更准。',
    ]
  }
  if (bt.ceilingAccuracy !== null && bt.accuracy >= bt.ceilingAccuracy) {
    return [
      `命中率 ${pct(bt.accuracy)} 已贴到分类天花板 ${pct(bt.ceilingAccuracy)}。`,
      '再准就不是算法问题了：团队本来就不完全按分类分工，要加维度（班次/在岗/具体技能）。',
    ]
  }
  return [
    `有信号：分类 ${pct(bt.accuracy)} > 基线 ${pct(bt.baselineAccuracy)}，一次派对率 ${pct(bt.hitRate)}。`,
    '可以考虑灰度：先只派"证据最硬"的那一档，其余仍进人工队列。',
  ]
}

async function main(): Promise<void> {
  const days = envInt('METRICS_DAYS') ?? 90
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })
  try {
    const prisma = app.get(PrismaService)
    const staffUser = await prisma.user.findFirst({
      where: { role: { in: ['agent', 'admin'] } },
      select: { id: true, email: true, name: true, role: true, department: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!staffUser) {
      console.log('库里没有任何坐席/管理员账号，指标全是权限内数据，脚本不代替你造一个。')
      console.log('建一个：把某个 User.role 改成 agent（或配 BOOTSTRAP_ADMIN_PASSWORD 后重启）。')
      return
    }
    const viewer = { ...staffUser, avatar: null } as unknown as SafeUser
    console.log(`视角：${staffUser.email}（${staffUser.role}）`)

    const [tickets, chats, messages, users] = await Promise.all([
      prisma.ticket.count(),
      prisma.chat.count(),
      prisma.message.count(),
      prisma.user.count(),
    ])
    const span = await prisma.ticket.aggregate({
      _min: { createdAt: true },
      _max: { createdAt: true },
    })
    const sinceCut = new Date(Date.now() - days * 86_400_000)
    const [inWindow, assignedInWindow, staff] = await Promise.all([
      prisma.ticket.count({ where: { createdAt: { gte: sinceCut } } }),
      prisma.ticket.count({ where: { createdAt: { gte: sinceCut }, assigneeId: { not: null } } }),
      prisma.user.count({ where: { role: { in: ['agent', 'admin'] } } }),
    ])

    console.log(hr(`样本体检（窗口 ${days} 天）`))
    console.log(line('用户 / 坐席', `${users} / ${staff}`))
    console.log(line('会话 / 消息', `${chats} / ${messages}`))
    console.log(line('工单（全量）', tickets))
    console.log(line('工单（窗口内）', `${inWindow}，其中派过人 ${assignedInWindow}`))
    console.log(
      line(
        '工单时间跨度',
        span._min.createdAt && span._max.createdAt
          ? `${span._min.createdAt.toISOString().slice(0, 10)} ~ ${span._max.createdAt.toISOString().slice(0, 10)}`
          : '—',
      ),
    )

    const analytics = app.get(AnalyticsService)
    const ticketsService = app.get(TicketsService)
    const who = makeWho(
      await prisma.user.findMany({
        where: { role: { in: ['agent', 'admin'] } },
        select: { id: true, name: true, email: true },
      }),
    )

    console.log(hr(`偏转率（按会话，近 ${days} 天）`))
    const def = await analytics.deflection(viewer, days)
    console.log(line('有过 AI 回答的会话', def.answeredSessions))
    console.log(line('其中升级到人工', def.escalatedSessions))
    console.log(line('偏转率', pct(def.deflectionRate)))
    console.log(
      line(
        '低置信偏转（没升级但被👎）',
        `${def.lowConfidenceDeflections} (${pct(def.lowConfidenceShare)})`,
      ),
    )
    console.log(
      line(
        '无依据偏转（整会话零引用）',
        `${def.ungroundedDeflections} (${pct(def.ungroundedShare)})`,
      ),
    )
    console.log(line('只有提问没有回答（不进比率）', def.unansweredSessions))
    console.log(line('归属可查率', pct(def.attributionCoverage)))
    console.log(line('追不到会话的 AI 工单', def.unattributedAgentTickets))
    // attributionCoverage 为 null 等价于"期内一条 AI 工单都没有"，
    // 此时 100% 说的是"从没人找过 AI 的麻烦"，不是"AI 全接住了"——这两个读数完全不同
    if (def.attributionCoverage === null) {
      console.log('  ⚠ 上面这个百分比是空心的：期内没有任何 AI 升级工单，分母里没有一次"没接住"。')
      console.log('    它只说明「AI 答过话、且没人被迫转人工」，不能读成偏转成功。')
    }
    if (def.ungroundedDeflections > 0) {
      console.log(
        `  ⚠ 其中 ${def.ungroundedDeflections} 个"接住"的会话通篇没有一条引用：最多有 ${pct(
          def.ungroundedShare,
        )} 的偏转是没查资料就答的（含纯闲聊，所以这是上限不是定论）。`,
      )
    }
    if (def.knowledgeGaps.length) {
      console.log(
        '  知识缺口排序：' + def.knowledgeGaps.map((g) => `${g.category}×${g.escalated}`).join(' '),
      )
    }

    console.log(hr('派单回测：按分类经验重派历史单'))
    const bt = await ticketsService.dispatchBacktest(viewer, days, {
      minEvidence: envInt('DISPATCH_MIN_EVIDENCE'),
    })
    console.log(line('有真值的单 / 敢自动派', `${bt.evaluated} / ${bt.decided}`))
    console.log(line('覆盖率', pct(bt.coverage)))
    console.log(line('出手准确率', pct(bt.accuracy)))
    console.log(line('一次派对率（含不敢派）', pct(bt.hitRate)))
    console.log(line('基线（谁最闲给谁）', `${bt.baselineHits} 中 / ${pct(bt.baselineAccuracy)}`))
    console.log(line(`短名单前 ${bt.topK} 含真值`, bt.topKHits))
    console.log(line('天花板（分类能到的上限）', pct(bt.ceilingAccuracy)))
    console.log(
      line('无信号 / 证据薄 / other', `${bt.noSignal} / ${bt.thinEvidence} / ${bt.unroutable}`),
    )
    console.log(line('转过派 / 本可省掉', `${bt.reassigned} / ${bt.wouldSaveReassignment}`))
    console.log(line('miss 中真值无该分类经验', bt.missesExplainedByNoAffinity))
    for (const c of bt.byCategory) {
      console.log(
        `  · ${c.category.padEnd(9, ' ')} 单 ${c.evaluated}，敢派 ${c.decided}，命中 ${c.hits}，准确率 ${pct(c.accuracy)}，天花板 ${pct(c.ceiling)}`,
      )
    }
    const review = bt.decisions.slice(0, 5)
    if (review.length) {
      console.log('  最该人工核对的几条：')
      for (const d of review) {
        console.log(
          `    ${d.ticketId.slice(0, 8)} ${d.category} 建议=${who(d.suggestedAssigneeId)} 真值=${who(d.actualAssigneeId)} ${d.hit ? '中' : '未中'}（${d.basis}${d.reassigned ? '，转过派' : ''}）`,
        )
      }
    }

    console.log(hr('派单预演：当前没人接的单该给谁'))
    const pv = await ticketsService.dispatchPreview(viewer, days, 20, {
      minEvidence: envInt('DISPATCH_MIN_EVIDENCE'),
      maxLoad: envInt('DISPATCH_MAX_LOAD'),
    })
    console.log(line('待派单 / 可自动派', `${pv.pendingTotal} / ${pv.autoDispatchable}`))
    if (pv.noRoster) console.log('  花名册为空：没有任何坐席/管理员可派')
    for (const s of pv.pending) printSuggestion(s, who)

    console.log(hr('结论'))
    if (def.attributionCoverage === null) {
      console.log(
        '  偏转率：无样本。要先有真实求助进来、并被 AI 判为处理不了（source=agent 的工单），这个比率才开始说话。',
      )
    }
    for (const v of verdict(bt)) console.log(`  ${v}`)
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error('[metrics:report] 失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
