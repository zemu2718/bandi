import { describe, expect, it } from 'vitest'
import { agentFileSource } from '../agent-file-source'
import { initialAgents, initialAssets, initialMemorySpaces } from '../domain'

const agent = initialAgents.find((item) => item.id === 'zhouce')!
const context = { assets: initialAssets, memorySpaces: initialMemorySpaces }

describe('Agent 文件源码投影', () => {
  it('从结构化事实即时生成 Instructions', () => {
    const result = agentFileSource({ ...agent, instructions: '当前内存正文' }, context, 'instructions.md')
    expect(result).toMatchObject({ status: 'available', provenance: 'demo-projection', language: 'markdown' })
    if (result.status === 'available') expect(result.content).toBe('当前内存正文')
  })

  it('从结构化事实稳定生成上下文配置', () => {
    const result = agentFileSource(agent, context, 'config/context.yaml')
    expect(result.status).toBe('available')
    if (result.status === 'available') {
      expect(result.content).toContain('contextPolicy:')
      expect(result.content).toContain('outputProfileId:')
      expect(result.content).not.toContain('aiClientProfileId')
      expect(result.content).not.toContain('token')
    }
  })

  it('外部只读引用不伪造源码', () => {
    const external = { ...agent, packageSchema: { compatibility: 'unverified' as const }, packageSource: { kind: 'external-reference', externalPath: '/demo/agent', strategy: 'reference-only' } as const, instructions: '外部 Instructions 未读取；当前仅登记 AgentPackage 引用。' }
    const result = agentFileSource(external, context, 'instructions.md')
    expect(result).toMatchObject({ status: 'unavailable', reason: 'external-reference' })
    if (result.status === 'unavailable') expect(result.message).not.toContain(external.instructions)
  })

  it('旧版和更高版本包不生成演示源码', () => {
    for (const packageSchema of [{ schemaVersion: 0, compatibility: 'legacy' as const }, { schemaVersion: 2, compatibility: 'future' as const }]) {
      expect(agentFileSource({ ...agent, packageSchema }, context, 'agent.yaml')).toMatchObject({ status: 'unavailable', reason: 'incompatible-package' })
    }
  })

})
