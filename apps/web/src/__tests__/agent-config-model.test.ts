import { describe, expect, it } from 'vitest'
import { applyAgentConfig, getAgentConfigPath, isAgentConfigPayload, normalizeAgentName, parseAgentComponentRefs, parseAgentContextConfig, parseAgentMcpRefs, parseAgentPermissions, parseAgentRuleRefs, parseAgentSkillRefs, parseAgentSopRefs, serializeAgentConfig, snapshotAgentConfig, validateAgentName, validateContextPolicy, validateContextWindowTokens } from '../agent-config-model'
import { initialAgents } from '../domain'

const agent = initialAgents.find((item) => item.id === 'zhouce')!

describe('Agent 配置模型', () => {
  it('统一校验和规范化 Agent 名称', () => {
    for (const value of ['周策', '测试工程师 2', 'A'.repeat(40)]) expect(validateAgentName(value)).toBeUndefined()
    for (const value of ['', '周', '1'.repeat(41), '123456', '１２３', '---', '！！！', '550e8400-e29b-41d4-a716-446655440000', 'agent-550e8400-e29b-41d4-a716-446655440000']) expect(validateAgentName(value)).toBeDefined()
    expect(normalizeAgentName('  测试工程师 2  ')).toBe('测试工程师 2')
    const identity = snapshotAgentConfig(agent, 'identity')!
    expect(identity.kind).toBe('identity')
    if (identity.kind !== 'identity') throw new Error('身份快照类型错误')
    expect(applyAgentConfig(agent, { ...identity, value: { ...identity.value, name: '123' } })).toBeUndefined()
    expect(isAgentConfigPayload({ ...identity, value: { ...identity.value, name: '---' } })).toBe(false)
  })

  it('把普通配置映射到唯一规范路径', () => {
    expect(getAgentConfigPath({ kind: 'instructions', value: 'x' })).toBe('instructions.md')
    expect(getAgentConfigPath({ kind: 'rules', value: [] })).toBe('config/rules.yaml')
    expect(getAgentConfigPath({ kind: 'context', value: { policy: agent.contextPolicy, contextWindowTokens: agent.contextWindowTokens } })).toBe('config/context.yaml')
  })

  it('往返应用并序列化上下文策略与输出格式', () => {
    const payload = {
      kind: 'context' as const,
      value: {
        policy: { ...agent.contextPolicy, triggerRatio: 0.85, targetRatio: 0.55 },
        contextWindowTokens: 256_000,
        outputProfileId: 'output-verifiable-delivery',
      },
    }
    const applied = applyAgentConfig(agent, payload)
    expect(applied?.contextPolicy.triggerRatio).toBe(0.85)
    expect(applied?.outputProfileId).toBe('output-verifiable-delivery')
    expect(serializeAgentConfig(agent, payload)).toContain('triggerRatio: 0.85')
    expect(serializeAgentConfig(agent, payload)).toContain('outputProfileId: "output-verifiable-delivery"')
  })

  it('在身份配置中稳定保存头像引用并拒绝任意路径', () => {
    const withAvatar = { ...agent, avatarPath: 'avatar.png' as const }
    const payload = snapshotAgentConfig(withAvatar, 'identity')!
    expect(payload.kind).toBe('identity')
    if (payload.kind !== 'identity') throw new Error('身份快照类型错误')
    expect(serializeAgentConfig(withAvatar, payload)).toContain('avatarPath: "avatar.png"')
    expect(applyAgentConfig(agent, payload)?.avatarPath).toBe('avatar.png')

    const withoutAvatar = snapshotAgentConfig(agent, 'identity')!
    expect(serializeAgentConfig(agent, withoutAvatar)).not.toContain('avatarPath')
    expect(isAgentConfigPayload({ ...payload, value: { ...payload.value, avatarPath: '../avatar.png' } })).toBe(false)
    expect(isAgentConfigPayload({ ...payload, value: { ...payload.value, avatarPath: 'https://example.com/avatar.png' } })).toBe(false)
  })

  it('解析自身生成的规范上下文 YAML', () => {
    const payload = {
      kind: 'context' as const,
      value: {
        policy: { ...agent.contextPolicy, triggerRatio: 0.85 },
        contextWindowTokens: 256_000,
        outputProfileId: 'output-verifiable-delivery',
        outputParameterBindings: [{ parameterId: 'tone', type: 'enum' as const, value: 'concise' }],
      },
    }
    const content = serializeAgentConfig(agent, payload)!

    expect(parseAgentContextConfig(content)).toEqual(payload.value)
    expect(parseAgentContextConfig(content.replace('contextWindowTokens: 256000\n', ''))?.contextWindowTokens).toBe(200_000)
    expect(parseAgentContextConfig(content.replace('contextWindowTokens: 256000', 'contextWindowTokens: 999'))).toBeUndefined()
    expect(parseAgentContextConfig(content.replace('schemaVersion: 1', 'schemaVersion: 2'))).toBeUndefined()
    expect(parseAgentContextConfig(content.replace('triggerRatio: 0.85', 'triggerRatio: NaN'))).toBeUndefined()
    expect(parseAgentContextConfig(content.replace('outputParameterBindings:', 'unknownBindings:'))).toBeUndefined()
  })

  it('解析自身生成的规范 Rule 引用 YAML', () => {
    const content = serializeAgentConfig(agent, { kind: 'rules', value: ['rule-common', 'rule-review'] })!
    expect(parseAgentRuleRefs(content)).toEqual(['rule-common', 'rule-review'])
    expect(parseAgentRuleRefs(serializeAgentConfig(agent, { kind: 'rules', value: [] })!)).toEqual([])
    expect(parseAgentRuleRefs(content.replace('schemaVersion: 1', 'schemaVersion: 2'))).toBeUndefined()
    expect(parseAgentRuleRefs(content.replace('rule-review', 'rule-common'))).toBeUndefined()
    expect(parseAgentRuleRefs(content.replace('rule-review', '../rule-review'))).toBeUndefined()
    expect(parseAgentRuleRefs(`${content}\nunknown: true`)).toBeUndefined()
  })

  it('解析自身生成的规范 Skill 引用 YAML', () => {
    const content = serializeAgentConfig(agent, { kind: 'skills', value: ['skill-review', 'skill-release'] })!
    expect(parseAgentSkillRefs(content)).toEqual(['skill-review', 'skill-release'])
    expect(parseAgentSkillRefs(serializeAgentConfig(agent, { kind: 'skills', value: [] })!)).toEqual([])
    expect(parseAgentSkillRefs(content.replace('schemaVersion: 1', 'schemaVersion: 2'))).toBeUndefined()
    expect(parseAgentSkillRefs(content.replace('skill-release', 'skill-review'))).toBeUndefined()
    expect(parseAgentSkillRefs(content.replace('skill-release', '../skill-release'))).toBeUndefined()
    expect(parseAgentSkillRefs(`${content}\nunknown: true`)).toBeUndefined()
  })

  it('解析自身生成的规范 MCP 引用 YAML', () => {
    const content = serializeAgentConfig(agent, { kind: 'mcp', value: ['mcp-common', 'mcp-review'] })!
    expect(parseAgentMcpRefs(content)).toEqual(['mcp-common', 'mcp-review'])
    expect(parseAgentMcpRefs(serializeAgentConfig(agent, { kind: 'mcp', value: [] })!)).toEqual([])
    expect(parseAgentMcpRefs(content.replace('schemaVersion: 1', 'schemaVersion: 2'))).toBeUndefined()
    expect(parseAgentMcpRefs(content.replace('mcp-review', 'mcp-common'))).toBeUndefined()
    expect(parseAgentMcpRefs(content.replace('mcp-review', '../mcp-review'))).toBeUndefined()
    expect(parseAgentMcpRefs(`${content}\nunknown: true`)).toBeUndefined()
  })

  it('解析自身生成的规范 SOP 引用 YAML', () => {
    const content = serializeAgentConfig(agent, { kind: 'sop', value: ['sop-delivery', 'sop-review'] })!
    expect(parseAgentSopRefs(content)).toEqual(['sop-delivery', 'sop-review'])
    expect(parseAgentSopRefs(serializeAgentConfig(agent, { kind: 'sop', value: [] })!)).toEqual([])
    expect(parseAgentSopRefs(content.replace('schemaVersion: 1', 'schemaVersion: 2'))).toBeUndefined()
    expect(parseAgentSopRefs(content.replace('sop-review', 'sop-delivery'))).toBeUndefined()
    expect(parseAgentSopRefs(content.replace('sop-review', '../sop-review'))).toBeUndefined()
    expect(parseAgentSopRefs(`${content}\nunknown: true`)).toBeUndefined()
  })

  it.each([
    ['Hook', 'hooks', 'hook-config-saved', 'include-path'],
    ['Command', 'commands', 'command-config-audit', 'scope'],
  ] as const)('解析自身生成的规范 %s 引用 YAML', (_label, key, assetId, parameterId) => {
    const references = [{ assetId, parameterBindings: [{ parameterId, type: 'boolean' as const, value: true }] }]
    const content = serializeAgentConfig(agent, { kind: key, value: references })!
    expect(parseAgentComponentRefs(content, key)).toEqual(references)
    expect(parseAgentComponentRefs(content.replace('schemaVersion: 1', 'schemaVersion: 2'), key)).toBeUndefined()
    expect(parseAgentComponentRefs(content.replace(assetId, '../component'), key)).toBeUndefined()
    expect(parseAgentComponentRefs(content.replace(`"assetId":"${assetId}"`, `"assetId":"${assetId}","unknown":true`), key)).toBeUndefined()
    expect(parseAgentComponentRefs(content.replace(/}]$/, `},{"parameterId":"${parameterId}","type":"boolean","value":false}]`), key)).toBeUndefined()
    expect(parseAgentComponentRefs(content.replace('"type":"boolean","value":true', '"type":"secret","value":"token"'), key)).toBeUndefined()
    expect(parseAgentComponentRefs(content.replace('"type":"boolean","value":true', `"type":"string","value":"${'x'.repeat(4097)}"`), key)).toBeUndefined()
  })

  it('解析自身生成的规范 Permissions YAML', () => {
    const content = serializeAgentConfig(agent, { kind: 'permissions', value: agent.permissions })!
    expect(parseAgentPermissions(content)).toEqual(agent.permissions)
    expect(parseAgentPermissions(content.replace('schemaVersion: 1', 'schemaVersion: 2'))).toBeUndefined()
    expect(parseAgentPermissions(content.replace('  files:', '  unknown:'))).toBeUndefined()
    expect(parseAgentPermissions(`${content}\nextra: true`)).toBeUndefined()
  })

  it('拒绝非法上下文策略', () => {
    expect(validateContextPolicy({ ...agent.contextPolicy, triggerRatio: 0.49 })).not.toHaveLength(0)
    expect(validateContextPolicy({ ...agent.contextPolicy, targetRatio: 0.75, triggerRatio: 0.8 })).not.toHaveLength(0)
    expect(validateContextPolicy({ ...agent.contextPolicy, protectRecentTurns: 1.5 })).not.toHaveLength(0)
    expect(validateContextWindowTokens(256_000)).toHaveLength(0)
    expect(validateContextWindowTokens(999)).not.toHaveLength(0)
    expect(validateContextWindowTokens(2_000_001)).not.toHaveLength(0)
    expect(validateContextWindowTokens(256_000.5)).not.toHaveLength(0)
    expect(applyAgentConfig(agent, {
      kind: 'context',
      value: { policy: { ...agent.contextPolicy, targetRatio: 0.75, triggerRatio: 0.8 }, contextWindowTokens: agent.contextWindowTokens },
    })).toBeUndefined()
  })
})
