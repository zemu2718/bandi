// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import contractsFixture from '../../../../packages/contracts/fixtures/core-contracts.valid.json'
import { AgentCreatePage } from '../pages/agents/agent-create-page'
import { AppProvider, initialState, useApp, type State } from '../state'

const NativeRequest = globalThis.Request

const bridge = vi.hoisted(() => ({
  desktop: false,
  allocateAgentId: vi.fn(),
  commitManagedAgentCreation: vi.fn(),
  importClaudeAgent: vi.fn(),
  previewClaudeAgent: vi.fn(),
  selectClaudeAgentFile: vi.fn(),
}))

vi.mock('../desktop-bridge', () => ({
  allocateAgentId: bridge.allocateAgentId,
  commitManagedAgentCreation: bridge.commitManagedAgentCreation,
  importClaudeAgent: bridge.importClaudeAgent,
  isDesktopRuntime: () => bridge.desktop,
  previewClaudeAgent: bridge.previewClaudeAgent,
  selectClaudeAgentFile: bridge.selectClaudeAgentFile,
}))

beforeEach(() => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined })
    }
  })
  vi.stubGlobal('crypto', { randomUUID: () => 'fixed-agent-id' })
  bridge.allocateAgentId.mockReset().mockResolvedValue('agent-backend-id')
  bridge.commitManagedAgentCreation.mockReset()
  bridge.importClaudeAgent.mockReset()
  bridge.previewClaudeAgent.mockReset()
  bridge.selectClaudeAgentFile.mockReset()
  bridge.selectClaudeAgentFile.mockResolvedValue('/tmp/.claude/agents/reviewer.md')
  bridge.previewClaudeAgent.mockResolvedValue({ sourcePath: '/tmp/.claude/agents/reviewer.md', sourceBaselineHash: 'sha256:source', name: 'Reviewer', description: 'Reviews code', instructions: 'Review carefully.', recognizedFields: ['name', 'description'], ignoredFields: [] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  bridge.desktop = false
})

function ResultProbe() {
  const { state } = useApp()
  const location = useLocation()
  return <div>{location.pathname}{location.search}<span>{state.notice?.title}</span><span>{state.notice?.description}</span></div>
}

function renderPage(state: State = initialState, initialEntry = '/agents/new') {
  const router = createMemoryRouter([
    { path: '/agents/new', element: <AgentCreatePage /> },
    { path: '/agents/:id', element: <ResultProbe /> },
  ], { initialEntries: [initialEntry] })
  return {
    router,
    ...render(<AppProvider initialState={state}><RouterProvider router={router} /></AppProvider>),
  }
}

function managedResult(agent: State['agents'][number], status = 'completed') {
  return {
    operation: { id: 'operation-fixed', agentId: agent.id, operationKind: 'create', status, createdAt: '2026-09-02T00:00:00Z' },
    agent,
  }
}

function enterName(name = '阿策') {
  fireEvent.change(screen.getByRole('textbox', { name: /Agent 名称/ }), { target: { value: name } })
}

function expandOptionalOrganization() {
  fireEvent.click(screen.getByText('更多设置（头像、部门与岗位）'))
}

function selectOptionalOrganization() {
  expandOptionalOrganization()
  fireEvent.change(screen.getByRole('combobox', { name: /所属部门/ }), { target: { value: 'dev' } })
  fireEvent.change(screen.getByRole('combobox', { name: /岗位/ }), { target: { value: 'role-web-engineer' } })
}

describe('Agent 创建页', () => {
  it('普通创建以模板优先的 Dialog 呈现，只要求名称', () => {
    bridge.desktop = true
    renderPage()

    expect(screen.getByRole('dialog', { name: '新建 Agent' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '空白 Agent' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '代码审查' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('textbox', { name: /一句话描述/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /角色定位/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /工作方法与约束/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '所属 Team' })).not.toBeInTheDocument()
    expect(screen.getByText('更多设置（头像、部门与岗位）').closest('details')).not.toHaveAttribute('open')
    expect(screen.queryByText('1 身份与组织')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 Agent' })).toBeInTheDocument()
  })

  it('空名称显示内联错误并聚焦名称字段', () => {
    bridge.desktop = true
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(screen.getByText('请输入 Agent 名称。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveAttribute('aria-invalid', 'true')
    expect(bridge.commitManagedAgentCreation).not.toHaveBeenCalled()
  })

  it('拒绝低质量名称，并在创建时裁剪首尾空白', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage({ ...initialState, teams: [initialState.teams[0]] })
    const input = screen.getByRole('textbox', { name: /Agent 名称/ })

    fireEvent.change(input, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))
    expect(screen.getByText('名称不能全部是数字。')).toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(bridge.commitManagedAgentCreation).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '  阿策  ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))
    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    expect(bridge.commitManagedAgentCreation.mock.calls[0][1].name).toBe('阿策')
  })

  it('模板只预填 mission 与 instructions，不扩大权限', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage({ ...initialState, teams: [initialState.teams[0]] })
    enterName()

    fireEvent.click(screen.getByRole('button', { name: '代码审查' }))
    expect(screen.getByRole('textbox', { name: /一句话描述/ })).toHaveValue('审查代码的正确性、安全性与可维护性。')
    expect(screen.getByRole('textbox', { name: /角色定位/ })).toHaveValue('你是一名严格、务实的代码审查 Agent，负责在代码合入前识别可复现且影响明确的问题。')
    expect(screen.getByRole('textbox', { name: /工作方法与约束/ })).toHaveValue('先确认变更范围和验证证据。\n按影响排序，说明问题位置、后果和最小修复方向。\n不要把个人偏好表达成代码缺陷。')
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    const agent = bridge.commitManagedAgentCreation.mock.calls[0][1]
    expect(agent.mission).toBe('审查代码的正确性、安全性与可维护性。')
    expect(agent.instructions).toContain('严格、务实的代码审查 Agent')
    expect(agent.instructions).toContain('先确认变更范围和验证证据')
    expect(agent.responsibilities).toEqual([])
    expect(agent.ruleRefs).toEqual([])
    expect(agent.permissions).toEqual({ files: '未授予', commands: '未授予', network: '未授予', delegation: '未授予' })
    expect(agent.serviceGrants).toEqual([])
  })

  it('修改模板字段后切换模板需要确认，且不覆盖名称', () => {
    renderPage()
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '代码审查' }))
    fireEvent.change(screen.getByRole('textbox', { name: /角色定位/ }), { target: { value: '自定义角色' } })

    fireEvent.click(screen.getByRole('button', { name: '研究助理' }))

    expect(screen.getByRole('dialog', { name: '替换当前模板内容？' })).toBeInTheDocument()
    expect(document.getElementById('field-角色定位（可选）')).toHaveValue('自定义角色')
    fireEvent.click(screen.getByRole('button', { name: '替换内容' }))
    expect(screen.queryByRole('dialog', { name: '替换当前模板内容？' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveValue('阿策')
    expect(screen.getByRole('textbox', { name: /角色定位/ })).toHaveValue('你是一名严谨的研究助理，围绕明确问题收集、比较并归纳信息。')
  })

  it('关闭有内容的 Dialog 前确认放弃草稿', () => {
    renderPage()
    enterName()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.getByRole('dialog', { name: '放弃未保存内容？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.queryByRole('dialog', { name: '放弃未保存内容？' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveValue('阿策')
  })

  it('单 Team 时仅填写名称即可创建 Agent，并保持安全默认', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    const { router } = renderPage({ ...initialState, currentTeamId: 'team-personal', teams: [{ ...initialState.teams[0], id: 'team-personal', name: '个人 Team' }] })
    enterName()

    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    const [requestId, agent, files, grants] = bridge.commitManagedAgentCreation.mock.calls[0]
    expect(requestId).toBe('create-agent-fixed-agent-id')
    expect(agent).toMatchObject({
      id: 'agent-backend-id',
      name: '阿策',
      mission: '',
      responsibilities: [],
      deliverables: [],
      decisionBoundaries: [],
      escalationConditions: [],
      prohibitions: [],
      completionDefinition: [],
      permissions: { files: '未授予', commands: '未授予', network: '未授予', delegation: '未授予' },
      serviceGrants: [],
    })
    expect(bridge.allocateAgentId).toHaveBeenCalledWith('create-agent-fixed-agent-id')
    expect(agent.teamId).toBe('team-personal')
    expect(agent.primaryDepartmentId).toBeUndefined()
    expect(agent.roleId).toBeUndefined()
    expect(grants).toEqual([])
    expect(files.map((file: { path: string }) => file.path).sort()).toEqual([
      'agent.yaml', 'config/commands.yaml', 'config/context.yaml', 'config/hooks.yaml', 'config/mcp.yaml',
      'config/orchestration.yaml', 'config/permissions.yaml', 'config/rules.yaml', 'config/skills.yaml',
      'config/sop.yaml', 'instructions.md',
    ])
    const orchestration = files.find((file: { path: string }) => file.path === 'config/orchestration.yaml')
    expect(orchestration?.content).toBe(contractsFixture.orchestrationSaveRequest.baseContent)
    expect(orchestration?.content).not.toContain('requireWorkspaceBinding')
    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/agent-backend-id'))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('Agent 已创建')).toBeInTheDocument()
    expect(screen.getByText(/任务使用与执行仍在 Claude Code 中完成/)).toBeInTheDocument()
  })

  it('多 Team 时继承当前 Team，部门和岗位仍可跳过', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage()
    enterName()

    expect(screen.queryByRole('combobox', { name: '所属 Team' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    const agent = bridge.commitManagedAgentCreation.mock.calls[0][1]
    expect(agent.teamId).toBe(initialState.currentTeamId)
    expect(agent.primaryDepartmentId).toBeUndefined()
    expect(agent.roleId).toBeUndefined()
  })

  it('部门深链接预填 Team 和部门并展开更多设置，岗位仍可后补', () => {
    renderPage(initialState, '/agents/new?department=dev')

    expect(screen.queryByRole('combobox', { name: /所属 Team/ })).not.toBeInTheDocument()
    expect(screen.getByText('更多设置（头像、部门与岗位）').closest('details')).toHaveAttribute('open')
    expect(screen.getByRole('combobox', { name: /所属部门/ })).toHaveValue('dev')
    expect(screen.getByRole('combobox', { name: /岗位/ })).toHaveValue('')
  })

  it('忽略 legacy 工作区深链接，不创建绑定', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage({ ...initialState, teams: [initialState.teams[0]] }, '/agents/new?workspace=legacy-project')
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/工作区/)).not.toBeInTheDocument()
  })

  it('导入模式通过文件选择和预览确认创建安全受管副本', async () => {
    bridge.desktop = true
    bridge.importClaudeAgent.mockImplementation(async (_path, _hash, _requestId, agent) => managedResult(agent))
    const { router } = renderPage(initialState, '/agents/new?mode=import')

    expect(screen.getByRole('dialog', { name: '导入 Agent' })).toBeInTheDocument()
    expect(screen.getByText(/当前支持 Claude Code 的 \.claude\/agents\/\*\.md/)).toBeInTheDocument()
    expect(screen.queryByText('1 身份与组织')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /所属部门|岗位|适用项目/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入 Agent' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /选择 Agent 文件/ }))

    expect(await screen.findByText('Reviews code')).toBeInTheDocument()
    expect(screen.getByText('Review carefully.')).toBeInTheDocument()
    expect(screen.getByText(`将添加到当前 Team：${initialState.teams.find((team) => team.id === initialState.currentTeamId)?.name}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入 Agent' }))

    await waitFor(() => expect(bridge.importClaudeAgent).toHaveBeenCalledWith('/tmp/.claude/agents/reviewer.md', 'sha256:source', 'import-agent-fixed-agent-id', expect.objectContaining({ id: 'agent-backend-id', instructions: 'Review carefully.', primaryDepartmentId: undefined, roleId: undefined, serviceGrants: [] }), expect.any(Array), []))
    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/agent-backend-id'))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('Agent 已导入')).toBeInTheDocument()
  })

  it('遗留 reference 链接安全降级为新建 Agent', () => {
    renderPage(initialState, '/agents/new?mode=reference')

    expect(screen.getByRole('dialog', { name: '新建 Agent' })).toBeInTheDocument()
    expect(screen.queryByText(/外部 Agent 目录|登记外部 Agent|添加页面引用/)).not.toBeInTheDocument()
  })

  it('导入名称不合格时允许就地修正后继续', async () => {
    bridge.desktop = true
    bridge.previewClaudeAgent.mockResolvedValue({ sourcePath: '/tmp/.claude/agents/reviewer.md', sourceBaselineHash: 'sha256:source', name: '123456', description: 'Reviews code', instructions: 'Review carefully.', recognizedFields: ['name'], ignoredFields: [] })
    renderPage(initialState, '/agents/new?mode=import')

    fireEvent.click(screen.getByRole('button', { name: /选择 Agent 文件/ }))
    const input = await screen.findByRole('textbox', { name: /Agent 名称/ })
    expect(input).toHaveValue('123456')
    fireEvent.click(screen.getByRole('button', { name: '导入 Agent' }))
    expect(screen.getByText('名称不能全部是数字。')).toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(bridge.importClaudeAgent).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: '代码审查员' } })
    expect(screen.queryByText('名称不能全部是数字。')).not.toBeInTheDocument()
  })

  it('半成功状态保留草稿并引导到全局恢复', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent, 'organization_pending'))
    renderPage({ ...initialState, teams: [initialState.teams[0]] })
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent 配置尚未完整保存，可从配置状态中的待处理项继续修复')
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveValue('阿策')
    expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1)
  })

  it('完整组织创建只提交同作用域的三字段', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage()
    enterName()
    selectOptionalOrganization()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    expect(bridge.commitManagedAgentCreation.mock.calls[0][1]).toMatchObject({ teamId: 'xinghe', primaryDepartmentId: 'dev', roleId: 'role-web-engineer' })
  })
})
