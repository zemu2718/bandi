import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@wdio/globals'
import {
  agentFiles,
  appDataPath,
  department,
  departmentId,
  managedAgent,
  managedAgentsPath,
  managerAgentId,
  managerAgentName,
  role,
  taskBriefId,
  team,
  teamId,
  teamName,
  workerAgentId,
  workerAgentName,
} from '../helpers/first-use-fixtures.js'

type JsonRecord = Record<string, unknown>
type SourceAsset = { id: string; kind: string; containerId: string }
type Discovery = {
  containers: Array<{ id: string; locator: { rootKind: string; relativePath?: string } }>
  assets: SourceAsset[]
  diagnostics: Array<{ severity: string; message: string }>
}
type Editor = { canonicalContent: string; baselineRef: JsonRecord }
type SaveResult = { kind: string; revision?: { id: string }; challenge?: { id: string } }
type ReviewPrincipal =
  | { kind: 'agent'; agentId: string }
  | { kind: 'chairman_user'; teamId: string }
type MemorySpace = { id: string; reviewPrincipal: ReviewPrincipal }
type EligibleSpaces = { spaces: MemorySpace[]; diagnostics: Array<{ severity: string; message: string }> }
type MemoryBundle = {
  candidate: {
    id: string
    version: number
    submittedBaseline: JsonRecord
    reviewPrincipal: ReviewPrincipal
  }
}
type MemoryResult = { kind: string; revision?: { id: string } }
type Backup = { id: string; entryCount: number; entries: Array<{ assetId: string }> }
type LongTermDomainSnapshot = {
  schemaVersion: number
  teams: Array<{ id: string }>
  departments: Array<{ id: string; managerAgentId?: string }>
  roles: Array<{ id: string }>
  taskBriefs: Array<{ id: string; teamId: string }>
}
type ManagedAgentView = {
  id: string
  instructions: string
  permissions: { files: string; commands: string; network: string; delegation: string }
}
type ClientLaunchResult = {
  teamId: string
  agentId: string
  taskId?: string
  outcome: string
  acceptedAt?: string
  capability: { evidence: string[] }
}

const invoke = <T>(session: WebdriverIO.Browser, command: string, args: JsonRecord = {}) => session.tauri.execute(
  (tauri, commandName: string, payload: JsonRecord) => tauri.core.invoke(commandName, payload) as Promise<T>,
  command,
  args,
)

async function createAgent(session: WebdriverIO.Browser, id: string, name: string, managerAgentId?: string) {
  const options = { id, name, managerAgentId }
  return invoke(session, 'commit_managed_agent_creation', {
    request: {
      requestId: `create-${id}`,
      create: {
        agentId: id,
        agent: managedAgent(options),
        files: agentFiles(options),
        avatarBytes: null,
      },
    },
  })
}

async function assetEditor(session: WebdriverIO.Browser, kind: string) {
  const discovery = await invoke<Discovery>(session, 'discover_config', {
    request: { requestId: `discover-${kind}`, includeClaudeUserRoot: false },
  })
  expect(discovery.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0)
  const relativePath = kind === 'instructions' ? 'instructions.md' : `config/${kind}.yaml`
  const container = discovery.containers.filter((item) =>
    item.locator.rootKind === 'managed'
    && item.locator.relativePath === `agt_${workerAgentId}/${relativePath}`,
  )
  expect(container).toHaveLength(1)
  const matches = discovery.assets.filter((asset) => asset.kind === kind && asset.containerId === container[0].id)
  expect(matches).toHaveLength(1)
  const editor = await invoke<Editor>(session, 'load_config_editor', {
    request: { requestId: `load-${kind}`, assetId: matches[0].id },
  })
  return { asset: matches[0], editor }
}

async function saveConfig(session: WebdriverIO.Browser, kind: 'instructions' | 'permissions', value: string) {
  const { asset, editor } = await assetEditor(session, kind)
  const request = {
    requestId: `save-${kind}`,
    assetId: asset.id,
    expectedOwner: { agentId: workerAgentId },
    change: { kind, value },
    expectedBaseline: editor.baselineRef,
    baseContent: editor.canonicalContent,
  }
  let result = await invoke<SaveResult>(session, 'save_config', { request })
  if (result.kind === 'confirmation_required') {
    expect(kind).toBe('permissions')
    expect(result.challenge?.id).toBeTruthy()
    result = await invoke<SaveResult>(session, 'save_config', {
      request: { ...request, confirmationRef: result.challenge?.id },
    })
  }
  expect(result.kind).toBe('saved')
  expect(result.revision?.id).toBeTruthy()
  return asset.id
}

async function assertPersistedFacts(session: WebdriverIO.Browser) {
  const snapshot = await invoke<LongTermDomainSnapshot>(session, 'load_long_term_domain_snapshot_v3')
  expect(snapshot.schemaVersion).toBe(3)
  expect(snapshot.teams.map((item) => item.id)).toContain(teamId)
  expect(snapshot.departments).toContainEqual(expect.objectContaining({ id: departmentId, managerAgentId }))
  expect(snapshot.roles.map((item) => item.id)).toContain(role.id)
  expect(snapshot.taskBriefs).toContainEqual(expect.objectContaining({ id: taskBriefId, teamId }))

  const result = await invoke<{ agents: ManagedAgentView[]; diagnostics: unknown[] }>(session, 'list_managed_agents')
  expect(result.diagnostics).toHaveLength(0)
  expect(result.agents).toHaveLength(2)
  const worker = result.agents.find((item) => item.id === workerAgentId)
  expect(worker?.instructions).toBe('首次旅程已保存的 Instructions')
  expect(worker?.permissions).toEqual({ files: '未授予', commands: '构建与测试', network: '禁止', delegation: '禁止' })

  const revisions = await invoke<Array<{ id: string }>>(session, 'list_memory_revisions', {
    request: { requestId: 'list-memory-revisions', spaceId: `memory-agent-${workerAgentId}` },
  })
  expect(revisions).toHaveLength(1)

  const backups = await invoke<Backup[]>(session, 'list_backup_snapshots')
  expect(backups).toHaveLength(1)
  expect(backups[0].entryCount).toBe(1)

  const launch = await invoke<ClientLaunchResult>(session, 'request_client_launch_v3', {
    request: {
      clientId: 'claude-code',
      adapterId: 'claude-code-terminal-v1',
      terminalId: 'terminal',
      intent: 'start_with_context',
      teamId,
      agentId: workerAgentId,
      taskId: taskBriefId,
    },
  })
  expect(launch).toMatchObject({ teamId, agentId: workerAgentId, taskId: taskBriefId, outcome: 'context_prepared' })
  expect(launch.acceptedAt).toBeUndefined()
  expect(launch.capability.evidence).toContain('仅复核 Team、Agent 与可选 TaskBrief，未访问目录或调用外部进程')

  await session.execute((id: string) => { window.location.hash = `#/agents/${id}` }, workerAgentId)
  await expect(session.$(`button[aria-label="切换 Team，当前为${teamName}"]`)).toBeDisplayed()
  await session.execute(() => { window.location.hash = '#/agents' })
  await expect(session.$('h1=先新建或导入一个长期 Agent')).not.toExist()
  expect(await session.$('body').getText()).not.toContain('知衡')
  await expect(session.$('h1=Agent')).toBeDisplayed()
  await session.waitUntil(
    async () => {
      const text = await session.$('body').getText()
      return text.includes(managerAgentName) && text.includes(workerAgentName)
    },
    { timeoutMsg: `重启后的 Agent 页面未恢复两个 Agent：${await session.$('body').getText()}` },
  )
}

describe('Desktop 首次使用真实闭环', () => {
  it(process.env.BANDI_E2E_VERIFY_ONLY === '1'
    ? '以相同数据目录启动新进程后恢复全部持久化事实'
    : '通过真实 IPC 创建、保存、审核和备份', async () => {
    if (process.env.BANDI_E2E_VERIFY_ONLY === '1') {
      await assertPersistedFacts(browser)
      return
    }

    await expect(browser.$('h1=先新建或导入一个长期 Agent')).toBeDisplayed()

    await invoke(browser, 'save_team_v2', { team })
    await createAgent(browser, managerAgentId, managerAgentName)
    await createAgent(browser, workerAgentId, workerAgentName, managerAgentId)
    await invoke(browser, 'save_department_v2', {
      department: { ...department, managerAgentId },
    })
    await invoke(browser, 'save_role_v2', { role })
    await invoke(browser, 'save_team_v2', {
      team: {
        ...team,
        memberAgentIds: [managerAgentId, workerAgentId],
        departmentIds: [departmentId],
      },
    })

    await invoke(browser, 'save_task_brief_v2', {
      taskBrief: {
        id: taskBriefId,
        teamId,
        title: '完成首次长期配置闭环',
        brief: '验证 Team、Agent 与上下文准备。',
      },
    })

    const instructionsAssetId = await saveConfig(browser, 'instructions', '首次旅程已保存的 Instructions')
    await saveConfig(browser, 'permissions', 'schemaVersion: 1\npermissions:\n  files: "未授予"\n  commands: "构建与测试"\n  network: "禁止"\n  delegation: "禁止"')

    const eligible = await invoke<EligibleSpaces>(browser, 'discover_eligible_memory_spaces', {
      request: { requestId: 'discover-memory', agentId: workerAgentId },
    })
    expect(eligible.diagnostics.filter((item) => item.severity === 'error')).toHaveLength(0)
    const agentMemory = eligible.spaces.find((item) => item.id === `memory-agent-${workerAgentId}`)
    expect(agentMemory?.reviewPrincipal).toEqual({ kind: 'agent', agentId: managerAgentId })

    const candidate = await invoke<MemoryBundle>(browser, 'create_memory_candidate', {
      request: {
        requestId: 'create-memory-candidate',
        candidateId: 'candidate-first-use',
        spaceId: agentMemory?.id,
        proposerAgentId: workerAgentId,
        source: { kind: 'manual', label: '真实首次旅程' },
        summary: '记录首次闭环',
        proposedContent: '首次旅程正式长期记忆',
      },
    })
    const reviewed = await invoke<MemoryResult>(browser, 'review_memory_candidate', {
      request: {
        requestId: 'approve-memory-candidate',
        candidateId: candidate.candidate.id,
        decision: 'approve',
        expectedCandidateVersion: candidate.candidate.version,
        expectedBaseline: candidate.candidate.submittedBaseline,
        expectedReviewPrincipal: candidate.candidate.reviewPrincipal,
        comment: '由独立主管审核通过',
      },
    })
    expect(reviewed.kind).toBe('saved')
    expect(reviewed.revision?.id).toBeTruthy()

    const backup = await invoke<Backup>(browser, 'create_backup_snapshot', {
      request: { requestId: 'create-backup', scope: { kind: 'files', assetIds: [instructionsAssetId] } },
    })
    expect(backup.entryCount).toBe(1)
    expect(backup.entries[0].assetId).toBe(instructionsAssetId)

    expect(await fs.readFile(path.join(managedAgentsPath, `agt_${workerAgentId}`, 'instructions.md'), 'utf8')).toBe('首次旅程已保存的 Instructions')
    expect(await fs.readFile(path.join(managedAgentsPath, `agt_${workerAgentId}`, 'memory', 'long-term.md'), 'utf8')).toBe('首次旅程正式长期记忆')
    await expect(fs.stat(path.join(appDataPath, 'bandi.db'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(appDataPath, 'revisions'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(appDataPath, 'backups', backup.id))).resolves.toBeDefined()
  })
})
