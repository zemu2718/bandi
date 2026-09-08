export type Id = string
export type ContentHash = `sha256:${string}`
export type Timestamp = string

export type BaselineRefDto = {
  id: Id
  assetId: Id
  containerId: Id
  assetContentHash: ContentHash
  containerContentHash: ContentHash
  targetExists?: boolean
}

export type Diagnostic = {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
  field?: string
  path?: string
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }
  remediation?: string
}

export type AgentListResult = {
  agents: import('./domain').FullAgent[]
  diagnostics: Diagnostic[]
}

export type ManagedAgentDeletionImpactDto = {
  id: Id
  label: string
  detail: string
  remediation?: string
}

export type ManagedAgentDeletionImpactsDto = {
  sharedAssetReferences: ManagedAgentDeletionImpactDto[]
  organizationRelationships: ManagedAgentDeletionImpactDto[]
  formalMemory: ManagedAgentDeletionImpactDto[]
  automaticCleanup: ManagedAgentDeletionImpactDto[]
  historyAndBackups: ManagedAgentDeletionImpactDto[]
  blockers: ManagedAgentDeletionImpactDto[]
}

export type PreviewManagedAgentDeletionRequest = {
  requestId: Id
  agentId: Id
}

export type ManagedAgentDeletionPreviewDto = PreviewManagedAgentDeletionRequest & {
  previewRef: Id
  confirmationText: string
  expiresAt: Timestamp
  packageFingerprint: string
  impacts: ManagedAgentDeletionImpactsDto
  canCommit: boolean
}

export type CommitManagedAgentDeletionRequest = PreviewManagedAgentDeletionRequest & {
  previewRef: Id
  confirmationText: string
}

export type ManagedAgentDeletionResultDto = PreviewManagedAgentDeletionRequest & {
  operationId: Id
  createdAt: Timestamp
  status: 'completed' | 'cleanup_pending'
  deletedConfigRevisions: number
  safeReason?: string
  pendingCleanup: string[]
}

export type SaveConfigOwner = {
  agentId: Id
}

export type SaveConfigRequest = {
  requestId: Id
  assetId: Id
  expectedOwner: SaveConfigOwner
  change:
    | { kind: 'instructions'; value: string }
    | { kind: 'context'; value: string }
    | { kind: 'rules'; value: string }
    | { kind: 'skills'; value: string }
    | { kind: 'mcp'; value: string }
    | { kind: 'permissions'; value: string }
    | { kind: 'sop'; value: string }
    | { kind: 'hooks'; value: string }
    | { kind: 'commands'; value: string }
  expectedBaseline: BaselineRefDto
  baseContent: string
  confirmationRef?: Id
}

export type WriteReceiptDto = {
  id: Id
  containerId: Id
  previousContainerHash: ContentHash
  writtenContainerHash: ContentHash
  verifiedAt: Timestamp
  atomicReplace: boolean
}

export type ConfigRevisionDto = {
  id: Id
  assetId: Id
  containerId: Id
  locator: AssetLocatorDto
  assetContentHash: ContentHash
  containerContentHash: ContentHash
  sourceAssetBaselineHash: ContentHash
  sourceContainerBaselineHash: ContentHash
  redacted: boolean
  writeReceiptId: Id
  savedAt: Timestamp
  summary: string
  confirmationRefs: Id[]
  restoredFromRevisionId?: Id
}

export type RestoreConfigRevisionRequest = {
  requestId: Id
  assetId: Id
  revisionId: Id
  expectedBaseline: BaselineRefDto
  baseContent: string
  confirmed: boolean
  confirmationRef?: Id
}

export type RecoverConfigRevisionRequest = {
  requestId: Id
  assetId: Id
  recoveryRef: Id
}

export type ConfigSide = {
  content: string
  assetContentHash: ContentHash
  containerContentHash: ContentHash
  redacted: boolean
}

export type ValidationFailed = {
  kind: 'validation_failed'
  requestId: Id
  diagnostics: Diagnostic[]
}

export type ConfirmationChallenge = {
  id: Id
  assetId: Id
  proposedContentHash: ContentHash
  expiresAt: Timestamp
  reason: string
}

export type SaveConfigResult =
  | { kind: 'saved'; requestId: Id; asset: SourceAssetSummaryDto; revision: ConfigRevisionDto; writeReceipt: WriteReceiptDto }
  | { kind: 'unchanged'; requestId: Id; asset: SourceAssetSummaryDto }
  | { kind: 'baseline_changed'; requestId: Id; assetId: Id; containerId: Id; locator: AssetLocatorDto; base: ConfigSide; current: ConfigSide; proposed: ConfigSide; diagnostics: Diagnostic[] }
  | { kind: 'confirmation_required'; requestId: Id; challenge: ConfirmationChallenge; diagnostics: Diagnostic[] }
  | ValidationFailed
  | { kind: 'save_failed'; requestId: Id; diagnostics: Diagnostic[]; retryable: boolean; fileState: 'unchanged' | 'write_not_verified' | 'verified_written_revision_pending'; recoveryRef?: Id }

export type ManagedAgentIdentityEditorResult = {
  assetId: Id
  containerId: Id
  locator: AssetLocatorDto
  canonicalContent: string
  baselineRef: BaselineRefDto
}

export type SaveManagedAgentIdentityResult =
  | { kind: 'saved'; requestId: Id; agent: import('./domain').FullAgent; baselineRef: BaselineRefDto; revision: ConfigRevisionDto; writeReceipt: WriteReceiptDto }
  | { kind: 'unchanged'; requestId: Id; agent: import('./domain').FullAgent; baselineRef: BaselineRefDto }
  | { kind: 'baseline_changed'; requestId: Id; assetId: Id; containerId: Id; locator: AssetLocatorDto; base: ConfigSide; current: ConfigSide; proposed: ConfigSide; diagnostics: Diagnostic[] }
  | ValidationFailed
  | { kind: 'save_failed'; requestId: Id; diagnostics: Diagnostic[]; retryable: boolean; fileState: 'unchanged' | 'write_not_verified' | 'verified_written_revision_pending'; recoveryRef?: Id }

export type RecoverManagedAgentIdentityRequest = {
  requestId: Id
  agentId: Id
  assetId: Id
  recoveryRef: Id
}

export type RestoreManagedAgentIdentityRequest = {
  requestId: Id
  agentId: Id
  assetId: Id
  revisionId: Id
  expectedBaseline: BaselineRefDto
  baseContent: string
  confirmed: boolean
}

export type RootKind = 'claude_user' | 'managed' | 'bandi' | 'authorized_external'
export type OfficialScope = 'user' | 'local' | 'managed' | 'bandi'

export type AssetLocatorDto = {
  rootKind: RootKind
  displayPath: string
  relativePath?: string
}

export type SourceContainerDto = {
  id: Id
  locator: AssetLocatorDto
  format: 'json' | 'jsonc' | 'yaml' | 'toml' | 'markdown' | 'directory'
  contentHash: ContentHash
  writable: boolean
  readOnlyReason?: string
}

export type SourceAssetSummaryDto = {
  id: Id
  containerId: Id
  kind: 'instructions' | 'context' | 'rules' | 'skills' | 'mcp' | 'permissions' | 'sop' | 'hooks' | 'commands'
  officialScope: OfficialScope
  assetContentHash: ContentHash
  containerContentHash: ContentHash
  writable: boolean
  parseStatus: 'parsed' | 'invalid' | 'unsupported' | 'redacted'
  diagnostics: Diagnostic[]
}

export type ClaudeAgentPreviewDto = {
  sourcePath: string
  sourceBaselineHash: ContentHash
  name: string
  description?: string
  instructions: string
  recognizedFields: string[]
  ignoredFields: string[]
}

export type AgentRecoveryStatus =
  | 'prepared'
  | 'filesystem_committed'
  | 'revision_pending'
  | 'team_pending'
  | 'database_committed'
  | 'blocked'
  | 'completed'

export type AgentRecoveryOperationSummaryDto = {
  id: Id
  agentId: Id
  operationKind: 'create' | 'identity_update' | 'delete'
  status: AgentRecoveryStatus
  createdAt: Timestamp
  completedAt?: Timestamp
  safeReason?: string
}

export type AgentCommitResultDto = {
  operation: AgentRecoveryOperationSummaryDto
  agent?: import('./domain').FullAgent
  identityResult?: SaveManagedAgentIdentityResult
}

export type TeamDto = {
  id: Id
  name: string
  mark?: string
  color?: string
  mission?: string
  boundary?: string
  memberAgentIds: Id[]
  sharedAssetIds: Id[]
}

export type TaskBriefDto = {
  id: Id
  teamId: Id
  title: string
  goal: string
  context: string
  constraints: string
  expectedOutput: string
  archivedAt?: Timestamp
}

export type LongTermDomainSnapshotDtoV4 = {
  schemaVersion: 4
  teams: TeamDto[]
  taskBriefs: TaskBriefDto[]
}

export type RequestClientLaunchV3 = {
  clientId: import('./client-adapters').BuiltInClientId
  adapterId: import('./client-adapters').ClientAdapterId
  terminalId: import('./terminal-model').TerminalId
  intent: 'start_with_context'
  teamId: Id
  agentId: Id
  taskId?: Id
}

export type ClientLaunchResultV3 = RequestClientLaunchV3 & {
  capability: {
    status: 'supported' | 'degraded' | 'unavailable' | 'not_checked'
    reason: string
    evidence: string[]
    remediation: string[]
  }
  outcome: 'context_prepared'
}

export type FormalMemoryScopeType = 'agent_long_term'
export type FormalMemoryScopeTypeV3 = FormalMemoryScopeType

export type MemoryScopeKeyDto = { kind: 'agent_long_term'; agentId: Id }
export type MemoryScopeKeyV3Dto = MemoryScopeKeyDto

export type MemoryOwnerDto = { kind: 'agent'; agentId: Id }
export type MemoryOwnerV3Dto = MemoryOwnerDto

export type MemorySpaceDto = {
  id: Id
  scopeType: FormalMemoryScopeType
  scopeKey: MemoryScopeKeyDto
  owner: MemoryOwnerDto
  visibilityPolicy: 'agent_private'
  storageProfileVersion: 'memory-v4'
  state: 'active' | 'read_only_history'
  storageLocator: AssetLocatorDto
  currentRevisionId?: Id
  contentHash: ContentHash
  updatedAt: Timestamp
}

export type MemoryRevisionDto = {
  id: Id
  spaceId: Id
  parentRevisionId?: Id
  contentHash: ContentHash
  storageLocator: AssetLocatorDto
  writeReceiptId: Id
  writtenAt: Timestamp
}

export type SaveMemoryRequest = {
  requestId: Id
  spaceId: Id
  content: string
}

export type SaveMemoryResult =
  | { kind: 'saved'; requestId: Id; space: MemorySpaceDto; revision: MemoryRevisionDto; writeReceipt: WriteReceiptDto }
  | { kind: 'unchanged'; requestId: Id; space: MemorySpaceDto }
  | ValidationFailed
  | { kind: 'save_failed'; requestId: Id; diagnostics: Diagnostic[]; retryable: boolean }

export type ListMemoryRevisionsRequest = {
  requestId: Id
  spaceId: Id
}

export type CreateBackupSnapshotRequest = {
  requestId: Id
  scope: { kind: 'files'; assetIds: Id[] }
}

export type BackupSnapshotEntryDto = {
  assetId: Id
  containerId: Id
  kind: SourceAssetSummaryDto['kind']
  locator: AssetLocatorDto
  assetContentHash: ContentHash
  containerContentHash: ContentHash
  snapshotContentHash: ContentHash
  sizeBytes: number
  redacted: false
}

export type BackupSnapshotDto = {
  id: Id
  kind: 'manual' | 'pre_restore'
  scope: 'files'
  createdAt: Timestamp
  entryCount: number
  manifestHash: ContentHash
  integrity: 'verified' | 'failed'
  entries: BackupSnapshotEntryDto[]
}

export type PreviewBackupRestoreRequest = {
  requestId: Id
  snapshotId: Id
  assetIds: Id[]
}

export type BackupRestorePreviewEntryDto = {
  assetId: Id
  status: 'ready' | 'baseline_changed' | 'missing_current' | 'integrity_failed' | 'unavailable'
  snapshotContentHash: ContentHash
  currentBaseline?: BaselineRefDto
  diagnostics?: Diagnostic[]
}

export type BackupRestorePreviewDto = {
  requestId: Id
  previewRef: Id
  snapshotId: Id
  expiresAt: Timestamp
  entries: BackupRestorePreviewEntryDto[]
  canRestore: boolean
  requiresConfirmation: true
}

export type RestoreBackupSnapshotRequest = {
  requestId: Id
  snapshotId: Id
  assetIds: Id[]
  previewRef: Id
  confirmed: true
}

export type BackupRestoreEntryResultDto = {
  assetId: Id
  status: 'restored' | 'baseline_changed' | 'integrity_failed' | 'validation_failed' | 'save_failed' | 'skipped'
  revisionId?: Id
  retryable?: boolean
  fileState?: 'unchanged' | 'write_not_verified' | 'verified_written_revision_pending'
  recoveryRef?: Id
  diagnostics?: Diagnostic[]
}

export type BackupRestoreResultDto = {
  kind: 'restored' | 'partial_failure' | 'restore_failed'
  requestId: Id
  snapshotId: Id
  preRestoreSnapshotId: Id
  entries: BackupRestoreEntryResultDto[]
}

export type DiscoveryRequest = {
  requestId: Id
  includeClaudeUserRoot: boolean
}

export type SharedAssetKind = 'rule' | 'skill' | 'mcp' | 'sop' | 'hook' | 'command' | 'output_profile'

export type SharedAssetNodeDto = {
  id: Id
  kind: SharedAssetKind | 'unknown'
  teamId: Id
  locator: AssetLocatorDto
  contentHash: ContentHash
  parseStatus: 'parsed' | 'invalid'
  diagnostics: Diagnostic[]
}

export type AssetReferenceDto = {
  sourceAssetId: Id
  sourceContainerId: Id
  referrerKind: 'agent'
  referrerId: Id
  targetAssetId: Id
  targetKind: SharedAssetKind
  state: 'resolved' | 'unresolved' | 'dangling' | 'type_mismatch' | 'out_of_scope' | 'target_invalid'
  targetLocator?: AssetLocatorDto
  targetTeamId?: Id
  sourcePath: string
}

export type DiscoveryResult = {
  requestId: Id
  profileVersion: string
  containers: SourceContainerDto[]
  assets: SourceAssetSummaryDto[]
  sharedAssets: SharedAssetNodeDto[]
  references: AssetReferenceDto[]
  diagnostics: Diagnostic[]
}

export type LoadEditorRequest = { requestId: Id; assetId: Id }

export type LoadEditorResult = {
  requestId: Id
  asset: SourceAssetSummaryDto
  canonicalContent: string
  redacted: boolean
  baselineRef: BaselineRefDto
  diagnostics: Diagnostic[]
}

export type LocalServiceEvent =
  | { kind: 'config_invalidated'; eventId: Id; occurredAt: Timestamp; assetIds: Id[]; reason: 'external_change' | 'discovery_changed' | 'parser_changed' }
  | { kind: 'operation_progress'; eventId: Id; occurredAt: Timestamp; operationId: Id; operationKind: 'discovery' | 'backup' | 'restore'; phase: string; completed: number; total?: number; message?: string }
