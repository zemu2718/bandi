import { describe, expect, it } from 'vitest'
import { assetCategoryForKind, countDiscoveredAssetCategories, filterDiscoveredAssets, groupAssetReferences, projectDiscoveredAssets, projectSharedAssets } from '../discovered-assets'
import type { DiscoveryResult, SharedAssetNodeDto } from '../contracts'

const hash = `sha256:${'a'.repeat(64)}` as const
const asset = (changes: Partial<SharedAssetNodeDto> = {}): SharedAssetNodeDto => ({
  id: 'skill-review', name: '代码审查', kind: 'skill', teamId: 'team-one',
  locator: { rootKind: 'bandi', displayPath: 'skill-review/SKILL.md', relativePath: 'skill-review/SKILL.md' },
  contentHash: hash, containerContentHash: hash, writable: true, source: { kind: 'authored' }, parseStatus: 'parsed', diagnostics: [], ...changes,
})
const discovery = (changes: Partial<DiscoveryResult> = {}): DiscoveryResult => ({ requestId: 'discover', profileVersion: 'agent-package-v1', containers: [], assets: [], sharedAssets: [asset()], references: [], diagnostics: [], ...changes })

describe('独立共享资产投影', () => {
  it('只把共享资产投影为列表，Agent 配置节点不成为资产行', () => {
    const rows = projectDiscoveredAssets(discovery({ assets: [{ id: 'config-skills', containerId: 'container', agentId: 'a', teamId: 'team-one', kind: 'skills', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }] }))
    expect(rows.map((item) => item.id)).toEqual(['skill-review'])
    expect(rows[0]).toMatchObject({ label: '代码审查', source: 'Bandi 新增', writable: true })
  })

  it('保留同 Team 引用，按 Agent ID 去重并隔离其他 Team', () => {
    const reference = { sourceAssetId: 'source-1', sourceContainerId: 'container-1', referrerKind: 'agent' as const, referrerId: 'agent-a', targetAssetId: 'skill-review', targetKind: 'skill' as const, state: 'resolved' as const, targetTeamId: 'team-one', sourcePath: 'config/skills.yaml' }
    const rows = projectDiscoveredAssets(discovery({ references: [reference, { ...reference, sourceAssetId: 'source-2' }, { ...reference, referrerId: 'agent-b', targetTeamId: 'team-two' }] }))
    expect(rows[0]).toMatchObject({ incomingReferences: 1, unresolvedReferences: 0 })
    expect(rows[0].referenceSummaries.map((item) => item.agentId)).toEqual(['agent-a'])
    expect(projectSharedAssets([asset()], [reference, { ...reference, sourceAssetId: 'source-2' }])[0].references).toHaveLength(1)
  })

  it('聚合同一 Agent 的异常引用状态', () => {
    const base = { sourceAssetId: 'one', sourceContainerId: 'container', referrerKind: 'agent' as const, referrerId: 'agent-a', targetAssetId: 'skill-review', targetKind: 'skill' as const, state: 'resolved' as const, sourcePath: 'config/skills.yaml' }
    const groups = groupAssetReferences([base, { ...base, sourceAssetId: 'two', state: 'type_mismatch' }])
    expect(groups).toEqual([expect.objectContaining({ agentId: 'agent-a', states: ['resolved', 'type_mismatch'] })])
  })

  it('按分类、Agent 使用方、搜索和健康状态筛选', () => {
    const rows = projectDiscoveredAssets(discovery({ sharedAssets: [asset(), asset({ id: 'mcp-linear', name: 'Linear', kind: 'mcp' }), asset({ id: 'secret', teamId: 'team-two' })], references: [{ sourceAssetId: 'source', sourceContainerId: 'container', referrerKind: 'agent', referrerId: 'agent-a', targetAssetId: 'skill-review', targetKind: 'skill', state: 'resolved', targetTeamId: 'team-one', sourcePath: 'config/skills.yaml' }] }))
    expect(countDiscoveredAssetCategories(rows.filter((item) => item.teamId === 'team-one'))).toEqual({ skills: 1, mcp: 1, rules: 0, sop: 0, other: 0 })
    expect(filterDiscoveredAssets(rows, { teamId: 'team-one', category: 'skills', query: '审查', owner: 'agent-a', health: 'parsed', agentNames: new Map([['agent-a', '周策']]) }).map((item) => item.id)).toEqual(['skill-review'])
    expect(filterDiscoveredAssets(rows, { teamId: 'team-one', category: 'overview', query: 'secret' })).toEqual([])
  })

  it('统一四类资产并把扩展类型归入其他', () => {
    expect(assetCategoryForKind('skill')).toBe('skills'); expect(assetCategoryForKind('rule')).toBe('rules'); expect(assetCategoryForKind('mcp')).toBe('mcp'); expect(assetCategoryForKind('sop')).toBe('sop'); expect(assetCategoryForKind('hook')).toBe('other')
  })
})
