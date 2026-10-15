import { z } from 'zod'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'

// dsh accepts a deliberately small JSON Schema subset. Zod remains the full validator;
// this projection keeps model-visible structure/descriptions and drops unsupported numeric limits.
export function dshSchema(schema: z.ZodType): JsonSchemaNode {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>
  function project(value: unknown): JsonSchemaNode {
    const node = value as Record<string, unknown>
    if (node.$ref) return { description: '任意可序列化 JSON 值；具体参数请查询模型设置。' }
    const description = typeof node.description === 'string' ? { description: node.description } : {}
    const variants = node.oneOf ?? node.anyOf
    if (Array.isArray(variants)) return { ...description, oneOf: variants.map(project) }
    if (Array.isArray(node.type)) return { ...description, oneOf: node.type.map(type => project({ type })) }
    const result: JsonSchemaNode = { ...description }
    if (typeof node.type === 'string') result.type = node.type as JsonSchemaNode['type']
    if (node.const !== undefined) result.const = node.const as never
    if (Array.isArray(node.enum)) result.enum = node.enum as never
    if (node.type === 'object') {
      result.properties = Object.fromEntries(Object.entries((node.properties ?? {}) as Record<string, unknown>).map(([key, child]) => [key, project(child)]))
      if (Array.isArray(node.required)) result.required = node.required as string[]
      result.additionalProperties = node.additionalProperties !== false
    }
    if (node.type === 'array' && node.items) result.items = project(node.items)
    return result
  }
  return project(raw)
}
