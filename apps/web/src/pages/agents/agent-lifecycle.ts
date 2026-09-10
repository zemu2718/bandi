import type { Dispatch } from 'react'
import { applyAgentConfig, serializeAgentConfig, type AgentIdentityConfig } from '../../agent-config-model'
import { commitManagedAgentIdentity, isDesktopRuntime, loadManagedAgentIdentity } from '../../desktop-bridge'
import type { FullAgent } from '../../domain'
import type { Action } from '../../state'

export type AgentLifecycleSaveResult =
  | { kind: 'saved' }
  | { kind: 'baseline_changed'; loaded: Awaited<ReturnType<typeof loadManagedAgentIdentity>>; result: Extract<Awaited<ReturnType<typeof commitManagedAgentIdentity>>['identityResult'], { kind: 'baseline_changed' }> }
  | { kind: 'failed'; message: string; recoveryRef?: string }

export function agentIdentityConfig(agent: FullAgent): AgentIdentityConfig {
  return {
    schemaVersion: 1,
    id: agent.id,
    name: agent.name,
    status: agent.status,
    teamId: agent.teamId,
    avatarPath: agent.avatarPath,
    functionId: agent.functionId,
    mission: agent.mission,
    responsibilities: agent.responsibilities,
    deliverables: agent.deliverables,
    decisionBoundaries: agent.decisionBoundaries,
    escalationConditions: agent.escalationConditions,
    prohibitions: agent.prohibitions,
    completionDefinition: agent.completionDefinition,
  }
}

export function canPersistAgentIdentity(agent: FullAgent): boolean {
  return isDesktopRuntime()
    && agent.packageSource.kind !== 'external-reference'
    && agent.packageSource.kind !== 'bandi-demo'
    && agent.packageSchema.compatibility === 'current'
}

export async function saveAgentLifecycle({
  agent,
  status,
  requestId,
  dispatch,
}: {
  agent: FullAgent
  status: FullAgent['status']
  requestId: string
  dispatch: Dispatch<Action>
}): Promise<AgentLifecycleSaveResult> {
  if (!canPersistAgentIdentity(agent)) {
    dispatch({ type: 'SET_AGENT_LIFECYCLE', agentId: agent.id, status })
    return { kind: 'saved' }
  }

  const value = { ...agentIdentityConfig(agent), status }
  const applied = applyAgentConfig(agent, { kind: 'identity', value })
  const manifest = serializeAgentConfig(agent, { kind: 'identity', value })
  if (!applied || !manifest) return { kind: 'failed', message: '生命周期配置无法序列化。' }

  const loaded = await loadManagedAgentIdentity(agent.id)
  const commit = await commitManagedAgentIdentity(requestId, applied, manifest, loaded.baselineRef, loaded.canonicalContent, { kind: 'keep' })
  dispatch({ type: 'SYNC_AGENT_RECOVERY', operation: commit.operation, agent: commit.agent })

  const result = commit.identityResult
  if (result?.kind === 'baseline_changed') return { kind: 'baseline_changed', loaded, result }
  if (result?.kind === 'validation_failed' || result?.kind === 'save_failed') {
    return {
      kind: 'failed',
      message: result.diagnostics.map((item) => item.message).join('；') || '生命周期保存失败。',
      recoveryRef: result.kind === 'save_failed' ? result.recoveryRef : undefined,
    }
  }
  if (commit.operation.status !== 'completed' || !commit.agent) {
    return {
      kind: 'failed',
      message: commit.operation.status === 'blocked'
        ? 'Agent 配置内容已发生变化，Bandi 未自动覆盖。请进入详情处理。'
        : '生命周期尚未完整保存，请从配置状态中的待处理项继续修复。',
    }
  }

  dispatch({ type: 'UPSERT_MANAGED_AGENT', agent: commit.agent, message: lifecycleSuccessMessage(agent.status, status) })
  return { kind: 'saved' }
}

export function lifecycleSuccessMessage(previous: FullAgent['status'], next: FullAgent['status']): string {
  if (previous === 'archived' && next === 'inactive') return 'Agent 已移回当前列表并保持停用'
  if (next === 'archived') return 'Agent 已归档'
  if (next === 'inactive') return 'Agent 已停用'
  return 'Agent 已重新启用'
}
