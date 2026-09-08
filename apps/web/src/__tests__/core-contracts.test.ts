import { describe, expect, it } from 'vitest'
import fixture from '../../../../packages/contracts/fixtures/core-contracts.valid.json'
import memoryFixture from '../../../../packages/contracts/fixtures/formal-memory-v3.valid.json'
import type { BaselineRefDto, Diagnostic, LocalServiceEvent, MemoryCandidateDto, MemoryRevisionDto, MemorySpaceDto, RecoverManagedAgentIdentityRequest, RestoreManagedAgentIdentityRequest, ReviewMemoryCandidateRequest, ReviewMemoryCandidateResult, SaveConfigRequest, SaveConfigResult, ValidationFailed } from '../contracts'

const hashPattern = /^sha256:[0-9a-f]{64}$/

describe('首切片核心共享合同', () => {
  it('Baseline 使用稳定 ID 和带算法前缀的双哈希', () => {
    const baseline = fixture.baseline as BaselineRefDto
    expect(baseline.assetId).toBe(fixture.saveRequest.assetId)
    expect(baseline.assetContentHash).toMatch(hashPattern)
    expect(baseline.containerContentHash).toMatch(hashPattern)
  })

  it('诊断支持未知 code 和可选定位信息', () => {
    const diagnostic = fixture.diagnostic as Diagnostic
    expect(diagnostic.code).toBe('instructions_invalid')
    expect(diagnostic.range?.startLine).toBe(1)
  })

  it('保存请求只允许已冻结的 Instructions、Context、Rules、Skills、MCP、Permissions、SOP 与 Orchestration 分支', () => {
    const instructions = fixture.saveRequest as SaveConfigRequest
    const context = fixture.contextSaveRequest as SaveConfigRequest
    const rules = fixture.rulesSaveRequest as SaveConfigRequest
    const skills = fixture.skillsSaveRequest as SaveConfigRequest
    expect(instructions.change.kind).toBe('instructions')
    expect(instructions.baseContent).toBe('# Original Instructions\n')
    expect(instructions.confirmationRef).toBeUndefined()
    expect(context.change.kind).toBe('context')
    expect(context.expectedBaseline.assetId).toBe(context.assetId)
    expect(rules.change.kind).toBe('rules')
    expect(rules.expectedBaseline.assetId).toBe(rules.assetId)
    expect(skills.change.kind).toBe('skills')
    expect(skills.expectedBaseline.assetId).toBe(skills.assetId)
    const mcp = fixture.mcpSaveRequest as SaveConfigRequest
    expect(mcp.change.kind).toBe('mcp')
    expect(mcp.expectedBaseline.assetId).toBe(mcp.assetId)
    const sop = fixture.sopSaveRequest as SaveConfigRequest
    expect(sop.change.kind).toBe('sop')
    expect(sop.expectedBaseline.assetId).toBe(sop.assetId)
    const orchestration = fixture.orchestrationSaveRequest as SaveConfigRequest
    expect(orchestration.change.kind).toBe('orchestration')
    expect(orchestration.expectedBaseline.assetId).toBe(orchestration.assetId)
    const hooks = fixture.hooksSaveRequest as SaveConfigRequest
    expect(hooks.change.kind).toBe('hooks')
    expect(hooks.expectedBaseline.assetId).toBe(hooks.assetId)
    const commands = fixture.commandsSaveRequest as SaveConfigRequest
    expect(commands.change.kind).toBe('commands')
    expect(commands.expectedBaseline.assetId).toBe(commands.assetId)
    const permissions = fixture.permissionsSaveRequest as SaveConfigRequest
    expect(permissions.change.kind).toBe('permissions')
    expect(permissions.expectedBaseline.assetId).toBe(permissions.assetId)
  })

  it('权限扩大确认绑定资产、内容哈希与过期时间', () => {
    const result = fixture.confirmationRequired as SaveConfigResult
    expect(result.kind).toBe('confirmation_required')
    if (result.kind !== 'confirmation_required') throw new Error('确认结果类型错误')
    expect(result.challenge.assetId).toBe(fixture.permissionsSaveRequest.assetId)
    expect(result.challenge.proposedContentHash).toMatch(hashPattern)
    expect(result.challenge.expiresAt).toMatch(/Z$/)
  })

  it('结果联合与事件使用 snake_case 判别值', () => {
    const failed = fixture.validationFailed as ValidationFailed
    const event = fixture.event as LocalServiceEvent
    expect(failed.kind).toBe('validation_failed')
    expect(event.kind).toBe('config_invalidated')
    expect(event.occurredAt).toMatch(/Z$/)
  })

  it('身份补记与恢复请求携带稳定资产和服务基线', () => {
    const recovery = fixture.identityRecoveryRequest as RecoverManagedAgentIdentityRequest
    const restore = fixture.identityRestoreRequest as RestoreManagedAgentIdentityRequest
    expect(recovery.recoveryRef).toBe('revision-identity-pending-1')
    expect(restore.expectedBaseline.assetId).toBe(restore.assetId)
    expect(restore.expectedBaseline.assetContentHash).toMatch(hashPattern)
    expect(restore.confirmed).toBe(true)
  })

  it('正式 Memory 使用独立空间、候选、审核和版本合同', () => {
    const space = memoryFixture.space as MemorySpaceDto
    const candidate = memoryFixture.candidate as MemoryCandidateDto
    const request = memoryFixture.reviewRequest as ReviewMemoryCandidateRequest
    const result = memoryFixture.savedResult as ReviewMemoryCandidateResult

    expect(space.scopeType).toBe('agent_long_term')
    expect(space.scopeKey).toEqual({ kind: 'agent_long_term', agentId: 'zhouce' })
    expect(space.owner).toEqual({ kind: 'agent', agentId: 'zhouce' })
    expect(space.stewardAgentId).toBe('zhouce')
    expect(space.storageProfileVersion).toBe('memory-v3')
    expect(space.storageLocator.relativePath).toBe('memory/long-term.md')
    expect(candidate.spaceId).toBe(space.id)
    expect(candidate.proposerAgentId).not.toBe(candidate.reviewPrincipal.kind === 'agent' ? candidate.reviewPrincipal.agentId : candidate.reviewPrincipal.teamId)
    expect(candidate.proposedContentHash).toMatch(hashPattern)
    expect(request.decision).toBe('approve')
    expect(request.expectedBaseline.assetId).toBe(space.id)
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') throw new Error('正式 Memory 保存结果类型错误')
    const revision = result.revision as MemoryRevisionDto
    expect(revision.candidateId).toBe(candidate.id)
    expect(revision.reviewDecisionId).toBe(result.decision.id)
    expect(revision.contentHash).toMatch(hashPattern)
    expect(result.writeReceipt.atomicReplace).toBe(true)
  })
})
