import type { ConfigRevision, EvidenceKind } from './domain'

export type RevisionOwner = Pick<ConfigRevision, 'ownerType' | 'ownerId' | 'path'>

export function demoContentHash(content: string): string {
  let hash = 0
  for (const character of content) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `demo-${hash.toString(16).padStart(8, '0')}`
}

export function listConfigRevisions(revisions: ConfigRevision[], owner: RevisionOwner): ConfigRevision[] {
  return revisions.filter((item) => item.ownerType === owner.ownerType && item.ownerId === owner.ownerId && item.path === owner.path)
}

export function getLatestConfigRevision(revisions: ConfigRevision[], owner: RevisionOwner): ConfigRevision | undefined {
  return listConfigRevisions(revisions, owner)[0]
}

export function appendConfigRevision(
  revisions: ConfigRevision[],
  input: RevisionOwner & Pick<ConfigRevision, 'content' | 'summary'> & {
    restoredFromRevisionId?: string
    evidence?: EvidenceKind
    payload?: unknown
  },
): { revisions: ConfigRevision[]; revision: ConfigRevision; created: boolean } {
  const previous = getLatestConfigRevision(revisions, input)
  const contentHash = demoContentHash(input.content)
  if (previous?.contentHash === contentHash && previous.content === input.content) {
    return { revisions, revision: previous, created: false }
  }
  const sequence = listConfigRevisions(revisions, input).length + 1
  const revision: ConfigRevision = {
    ...input,
    id: `cfg-${input.ownerType}-${input.ownerId}-${sequence}`,
    parentRevisionId: previous?.id,
    contentHash,
    savedAt: '刚刚',
    evidence: input.evidence ?? 'memory-only',
  }
  return { revisions: [revision, ...revisions], revision, created: true }
}

export function getLatestAgentRevision(revisions: ConfigRevision[], agentId: string): ConfigRevision | undefined {
  return revisions.find((item) => item.ownerType === 'agent' && item.ownerId === agentId)
}
