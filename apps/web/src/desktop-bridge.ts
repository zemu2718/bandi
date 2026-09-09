import type { AppCommandId } from './app-commands'
import type { FullAgent } from './domain'
import type { AgentCommitResultDto, AgentListResult, AgentRecoveryOperationSummaryDto, BackupRestorePreviewDto, BackupRestoreResultDto, BackupSnapshotDto, BaselineRefDto, ClaudeAgentPreviewDto, ClientLaunchResultV3, CommitManagedAgentDeletionRequest, ConfigRevisionDto, CreateBackupSnapshotRequest, DiscoveryRequest, DiscoveryResult, HostIntegrationCommitRequest, HostIntegrationDto, HostIntegrationPreviewDto, HostIntegrationRequest, HostIntegrationResultDto, ListMemoryRevisionsRequest, LoadEditorRequest, LoadEditorResult, ManagedAgentDeletionPreviewDto, ManagedAgentDeletionResultDto, ManagedAgentIdentityEditorResult, MemoryRevisionDto, LongTermDomainSnapshotDtoV4, PreviewBackupRestoreRequest, PreviewManagedAgentDeletionRequest, RecoverConfigRevisionRequest, RecoverManagedAgentIdentityRequest, RequestClientLaunchV3, RestoreBackupSnapshotRequest, RestoreConfigRevisionRequest, RestoreManagedAgentIdentityRequest, RevealHostDirectoryResultDto, SaveConfigRequest, SaveConfigResult, SaveManagedAgentIdentityResult, SaveMemoryRequest, SaveMemoryResult, TaskBriefDto, TeamDto } from './contracts'

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

export type ToolPlanDto = { id: string; name: string; toolIds: string[] }
export type CustomToolDto = { id: string; name: string }
export type ToolConfigurationSnapshotDto = {
  revision: number
  selectedPlanId: string
  builtInToolIds: string[]
  plans: ToolPlanDto[]
  customTools: CustomToolDto[]
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

export async function listHostIntegrations(): Promise<HostIntegrationDto[]> {
  return invokeDesktop('list_host_integrations', {})
}

export async function previewHostIntegrationInstall(input: HostIntegrationRequest): Promise<HostIntegrationPreviewDto> {
  return invokeDesktop('preview_host_integration_install', { request: input })
}

export async function commitHostIntegrationInstall(input: HostIntegrationCommitRequest): Promise<HostIntegrationResultDto> {
  return invokeDesktop('commit_host_integration_install', { request: input })
}

export async function previewHostIntegrationUninstall(input: HostIntegrationRequest): Promise<HostIntegrationPreviewDto> {
  return invokeDesktop('preview_host_integration_uninstall', { request: input })
}

export async function commitHostIntegrationUninstall(input: HostIntegrationCommitRequest): Promise<HostIntegrationResultDto> {
  return invokeDesktop('commit_host_integration_uninstall', { request: input })
}

export async function revealHostDirectory(input: HostIntegrationRequest): Promise<RevealHostDirectoryResultDto> {
  return invokeDesktop('reveal_host_directory', { request: input })
}

export async function loadToolConfiguration(): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('load_tool_configuration', {})
}

export async function saveToolPlan(plan: ToolPlanDto, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('save_tool_plan', { request: { plan, expectedRevision } })
}

export async function createToolPlan(plan: ToolPlanDto, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('create_tool_plan', { request: { plan, expectedRevision } })
}

export async function copyToolPlan(sourcePlanId: string, planId: string, name: string, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('copy_tool_plan', { request: { sourcePlanId, planId, name, expectedRevision } })
}

export async function deleteToolPlan(planId: string, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('delete_tool_plan', { request: { planId, expectedRevision } })
}

export async function selectToolPlan(planId: string, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('select_tool_plan', { request: { planId, expectedRevision } })
}

export async function saveCustomTool(tool: CustomToolDto, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('save_custom_tool', { request: { tool, expectedRevision } })
}

export async function deleteCustomTool(toolId: string, expectedRevision: number): Promise<ToolConfigurationSnapshotDto> {
  return invokeDesktop('delete_custom_tool', { request: { toolId, expectedRevision } })
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

export async function saveMemory(input: SaveMemoryRequest): Promise<SaveMemoryResult> {
  return invokeDesktop('save_memory', { request: input })
}

export async function listMemoryRevisions(input: ListMemoryRevisionsRequest): Promise<MemoryRevisionDto[]> {
  return invokeDesktop('list_memory_revisions', { request: input })
}

export async function discoverConfig(input: DiscoveryRequest): Promise<DiscoveryResult> {
  return invokeDesktop('discover_config', { request: input })
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
