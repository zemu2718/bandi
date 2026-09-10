import { describe, expect, it } from 'vitest'
import fixture from '../../../../packages/contracts/fixtures/core-contracts.valid.json'
import type {
  BaselineRefDto,
  Diagnostic,
  LocalServiceEvent,
  MemoryRevisionDto,
  MemorySpaceDto,
  RecoverManagedAgentIdentityRequest,
  RestoreManagedAgentIdentityRequest,
  SaveConfigRequest,
  SaveConfigResult,
  SaveMemoryRequest,
  SaveMemoryResult,
  ValidationFailed,
} from '../contracts'

const hash = `sha256:${'a'.repeat(64)}` as const
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

  it('保存请求覆盖 Agent 自身长期配置', () => {
    const requests = [
      fixture.saveRequest,
      fixture.contextSaveRequest,
      fixture.rulesSaveRequest,
      fixture.skillsSaveRequest,
      fixture.mcpSaveRequest,
      fixture.permissionsSaveRequest,
      fixture.sopSaveRequest,
      fixture.hooksSaveRequest,
      fixture.commandsSaveRequest,
    ] as SaveConfigRequest[]
    expect(requests.map((request) => request.change.kind)).toEqual([
      'instructions', 'context', 'rules', 'skills', 'mcp',
      'permissions', 'sop', 'hooks', 'commands',
    ])
    expect(requests.every((request) => request.expectedBaseline.assetId === request.assetId)).toBe(true)
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

  it('长期 Memory 直接保存并生成独立 revision', () => {
    const space: MemorySpaceDto = {
      id: 'memory-agent-zhouce',
      agentId: 'zhouce',
      storageProfileVersion: 'memory-v4',
      state: 'active',
      storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' },
      currentRevisionId: 'memory-revision-2',
      contentHash: hash,
      updatedAt: '2026-09-01T00:02:00Z',
    }
    const baseline = { id: 'memory-baseline', assetId: space.id, containerId: space.id, assetContentHash: hash, containerContentHash: hash, targetExists: true }
    const request: SaveMemoryRequest = { requestId: 'save-memory-1', spaceId: space.id, agentId: space.agentId, content: '新的长期事实', contentHash: hash, expectedBaseline: baseline }
    const revision: MemoryRevisionDto = {
      id: 'memory-revision-2',
      spaceId: space.id,
      parentRevisionId: 'memory-revision-1',
      sourceContentHash: hash,
      contentHash: hash,
      writeReceiptId: 'memory-write-2',
      writtenAt: space.updatedAt,
    }
    const result: SaveMemoryResult = {
      kind: 'saved', requestId: request.requestId, memory: { requestId: request.requestId, space, content: request.content, baselineRef: baseline }, revision,
      writeReceipt: { id: 'memory-write-2', containerId: space.id, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: space.updatedAt, atomicReplace: true },
    }

    expect(request.spaceId).toBe(space.id)
    expect(space.storageProfileVersion).toBe('memory-v4')
    expect(result.kind).toBe('saved')
    if (result.kind !== 'saved') throw new Error('长期 Memory 保存结果类型错误')
    expect(result.revision.parentRevisionId).toBe('memory-revision-1')
    expect(result.revision.contentHash).toMatch(hashPattern)
    expect(result.writeReceipt.atomicReplace).toBe(true)
  })
})
