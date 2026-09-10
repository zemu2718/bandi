import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react'
import { aiClients as initialAiClients, type AiClient } from './mock'
import {
  initialAgents,
  initialAssets,
  initialBackupSnapshots,
  initialTeams,
  initialConfigRevisions,
  initialMemorySpaces,
  initialPluginInstallations,
  type BackupSnapshot,
  type ConfigRevision,
  type FullAgent,
  type FullAsset,
  type MemorySpace,
} from './domain'
import { applyPluginAction, type PluginAction, type PluginInstallation } from './plugin-installation'
import { applySkillAction, type SkillAction } from './skill-installation'
import { getAgentPackageEditability } from './agent-package-schema'
import { applyAgentConfig, describeAgentConfigFile, getAgentConfigPath, isAgentConfigPayload, serializeAgentConfig, snapshotAgentConfig, type AgentConfigPayload, type SaveAgentConfigInput } from './agent-config-model'
import { appendConfigRevision } from './config-revisions'
import { projectSharedAssets } from './discovered-assets'
import type { AgentRecoveryOperationSummaryDto, AssetReferenceDto, Diagnostic, LongTermDomainSnapshotDtoV4, SharedAssetNodeDto, TaskBriefDto, TeamDto } from './contracts'
import type { TerminalId } from './terminal-model'
import type { MainMenuLayoutPreference } from './navigation-layout'
import type { UsageGuideTopic } from './components/usage-guide'
import { discoverConfig, isDesktopRuntime, listAgentRecoveryOperations, listAgents, loadLongTermDomainSnapshotV4 } from './desktop-bridge'
import { longTermDomainV4ToView } from './long-term-domain'
import {
  DEFAULT_UI_PREFERENCES,
  getAccessibleAccent,
  loadUiPreferences,
  resolveTheme,
  saveUiPreferences,
  type EffectiveTheme,
  type UiPreferences,
} from './ui-preferences'

export type NoticeTone = 'success' | 'info' | 'warning' | 'error'

export type Notice = {
  id: string
  tone: NoticeTone
  title: string
  description?: string
  duration?: number
}

export type DialogState =
  | { kind: 'diff'; assetId?: string; agentId?: string; path?: string }
  | { kind: 'source'; assetId?: string; agentId?: string; section?: string }
  | { kind: 'shared'; assetId: string; changes?: Partial<FullAsset>; message?: string }
  | { kind: 'conflict'; assetId?: string; agentId?: string }
  | { kind: 'permission'; agentId: string; nextFiles?: string }
  | { kind: 'client-guide'; clientId?: string; agentId?: string }
  | { kind: 'usage-guide'; topic: UsageGuideTopic }
  | { kind: 'config-history'; ownerType: ConfigRevision['ownerType']; ownerId: string; path: string }
  | { kind: 'backup-restore'; snapshotId: string }
  | { kind: 'organization'; entity: 'team'; id?: string; mode: 'create' | 'edit'; returnTo?: '/agents' }
  | null

export type BackupSettings = {
  gitConnection: { status: 'disconnected'; visibility: 'private' } | { status: 'connected-demo'; visibility: 'private'; repository: string }
  formalMemoryRemote: 'excluded' | 'confirmed'
}

export type NetworkProxySettings = {
  mode: 'system' | 'none' | 'manual'
  httpProxy: string
  httpsProxy: string
  socksProxy: string
  noProxy: string
}

export type SettingsState = {
  language: '简体中文' | 'English'
  agentRoot: string
  terminal: TerminalId
  externalChangeInterval: '手动' | '5 分钟' | '15 分钟'
  autoSnapshot: boolean
  networkProxy: NetworkProxySettings
}

export type OnboardingState = {
  status: 'active' | 'completed'
}

export type HydrationStatus = 'idle' | 'loading' | 'succeeded' | 'failed'
export type HydrationKey = 'managedAgents' | 'organization' | 'sharedAssets' | 'agentRecovery'
export type FactoryResetLifecycle =
  | { status: 'idle' }
  | { status: 'legacy-database-required'; technicalDetails: string }
  | { status: 'committed' }
  | { status: 'restarting' }
  | { status: 'manual-restart-required'; technicalDetails?: string }

export type State = {
  runtime: 'web' | 'desktop'
  hydration: Record<HydrationKey, HydrationStatus>
  hydrationErrors: Partial<Record<HydrationKey, string>>
  factoryReset: FactoryResetLifecycle
  agentDiagnostics: Diagnostic[]
  agentRecoveryOperations: AgentRecoveryOperationSummaryDto[]
  onboarding: OnboardingState
  agents: FullAgent[]
  teams: TeamDto[]
  currentTeamId: string
  taskBriefs: TaskBriefDto[]
  assets: FullAsset[]
  sharedAssets: SharedAssetNodeDto[]
  assetReferences: AssetReferenceDto[]
  pluginInstallations: PluginInstallation[]
  memorySpaces: MemorySpace[]
  configRevisions: ConfigRevision[]
  backupSnapshots: BackupSnapshot[]
  backupSettings: BackupSettings
  settings: SettingsState
  aiClients: AiClient[]
  recentAgentIds: string[]
  uiPreferences: UiPreferences
  theme: EffectiveTheme
  mainMenuLayoutPreference: MainMenuLayoutPreference
  dialog: DialogState
  notice?: Notice
}

export type Action =
  | { type: 'THEME'; effectiveTheme?: EffectiveTheme }
  | { type: 'SET_MAIN_MENU_LAYOUT'; preference: MainMenuLayoutPreference }
  | { type: 'UPDATE_UI_PREFERENCES'; preferences: UiPreferences }
  | { type: 'SET_EFFECTIVE_THEME'; theme: EffectiveTheme }
  | { type: 'SELECT_TEAM'; teamId: string }
  | { type: 'COMPLETE_ONBOARDING' }
  | { type: 'OPEN_DIALOG'; dialog: Exclude<DialogState, null> }
  | { type: 'CLOSE_DIALOG' }
  | { type: 'SHEET'; sheet: 'diff' | 'source' | 'shared' | 'conflict' | 'permission' | 'claude' | null }
  | { type: 'CREATE_AGENT'; agent: FullAgent }
  | { type: 'UPSERT_MANAGED_AGENT'; agent: FullAgent; message?: string }
  | { type: 'REMOVE_MANAGED_AGENT'; agentId: string }
  | { type: 'START_DESKTOP_HYDRATION' }
  | { type: 'FACTORY_RESET_LEGACY_REQUIRED'; technicalDetails: string }
  | { type: 'FACTORY_RESET_COMMITTED' }
  | { type: 'FACTORY_RESET_RESTARTING' }
  | { type: 'FACTORY_RESET_MANUAL_RESTART_REQUIRED'; technicalDetails?: string }
  | { type: 'HYDRATE_MANAGED_AGENTS'; agents: FullAgent[]; diagnostics: Diagnostic[] }
  | { type: 'FAIL_MANAGED_AGENTS_HYDRATION'; message: string }
  | { type: 'HYDRATE_AGENT_RECOVERY'; operations: AgentRecoveryOperationSummaryDto[] }
  | { type: 'SYNC_AGENT_RECOVERY'; operation: AgentRecoveryOperationSummaryDto; agent?: FullAgent }
  | { type: 'FAIL_AGENT_RECOVERY_HYDRATION'; message: string }
  | { type: 'HYDRATE_ORGANIZATION'; snapshot: LongTermDomainSnapshotDtoV4 }
  | { type: 'FAIL_ORGANIZATION_HYDRATION'; message: string }
  | { type: 'HYDRATE_SHARED_ASSETS'; sharedAssets: SharedAssetNodeDto[]; references: AssetReferenceDto[] }
  | { type: 'FAIL_SHARED_ASSETS_HYDRATION'; message: string }
  | { type: 'SYNC_PERSISTED_TEAMS'; teams: TeamDto[] }
  | { type: 'UPSERT_TASK_BRIEF'; taskBrief: TaskBriefDto }
  | { type: 'REMOVE_TASK_BRIEF'; taskBriefId: string }
  | { type: 'UPDATE_AGENT'; agentId: string; changes: Partial<FullAgent>; message?: string }
  | { type: 'SET_AGENT_LIFECYCLE'; agentId: string; status: FullAgent['status'] }
  | { type: 'SAVE_INSTRUCTIONS'; agentId?: string; text: string }
  | { type: 'SAVE_AGENT_CONFIG'; input: SaveAgentConfigInput; summary?: string }
  | { type: 'RESTORE_CONFIG_REVISION'; revisionId: string }
  | { type: 'SAVE_MEMORY'; spaceId: string; content: string; revisionId?: string }
  | { type: 'CREATE_TEAM'; team: TeamDto }
  | { type: 'UPDATE_TEAM'; teamId: string; changes: Partial<TeamDto> }
  | { type: 'UPDATE_ASSET'; assetId: string; changes: Partial<FullAsset>; message?: string }
  | { type: 'CREATE_ASSET'; asset: FullAsset }
  | { type: 'APPLY_SKILL_ACTION'; skillId: string; action: SkillAction; version?: string }
  | { type: 'APPLY_PLUGIN_ACTION'; pluginId: string; action: PluginAction; version?: string }
  | { type: 'UPDATE_BACKUP_SETTINGS'; changes: Partial<BackupSettings> }
  | { type: 'CREATE_DEMO_BACKUP_SNAPSHOT'; snapshot: BackupSnapshot }
  | { type: 'SIMULATE_RESTORE'; snapshotId: string; beforeSnapshot: BackupSnapshot }
  | { type: 'UPDATE_SETTINGS'; changes: Partial<SettingsState> }
  | { type: 'RECORD_RECENT_AGENT'; agentId: string }
  | { type: 'REMOVE_RECENT_AGENT'; agentId: string }
  | { type: 'CLEAR_RECENT_AGENTS' }
  | { type: 'SHOW_NOTICE'; notice: Omit<Notice, 'id'> }
  | { type: 'CLEAR_NOTICE'; id?: string }
  | { type: 'TOAST'; text?: string }

function reconcileAgentTeamMembership(teams: TeamDto[], agents: FullAgent[]): TeamDto[] {
  const nextTeams = teams.some((team) => team.id === 'team-personal')
    ? teams
    : [...teams, { id: 'team-personal', name: '个人 Team', memberAgentIds: [], sharedAssetIds: [] }]
  return nextTeams.map((team) => ({
    ...team,
    memberAgentIds: agents.filter((agent) => agent.teamId === team.id).map((agent) => agent.id),
  }))
}

function resolveCurrentTeamId(teams: TeamDto[], currentTeamId: string): string {
  return teams.some((team) => team.id === currentTeamId)
    ? currentTeamId
    : teams.find((team) => team.id === 'team-personal')?.id ?? teams[0]?.id ?? ''
}

function getInitialUiPreferences(): UiPreferences {
  try {
    return loadUiPreferences(localStorage)
  } catch {
    return { ...DEFAULT_UI_PREFERENCES }
  }
}

const initialUiPreferences = getInitialUiPreferences()

export const initialState: State = {
  runtime: 'web',
  hydration: { managedAgents: 'idle', organization: 'idle', sharedAssets: 'idle', agentRecovery: 'idle' },
  hydrationErrors: {},
  factoryReset: { status: 'idle' },
  agentDiagnostics: [],
  agentRecoveryOperations: [],
  onboarding: { status: 'active' },
  agents: initialAgents,
  teams: initialTeams,
  currentTeamId: initialTeams[0]?.id ?? '',
  taskBriefs: [],
  assets: initialAssets,
  sharedAssets: [],
  assetReferences: [],
  pluginInstallations: initialPluginInstallations,
  memorySpaces: initialMemorySpaces,
  configRevisions: initialConfigRevisions,
  backupSnapshots: initialBackupSnapshots,
  backupSettings: { gitConnection: { status: 'disconnected', visibility: 'private' }, formalMemoryRemote: 'excluded' },
  settings: {
    language: '简体中文',
    agentRoot: '~/.bandi/agents',
    terminal: initialUiPreferences.terminal,
    externalChangeInterval: '5 分钟',
    autoSnapshot: true,
    networkProxy: { mode: 'system', httpProxy: '', httpsProxy: '', socksProxy: '', noProxy: '' },
  },
  aiClients: initialAiClients,
  recentAgentIds: [],
  uiPreferences: initialUiPreferences,
  theme: resolveTheme(initialUiPreferences.theme, false),
  mainMenuLayoutPreference: initialUiPreferences.mainMenuLayout,
  dialog: null,
}

function createDesktopInitialState(): State {
  const teams = reconcileAgentTeamMembership([], [])
  return {
    ...initialState,
    runtime: 'desktop',
    hydration: { managedAgents: 'loading', organization: 'loading', sharedAssets: 'loading', agentRecovery: 'loading' },
    hydrationErrors: {},
    agentRecoveryOperations: [],
    agents: [],
    teams,
    currentTeamId: resolveCurrentTeamId(teams, ''),
    taskBriefs: [],
    assets: [],
    sharedAssets: [],
    assetReferences: [],
    pluginInstallations: [],
    memorySpaces: [],
    configRevisions: [],
    backupSnapshots: [],
    aiClients: initialAiClients,
    recentAgentIds: [],
  }
}

let noticeId = 0
const notice = (tone: NoticeTone, title: string, description?: string, duration = 5000): Notice => ({
  id: `notice-${++noticeId}`,
  tone,
  title,
  description,
  duration,
})

function withoutHydrationError(errors: State['hydrationErrors'], key: HydrationKey) {
  const next = { ...errors }
  delete next[key]
  return next
}

function initializeAgentConfigRecords(agent: FullAgent, revisions: ConfigRevision[]): { agent: FullAgent; revisions: ConfigRevision[] } {
  if (agent.packageSource.kind === 'external-reference') return { agent, revisions }
  const payloads: AgentConfigPayload[] = [
    snapshotAgentConfig(agent, 'identity'),
    snapshotAgentConfig(agent, 'instructions'),
    snapshotAgentConfig(agent, 'context'),
    snapshotAgentConfig(agent, 'permissions'),
    ...(agent.hookRefs.length ? [snapshotAgentConfig(agent, 'hooks')] : []),
    ...(agent.commandRefs.length ? [snapshotAgentConfig(agent, 'commands')] : []),
  ].filter((payload): payload is AgentConfigPayload => Boolean(payload))
  let nextRevisions = revisions
  let files = agent.files
  for (const payload of payloads) {
    const path = getAgentConfigPath(payload)
    const content = serializeAgentConfig(agent, payload)
    const file = describeAgentConfigFile(payload)
    if (!path || content === undefined || !file) continue
    const appended = appendConfigRevision(nextRevisions, { ownerType: 'agent', ownerId: agent.id, path, content, summary: `创建 ${file.type} 演示配置`, payload, evidence: 'memory-only' })
    nextRevisions = appended.revisions
    files = files.some((item) => item.path === path)
      ? files.map((item) => item.path === path ? { ...item, ...file, revision: appended.revision.id } : item)
      : [...files, { ...file, revision: appended.revision.id }]
  }
  return { agent: { ...agent, files }, revisions: nextRevisions }
}

function saveAgentConfig(state: State, agentId: string, payload: AgentConfigPayload, summary: string): State {
  const agent = state.agents.find((item) => item.id === agentId)
  if (!agent) return { ...state, notice: notice('warning', '无法更新 Agent 配置', 'Agent 不存在') }
  const editability = getAgentPackageEditability(agent.packageSchema)
  if (!editability.editable) return { ...state, notice: notice('warning', '无法更新 Agent 配置', editability.reason) }
  if (payload.kind === 'identity') {
    const teamExists = state.teams.some((team) => team.id === payload.value.teamId)
    if (payload.value.id !== agent.id || !teamExists) {
      return { ...state, notice: notice('error', '无法更新 Agent 配置', 'Agent ID 或 Team 作用域不匹配') }
    }
  }
  const currentPayload = snapshotAgentConfig(agent, payload.kind)
  if (currentPayload && JSON.stringify(currentPayload) === JSON.stringify(payload)) return state
  const path = getAgentConfigPath(payload)
  const nextAgent = applyAgentConfig(agent, payload)
  const content = serializeAgentConfig(agent, payload)
  const file = describeAgentConfigFile(payload)
  if (!path || !nextAgent || content === undefined || !file) {
    return { ...state, notice: notice('error', '无法更新 Agent 配置', '配置目标或路径无效') }
  }
  const appended = appendConfigRevision(state.configRevisions, {
    ownerType: 'agent', ownerId: agentId, path, content, summary, payload, evidence: 'memory-only',
  })
  if (!appended.created) return state
  const existingFile = nextAgent.files.some((item) => item.path === path)
  const files = existingFile
    ? nextAgent.files.map((item) => item.path === path ? { ...item, ...file, revision: appended.revision.id } : item)
    : [...nextAgent.files, { ...file, revision: appended.revision.id }]
  const agents = state.agents.map((item) => item.id === agentId ? { ...nextAgent, files, updated: '刚刚' } : item)
  return {
    ...state,
    agents,
    teams: payload.kind === 'identity' ? reconcileAgentTeamMembership(state.teams, agents) : state.teams,
    configRevisions: appended.revisions,
    notice: notice('success', 'Agent 配置已记录', `${path} · ${appended.revision.id} · 仅在当前页面有效 · 未写入文件`),
  }
}

const legacyDialog = (sheet: Exclude<Extract<Action, { type: 'SHEET' }>['sheet'], null>): Exclude<DialogState, null> => {
  if (sheet === 'claude') return { kind: 'client-guide' }
  if (sheet === 'permission') return { kind: 'permission', agentId: 'zhouce' }
  if (sheet === 'shared') return { kind: 'shared', assetId: 'rule-common' }
  return { kind: sheet }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'THEME': {
      const theme = (action.effectiveTheme ?? state.theme) === 'light' ? 'dark' : 'light'
      return { ...state, theme, uiPreferences: { ...state.uiPreferences, theme } }
    }
    case 'SET_MAIN_MENU_LAYOUT':
      return state.mainMenuLayoutPreference === action.preference
        ? state
        : { ...state, mainMenuLayoutPreference: action.preference, uiPreferences: { ...state.uiPreferences, mainMenuLayout: action.preference } }
    case 'UPDATE_UI_PREFERENCES':
      return JSON.stringify(state.uiPreferences) === JSON.stringify(action.preferences)
        ? state
        : {
            ...state,
            uiPreferences: action.preferences,
            mainMenuLayoutPreference: action.preferences.mainMenuLayout,
        notice: notice('success', '个性化设置已应用', '仅保存在当前设备，不进入 Agent 配置、版本历史或备份'),
          }
    case 'SET_EFFECTIVE_THEME':
      return state.theme === action.theme ? state : { ...state, theme: action.theme }
    case 'SELECT_TEAM':
      return state.teams.some((team) => team.id === action.teamId) && state.currentTeamId !== action.teamId
        ? { ...state, currentTeamId: action.teamId }
        : state
    case 'COMPLETE_ONBOARDING':
      return state.onboarding.status === 'completed' && state.uiPreferences.firstUseTeamSetupDismissed
        ? state
        : {
            ...state,
            onboarding: { status: 'completed' },
            uiPreferences: { ...state.uiPreferences, firstUseTeamSetupDismissed: true },
          }
    case 'OPEN_DIALOG':
      return { ...state, dialog: action.dialog }
    case 'CLOSE_DIALOG':
      return { ...state, dialog: null }
    case 'SHEET':
      return { ...state, dialog: action.sheet ? legacyDialog(action.sheet) : null }
    case 'CREATE_AGENT': {
      if (state.agents.some((item) => item.id === action.agent.id || item.name === action.agent.name)) return state
      const initialized = initializeAgentConfigRecords(action.agent, state.configRevisions)
      const agents = [...state.agents, initialized.agent]
      return { ...state, agents, teams: reconcileAgentTeamMembership(state.teams, agents), configRevisions: initialized.revisions, notice: notice('success', `${action.agent.name} 已添加到演示配置`, action.agent.packageSource.kind === 'external-reference' ? '仅记录外部只读引用 · 未读取或创建真实 Agent 配置' : '已记录当前页面配置版本 · 未创建真实 Agent 配置') }
    }
    case 'START_DESKTOP_HYDRATION':
      return {
        ...state,
        hydration: { managedAgents: 'loading', organization: 'loading', sharedAssets: 'loading', agentRecovery: 'loading' },
        hydrationErrors: {},
      }
    case 'FACTORY_RESET_LEGACY_REQUIRED':
      return state.factoryReset.status === 'idle' || state.factoryReset.status === 'legacy-database-required'
        ? { ...state, factoryReset: { status: 'legacy-database-required', technicalDetails: action.technicalDetails } }
        : state
    case 'FACTORY_RESET_COMMITTED':
      return state.factoryReset.status === 'idle' || state.factoryReset.status === 'legacy-database-required'
        ? { ...state, factoryReset: { status: 'committed' }, dialog: null, notice: undefined }
        : state
    case 'FACTORY_RESET_RESTARTING':
      return state.factoryReset.status === 'committed'
        ? { ...state, factoryReset: { status: 'restarting' } }
        : state
    case 'FACTORY_RESET_MANUAL_RESTART_REQUIRED':
      return state.factoryReset.status === 'committed' || state.factoryReset.status === 'restarting'
        ? { ...state, factoryReset: { status: 'manual-restart-required', technicalDetails: action.technicalDetails } }
        : state
    case 'UPSERT_MANAGED_AGENT': {
      const exists = state.agents.some((item) => item.id === action.agent.id)
      const agents = exists
        ? state.agents.map((item) => item.id === action.agent.id ? action.agent : item)
        : [...state.agents, action.agent]
      return {
        ...state,
        agents,
        teams: reconcileAgentTeamMembership(state.teams, agents),
        notice: notice('success', 'Agent 配置已保存', action.message ?? '已写入 Bandi Desktop 受管目录'),
      }
    }
    case 'REMOVE_MANAGED_AGENT': {
      const agents = state.agents.filter((item) => item.id !== action.agentId)
      return {
        ...state,
        agents,
        teams: reconcileAgentTeamMembership(state.teams, agents),
        recentAgentIds: state.recentAgentIds.filter((id) => id !== action.agentId),
        notice: notice('success', 'Agent 已永久删除', 'Agent 配置和相关索引已从 Bandi Desktop 移除'),
      }
    }
    case 'HYDRATE_MANAGED_AGENTS': {
      const agents = action.agents
      return {
        ...state,
        hydration: { ...state.hydration, managedAgents: 'succeeded' },
        hydrationErrors: withoutHydrationError(state.hydrationErrors, 'managedAgents'),
        onboarding: state.runtime === 'desktop'
          ? { status: action.agents.length || action.diagnostics.length || state.uiPreferences.firstUseTeamSetupDismissed ? 'completed' : 'active' }
          : state.onboarding,
        agentDiagnostics: action.diagnostics,
        agents,
        teams: reconcileAgentTeamMembership(state.teams, agents),
      }
    }
    case 'FAIL_MANAGED_AGENTS_HYDRATION':
      return {
        ...state,
        hydration: { ...state.hydration, managedAgents: 'failed' },
        hydrationErrors: { ...state.hydrationErrors, managedAgents: action.message },
      }
    case 'HYDRATE_AGENT_RECOVERY':
      return {
        ...state,
        hydration: { ...state.hydration, agentRecovery: 'succeeded' },
        hydrationErrors: withoutHydrationError(state.hydrationErrors, 'agentRecovery'),
        agentRecoveryOperations: action.operations.filter((item) => item.status !== 'completed'),
      }
    case 'SYNC_AGENT_RECOVERY': {
      const operations = action.operation.status === 'completed'
        ? state.agentRecoveryOperations.filter((item) => item.id !== action.operation.id)
        : [...state.agentRecoveryOperations.filter((item) => item.id !== action.operation.id), action.operation]
      const agents = action.agent
        ? state.agents.some((item) => item.id === action.agent!.id)
          ? state.agents.map((item) => item.id === action.agent!.id ? action.agent! : item)
          : [...state.agents, action.agent]
        : state.agents
      return { ...state, agents, teams: action.agent ? reconcileAgentTeamMembership(state.teams, agents) : state.teams, agentRecoveryOperations: operations }
    }
    case 'FAIL_AGENT_RECOVERY_HYDRATION':
      return {
        ...state,
        hydration: { ...state.hydration, agentRecovery: 'failed' },
        hydrationErrors: { ...state.hydrationErrors, agentRecovery: action.message },
      }
    case 'HYDRATE_ORGANIZATION': {
      const view = longTermDomainV4ToView(action.snapshot)
      const teams = reconcileAgentTeamMembership(view.teams, state.agents)
      return {
        ...state,
        hydration: { ...state.hydration, organization: 'succeeded' },
        hydrationErrors: withoutHydrationError(state.hydrationErrors, 'organization'),
        onboarding: state.runtime === 'desktop'
          ? { status: state.agents.length || state.uiPreferences.firstUseTeamSetupDismissed ? 'completed' : 'active' }
          : state.onboarding,
        teams,
        currentTeamId: resolveCurrentTeamId(teams, state.currentTeamId),
        taskBriefs: view.taskBriefs,
      }
    }
    case 'FAIL_ORGANIZATION_HYDRATION':
      return {
        ...state,
        hydration: { ...state.hydration, organization: 'failed' },
        hydrationErrors: { ...state.hydrationErrors, organization: action.message },
      }
    case 'HYDRATE_SHARED_ASSETS':
      return {
        ...state,
        hydration: { ...state.hydration, sharedAssets: 'succeeded' },
        hydrationErrors: withoutHydrationError(state.hydrationErrors, 'sharedAssets'),
        sharedAssets: action.sharedAssets,
        assetReferences: action.references,
        assets: projectSharedAssets(action.sharedAssets, action.references),
      }
    case 'FAIL_SHARED_ASSETS_HYDRATION':
      return {
        ...state,
        hydration: { ...state.hydration, sharedAssets: 'failed' },
        hydrationErrors: { ...state.hydrationErrors, sharedAssets: action.message },
      }
    case 'SYNC_PERSISTED_TEAMS': {
      const persisted = new Map(action.teams.map((team) => [team.id, team]))
      const teams = state.teams.map((team) => persisted.get(team.id) ?? team)
      for (const team of action.teams) {
        if (!teams.some((item) => item.id === team.id)) teams.push(team)
      }
      const reconciled = reconcileAgentTeamMembership(teams, state.agents)
      return { ...state, teams: reconciled, currentTeamId: resolveCurrentTeamId(reconciled, state.currentTeamId) }
    }
    case 'UPSERT_TASK_BRIEF': {
      const exists = state.taskBriefs.some((item) => item.id === action.taskBrief.id)
      return {
        ...state,
        taskBriefs: exists
          ? state.taskBriefs.map((item) => item.id === action.taskBrief.id ? action.taskBrief : item)
          : [...state.taskBriefs, action.taskBrief],
        notice: undefined,
      }
    }
    case 'REMOVE_TASK_BRIEF':
      return {
        ...state,
        taskBriefs: state.taskBriefs.filter((item) => item.id !== action.taskBriefId),
        notice: notice('success', '需求已删除'),
      }
    case 'UPDATE_AGENT': {
      const agents = state.agents.map((item) => item.id === action.agentId ? { ...item, ...action.changes, updated: '刚刚' } : item)
      return { ...state, agents, teams: reconcileAgentTeamMembership(state.teams, agents), notice: notice('success', 'Agent 演示配置已更新', action.message ?? '仅在当前页面有效 · 未写入文件') }
    }
    case 'SET_AGENT_LIFECYCLE': {
      const agent = state.agents.find((item) => item.id === action.agentId)
      const manifest = agent ? snapshotAgentConfig(agent, 'identity') : undefined
      if (!agent || !manifest || manifest.kind !== 'identity') return state
      return saveAgentConfig(state, agent.id, { ...manifest, value: { ...manifest.value, status: action.status } }, `更新生命周期为 ${action.status}`)
    }
    case 'SAVE_INSTRUCTIONS':
      return saveAgentConfig(state, action.agentId ?? 'zhouce', { kind: 'instructions', value: action.text }, '保存主指令演示配置')
    case 'SAVE_AGENT_CONFIG': {
      if (state.runtime === 'desktop') return { ...state, notice: notice('warning', '未保存配置', '请通过 Bandi Desktop 保存此配置。') }
      const { agentId, ...payload } = action.input
      return saveAgentConfig(state, agentId, payload, action.summary ?? `保存 ${payload.kind} 演示配置`)
    }
    case 'SAVE_MEMORY': {
      const current = state.memorySpaces.find((item) => item.id === action.spaceId)
      if (!current || current.content === action.content) return state
      const nextRevision = action.revisionId ?? `r${Number(current.revision.replace(/^r/, '')) + 1}`
      return {
        ...state,
        memorySpaces: state.memorySpaces.map((item) => item.id === action.spaceId ? { ...item, content: action.content, revision: nextRevision } : item),
        notice: notice('success', 'Agent 长期记忆已保存', state.runtime === 'desktop' ? '已保存并生成新版本' : '仅在当前页面有效'),
      }
    }
    case 'RESTORE_CONFIG_REVISION': {
      const target = state.configRevisions.find((item) => item.id === action.revisionId)
      if (!target) return { ...state, notice: notice('warning', '无法恢复配置版本', '目标版本不存在') }
      if (target.ownerType === 'agent') {
        const payload = isAgentConfigPayload(target.payload)
          ? target.payload
          : target.path === 'instructions.md'
            ? { kind: 'instructions' as const, value: target.content }
            : undefined
        if (!payload || getAgentConfigPath(payload) !== target.path) return { ...state, notice: notice('warning', '无法恢复配置版本', '该版本没有与目标路径匹配的可验证结构化快照') }
        const restored = saveAgentConfig(state, target.ownerId, payload, `恢复自 ${target.id}`)
        if (restored.configRevisions === state.configRevisions) return { ...restored, notice: notice('info', '无需恢复配置版本', '目标版本与当前结构化配置相同，未生成重复版本') }
        const latest = restored.configRevisions[0]
        return { ...restored, dialog: null, configRevisions: [{ ...latest, restoredFromRevisionId: target.id }, ...restored.configRevisions.slice(1)] }
      }
      const appended = appendConfigRevision(state.configRevisions, { ownerType: target.ownerType, ownerId: target.ownerId, path: target.path, content: target.content, summary: `恢复自 ${target.id}`, restoredFromRevisionId: target.id, evidence: 'memory-only' })
      const revision = appended.revision
      const configRevisions = appended.revisions
      if (target.ownerType === 'asset') {
        const asset = state.assets.find((item) => item.id === target.ownerId)
        if (!asset || asset.kind === 'Memory') return { ...state, notice: notice('warning', '无法恢复配置版本', 'Agent 长期记忆需要从自己的版本历史中恢复') }
        let changes: Partial<FullAsset> = { content: target.content }
        if (asset.kind === 'SOP') {
          try {
            const steps: unknown = JSON.parse(target.content)
            if (!Array.isArray(steps)) throw new Error('SOP 快照不是步骤数组')
            changes = { steps: steps as FullAsset['steps'] }
          } catch {
            return { ...state, notice: notice('warning', '无法恢复配置版本', 'SOP 版本内容损坏或结构无效') }
          }
        }
        return { ...state, assets: state.assets.map((item) => item.id === target.ownerId ? { ...item, ...changes } : item), configRevisions, dialog: null, notice: notice('success', '已恢复为新的演示版本', `${revision.id} · 来源 ${target.id} · 未写入真实文件`) }
      }
      return state
    }
    case 'CREATE_TEAM':
      if (state.teams.some((item) => item.id === action.team.id)) return state
      return { ...state, teams: [...state.teams, action.team], currentTeamId: action.team.id, notice: notice('success', 'Team 已创建', '仅在当前页面有效') }
    case 'UPDATE_TEAM':
      return { ...state, teams: state.teams.map((item) => item.id === action.teamId ? { ...item, ...action.changes } : item), notice: notice('success', 'Team 信息已更新', '未写入文件') }
    case 'UPDATE_ASSET': {
      const asset = state.assets.find((item) => item.id === action.assetId)
      if (!asset) return state
      const nextAsset = { ...asset, ...action.changes } as FullAsset
      const revisionContent = asset.kind === 'SOP' && action.changes.steps ? JSON.stringify(nextAsset.steps ?? []) : typeof action.changes.content === 'string' ? nextAsset.content : undefined
      const appended = revisionContent !== undefined && asset.kind !== 'Memory'
        ? appendConfigRevision(state.configRevisions, { ownerType: 'asset', ownerId: asset.id, path: asset.path, content: revisionContent, summary: `保存 ${asset.name} 演示配置`, evidence: 'memory-only' })
        : undefined
      const configRevisions = appended?.revisions ?? state.configRevisions
      return { ...state, assets: state.assets.map((item) => item.id === action.assetId ? nextAsset : item), configRevisions, notice: notice('success', '资产演示配置已更新', appended ? `已记录 ${appended.revision.id} · 仅在当前页面有效 · 未写入文件` : action.message ?? '仅在当前页面有效 · 未写入文件') }
    }
    case 'CREATE_ASSET':
      if (state.assets.some((item) => item.id === action.asset.id)) return state
      return { ...state, assets: [...state.assets, action.asset], notice: notice('success', '资产已创建在演示内存中', '未创建真实文件') }
    case 'APPLY_SKILL_ACTION': {
      if (state.runtime === 'desktop') return { ...state, notice: notice('warning', '未执行技能操作', 'Desktop 当前只读索引技能，不提供安装、更新、回滚或卸载。') }
      const asset = state.assets.find((item) => item.id === action.skillId)
      if (!asset?.skill) return { ...state, notice: notice('warning', '无法更新技能演示状态', '目标不存在或不是可管理的技能') }
      const installation = applySkillAction(asset.skill.installation, action.action, action.version)
      if (!installation) return { ...state, notice: notice('warning', '当前技能状态不支持此操作', '未修改安装记录或使用位置') }
      const labels: Record<SkillAction, string> = { install: '安装', update: '更新', rollback: '回滚', uninstall: '卸载' }
      return { ...state, assets: state.assets.map((item) => item.id === asset.id && item.skill ? { ...item, status: action.action === 'uninstall' ? '可演示安装' : '演示已安装', skill: { ...item.skill, installation } } : item), notice: notice('success', `技能已模拟${labels[action.action]}`, '仅更新当前页面内存 · 未下载、复制或删除文件 · 未执行安装脚本 · 未自动分配给 Agent') }
    }
    case 'APPLY_PLUGIN_ACTION': {
      if (state.runtime === 'desktop') return { ...state, notice: notice('warning', '未执行插件操作', 'Desktop 当前只读索引插件，不提供安装、更新、回滚或卸载。') }
      const installation = state.pluginInstallations.find((item) => item.pluginId === action.pluginId)
      if (!installation) return { ...state, notice: notice('warning', '无法更新插件演示状态', '目标没有独立的插件安装记录') }
      const next = applyPluginAction(installation, action.action, action.version)
      if (!next) return { ...state, notice: notice('warning', '当前插件状态不支持此操作', '未修改安装记录或 Agent 组件使用位置') }
      const labels: Record<PluginAction, string> = { install: '安装', update: '更新', rollback: '回滚', uninstall: '卸载' }
      return { ...state, pluginInstallations: state.pluginInstallations.map((item) => item.pluginId === action.pluginId ? next : item), notice: notice('success', `插件已模拟${labels[action.action]}`, '仅更新当前页面中的插件安装记录 · 未检查电脑、下载、运行安装脚本或写入文件 · 未自动更改 Agent 的使用位置') }
    }
    case 'UPDATE_BACKUP_SETTINGS':
      return { ...state, backupSettings: { ...state.backupSettings, ...action.changes }, notice: notice('info', '备份演示策略已更新', '仅在当前页面有效 · 未连接 Git、上传文件或读取凭据') }
    case 'CREATE_DEMO_BACKUP_SNAPSHOT':
      return { ...state, backupSnapshots: [action.snapshot, ...state.backupSnapshots], notice: notice('success', '已创建演示快照记录', '未读取、打包或写入真实文件') }
    case 'SIMULATE_RESTORE':
      return { ...state, backupSnapshots: [action.beforeSnapshot, ...state.backupSnapshots], dialog: null, notice: notice('info', `已记录模拟恢复 ${action.snapshotId}`, '未恢复任何真实文件') }
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.changes }, notice: notice('success', '设置已在当前页面更新', '未写入配置文件') }
    case 'RECORD_RECENT_AGENT': {
      if (!state.agents.some((item) => item.id === action.agentId) || state.recentAgentIds.includes(action.agentId)) return state
      return { ...state, recentAgentIds: [action.agentId, ...state.recentAgentIds].slice(0, 6) }
    }
    case 'REMOVE_RECENT_AGENT': {
      if (!state.recentAgentIds.includes(action.agentId)) return state
      return {
        ...state,
        recentAgentIds: state.recentAgentIds.filter((id) => id !== action.agentId),
        notice: notice('info', '已从最近访问中移除', '仅影响当前页面'),
      }
    }
    case 'CLEAR_RECENT_AGENTS':
      return state.recentAgentIds.length
        ? { ...state, recentAgentIds: [], notice: notice('info', '最近访问记录已清空', '仅影响当前页面') }
        : state
    case 'SHOW_NOTICE':
      return { ...state, notice: notice(action.notice.tone, action.notice.title, action.notice.description, action.notice.duration) }
    case 'CLEAR_NOTICE':
      return !action.id || state.notice?.id === action.id ? { ...state, notice: undefined } : state
    case 'TOAST':
      return { ...state, notice: action.text ? notice('info', '演示操作未执行系统能力', action.text) : undefined }
  }
}

export type UiPreviewAssets = { logo?: string | null; background?: string | null }

type AppContextValue = {
  state: State
  dispatch: React.Dispatch<Action>
  effectiveUiPreferences: UiPreferences
  effectiveTheme: EffectiveTheme
  uiPreviewAssets?: UiPreviewAssets
  hydrateDesktop: () => void
  setUiPreferencesPreview: (preferences?: UiPreferences, assets?: UiPreviewAssets) => void
}

const Ctx = createContext<AppContextValue | null>(null)

export function AppProvider({ children, initialState: providedState }: { children: ReactNode; initialState?: State }) {
  const [state, dispatch] = useReducer(reducer, providedState ?? (isDesktopRuntime() ? createDesktopInitialState() : initialState))
  const [preview, setPreview] = useState<{ preferences: UiPreferences; assets?: UiPreviewAssets }>()
  const [prefersDark, setPrefersDark] = useState(() => providedState?.theme === 'dark')
  const effectiveUiPreferences = preview?.preferences ?? state.uiPreferences
  const effectiveTheme = resolveTheme(effectiveUiPreferences.theme, prefersDark)
  const setUiPreferencesPreview = useCallback((preferences?: UiPreferences, assets?: UiPreviewAssets) => {
    setPreview(preferences ? { preferences, assets } : undefined)
  }, [])
  const hydrateDesktop = useCallback(() => {
    if (providedState || !isDesktopRuntime()) return
    dispatch({ type: 'START_DESKTOP_HYDRATION' })
    const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)
    const hydrationFailure = (error: unknown, action: Action) => {
      const message = errorMessage(error)
      if (message.startsWith('LEGACY_DATABASE_RESET_REQUIRED:')) {
        dispatch({ type: 'FACTORY_RESET_LEGACY_REQUIRED', technicalDetails: message })
      }
      dispatch(action)
    }
    void listAgents()
      .then(({ agents, diagnostics }) => dispatch({ type: 'HYDRATE_MANAGED_AGENTS', agents, diagnostics }))
      .catch((error) => hydrationFailure(error, { type: 'FAIL_MANAGED_AGENTS_HYDRATION', message: errorMessage(error) }))
    void loadLongTermDomainSnapshotV4()
      .then((snapshot) => dispatch({ type: 'HYDRATE_ORGANIZATION', snapshot }))
      .catch((error) => hydrationFailure(error, { type: 'FAIL_ORGANIZATION_HYDRATION', message: errorMessage(error) }))
    void discoverConfig({ requestId: 'hydrate-shared-assets', includeClaudeUserRoot: false })
      .then(({ sharedAssets, references }) => dispatch({ type: 'HYDRATE_SHARED_ASSETS', sharedAssets, references }))
      .catch((error) => hydrationFailure(error, { type: 'FAIL_SHARED_ASSETS_HYDRATION', message: errorMessage(error) }))
    void listAgentRecoveryOperations()
      .then((operations) => dispatch({ type: 'HYDRATE_AGENT_RECOVERY', operations }))
      .catch((error) => hydrationFailure(error, { type: 'FAIL_AGENT_RECOVERY_HYDRATION', message: errorMessage(error) }))
  }, [providedState])

  useEffect(() => {
    hydrateDesktop()
  }, [hydrateDesktop])

  useEffect(() => {
    if (providedState) return
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined
    const update = () => setPrefersDark(media?.matches ?? false)
    update()
    media?.addEventListener('change', update)
    return () => media?.removeEventListener('change', update)
  }, [providedState])

  useEffect(() => {
    const root = document.documentElement
    const accent = getAccessibleAccent(effectiveUiPreferences.accentColor)
    root.classList.toggle('dark', effectiveTheme === 'dark')
    root.dataset.theme = effectiveTheme
    root.dataset.interfaceFont = effectiveUiPreferences.interfaceFont
    root.dataset.monoFont = effectiveUiPreferences.monoFont
    root.dataset.fontScale = effectiveUiPreferences.fontScale
    root.dataset.density = effectiveUiPreferences.density
    root.dataset.backgroundStyle = effectiveUiPreferences.backgroundStyle
    root.style.setProperty('--accent', accent?.color ?? DEFAULT_UI_PREFERENCES.accentColor)
    root.style.setProperty('--accent-foreground', accent?.foreground ?? '#ffffff')
    root.style.setProperty('--background-dim', `${effectiveUiPreferences.backgroundDim / 100}`)
  }, [effectiveTheme, effectiveUiPreferences])

  useEffect(() => {
    if (['committed', 'restarting', 'manual-restart-required'].includes(state.factoryReset.status)) return
    try {
      saveUiPreferences(localStorage, state.uiPreferences)
    } catch {
      /* 本机偏好写入失败时仍保留当前会话效果 */
    }
  }, [state.factoryReset.status, state.uiPreferences])

  const value = useMemo<AppContextValue>(() => ({
    state,
    dispatch,
    effectiveUiPreferences,
    effectiveTheme,
    uiPreviewAssets: preview?.assets,
    hydrateDesktop,
    setUiPreferencesPreview,
  }), [effectiveTheme, effectiveUiPreferences, hydrateDesktop, preview?.assets, setUiPreferencesPreview, state])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const value = useContext(Ctx)
  if (!value) throw new Error('useApp 必须在 AppProvider 中使用')
  return value
}
