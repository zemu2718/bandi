import { describe, expect, it } from 'vitest'
import { buildBackupPreview, createDemoSnapshot, NEVER_BACKED_UP } from '../backup-policy'
import { initialAgents, initialTeams } from '../domain'

const context = { agents: initialAgents, teams: initialTeams }

describe('备份策略', () => {
  it('解析四类合法范围', () => {
    expect(buildBackupPreview(context, { kind: 'all' })?.includesFormalMemory).toBe(true)
    expect(buildBackupPreview(context, { kind: 'team', teamId: 'xinghe' })).toBeDefined()
    expect(buildBackupPreview(context, { kind: 'agent', agentId: 'zhouce' })).toBeDefined()
    expect(buildBackupPreview(context, { kind: 'files', paths: ['agent.yaml'] })).toBeDefined()
  })

  it('拒绝缺失对象和空文件范围', () => {
    expect(buildBackupPreview(context, { kind: 'team', teamId: 'missing' })).toBeUndefined()
    expect(buildBackupPreview(context, { kind: 'files', paths: [] })).toBeUndefined()
  })

  it('固定排除敏感和执行数据', () => {
    const preview = buildBackupPreview(context, { kind: 'all' })!
    expect(preview.excludes).toEqual(NEVER_BACKED_UP)
    expect(preview.includes).not.toContain('个性化设置')
    const snapshot = createDemoSnapshot(preview, { id: 'snap-2', createdAt: '刚刚' })
    expect(snapshot.remoteStatus).toBe('private-git-not-connected')
    expect(snapshot.localPath).toContain('snap-2')
  })
})
