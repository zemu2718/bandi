import { describe, expect, it } from 'vitest'
import launchV3 from '../../../../packages/contracts/fixtures/client-launch-v3.valid.json'
import { clientAdapterCatalog } from '../client-adapters'
import type { ClientLaunchResultV3, RequestClientLaunchV3 } from '../contracts'

describe('客户端启动共享合同', () => {
  it('v3 只准备受控 Team、Agent 与可选 TaskBrief 上下文', () => {
    const value = launchV3 as RequestClientLaunchV3

    expect(value).toMatchObject({
      teamId: 'team-acme',
      agentId: 'agent-owner',
      taskId: 'brief-contracts',
      intent: 'start_with_context',
    })
    expect(value).not.toHaveProperty('projectId')
    expect(value).not.toHaveProperty('directoryId')
    expect(value).not.toHaveProperty('command')
    expect(value).not.toHaveProperty('cwd')
    expect(value).not.toHaveProperty('prompt')
    expect({
      ...value,
      capability: {
        status: 'supported',
        reason: '已验证',
        evidence: ['固定适配器'],
        remediation: ['无需处理'],
      },
      outcome: 'context_prepared',
    } satisfies ClientLaunchResultV3).toBeTruthy()
  })

  it('静态 Adapter 目录覆盖九个内置工具且只启用受控启动', () => {
    expect(Object.keys(clientAdapterCatalog)).toHaveLength(9)
    expect(clientAdapterCatalog['claude-code'].launch).toEqual({
      clientId: 'claude-code',
      adapterId: 'claude-code-terminal-v1',
    })
    expect(clientAdapterCatalog.codex.launch).toEqual({
      clientId: 'codex',
      adapterId: 'codex-terminal-v1',
    })
    expect(Object.values(clientAdapterCatalog).filter((item) => item.launch)).toHaveLength(2)
  })
})
