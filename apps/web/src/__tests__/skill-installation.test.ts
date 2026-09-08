import { describe, expect, it } from 'vitest'
import { applySkillAction, getSkillReferences, skillInstallationStatusLabels } from '../skill-installation'
import { initialAgents } from '../domain'

const available = { status: 'available' as const, availableVersion: '2.0.0', previousVersions: [] }

describe('Skill 安装生命周期', () => {
  it('安装、更新、回滚和卸载均保持明确状态', () => {
    const installed = applySkillAction(available, 'install')!
    expect(installed.installedVersion).toBe('2.0.0')
    const update = applySkillAction({ ...installed, status: 'update-available', availableVersion: '2.1.0' }, 'update')!
    expect(update.previousVersions).toContain('2.0.0')
    expect(applySkillAction(update, 'rollback', '2.0.0')?.installedVersion).toBe('2.0.0')
    expect(applySkillAction(update, 'uninstall')?.status).toBe('available')
  })

  it('拒绝非法转换', () => expect(applySkillAction(available, 'update')).toBeUndefined())

  it('定义完整的中文安装状态标签', () => {
    expect(skillInstallationStatusLabels).toEqual({
      available: '未安装',
      installed: '已安装',
      'update-available': '可更新',
    })
  })

  it('只读取显式引用而不修改 Agent', () => {
    const before = structuredClone(initialAgents)
    expect(getSkillReferences(initialAgents, 'skill-review').length).toBeGreaterThan(0)
    expect(initialAgents).toEqual(before)
  })

  it('卸载事实不会删除仍需诊断的引用', () => {
    const references = getSkillReferences(initialAgents, 'skill-review')
    const uninstalled = applySkillAction({ status: 'installed', installedVersion: '2.0.0', availableVersion: '2.0.0', previousVersions: ['1.0.0'] }, 'uninstall')!
    expect(uninstalled.status).toBe('available')
    expect(getSkillReferences(initialAgents, 'skill-review')).toEqual(references)
  })
})
