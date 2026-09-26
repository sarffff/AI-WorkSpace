import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ConfigService } from '@nestjs/config'
import { isSafeDocumentId, UploadPayloadStore } from './upload-payload.store'

// 行为依据（与实现一致）：
// - 副本按 documentId 存于 UPLOAD_STORE_DIR，write/read/remove 往返一致
// - documentId 必须匹配 uuid 形状：它直接拼进文件路径，不校验就是目录穿越
// - 文件不存在（ENOENT）返回 null，真实 IO 错误抛出 —— 调用方要区分「没有副本」
//   与「读不动」，前者判失败、后者本轮不动

const DOC_ID = '9bdefb1c-c4b1-4804-b008-e321cfe6b032'

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), 'sd-payload-'))
  const config = { get: () => dir } as unknown as ConfigService
  return { store: new UploadPayloadStore(config), dir }
}

describe('UploadPayloadStore', () => {
  let cleanup: string | null = null

  afterEach(async () => {
    if (cleanup) await rm(cleanup, { recursive: true, force: true })
    cleanup = null
  })

  it('写入后可读回，删除后读不到', async () => {
    const { store, dir } = await makeStore()
    cleanup = dir

    expect(await store.write(DOC_ID, Buffer.from('hello pdf'))).toBe(true)
    expect((await store.read(DOC_ID))?.toString()).toBe('hello pdf')

    await store.remove(DOC_ID)
    expect(await store.read(DOC_ID)).toBeNull()
  })

  it('未落盘过时 read 返回 null 而不是抛（ENOENT 归入「没有副本」）', async () => {
    const { store, dir } = await makeStore()
    cleanup = dir
    expect(await store.read('00000000-0000-0000-0000-000000000000')).toBeNull()
  })

  it('remove 对不存在的副本是幂等的', async () => {
    const { store, dir } = await makeStore()
    cleanup = dir
    await expect(store.remove(DOC_ID)).resolves.toBeUndefined()
  })

  it('非法 id 一律拒绝，且绝不落到目标目录之外', async () => {
    const { store, dir } = await makeStore()
    cleanup = dir

    for (const bad of ['../../etc/passwd', 'a/b', 'x;.bin', '', ' ']) {
      expect(await store.write(bad, Buffer.from('x'))).toBe(false)
      expect(await store.read(bad)).toBeNull()
      await expect(store.remove(bad)).resolves.toBeUndefined()
    }
    // 目录里什么都没写过
    expect(await store.read(DOC_ID)).toBeNull()
  })
})

describe('isSafeDocumentId', () => {
  it('接受 uuid 形状', () => {
    expect(isSafeDocumentId(DOC_ID)).toBe(true)
  })

  it('拒绝路径分隔、点号、空白与注入字符', () => {
    for (const bad of ['../x', '..\\x', 'a/b', 'a?b', 'a b', '', ';rm -rf', 'a'.repeat(65)]) {
      expect(isSafeDocumentId(bad)).toBe(false)
    }
  })
})
