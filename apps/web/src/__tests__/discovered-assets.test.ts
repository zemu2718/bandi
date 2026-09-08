import { describe, expect, it } from 'vitest'
import { groupAssetReferences, groupDiscoveryDiagnostics, projectDiscoveredAssets, projectSharedAssets } from '../discovered-assets'

const hash = `sha256:${'a'.repeat(64)}` as const

describe('真实资产发现投影', () => {
  it('将共享索引转换为 Agent 可用的引用候选并跳过未知类型', () => {
    const assets = projectSharedAssets([
      { id: 'skill-review', kind: 'skill', teamId: 'team-personal', locator: { rootKind: 'bandi', displayPath: '/tmp/shared/skills/code-review', relativePath: 'skills/code-review' }, contentHash: hash, parseStatus: 'parsed', diagnostics: [] },
      { id: 'unknown', kind: 'unknown', teamId: 'team-personal', locator: { rootKind: 'bandi', displayPath: '/tmp/shared/unknown' }, contentHash: hash, parseStatus: 'invalid', diagnostics: [] },
    ])

    expect(assets).toEqual([expect.objectContaining({ id: 'skill-review', name: 'skill-review', kind: 'Skill', path: 'skills/code-review', sourceType: '显式共享' })])
  })

  it('连接来源容器并保留只读与诊断事实', () => {
    const rows = projectDiscoveredAssets({
      requestId: 'discover-1',
      profileVersion: 'agent-package-v1',
      containers: [{ id: 'container-1', locator: { rootKind: 'managed', displayPath: 'config/mcp.yaml', relativePath: 'config/mcp.yaml' }, format: 'yaml', contentHash: hash, writable: false, readOnlyReason: 'future schema' }],
      assets: [{ id: 'asset-1', containerId: 'container-1', kind: 'mcp', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'unsupported', diagnostics: [{ code: 'future_schema', severity: 'warning', message: '未来版本只读' }] }],
      sharedAssets: [],
      references: [{ sourceAssetId: 'asset-1', sourceContainerId: 'container-1', referrerKind: 'agent', referrerId: 'zhouce', targetAssetId: 'mcp-bandi', targetKind: 'mcp', state: 'unresolved', sourcePath: 'config/mcp.yaml' }],
      diagnostics: [],
    })

    expect(rows[0]).toMatchObject({ path: 'config/mcp.yaml', writable: false, readOnlyReason: 'future schema', parseStatus: 'unsupported', outgoingReferences: 1, unresolvedReferences: 1 })
    expect(rows[0].diagnostics[0].message).toBe('未来版本只读')
  })

  it('按 Agent 配置聚合缺失文件并保留原始诊断', () => {
    const diagnostics = ['rules', 'skills', 'mcp', 'sop', 'hooks', 'commands'].map((kind) => ({
      code: `${kind}_missing`, severity: 'warning' as const, source: 'agt_a', message: `缺少 ${kind}`, path: `config/${kind}.yaml`,
    }))
    const groups = groupDiscoveryDiagnostics([
      ...diagnostics,
      { code: 'shared_asset_root_not_initialized', severity: 'info', message: '共享资产根未初始化' },
    ])

    expect(groups[0]).toMatchObject({ title: 'agt_a 缺少配置文件', severity: 'warning' })
    expect(groups[0].diagnostics).toHaveLength(6)
    expect(groups[0].diagnostics.map((item) => item.path)).toEqual(diagnostics.map((item) => item.path))
    expect(groups[1]).toMatchObject({ severity: 'info', title: '共享资产尚未启用，不影响查看受管 Agent 配置' })
  })

  it('按状态、目标和类型汇总引用且保留每条来源边', () => {
    const reference = {
      sourceAssetId: 'asset-1', sourceContainerId: 'container-1', referrerKind: 'agent' as const,
      referrerId: 'zhouce', targetAssetId: 'skill-review', targetKind: 'skill' as const,
      state: 'resolved' as const, sourcePath: 'config/skills.yaml',
    }
    const groups = groupAssetReferences([
      reference,
      { ...reference, sourceAssetId: 'asset-2', sourcePath: 'config/other-skills.yaml' },
      { ...reference, state: 'dangling' },
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ state: 'resolved', targetAssetId: 'skill-review', targetKind: 'skill' })
    expect(groups[0].references).toHaveLength(2)
    expect(groups[1].references).toHaveLength(1)
  })

  it('来源容器缺失时不伪造路径或可写能力', () => {
    const rows = projectDiscoveredAssets({
      requestId: 'discover-2',
      profileVersion: 'agent-package-v1',
      containers: [],
      assets: [{ id: 'asset-2', containerId: 'missing', kind: 'skills', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }],
      sharedAssets: [],
      references: [],
      diagnostics: [],
    })

    expect(rows[0]).toMatchObject({ path: '来源容器缺失', writable: false })
    expect(rows[0].diagnostics[0].code).toBe('asset_container_missing')
  })
})
