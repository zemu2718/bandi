import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { EmptyState, EntityNotFound, FieldRow, PageHeader, StatusBadge } from '../../components/app/page'
import { useApp } from '../../state'
import { assetKindLabel } from '../../presentation'

export function OrganizationPage() {
  const { state, dispatch } = useApp()
  const createTeam = () => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'organization', entity: 'team', mode: 'create' } })
  return <>
    <PageHeader title="Team" description="管理 Team、由 Agent 归属派生的成员，以及显式共享资产。" action={<Button onClick={createTeam}>创建 Team</Button>} />
    {state.teams.length ? <section className="panel divide-y divide-border">{state.teams.map((team) => {
      const memberCount = state.agents.filter((agent) => agent.teamId === team.id).length
      const sharedCount = state.assets.filter((asset) => asset.teamId === team.id && asset.sourceType === '显式共享').length
      return <Link key={team.id} to={`/organization/teams/${team.id}`} className="flex min-h-16 items-center justify-between gap-4 p-5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><span className="min-w-0"><b className="block truncate">{team.name}</b><small className="mt-1 block text-muted-foreground">{memberCount} 个 Agent · {sharedCount} 项共享资产</small></span><StatusBadge tone={team.id === 'team-personal' ? 'neutral' : 'success'}>{team.id === 'team-personal' ? '固定' : '可管理'}</StatusBadge></Link>
    })}</section> : <section className="panel p-6"><EmptyState title="还没有 Team" description="创建 Team 后即可归属 Agent 和管理共享资产。" action={<Button onClick={createTeam}>创建 Team</Button>} /></section>}
  </>
}

export function TeamDetailPage() {
  const { id } = useParams()
  const { state, dispatch } = useApp()
  const team = state.teams.find((item) => item.id === id)
  useEffect(() => {
    if (team && team.id !== state.currentTeamId) dispatch({ type: 'SELECT_TEAM', teamId: team.id })
  }, [dispatch, state.currentTeamId, team])
  if (!team) return <EntityNotFound entity="Team" backTo="/organization" />
  const members = state.agents.filter((agent) => agent.teamId === team.id)
  const shared = state.assets.filter((asset) => asset.teamId === team.id && asset.sourceType === '显式共享')
  return <>
    <PageHeader backTo="/organization" title={team.name} description="Team 成员由 Agent 的 Team 归属自动派生；共享资产必须显式引用。" action={<Button variant="outline" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'organization', entity: 'team', id: team.id, mode: 'edit' } })}>编辑 Team</Button>} />
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel p-5"><h3 className="font-semibold">Team 信息</h3><FieldRow label="使命">{team.mission || '未设置'}</FieldRow><FieldRow label="边界">{team.boundary || '未设置'}</FieldRow></section>
      <section className="panel p-5"><h3 className="font-semibold">成员</h3><div className="mt-4 space-y-2">{members.map((agent) => <Link key={agent.id} to={`/agents/${agent.id}`} className="flex min-h-11 items-center justify-between rounded-lg border border-border px-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>{agent.name}</span><StatusBadge tone={agent.status === 'active' ? 'success' : 'neutral'}>{agent.status === 'active' ? '已启用' : agent.status === 'inactive' ? '已停用' : '已归档'}</StatusBadge></Link>)}{!members.length && <p className="text-sm text-muted-foreground">当前没有归属此 Team 的 Agent。</p>}</div></section>
    </div>
    <section className="panel mt-5 p-5"><h3 className="font-semibold">共享资产</h3><div className="mt-4 divide-y divide-border">{shared.map((asset) => <Link key={asset.id} to={`/assets/${asset.id}`} className="flex min-h-12 items-center justify-between gap-4 py-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>{asset.name}</span><small className="text-muted-foreground">{assetKindLabel(asset.kind)}</small></Link>)}{!shared.length && <p className="text-sm text-muted-foreground">当前没有显式共享资产。</p>}</div></section>
  </>
}
