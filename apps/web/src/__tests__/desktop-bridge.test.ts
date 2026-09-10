// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaselineRefDto } from '../contracts'
import type { FullAgent } from '../domain'
import {
  commitManagedAgentCreation,
  commitManagedAgentIdentity,
  commitSharedAssetImport,
  importClaudeAgent,
  selectSharedAssetImport,
} from '../desktop-bridge'

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))

const agent = { id: 'agent-reviewer', teamId: 'team-product' } as FullAgent
const baseline: BaselineRefDto = {
  id: 'baseline-1',
  assetId: 'agent-reviewer',
  containerId: 'agent-reviewer',
  assetContentHash: 'sha256:asset',
  containerContentHash: 'sha256:container',
}

beforeEach(() => {
  tauri.invoke.mockReset().mockResolvedValue({})
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
})

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})

describe('Desktop bridge Agent Team 请求', () => {
  it('创建时发送嵌套 Team，并保留显式 Team 覆盖', async () => {
    await commitManagedAgentCreation('request-1', agent, [], undefined, 'team-override')

    expect(tauri.invoke).toHaveBeenCalledWith('commit_managed_agent_creation', {
      request: {
        requestId: 'request-1',
        create: { agentId: agent.id, agent, files: [], avatarBytes: undefined },
        team: { teamId: 'team-override' },
      },
    })
  })

  it('导入时在 commit 内发送嵌套 Team', async () => {
    await importClaudeAgent('/tmp/reviewer.md', 'sha256:source', 'request-2', agent, [])

    expect(tauri.invoke).toHaveBeenCalledWith('import_claude_agent', {
      request: {
        sourcePath: '/tmp/reviewer.md',
        expectedSourceBaselineHash: 'sha256:source',
        confirmed: true,
        commit: {
          requestId: 'request-2',
          create: { agentId: agent.id, agent, files: [] },
          team: { teamId: agent.teamId },
        },
      },
    })
  })

  it('保存身份时发送嵌套 Team', async () => {
    await commitManagedAgentIdentity('request-3', agent, 'manifest', baseline, 'base', { kind: 'keep' })

    expect(tauri.invoke).toHaveBeenCalledWith('commit_managed_agent_identity', {
      request: {
        save: {
          requestId: 'request-3',
          agentId: agent.id,
          agent,
          manifest: 'manifest',
          expectedBaseline: baseline,
          baseContent: 'base',
          avatar: { kind: 'keep' },
        },
        team: { teamId: agent.teamId },
      },
    })
  })

  it('共享资产导入只提交 opaque previewRef，不提交路径或文件内容', async () => {
    await selectSharedAssetImport('request-4', 'team-product', 'skill')
    expect(tauri.invoke).toHaveBeenCalledWith('select_shared_asset_import', {
      request: { requestId: 'request-4', teamId: 'team-product', kind: 'skill' },
    })

    await commitSharedAssetImport({
      requestId: 'request-5',
      previewRef: 'preview-1',
      expectedSourceHash: 'sha256:source',
      teamId: 'team-product',
      assetId: 'skill-review',
      name: '代码审查',
      confirmed: true,
    })
    expect(tauri.invoke).toHaveBeenLastCalledWith('commit_shared_asset_import', {
      request: {
        requestId: 'request-5',
        previewRef: 'preview-1',
        expectedSourceHash: 'sha256:source',
        teamId: 'team-product',
        assetId: 'skill-review',
        name: '代码审查',
        confirmed: true,
      },
    })
    expect(JSON.stringify(tauri.invoke.mock.lastCall)).not.toMatch(/sourcePath|bytes/)
  })
})
