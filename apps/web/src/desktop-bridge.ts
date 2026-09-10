import type { AppCommandId } from './app-commands'
import type { FullAgent } from './domain'
import type { AgentCommitResultDto, AgentListResult, AgentRecoveryOperationSummaryDto, AiToolHostRequest, AiToolHostStatusDto, AiToolUpgradeCommitRequest, AiToolUpgradePreviewDto, AiToolUpgradeResultDto, BackupRestorePreviewDto, BackupRestoreResultDto, BackupSnapshotDto, BaselineRefDto, ClaudeAgentPreviewDto, ClientLaunchResultV3, CommitManagedAgentDeletionRequest, CommitSharedAssetImportRequest, ConfigRevisionDto, CreateBackupSnapshotRequest, CreateSharedAssetRequest, DiscoverMemorySpacesRequest, DiscoverMemorySpacesResult, DiscoveryRequest, DiscoveryResult, ListMemoryRevisionsRequest, LoadEditorRequest, LoadEditorResult, LoadedMemoryDto, LoadMemoryRequest, ManagedAgentDeletionPreviewDto, ManagedAgentDeletionResultDto, ManagedAgentIdentityEditorResult, MemoryRevisionDto, LongTermDomainSnapshotDtoV4, OpenAiToolInstallPageResultDto, PreviewBackupRestoreRequest, PreviewManagedAgentDeletionRequest, ReadMemoryRevisionContentRequest, RecoverConfigRevisionRequest, RecoverManagedAgentIdentityRequest, RecoverMemoryRevisionRequest, RecoverSharedAssetRevisionRequest, RepairSharedAssetRegistrationRequest, RequestClientLaunchV3, RestoreBackupSnapshotRequest, RestoreConfigRevisionRequest, RestoreManagedAgentIdentityRequest, RestoreMemoryRevisionRequest, RevealAiToolConfigLocationResultDto, SaveConfigRequest, SaveConfigResult, SaveManagedAgentIdentityResult, SaveMemoryRequest, SaveMemoryResult, SaveSharedAssetRequest, SaveSharedAssetResult, SharedAssetEditorDto, SharedAssetImportPreviewDto, SharedAssetMutationResult, TaskBriefDto, TeamDto } from './contracts'

const commandEvent = 'bandi://app-command'

export function isDesktopRuntime(): boolean {
  return '__TAURI_INTERNALS__' in window
}

export async function listenForDesktopCommands(
  handler: (command: unknown) => void,
): Promise<() => void> {
  if (!isDesktopRuntime()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<unknown>(commandEvent, (event) => handler(event.payload))
}

export async function setDesktopTitle(title: string): Promise<void> {
  if (!isDesktopRuntime()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().setTitle(title)
}

export function desktopCommandEventName(): string {
  return commandEvent
}

export type DesktopCommand = AppCommandId
export type UiAssetSlot = 'logo' | 'background'

export type CapabilityStatus = 'supported' | 'degraded' | 'unavailable' | 'not_checked'
export type CapabilityFactDto = {
  status: CapabilityStatus
  reason: string
  evidence: string[]
  remediation: string[]
}

export type FactoryResetTargetDto = {
  id: string
  kind: 'file' | 'directory'
  state: 'present' | 'absent'
}

export type FactoryResetPreviewDto = {
  requestId: string
  previewRef: string
  expiresAt: string
  confirmationText: string
  targets: FactoryResetTargetDto[]
  canCommit: boolean
}

export type CommitFactoryResetRequest = {
  requestId: string
  previewRef: string
  confirmationText: string
}

export type FactoryResetResultDto = {
  requestId: string
  previewRef: string
  resetAt: string
  quarantinedTargetIds: string[]
  absentTargetIds: string[]
  requiresRestart: boolean
}

type UiAssetPayload = { mimeType: string; bytes: number[] }

async function invokeDesktop<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!isDesktopRuntime()) throw new Error('该系统功能仅在 Bandi Desktop 中可用')
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function requestClientLaunchV3(input: RequestClientLaunchV3): Promise<ClientLaunchResultV3> {
  return invokeDesktop<ClientLaunchResultV3>('request_client_launch_v3', { request: input })
}

export async function listAiToolHostStatuses(): Promise<AiToolHostStatusDto[]> {
  return invokeDesktop('list_ai_tool_host_statuses', {})
}

export async function openAiToolInstallPage(input: AiToolHostRequest): Promise<OpenAiToolInstallPageResultDto> {
  return invokeDesktop('open_ai_tool_install_page', { request: input })
}

export async function revealAiToolConfigLocation(input: AiToolHostRequest): Promise<RevealAiToolConfigLocationResultDto> {
  return invokeDesktop('reveal_ai_tool_config_location', { request: input })
}

export async function previewAiToolUpgrade(input: AiToolHostRequest): Promise<AiToolUpgradePreviewDto> {
  return invokeDesktop('preview_ai_tool_upgrade', { request: input })
}

export async function commitAiToolUpgrade(input: AiToolUpgradeCommitRequest): Promise<AiToolUpgradeResultDto> {
  return invokeDesktop('commit_ai_tool_upgrade', { request: input })
}

export async function previewFactoryReset(requestId: string): Promise<FactoryResetPreviewDto> {
  return invokeDesktop('preview_factory_reset', { request: { requestId } })
}

export async function commitFactoryReset(input: CommitFactoryResetRequest): Promise<FactoryResetResultDto> {
  return invokeDesktop('commit_factory_reset', { request: input })
}

export async function restartAfterFactoryReset(): Promise<void> {
  return invokeDesktop('restart_after_factory_reset', {})
}

export async function selectClaudeAgentFile(): Promise<string | null> {
  if (!isDesktopRuntime()) throw new Error('该系统功能仅在 Bandi Desktop 中可用')
  const { open } = await import('@tauri-apps/plugin-dialog')
  return open({ directory: false, multiple: false, filters: [{ name: 'Claude Agent', extensions: ['md'] }] })
}

export async function loadLongTermDomainSnapshotV4(): Promise<LongTermDomainSnapshotDtoV4> {
  return invokeDesktop('load_long_term_domain_snapshot_v4', {})
}

export async function saveTeamV4(team: TeamDto): Promise<TeamDto> {
  return invokeDesktop('save_team_v4', { team })
}

export async function removeTeamV4(teamId: string): Promise<void> {
  return invokeDesktop('remove_team_v4', { request: { teamId } })
}

export async function saveTaskBriefV4(taskBrief: TaskBriefDto): Promise<TaskBriefDto> {
  return invokeDesktop('save_task_brief_v4', { taskBrief })
}

export async function removeTaskBriefV4(taskBriefId: string): Promise<void> {
  return invokeDesktop('remove_task_brief_v4', { request: { taskBriefId } })
}

export async function generateEntityId(prefix: 'team' | 'task', name: string): Promise<string> {
  return invokeDesktop('generate_entity_id', { prefix, name })
}

export async function allocateAgentId(requestId: string): Promise<string> {
  return invokeDesktop('allocate_agent_id', { requestId })
}

export async function discoverMemorySpaces(input: DiscoverMemorySpacesRequest): Promise<DiscoverMemorySpacesResult> {
  return invokeDesktop('discover_memory_spaces', { request: input })
}

export async function loadMemory(input: LoadMemoryRequest): Promise<LoadedMemoryDto> {
  return invokeDesktop('load_memory', { request: input })
}

export async function saveMemory(input: SaveMemoryRequest): Promise<SaveMemoryResult> {
  return invokeDesktop('save_memory', { request: input })
}

export async function listMemoryRevisions(input: ListMemoryRevisionsRequest): Promise<MemoryRevisionDto[]> {
  return invokeDesktop('list_memory_revisions', { request: input })
}

export async function readMemoryRevisionContent(input: ReadMemoryRevisionContentRequest): Promise<string> {
  return invokeDesktop('read_memory_revision_content', { request: input })
}

export async function restoreMemoryRevision(input: RestoreMemoryRevisionRequest): Promise<SaveMemoryResult> {
  return invokeDesktop('restore_memory_revision', { request: input })
}

export async function recoverMemoryRevision(input: RecoverMemoryRevisionRequest): Promise<SaveMemoryResult> {
  return invokeDesktop('recover_memory_revision', { request: input })
}

export async function discoverConfig(input: DiscoveryRequest): Promise<DiscoveryResult> {
  return invokeDesktop('discover_config', { request: input })
}

export async function createSharedAsset(input: CreateSharedAssetRequest): Promise<SharedAssetMutationResult> {
  return invokeDesktop('create_shared_asset', { request: input })
}

export async function selectSharedAssetImport(requestId: string, teamId: string, kind: import('./contracts').ManageableSharedAssetKind): Promise<SharedAssetImportPreviewDto | null> {
  return invokeDesktop('select_shared_asset_import', { request: { requestId, teamId, kind } })
}

export async function commitSharedAssetImport(input: CommitSharedAssetImportRequest): Promise<SharedAssetMutationResult> {
  return invokeDesktop('commit_shared_asset_import', { request: input })
}

export async function loadSharedAssetEditor(requestId: string, assetId: string): Promise<SharedAssetEditorDto> {
  return invokeDesktop('load_shared_asset_editor', { request: { requestId, assetId } })
}

export async function saveSharedAsset(input: SaveSharedAssetRequest): Promise<SaveSharedAssetResult> {
  return invokeDesktop('save_shared_asset', { request: input })
}

export async function repairSharedAssetRegistration(input: RepairSharedAssetRegistrationRequest): Promise<SharedAssetMutationResult> {
  return invokeDesktop('repair_shared_asset_registration', { request: input })
}

export async function recoverSharedAssetRevision(input: RecoverSharedAssetRevisionRequest): Promise<SharedAssetMutationResult> {
  return invokeDesktop('recover_shared_asset_revision', { request: input })
}

export async function createBackupSnapshot(input: CreateBackupSnapshotRequest): Promise<BackupSnapshotDto> {
  return invokeDesktop('create_backup_snapshot', { request: input })
}

export async function listBackupSnapshots(): Promise<BackupSnapshotDto[]> {
  return invokeDesktop('list_backup_snapshots', {})
}

export async function previewBackupRestore(input: PreviewBackupRestoreRequest): Promise<BackupRestorePreviewDto> {
  return invokeDesktop('preview_backup_restore', { request: input })
}

export async function restoreBackupSnapshot(input: RestoreBackupSnapshotRequest): Promise<BackupRestoreResultDto> {
  return invokeDesktop('restore_backup_snapshot', { request: input })
}

export async function loadConfigEditor(input: LoadEditorRequest): Promise<LoadEditorResult> {
  return invokeDesktop('load_config_editor', { request: input })
}

export async function listConfigRevisions(assetId: string): Promise<ConfigRevisionDto[]> {
  return invokeDesktop('list_config_revisions', { assetId })
}

export async function readConfigRevisionContent(revisionId: string): Promise<string> {
  return invokeDesktop('read_config_revision_content', { revisionId })
}

export async function saveConfig(input: SaveConfigRequest): Promise<SaveConfigResult> {
  return invokeDesktop('save_config', { request: input })
}

export async function recoverConfigRevision(input: RecoverConfigRevisionRequest): Promise<SaveConfigResult> {
  return invokeDesktop('recover_config_revision', { request: input })
}

export async function restoreConfigRevision(input: RestoreConfigRevisionRequest): Promise<SaveConfigResult> {
  return invokeDesktop('restore_config_revision', { request: input })
}

export async function importUiAsset(slot: UiAssetSlot, file: File): Promise<void> {
  await invokeDesktop('import_ui_asset', { slot, bytes: Array.from(new Uint8Array(await file.arrayBuffer())) })
}

export async function readUiAsset(slot: UiAssetSlot): Promise<string | undefined> {
  const asset = await invokeDesktop<UiAssetPayload | null>('read_ui_asset', { slot })
  if (!asset) return undefined
  return URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }))
}

export async function deleteUiAsset(slot: UiAssetSlot): Promise<void> {
  await invokeDesktop('delete_ui_asset', { slot })
}

export async function readAgentAvatar(agentId: string): Promise<string | undefined> {
  const asset = await invokeDesktop<UiAssetPayload | null>('read_agent_avatar', { agentId })
  if (!asset) return undefined
  return URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mimeType }))
}

export type AgentPackageFileInput = { path: string; content: string }

export async function previewClaudeAgent(sourcePath: string): Promise<ClaudeAgentPreviewDto> {
  const result = await invokeDesktop<{ preview: ClaudeAgentPreviewDto }>('preview_claude_agent', { request: { sourcePath } })
  return result.preview
}

export async function importClaudeAgent(
  sourcePath: string,
  expectedSourceBaselineHash: string,
  requestId: string,
  agent: FullAgent,
  files: AgentPackageFileInput[],
): Promise<AgentCommitResultDto> {
  return invokeDesktop('import_claude_agent', {
    request: {
      sourcePath,
      expectedSourceBaselineHash,
      confirmed: true,
      commit: {
        requestId,
        create: { agentId: agent.id, agent, files },
        team: { teamId: agent.teamId },
      },
    },
  })
}

export async function commitManagedAgentCreation(
  requestId: string,
  agent: FullAgent,
  files: AgentPackageFileInput[],
  avatar?: File,
  teamId?: string,
): Promise<AgentCommitResultDto> {
  return invokeDesktop('commit_managed_agent_creation', {
    request: {
      requestId,
      create: {
        agentId: agent.id,
        agent,
        files,
        avatarBytes: avatar
          ? Array.from(new Uint8Array(await avatar.arrayBuffer()))
          : undefined,
      },
      team: { teamId: teamId ?? agent.teamId },
    },
  })
}

export async function loadManagedAgentIdentity(agentId: string): Promise<ManagedAgentIdentityEditorResult> {
  return invokeDesktop('load_managed_agent_identity', { agentId })
}

export async function commitManagedAgentIdentity(
  requestId: string,
  agent: FullAgent,
  manifest: string,
  expectedBaseline: BaselineRefDto,
  baseContent: string,
  avatar: { kind: 'keep' } | { kind: 'remove' } | { kind: 'replace'; file: File },
): Promise<AgentCommitResultDto> {
  return invokeDesktop('commit_managed_agent_identity', {
    request: {
      save: {
        requestId,
        agentId: agent.id,
        agent,
        manifest,
        expectedBaseline,
        baseContent,
        avatar: avatar.kind === 'replace'
          ? {
              kind: 'replace',
              bytes: Array.from(new Uint8Array(await avatar.file.arrayBuffer())),
            }
          : avatar,
      },
      team: { teamId: agent.teamId },
    },
  })
}

export async function listAgentRecoveryOperations(): Promise<AgentRecoveryOperationSummaryDto[]> {
  return invokeDesktop('list_agent_recovery_summaries', { agentId: null })
}

export async function continueAgentRecovery(operationId: string): Promise<AgentCommitResultDto> {
  return invokeDesktop('continue_agent_recovery', { request: { operationId } })
}

export async function recoverManagedAgentIdentity(
  input: RecoverManagedAgentIdentityRequest,
): Promise<SaveManagedAgentIdentityResult> {
  return invokeDesktop('recover_managed_agent_identity', { request: input })
}

export async function restoreManagedAgentIdentity(
  input: RestoreManagedAgentIdentityRequest,
): Promise<SaveManagedAgentIdentityResult> {
  return invokeDesktop('restore_managed_agent_identity', { request: input })
}

export async function listAgents(): Promise<AgentListResult> {
  return invokeDesktop('list_agents', {})
}

export async function previewManagedAgentDeletion(
  input: PreviewManagedAgentDeletionRequest,
): Promise<ManagedAgentDeletionPreviewDto> {
  return invokeDesktop('preview_managed_agent_deletion', { request: input })
}

export async function commitManagedAgentDeletion(
  input: CommitManagedAgentDeletionRequest,
): Promise<ManagedAgentDeletionResultDto> {
  return invokeDesktop('commit_managed_agent_deletion', { request: input })
}
