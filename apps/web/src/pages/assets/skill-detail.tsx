import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FieldRow, MockBoundaryNote, MonoPath, PageHeader, StatusBadge, toneForStatus } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import type { FullAsset } from '../../domain'
import { getSkillReferences, skillInstallationStatusLabels, type SkillAction } from '../../skill-installation'
import { useApp } from '../../state'
import { SkillActionDialog } from './skills-page'

export function SkillDetail({ asset }: { asset: FullAsset }) {
  const { state } = useApp()
  const [action, setAction] = useState<SkillAction>()
  const skill = asset.skill
  if (!skill) return null
  const refs = getSkillReferences(state.agents, asset.id)
  const desktop = state.runtime === 'desktop'

  return <><PageHeader backTo="/assets/skills" backLabel="返回技能列表" title={asset.name} description={`${asset.summary} · 技能安装与使用位置相互独立`} action={!desktop ? <div className="flex flex-wrap gap-2">{skill.installation.status === 'available' && <Button onClick={() => setAction('install')}>模拟安装</Button>}{skill.installation.status === 'update-available' && <Button onClick={() => setAction('update')}>模拟更新</Button>}{skill.installation.status !== 'available' && skill.installation.previousVersions.length > 0 && <Button variant="outline" onClick={() => setAction('rollback')}>模拟回滚</Button>}{skill.installation.status !== 'available' && <Button variant="outline" onClick={() => setAction('uninstall')}>模拟卸载</Button>}</div> : undefined} /><div className="grid gap-5 lg:grid-cols-[1fr_360px]"><section className="panel p-5"><FieldRow label="来源">{skill.source.kind === 'local' ? `本地 · ${skill.source.path}` : skill.source.kind === 'git' ? `Git · ${skill.source.repository}@${skill.source.ref}` : `${skill.source.provider} · Marketplace 预置演示`}</FieldRow><FieldRow label="交付方式">{skill.delivery.kind === 'plugin' ? `插件提供 · ${skill.delivery.pluginAssetId}` : '独立技能'}</FieldRow><FieldRow label="安装状态"><StatusBadge tone={toneForStatus(skill.installation.status)}>{skillInstallationStatusLabels[skill.installation.status]}</StatusBadge></FieldRow><FieldRow label="版本">当前 {skill.installation.installedVersion ?? '未安装'} · 可用 {skill.installation.availableVersion}</FieldRow><FieldRow label="历史版本">{skill.installation.previousVersions.join('、') || '无'}</FieldRow><FieldRow label="声明权限">{skill.review.permissions.join('；')}</FieldRow><FieldRow label="影响">{skill.review.impact.join('；')}</FieldRow><FieldRow label="文件">{skill.review.files.join('；')}</FieldRow><FieldRow label="演示路径"><MonoPath>{asset.path}</MonoPath></FieldRow></section><aside className="panel overflow-hidden"><div className="border-b border-border p-4"><b>使用位置</b><p className="mt-1 text-xs text-muted-foreground">安装操作不会自动修改以下配置。</p></div>{refs.length ? <div className="divide-y divide-border">{refs.map((ref) => <Link key={ref.agentId} to={`/agents/${ref.agentId}?tab=skills`} className="block p-4 hover:bg-muted"><b>{ref.agentName}</b><small className="mt-1 block text-muted-foreground">Agent 配置</small></Link>)}</div> : <p className="p-4 text-sm text-muted-foreground">暂无使用位置。</p>}</aside></div><div className="mt-5"><MockBoundaryNote>{desktop ? 'Desktop 当前只读展示已有的技能信息，不提供安装、更新、回滚或卸载。' : '本页不会下载、写入、删除文件或执行安装脚本；所有状态刷新后恢复初始演示数据。'}</MockBoundaryNote></div>{!desktop && action && <SkillActionDialog asset={asset} action={action} onClose={() => setAction(undefined)} />}</>
}
