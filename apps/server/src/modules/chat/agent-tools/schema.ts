// ===== 工具参数 schema：单一真相 =====
//
// 背景：原先每个工具手写 typeof 校验，同时又在 agentTools() 里手写一份 JSON Schema
// 给模型 —— 两份真相会漂移（改了校验忘了改 schema，模型看到的约束与实际校验不一致）。
// 这里一次声明，既生成给模型的 JSON Schema，又驱动运行时校验。
//
// 只覆盖 function calling 实际用得到的标量类型（string/number/boolean）。
// 校验失败一律回传结构化错误文案交由模型自我修正，不静默兜底 —— 与原实现一致。

export interface StringField {
  type: 'string'
  description: string
  required?: true
  /** trim 后不得为空 */
  nonEmpty?: true
  enum?: readonly string[]
  /** 超长截断（截断不报错，防御超长入参而非拒绝） */
  maxLength?: number
  /** 取值非法时回退到该默认值而不报错（低风险字段用，如 priority） */
  fallback?: string
  /** 校验失败回传模型的文案；不给则按字段名生成 */
  message?: string
}

export interface NumberField {
  type: 'number'
  description: string
  required?: true
  /** 越界夹紧到区间（不报错） */
  min?: number
  max?: number
  /** 取整 */
  int?: true
  fallback?: number
  message?: string
}

export interface BooleanField {
  type: 'boolean'
  description: string
  required?: true
  fallback?: boolean
  message?: string
}

export type Field = StringField | NumberField | BooleanField

export type ToolSchema = Record<string, Field>

// schema → 校验后参数的静态类型：required 为必选，其余可选
type FieldType<F extends Field> = F extends StringField
  ? string
  : F extends NumberField
    ? number
    : boolean

export type InferArgs<S extends ToolSchema> = {
  [K in keyof S as S[K] extends { required: true } ? K : never]: FieldType<S[K]>
} & {
  [K in keyof S as S[K] extends { required: true } ? never : K]?: FieldType<S[K]>
}

// error?: never 是必要的：ToolSchema 基类型下 InferArgs 会退化为 {}，
// 失败分支会被成功分支吸收而无法按 ok 收窄（registry 以基类型持有工具）
export type ValidateResult<S extends ToolSchema> =
  { ok: true; args: InferArgs<S>; error?: never } | { ok: false; error: string; args?: never }

const invalidMsg = (name: string, field: Field, key: string): string => {
  if (field.message) return field.message
  if (field.type === 'string') {
    const of = field.enum ? `${field.enum.join('/')} 之一` : '字符串'
    return `参数错误: ${key} 必须是${of}，请修正参数后重试`
  }
  const kind = field.type === 'number' ? '数字' : '布尔值'
  return `参数错误: ${key} 必须是${kind}，请修正参数后重试`
}

// 缺失必填字段与类型不符都回传同一套「参数错误」文案，让模型下一轮修正。
// tool 名进入整体守卫文案（参数必须是 JSON 对象），与原实现保持一致。
export function validateArgs<S extends ToolSchema>(
  toolName: string,
  schema: S,
  raw: unknown,
): ValidateResult<S> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `参数错误: ${toolName} 的参数必须是 JSON 对象，请修正后重试` }
  }
  const input = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, field] of Object.entries(schema)) {
    const value = input[key]
    const present = value !== undefined && value !== null

    if (field.type === 'string') {
      const str = typeof value === 'string' ? value.trim() : ''
      const bad = !present || typeof value !== 'string' || (field.nonEmpty && !str)
      const enumBad = !bad && field.enum && !field.enum.includes(str)
      if (bad || enumBad) {
        if (field.fallback !== undefined) {
          out[key] = field.fallback
          continue
        }
        // 可选字段缺失/类型不符：按未传处理（不报错，与原 status 行为一致）
        if (!field.required && (!present || typeof value !== 'string')) continue
        return { ok: false, error: invalidMsg(toolName, field, key) }
      }
      out[key] = field.maxLength ? str.slice(0, field.maxLength) : str
      continue
    }

    if (field.type === 'number') {
      const num = typeof value === 'number' && Number.isFinite(value) ? value : NaN
      if (Number.isNaN(num)) {
        if (field.fallback !== undefined) {
          out[key] = field.fallback
          continue
        }
        if (!field.required) continue
        return { ok: false, error: invalidMsg(toolName, field, key) }
      }
      let n = num
      if (field.min !== undefined) n = Math.max(n, field.min)
      if (field.max !== undefined) n = Math.min(n, field.max)
      out[key] = field.int ? Math.round(n) : n
      continue
    }

    if (typeof value !== 'boolean') {
      if (field.fallback !== undefined) {
        out[key] = field.fallback
        continue
      }
      if (!field.required) continue
      return { ok: false, error: invalidMsg(toolName, field, key) }
    }
    out[key] = value
  }

  return { ok: true, args: out as InferArgs<S> }
}

// schema → OpenAI function calling 的 parameters（JSON Schema）
export function toJsonSchema(schema: ToolSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, field] of Object.entries(schema)) {
    const prop: Record<string, unknown> = { type: field.type, description: field.description }
    if (field.type === 'string' && field.enum) prop.enum = [...field.enum]
    properties[key] = prop
    if (field.required) required.push(key)
  }
  const out: Record<string, unknown> = { type: 'object', properties }
  if (required.length > 0) out.required = required
  return out
}
