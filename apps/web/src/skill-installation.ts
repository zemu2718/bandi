import type { FullAgent, FullAsset, SkillInstallation } from './domain'

export type SkillAction = 'install' | 'update' | 'rollback' | 'uninstall'

export const skillInstallationStatusLabels: Record<SkillInstallation['status'], string> = {
  available: '未安装',
  installed: '已安装',
  'update-available': '可更新',
}

export function isSkillAsset(asset: FullAsset): asset is FullAsset & { skill: NonNullable<FullAsset['skill']> } {
  return asset.kind === 'Skill' && Boolean(asset.skill)
}

export function applySkillAction(installation: SkillInstallation, action: SkillAction, version?: string): SkillInstallation | undefined {
  if (action === 'install' && installation.status === 'available') return { ...installation, status: 'installed', installedVersion: installation.availableVersion }
  if (action === 'update' && installation.status === 'update-available' && installation.installedVersion) {
    return { ...installation, status: 'installed', previousVersions: [installation.installedVersion, ...installation.previousVersions.filter((item) => item !== installation.installedVersion)], installedVersion: installation.availableVersion }
  }
  if (action === 'rollback' && version && installation.previousVersions.includes(version) && installation.installedVersion) {
    return { ...installation, status: installation.availableVersion === version ? 'installed' : 'update-available', previousVersions: [installation.installedVersion, ...installation.previousVersions.filter((item) => item !== version && item !== installation.installedVersion)], installedVersion: version }
  }
  if (action === 'uninstall' && installation.status !== 'available') return { ...installation, status: 'available', installedVersion: undefined }
  return undefined
}

export function getSkillReferences(agents: FullAgent[], skillId: string) {
  return agents.flatMap((agent) => {
    const references = [] as { agentId: string; agentName: string }[]
    if (agent.skillRefs.includes(skillId)) references.push({ agentId: agent.id, agentName: agent.name })
    return references
  })
}
