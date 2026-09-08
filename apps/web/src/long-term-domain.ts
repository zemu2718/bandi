import type { LongTermDomainSnapshotDtoV4, TaskBriefDto, TeamDto } from './contracts'

export type LongTermDomainView = { teams: TeamDto[]; taskBriefs: TaskBriefDto[] }

export function longTermDomainV4ToView(snapshot: LongTermDomainSnapshotDtoV4): LongTermDomainView {
  return { teams: snapshot.teams, taskBriefs: snapshot.taskBriefs }
}
