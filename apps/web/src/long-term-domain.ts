import type { OrganizationSnapshotV3, TaskBriefDto, TeamDto } from './contracts'

export type LongTermDomainView = { teams: TeamDto[]; taskBriefs: TaskBriefDto[] }

export function organizationV3ToView(snapshot: OrganizationSnapshotV3): LongTermDomainView {
  return { teams: snapshot.teams, taskBriefs: snapshot.taskBriefs }
}
