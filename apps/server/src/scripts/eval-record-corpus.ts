/**
 * 语料与查询向量录制（P2：让检索排序评测能离线进 CI）
 *
 * eval:retrieval 需要真实 MySQL 与 embedding Key，CI 里跑不了 —— 于是本会话重写了
 * BM25、稠密比较与融合排序之后，没有任何回归门禁守着它。
 *
 * 这里把「语料 + 每条查询的向量 + 期望命中文档」一次性录成 fixture，之后 CI 只需
 * 读 JSON 重跑 coarseRank 即可，无数据库、无网络、无 Key。
 *
 * 用法（在 apps/server 下，需 EMBEDDING_* 或 LLM_* 配置可用）：
 *   pnpm eval:record-corpus
 * 然后人工检查 scripts/eval-corpus-fixture.json 并随代码提交。
 *
 * 注意：录制依赖 embedding 模型。换模型/换维度后 retrieval-offline.spec 会失败并
 * 提示重录 —— 那是正确的行为，向量不匹配的评测结果毫无意义。
 */
import { NestFactory } from '@nestjs/core'
import { writeFile } from 'fs/promises'
import * as path from 'path'
import { AppModule } from '../app.module'
import { EmbeddingsClient } from '../common/embeddings'

interface FixtureLeaf {
  id: string
  parentId: string
  documentId: string
  documentName: string
  sectionPath: string | null
  content: string
  leafText: string
  embedding: number[]
}

interface FixtureParent {
  id: string
  documentId: string
  documentName: string
  sectionPath: string | null
  content: string
}

interface FixtureQuery {
  query: string
  expectedDocs: string[]
  embedding: number[]
  note?: string
}

// 语料刻意做成「多文档多章节 + 有跨部门干扰项」：只有存在会抢名次的相近内容时，// 混合检索与 RRF 的排序回归才测得出来。
const CORPUS: Array<{
  doc: string
  dept: string
  sections: Array<{ path: string; parent: string; leaves: string[] }>
}> = [
  {
    doc: 'vpn-troubleshooting.md',
    dept: 'IT',
    sections: [
      {
        path: '连接失败 > 账号锁定',
        parent:
          'VPN 连接失败时优先确认账号状态。连续输错密码会触发域账号锁定，锁定后所有端点同时失败，' +
          '表现为客户端一直停在「正在验证身份」。需要 IT 管理员在域控解锁账号后才能恢复。',
        leaves: [
          'VPN 连接失败时优先确认账号状态，连续输错密码会触发域账号锁定。',
          '账号被锁定后所有端点同时失败，客户端一直停在「正在验证身份」。',
          '解锁账号需要 IT 管理员在域控操作，员工无法自助完成。',
        ],
      },
      {
        path: '连接失败 > 证书过期',
        parent:
          '个人证书有效期 180 天，过期后 VPN 握手阶段直接失败并返回错误码 ERR-4012。' +
          '处理方式是在自助门户重新申请证书并重新导入客户端。',
        leaves: [
          '个人证书有效期 180 天，过期后握手阶段失败并返回 ERR-4012。',
          '证书过期需在自助门户重新申请并导入客户端。',
        ],
      },
    ],
  },
  {
    doc: 'printer-guide.md',
    dept: '行政',
    sections: [
      {
        path: '卡纸处理',
        parent:
          '打印机卡纸时先关机断电，打开后盖沿出纸方向缓慢抽出纸张，切勿反向硬拉以免碎纸残留。' +
          '反复卡纸通常是搓纸轮老化，需要报修更换。',
        leaves: [
          '卡纸需关机断电后沿出纸方向缓慢抽出，不能反向硬拉。',
          '反复卡纸通常是搓纸轮老化，需要报修更换搓纸轮。',
        ],
      },
      {
        path: '更换墨盒',
        parent:
          '更换墨盒时打开前盖等打印头移到中部，按下卡扣取出空墨盒，注意不要触碰铜色触点；' +
          '新墨盒撕掉保护夹后斜插到位听到咔嗒声。面板报 E-05 表示未卡到位。',
        leaves: [
          '换墨盒要等打印头移到中部，按下卡扣取出，不要触碰铜色触点。',
          '面板报 E-05 说明墨盒未卡到位，需重新插入到位。',
        ],
      },
    ],
  },
  {
    doc: 'expense-policy.md',
    dept: '财务',
    sections: [
      {
        path: '报销审批流程',
        parent:
          '差旅报销需先在 OA 提交费用申请，经直属主管审批、部门负责人审批、财务复核三个环节后打款。' +
          '单笔超过 5000 元另需分管副总审批。发票须在开票后 90 天内提交。',
        leaves: [
          '差旅报销走 OA：直属主管、部门负责人、财务复核三环节后打款。',
          '单笔超 5000 元需分管副总加签，发票 90 天内提交有效。',
        ],
      },
      {
        path: '发票抬头与税号',
        parent:
          '公司发票抬头为「星海科技有限公司」，纳税人识别号见财务共享页。' +
          '普票无需税号，专票必须提供开户行信息。',
        leaves: ['发票抬头为星海科技有限公司，专票必须提供开户行信息。'],
      },
    ],
  },
  {
    doc: 'onboarding.md',
    dept: '人事',
    sections: [
      {
        path: '入职设备申领',
        parent:
          '新员工入职由用人部门在 IT 服务台提交设备申领工单，默认配置为笔记本 + 显示器 + 键鼠。' +
          '特殊配置需部门负责人邮件审批。设备在离职时须归还行政部。',
        leaves: [
          '新员工设备由用人部门提交申领工单，默认笔记本加显示器加键鼠。',
          '特殊配置需部门负责人邮件审批，离职时设备归还行政部。',
        ],
      },
      {
        path: '企业邮箱开通',
        parent: '企业邮箱随域账号自动开通，容量 50G，外发附件上限 20M。超限请改用网盘分享链接。',
        leaves: ['企业邮箱容量 50G，外发附件上限 20M，超限改用网盘链接。'],
      },
    ],
  },
]

// 查询集：expectedDocs 为空即负例（期望什么都不命中）
const QUERIES: Array<{ query: string; expectedDocs: string[]; note: string }> = [
  {
    query: 'VPN 一直显示正在验证身份，连不上',
    expectedDocs: ['vpn-troubleshooting.md'],
    note: '账号锁定语义改写，不含「锁定」二字',
  },
  {
    query: 'VPN 报 ERR-4012 怎么处理',
    expectedDocs: ['vpn-troubleshooting.md'],
    note: '错误码类查询：稠密易漏，靠 BM25 词法命中兜住',
  },
  {
    query: '打印机反复卡纸',
    expectedDocs: ['printer-guide.md'],
    note: '与「卡纸处理」章节直接对应',
  },
  {
    query: '墨盒换了还报 E-05',
    expectedDocs: ['printer-guide.md'],
    note: '编号 + 词法混合',
  },
  {
    query: '出差报销要几级审批',
    expectedDocs: ['expense-policy.md'],
    note: '制度类，跨章节干扰项是入职流程',
  },
  {
    query: '专票需要额外提供什么信息',
    expectedDocs: ['expense-policy.md'],
    note: '同文档内另一章节，考察章节级排序',
  },
  {
    query: '新员工显示器怎么申请',
    expectedDocs: ['onboarding.md'],
    note: '与行政设备章节存在竞争',
  },
  {
    query: '邮箱附件发不出去太大',
    expectedDocs: ['onboarding.md'],
    note: '20M 上限',
  },
  {
    query: '如何评价公司年会节目单的安排',
    expectedDocs: [],
    note: '负例：语料中确实没有，应不命中',
  },
  {
    query: '量子比特的拓扑量子纠错码阈值定理证明',
    expectedDocs: [],
    note: '负例：完全无关的专业问题',
  },
]

// 向量位数截断：1024 维全精度会把 fixture 撑到几百 KB，5 位小数足够复现排序
function round(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1e5) / 1e5)
}

function prefixed(docName: string, sectionPath: string | null, content: string): string {
  const prefix = sectionPath ? `${docName} > ${sectionPath}` : docName
  return `${prefix}\n${content}`
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] })
  const embeddings = app.get(EmbeddingsClient).get()
  if (!embeddings) {
    console.error('embedding 未配置（EMBEDDING_API_KEY / LLM_API_KEY），无法录制')
    process.exitCode = 1
    await app.close()
    return
  }

  const parents: FixtureParent[] = []
  const leaves: FixtureLeaf[] = []

  for (const doc of CORPUS) {
    const documentId = `doc-${doc.doc}`
    for (const [si, sec] of doc.sections.entries()) {
      const parentId = `${documentId}#p${si}`
      parents.push({
        id: parentId,
        documentId,
        documentName: doc.doc,
        sectionPath: sec.path,
        content: sec.parent,
      })
      sec.leaves.forEach((text, li) => {
        leaves.push({
          id: `${parentId}#l${li}`,
          parentId,
          documentId,
          documentName: doc.doc,
          sectionPath: sec.path,
          content: text,
          leafText: prefixed(doc.doc, sec.path, text),
          embedding: [],
        })
      })
    }
  }

  console.log(
    `录制 ${parents.length} 个父块 / ${leaves.length} 个叶子块 + ${QUERIES.length} 条查询向量...`,
  )
  const leafVectors = await embeddings.embedDocuments(leaves.map((l) => l.leafText))
  leafVectors.forEach((v, i) => {
    leaves[i].embedding = round(v)
  })
  const queryVectors = await embeddings.embedDocuments(QUERIES.map((q) => q.query))

  const fixture = {
    // 录制时的 embedding 模型：换模型必须重录，否则向量不属于同一空间
    embeddingModel: process.env.EMBEDDING_MODEL || process.env.LLM_EMBEDDING_MODEL || 'embedding-3',
    dims: leafVectors[0]?.length ?? 0,
    // 离线评测固定用这套参数（不含 rerank 与查询改写 —— 那两个要联网）
    params: { minScore: 0.25, coarseTopK: 20, finalTopK: 4 },
    parents,
    leaves,
    queries: QUERIES.map((q, i): FixtureQuery => ({
      query: q.query,
      expectedDocs: q.expectedDocs,
      note: q.note,
      embedding: round(queryVectors[i]),
    })),
  }

  const out = path.join(process.cwd(), 'scripts', 'eval-corpus-fixture.json')
  await writeFile(out, JSON.stringify(fixture), 'utf8')
  const kb = Buffer.byteLength(JSON.stringify(fixture)) / 1024
  console.log(
    `已写入 ${out}（${parents.length} 父块 / ${leaves.length} 叶子 / ${kb.toFixed(0)} KB）`,
  )
  console.log('下一步：跑一次 pnpm test:ci 确认离线门禁通过，然后把 fixture 一起提交。')
  await app.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
