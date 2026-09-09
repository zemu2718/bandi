import { describe, expect, it } from 'vitest'
import { assetCategoryForKind, countDiscoveredAssetCategories, filterDiscoveredAssets, groupAssetReferences, groupDiscoveryDiagnostics, projectDiscoveredAssets, projectSharedAssets, type DiscoveredAssetRow } from '../discovered-assets'

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
      assets: [{ id: 'asset-1', containerId: 'container-1', kind: 'mcp', officialScope: 'managed', agentId: 'zhouce', teamId: 'team-personal', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'unsupported', diagnostics: [{ code: 'future_schema', severity: 'warning', message: '未来版本只读' }] }],
      sharedAssets: [],
      references: [{ sourceAssetId: 'asset-1', sourceContainerId: 'container-1', referrerKind: 'agent', referrerId: 'zhouce', targetAssetId: 'mcp-bandi', targetKind: 'mcp', state: 'unresolved', sourcePath: 'config/mcp.yaml' }],
      diagnostics: [],
    })

    expect(rows[0]).toMatchObject({ path: 'config/mcp.yaml', agentId: 'zhouce', teamId: 'team-personal', writable: false, readOnlyReason: 'future schema', parseStatus: 'unsupported', outgoingReferences: 1, unresolvedReferences: 1 })
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
      assets: [{ id: 'asset-2', containerId: 'missing', kind: 'skills', officialScope: 'managed', agentId: 'zhouce', teamId: 'team-personal', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }],
      sharedAssets: [],
      references: [],
      diagnostics: [],
    })

    expect(rows[0]).toMatchObject({ path: '配置来源缺失', agentId: 'zhouce', teamId: 'team-personal', writable: false })
    expect(rows[0].diagnostics[0].code).toBe('asset_container_missing')
  })

  it('统一资产分类并将扩展类型归入其他', () => {
    expect(assetCategoryForKind('skills')).toBe('skills')
    expect(assetCategoryForKind('skill')).toBe('skills')
    expect(assetCategoryForKind('rules')).toBe('rules')
    expect(assetCategoryForKind('rule')).toBe('rules')
    expect(assetCategoryForKind('mcp')).toBe('mcp')
    expect(assetCategoryForKind('sop')).toBe('sop')
    for (const kind of ['instructions', 'permissions', 'hooks', 'unknown']) {
      expect(assetCategoryForKind(kind)).toBe('other')
    }
  })

  it('先按 Team 隔离，再按分类、搜索和筛选派生列表', () => {
    const row = (id: string, kind: string, teamId: string, agentId = 'zhouce'): DiscoveredAssetRow => ({
      id,
      label: `${id}.yaml`,
      source: '受管 Agent 配置',
      nodeType: 'config',
      teamId,
      agentId,
      kind,
      scope: 'managed',
      path: `config/${id}.yaml`,
      writable: true,
      parseStatus: 'parsed',
      profileVersion: 'agent-package-v1',
      diagnostics: [],
      references: [],
      referenceSummaries: [],
      outgoingReferences: 0,
      incomingReferences: 0,
      unresolvedReferences: 0,
    })
    const rows = [row('review', 'skills', 'team-one'), row('linear', 'mcp', 'team-one'), row('secret', 'skills', 'team-two')]
    const teamRows = filterDiscoveredAssets(rows, { teamId: 'team-one', category: 'overview' })

    expect(countDiscoveredAssetCategories(teamRows)).toEqual({ skills: 1, mcp: 1, rules: 0, sop: 0, other: 0 })
    expect(filterDiscoveredAssets(rows, {
      teamId: 'team-one',
      category: 'skills',
      query: '周策',
      owner: 'zhouce',
      scope: 'managed',
      health: 'parsed',
      agentNames: new Map([['zhouce', '周策']]),
    }).map((item) => item.id)).toEqual(['review'])
    expect(filterDiscoveredAssets(rows, { teamId: 'team-one', category: 'skills', query: 'secret' })).toEqual([])
  })
})
