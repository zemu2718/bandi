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
  agentId: Id
  teamId: Id
  kind: 'instructions' | 'context' | 'rules' | 'skills' | 'mcp' | 'permissions' | 'sop' | 'hooks' | 'commands'
  officialScope: OfficialScope
  assetContentHash: ContentHash
  containerContentHash: ContentHash
  writable: boolean
  parseStatus: 'parsed' | 'invalid' | 'unsupported' | 'redacted'
  diagnostics: Diagnostic[]
}

export type ClaudeAgentPreviewDto = {
  toolId: import('./client-adapters').BuiltInClientId
  sourcePath: string
  sourceFileName: string
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
  outcome: 'terminal_launch_requested' | 'application_launch_requested' | 'manual_context_required'
  contextDelivery: 'initial_prompt' | 'manual_copy' | 'none'
  manualPrompt?: string
}

export type AiToolAvailability = 'installed' | 'not_found' | 'unsupported_platform' | 'detection_failed'
export type AiToolContextMode = 'initial_prompt' | 'manual_context' | 'unavailable'
export type AiToolInstallSource = 'npm' | 'homebrew' | 'native' | 'app_bundle' | 'unknown' | 'not_applicable'
export type AiToolVersionState = 'not_applicable' | 'unknown' | 'up_to_date' | 'update_available' | 'ahead_or_prerelease' | 'conflicting_installs'

export type AiToolHostStatusDto = {
  toolId: import('./client-adapters').BuiltInClientId
  availability: AiToolAvailability
  contextMode: AiToolContextMode
  configLocationLabel: string
  canRevealConfig: boolean
  canOpenOfficialInstallPage: boolean
  reasonCode: string
  currentVersion: string | null
  latestVersion: string | null
  installSource: AiToolInstallSource
  versionState: AiToolVersionState
  canUpgrade: boolean
  versionReasonCode: string
  installationCount: number
}

export type AiToolHostRequest = {
  toolId: import('./client-adapters').BuiltInClientId
  requestId: Id
}

export type AiToolUpgradePreviewDto = AiToolHostRequest & {
  previewRef: string
  currentVersion: string
  latestVersion: string
  installSource: AiToolInstallSource
  confirmationText: string
}

export type AiToolUpgradeCommitRequest = AiToolHostRequest & {
  previewRef: string
  confirmation: true
}

export type AiToolUpgradeResultDto = AiToolHostRequest & {
  outcome: 'updated' | 'already_current' | 'process_failed' | 'timed_out' | 'postcheck_failed' | 'version_unchanged' | 'target_changed' | 'unsupported_installation'
  previousVersion: string | null
  currentVersion: string | null
}

export type OpenAiToolInstallPageResultDto = AiToolHostRequest & {
  outcome: 'open_requested'
}

export type RevealAiToolConfigLocationResultDto = AiToolHostRequest & {
  outcome: 'revealed'
}

export type MemorySpaceDto = {
  id: Id
  agentId: Id
  state: 'active' | 'read_only_history'
  storageProfileVersion: 'memory-v4'
  storageLocator: AssetLocatorDto
  currentRevisionId?: Id
  contentHash: ContentHash
  updatedAt: Timestamp
}

export type LoadedMemoryDto = {
  requestId: Id
  space: MemorySpaceDto
  content: string
  baselineRef: BaselineRefDto
}

export type MemoryRevisionDto = {
  id: Id
  spaceId: Id
  parentRevisionId?: Id
  sourceContentHash: ContentHash
  contentHash: ContentHash
  writeReceiptId: Id
  writtenAt: Timestamp
}

export type DiscoverMemorySpacesRequest = { requestId: Id; agentId: Id }
export type DiscoverMemorySpacesResult = { requestId: Id; spaces: MemorySpaceDto[] }
export type LoadMemoryRequest = { requestId: Id; spaceId: Id; agentId: Id }

export type SaveMemoryRequest = LoadMemoryRequest & {
  content: string
  contentHash: ContentHash
  expectedBaseline: BaselineRefDto
}

export type SaveMemoryResult =
  | { kind: 'saved'; requestId: Id; memory: LoadedMemoryDto; revision: MemoryRevisionDto; writeReceipt: WriteReceiptDto }
  | { kind: 'baseline_changed'; requestId: Id; current: LoadedMemoryDto; proposedContentHash: ContentHash; diagnostics: Diagnostic[] }
  | { kind: 'revision_pending'; requestId: Id; journalId: Id; writeReceipt: WriteReceiptDto; diagnostics: Diagnostic[] }
  | ValidationFailed
  | { kind: 'save_failed'; requestId: Id; diagnostics: Diagnostic[]; retryable: boolean; fileState: string }

export type ListMemoryRevisionsRequest = LoadMemoryRequest
export type ReadMemoryRevisionContentRequest = LoadMemoryRequest & { revisionId: Id }
export type RestoreMemoryRevisionRequest = ReadMemoryRevisionContentRequest & {
  expectedBaseline: BaselineRefDto
  baseContent: string
  confirmed: boolean
}
export type RecoverMemoryRevisionRequest = LoadMemoryRequest & { journalId: Id }

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
}

export type SharedAssetKind = 'rule' | 'skill' | 'mcp' | 'sop' | 'hook' | 'command' | 'output_profile'
export type ManageableSharedAssetKind = Extract<SharedAssetKind, 'rule' | 'skill' | 'mcp' | 'sop'>

export type SharedAssetSourceDto =
  | { kind: 'authored' }
  | { kind: 'imported'; fileName: string; importedHash: ContentHash; importedAt: Timestamp }
  | { kind: 'legacy' }

export type SharedAssetNodeDto = {
  id: Id
  name: string
  kind: SharedAssetKind | 'unknown'
  teamId: Id
  locator: AssetLocatorDto
  contentHash: ContentHash
  containerContentHash: ContentHash
  writable: boolean
  source: SharedAssetSourceDto
  currentRevisionId?: Id
  parseStatus: 'parsed' | 'invalid'
  diagnostics: Diagnostic[]
}

export type SharedAssetWriteState = 'verified_written_registration_pending' | 'verified_written_revision_pending'

export type SharedAssetMutationResult =
  | { kind: 'saved'; requestId: Id; asset: SharedAssetNodeDto; revision: ConfigRevisionDto; writeReceipt: WriteReceiptDto }
  | { kind: 'registration_pending'; requestId: Id; asset: SharedAssetNodeDto; fileState: 'verified_written_registration_pending'; diagnostics?: Diagnostic[] }
  | { kind: 'revision_pending'; requestId: Id; asset: SharedAssetNodeDto; fileState: 'verified_written_revision_pending'; recoveryRef: Id; diagnostics?: Diagnostic[] }

export type SaveSharedAssetResult =
  | Exclude<SaveConfigResult, { kind: 'confirmation_required' }>
  | (Extract<SaveConfigResult, { kind: 'confirmation_required' }> & { affectedAgentIds?: Id[] })

export type CreateSharedAssetRequest = {
  requestId: Id
  teamId: Id
  assetId: Id
  name: string
  kind: ManageableSharedAssetKind
  content: string
}

export type SharedAssetImportPreviewDto = {
  requestId: Id
  previewRef: Id
  expiresAt: Timestamp
  fileName: string
  kind: ManageableSharedAssetKind
  size: number
  sourceHash: ContentHash
  suggestedName: string
  suggestedId: Id
  diagnostics: Diagnostic[]
}

export type CommitSharedAssetImportRequest = {
  requestId: Id
  previewRef: Id
  expectedSourceHash: ContentHash
  teamId: Id
  assetId: Id
  name: string
  confirmed: boolean
}

export type SharedAssetEditorDto = {
  requestId: Id
  asset: SharedAssetNodeDto
  canonicalContent: string
  baselineRef: BaselineRefDto
  currentRevisionId?: Id
}

export type SaveSharedAssetRequest = {
  requestId: Id
  assetId: Id
  expectedBaseline: BaselineRefDto
  baseContent: string
  proposedContent: string
  confirmationRef?: Id
}

export type RepairSharedAssetRegistrationRequest = { requestId: Id; assetId: Id }
export type RecoverSharedAssetRevisionRequest = { requestId: Id; assetId: Id; recoveryRef: Id }

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
