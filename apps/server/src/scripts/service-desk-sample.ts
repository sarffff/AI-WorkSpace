/**
 * 让演示库长出能评测的样本：补知识库文档、纠正工单分类、跑真实 Agent 升级。
 *
 * 用法（apps/server 下）：
 *   pnpm sample:run                       # 缺省 = audit，纯读，不打任何外部服务
 *   SAMPLE_STAGE=docs pnpm sample:run     # 上传 samples/docs/*.md（会调 embedding）
 *   SAMPLE_STAGE=reclassify pnpm sample:run   # 按清单纠正分类（走 service，留时间线）
 *   SAMPLE_YES=1 SAMPLE_STAGE=escalate pnpm sample:run  # 真实 LLM 跑 Agent，会产生工单
 *
 * 为什么要 escalate 这道显式开关：它是唯一花钱、也唯一往业务表写东西的阶段，
 * 一次跑几个问题就是几毛钱加几张真单，不该被"顺手跑个脚本"触发。
 *
 * 全部动作都走 service 方法而不是裸 SQL：
 * - 分类纠正走 TicketsService.update，这样时间线里有「分类由「其他」调整为「网络访问」」，
 *   缺口清单与回测才看得到这次纠正（数据要经得起自己的读路径检验）
 * - 升级走 ChatService.startStream + resolveConfirm，即 SSE 那条真路径：
 *   产出的工单带 source='agent' 与 chatId 归属，偏转率的分子才是真的
 * - 文档走 KnowledgeService.uploadDocument，切块/向量/落盘/入队全都按线上流程走
 *
 * 清单住在 samples/service-desk-sample.json，文档正文住在 samples/docs/。
 * 按标题片段定位工单而不是写死 UUID：换一套库还能跑。
 */
import { NestFactory } from '@nestjs/core'
import { readFile, readdir } from 'fs/promises'
import * as path from 'path'
import { AppModule } from '../app.module'
import { PrismaService } from '../prisma/prisma.service'
import { ChatService } from '../modules/chat/chat.service'
import { KnowledgeService } from '../modules/knowledge/knowledge.service'
import { TicketsService } from '../modules/tickets/tickets.service'
import type { SafeUser } from '../modules/auth/auth.service'
import type { TicketCategory } from '../modules/tickets/ticket-taxonomy'

interface DocSpec {
  file: string
  ownerEmail: string
  shareToDepartment?: boolean
}
interface ReclassifySpec {
  titleContains: string
  category: TicketCategory
  why: string
}
interface EscalationSpec {
  email: string
  ask: string
  /** expect=escalate 期望 AI 判到自己处理不了而建单；expect=answer 期望直接答住 */
  expect: 'escalate' | 'answer'
  note?: string
}
interface SampleManifest {
  docs: DocSpec[]
  reclassify: ReclassifySpec[]
  escalations: EscalationSpec[]
}

const hr = (t: string) => `\n===== ${t} =====`

async function samplesRoot(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), 'samples'),
    path.join(__dirname, '..', '..', 'samples'),
  ]
  for (const dir of candidates) {
    try {
      await readFile(path.join(dir, 'service-desk-sample.json'), 'utf8')
      return dir
    } catch {
      // 换下一个候选路径
    }
  }
  throw new Error('找不到 samples/service-desk-sample.json（检查 cwd 是否为 apps/server）')
}

async function loadManifest(): Promise<SampleManifest> {
  const dir = await samplesRoot()
  const raw = await readFile(path.join(dir, 'service-desk-sample.json'), 'utf8')
  const parsed = JSON.parse(raw) as SampleManifest
  return {
    docs: parsed.docs ?? [],
    reclassify: parsed.reclassify ?? [],
    escalations: parsed.escalations ?? [],
  }
}

function asViewer(user: {
  id: string
  email: string
  name: string | null
  role: string
  department: string | null
}) {
  return { ...user, avatar: null } as unknown as SafeUser & {
    id: string
    role: string
    department: string | null
  }
}

async function audit(prisma: PrismaService): Promise<void> {
  const [users, tickets, docs, messages] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, department: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.ticket.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        priority: true,
        status: true,
        source: true,
        assigneeId: true,
        chatId: true,
        comments: { select: { kind: true, content: true }, orderBy: { createdAt: 'asc' } },
      },
    }),
    prisma.document.findMany({
      select: {
        id: true,
        name: true,
        department: true,
        status: true,
        chunks: true,
        userId: true,
        chunkList: { select: { content: true, parentId: true, sectionPath: true } },
      },
    }),
    prisma.message.findMany({
      select: { role: true, content: true, chatId: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const nameOf = (id: string | null) => (id ? (users.find((u) => u.id === id)?.email ?? id) : '-')

  console.log(hr('用户'))
  for (const u of users)
    console.log(`  ${u.role.padEnd(8)}${u.email.padEnd(30)}部门=${u.department ?? '-'}`)

  console.log(hr(`工单（${tickets.length} 张）`))
  for (const t of tickets) {
    console.log(
      `  [${t.category}/${t.priority}/${t.status}] "${t.title}" source=${t.source} 受理=${nameOf(t.assigneeId)}`,
    )
    console.log(`     内容：${t.content.replace(/\s+/g, ' ').slice(0, 160)}`)
    for (const c of t.comments) console.log(`     · ${c.kind}: ${c.content}`)
  }

  console.log(hr(`知识库文档（${docs.length} 篇）`))
  for (const d of docs) {
    console.log(
      `  ${d.name} | 所有者=${nameOf(d.userId)} 共享部门=${d.department ?? '-'} 状态=${d.status} 块数=${d.chunks}`,
    )
    for (const c of d.chunkList.slice(0, 3)) {
      console.log(
        `     [${c.parentId ? 'leaf' : 'parent'}] ${(c.sectionPath ?? '-').slice(0, 30)} :: ${c.content.replace(/\s+/g, ' ').slice(0, 80)}`,
      )
    }
  }

  console.log(hr(`用户说过的话（${messages.filter((m) => m.role === 'user').length} 条）`))
  for (const m of messages.filter((x) => x.role === 'user')) {
    console.log(`  ${m.content.replace(/\s+/g, ' ').slice(0, 140)}`)
  }
}

async function uploadDocs(
  prisma: PrismaService,
  knowledge: KnowledgeService,
  manifest: SampleManifest,
): Promise<void> {
  const dir = await samplesRoot()
  const docsDir = path.join(dir, 'docs')
  const present = await readdir(docsDir)
  console.log(hr(`补知识库文档（清单 ${manifest.docs.length} 篇，目录 ${present.length} 个文件）`))
  for (const spec of manifest.docs) {
    if (!present.includes(spec.file)) {
      console.log(`  跳过：找不到 samples/docs/${spec.file}`)
      continue
    }
    const owner = await prisma.user.findUnique({
      where: { email: spec.ownerEmail },
      select: { id: true, email: true, name: true, role: true, department: true },
    })
    if (!owner) {
      console.log(`  跳过 ${spec.file}：库里没有 ${spec.ownerEmail}`)
      continue
    }
    const buffer = await readFile(path.join(docsDir, spec.file))
    const existing = await prisma.document.findFirst({
      where: { name: spec.file, userId: owner.id },
    })
    if (existing) {
      console.log(`  已存在，跳过：${spec.file}（${existing.status}，${existing.chunks} 块）`)
      continue
    }
    // 共享给部门要求 owner 自己有部门，否则 uploadDocument 会静默当私有文档处理
    const shareTo = spec.shareToDepartment && owner.department ? owner.department : undefined
    const file = {
      originalname: spec.file,
      buffer,
      size: buffer.length,
      mimetype: 'text/markdown',
    } as Express.Multer.File
    const doc = await knowledge.uploadDocument({ ...owner }, file, shareTo)
    console.log(
      `  已提交：${spec.file} → 所有者 ${owner.email}${shareTo ? `（共享 ${shareTo}）` : '（仅本人可见）'}，状态 ${doc.status}`,
    )
  }
  // 索引是异步队列跑的，等它落定再看得到块数与 embedding
  await waitForIndexing(prisma)
}

async function waitForIndexing(prisma: PrismaService, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const busy = await prisma.document.count({
      where: { status: { in: ['processing', 'queued'] } },
    })
    if (busy === 0 || Date.now() > deadline) {
      const rows = await prisma.document.findMany({
        select: { name: true, status: true, chunks: true },
        orderBy: { createdAt: 'desc' },
      })
      console.log('  索引落定：' + rows.map((r) => `${r.name}=${r.status}/${r.chunks}块`).join(' '))
      return
    }
    await new Promise((res) => setTimeout(res, 1500))
  }
}

async function reclassify(
  prisma: PrismaService,
  tickets: TicketsService,
  manifest: SampleManifest,
): Promise<void> {
  console.log(hr(`纠正工单分类（${manifest.reclassify.length} 条）`))
  const staff = await prisma.user.findFirst({
    where: { role: { in: ['agent', 'admin'] } },
    select: { id: true, email: true, name: true, role: true, department: true },
  })
  if (!staff) {
    console.log('  没有坐席/管理员账号，分类纠正需要坐席权限（员工无此权限），跳过')
    return
  }
  const viewer = asViewer(staff)
  for (const spec of manifest.reclassify) {
    const hit = await prisma.ticket.findFirst({
      where: { title: { contains: spec.titleContains } },
      select: { id: true, title: true, category: true },
    })
    if (!hit) {
      console.log(`  没找到标题含「${spec.titleContains}」的工单`)
      continue
    }
    if (hit.category === spec.category) {
      console.log(`  已是目标分类，跳过：${hit.title}（${hit.category}）`)
      continue
    }
    await tickets.update(viewer, hit.id, { category: spec.category })
    console.log(`  ${hit.title}：${hit.category} → ${spec.category}（理由：${spec.why}）`)
  }
}

async function escalate(
  prisma: PrismaService,
  chat: ChatService,
  manifest: SampleManifest,
): Promise<void> {
  console.log(hr(`真实 Agent 跑（${manifest.escalations.length} 个问题，会产生工单）`))
  let made = 0
  for (const spec of manifest.escalations) {
    const user = await prisma.user.findUnique({
      where: { email: spec.email },
      select: { id: true, email: true, name: true, role: true, department: true },
    })
    if (!user) {
      console.log(`  跳过：库里没有 ${spec.email}`)
      continue
    }
    const created = await prisma.chat.create({
      data: { userId: user.id, title: `取样：${spec.ask.slice(0, 20)}` },
    })
    const tools: string[] = []
    let ticketId: string | null = null
    let answerChars = 0
    try {
      const { stream } = await chat.startStream(created.id, spec.ask)
      for await (const evt of stream) {
        if (evt.type === 'tool' && evt.step.status === 'start') tools.push(evt.step.tool)
        if (evt.type === 'confirm_required') {
          // 生成器停在 yield 上，此刻批准不会死锁；建单走的就是这条真路径
          const ok = await chat.resolveConfirm(evt.draft.requestId, true)
          tools.push(ok ? 'approved' : 'confirm-failed')
        }
        if (evt.type === 'content') answerChars += evt.text.length
        if (evt.type === 'ticket' && evt.ticket) ticketId = evt.ticket.id
      }
    } catch (err) {
      console.log(
        `  × ${spec.ask.slice(0, 30)} 跑挂了：${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    if (ticketId) made++
    const escalated = ticketId !== null
    const ok = spec.expect === 'escalate' ? escalated : !escalated
    console.log(
      `  ${ok ? '✓' : '✗'} [${user.email}] "${spec.ask.slice(0, 40)}" → ` +
        `工具=${tools.join(',') || '无'} 答案${answerChars}字 工单=${ticketId ?? '未建'}（期望 ${spec.expect}）`,
    )
  }
  console.log(`  本轮新增 AI 升级工单 ${made} 张`)
}

async function main(): Promise<void> {
  const stage = (process.env.SAMPLE_STAGE ?? 'audit').trim()
  const manifest = await loadManifest()
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] })
  try {
    const prisma = app.get(PrismaService)
    if (stage === 'audit') {
      await audit(prisma)
      console.log(hr('清单'))
      console.log(
        `  docs ${manifest.docs.length} 篇 / reclassify ${manifest.reclassify.length} 条 / escalations ${manifest.escalations.length} 个`,
      )
      return
    }
    if (stage === 'docs') return await uploadDocs(prisma, app.get(KnowledgeService), manifest)
    if (stage === 'reclassify') return await reclassify(prisma, app.get(TicketsService), manifest)
    if (stage === 'escalate') {
      if (process.env.SAMPLE_YES !== '1') {
        console.log(
          'escalate 会调用真实 LLM 并往业务表写工单，必须显式确认：SAMPLE_YES=1 SAMPLE_STAGE=escalate pnpm sample:run',
        )
        return
      }
      return await escalate(prisma, app.get(ChatService), manifest)
    }
    console.log(`未知阶段 ${stage}（可用：audit / docs / reclassify / escalate）`)
  } finally {
    await app.close()
  }
}

main().catch((err) => {
  console.error('[sample:run] 失败：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
