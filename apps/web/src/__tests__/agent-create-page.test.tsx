// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  bridge.previewClaudeAgent.mockResolvedValue({ toolId: 'claude-code', sourcePath: '/tmp/.claude/agents/reviewer.md', sourceFileName: 'reviewer.md', sourceBaselineHash: 'sha256:source', name: 'Reviewer', description: 'Reviews code', instructions: 'Review carefully.', recognizedFields: ['name', 'description'], ignoredFields: [] })
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

describe('Agent 创建页', () => {
  it('普通创建以模板优先的 Dialog 呈现，只要求名称', () => {
    bridge.desktop = true
    renderPage()

    expect(screen.getByRole('dialog', { name: '新建 Agent' })).toBeInTheDocument()
    expect(screen.getByText('将创建到「星河科技」。选择角色模板预填内容，创建后仍可修改。')).toBeInTheDocument()
    expect(screen.queryByText('所属 Team')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toBeInTheDocument()
    expect(screen.getByText('角色模板（可选）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '空白 Agent' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '软件研发' })).toHaveAttribute('aria-pressed', 'false')
    const moreSettings = screen.getByText('更多设置').closest('details')!
    expect(moreSettings).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('更多设置'))
    expect(moreSettings).toHaveAttribute('open')
    const avatarButton = screen.getByRole('button', { name: '选择 Agent 头像' })
    const functionInput = screen.getByRole('textbox', { name: '自定义职能' })
    expect(avatarButton.compareDocumentPosition(functionInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('选择图片')).not.toBeInTheDocument()
    expect(functionInput).toHaveValue('')
    expect(screen.getByRole('button', { name: '研发' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: '运营' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /一句话描述/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /角色定位/ })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /工作原则/ })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '所属 Team' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 身份与组织')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 Agent' })).toBeInTheDocument()
  })

  it('当前 Team 不可用时显示明确错误并阻止创建', () => {
    renderPage({ ...initialState, currentTeamId: 'team-missing' })

    expect(screen.getByText('当前 Team 不可用，暂时无法创建 Agent。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '创建 Agent' })).toBeDisabled()
    fireEvent.click(screen.getByText('更多设置'))
    expect(screen.getByRole('alert')).toHaveTextContent('请返回 Team 切换器重新选择')
  })

  it('创建后进入普通详情，并引导配置 Skills', async () => {
    const { router } = renderPage()

    expect(screen.getByText('浏览器演示不会写入本机配置。')).toBeInTheDocument()
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/agent-fixed-agent-id'))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('Agent 已创建')).toBeInTheDocument()
    expect(screen.getByText(/下一步可在“技能”中配置 Skills/)).toBeInTheDocument()
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

  it('可输入自定义职能并保存规范化值', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage({ ...initialState, teams: [initialState.teams[0]] })
    enterName()
    fireEvent.click(screen.getByText('更多设置'))

    fireEvent.change(screen.getByRole('textbox', { name: '自定义职能' }), { target: { value: '  开发者体验  ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    expect(bridge.commitManagedAgentCreation.mock.calls[0][1].functionId).toBe('开发者体验')
    expect(bridge.commitManagedAgentCreation.mock.calls[0][2]).toContainEqual(expect.objectContaining({
      path: 'agent.yaml',
      content: expect.stringContaining('functionId: "开发者体验"'),
    }))
  })

  it('职能支持单选预设和自由输入', () => {
    renderPage()
    fireEvent.click(screen.getByText('更多设置'))
    const input = screen.getByRole('textbox', { name: '自定义职能' })
    const product = screen.getByRole('button', { name: '产品' })
    const design = screen.getByRole('button', { name: '设计' })

    fireEvent.click(product)
    expect(product).toHaveAttribute('aria-pressed', 'true')
    expect(input).toHaveValue('')

    fireEvent.click(design)
    expect(product).toHaveAttribute('aria-pressed', 'false')
    expect(design).toHaveAttribute('aria-pressed', 'true')

    fireEvent.change(input, { target: { value: '前端研发' } })
    expect(design).toHaveAttribute('aria-pressed', 'false')
    expect(input).toHaveValue('前端研发')
  })

  it('更多设置建议当前 Team 已使用的自定义职能', () => {
    const current = initialState.agents.find((agent) => agent.teamId === initialState.currentTeamId)!
    const otherTeam = { ...current, id: 'other-agent', teamId: 'team-other', functionId: '安全审计' }
    renderPage({
      ...initialState,
      agents: [
        ...initialState.agents,
        { ...current, id: 'custom-function-agent', functionId: '开发者体验' },
        otherTeam,
      ],
    })

    fireEvent.click(screen.getByText('更多设置'))

    expect(screen.getByRole('button', { name: '开发者体验' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '安全审计' })).not.toBeInTheDocument()
  })

  it('模板只预填 mission 与 instructions，不扩大权限', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage({ ...initialState, teams: [initialState.teams[0]] })
    enterName()

    fireEvent.click(screen.getByRole('button', { name: '软件研发' }))
    expect(screen.getByRole('textbox', { name: /一句话描述/ })).toHaveValue('把已确认目标交付为可验证的软件成果。')
    expect(screen.getByRole('textbox', { name: /角色定位/ })).toHaveValue('你是一名可靠的研发 Agent，负责实现、验证并说明技术取舍。')
    fireEvent.click(screen.getByText('更多设置'))
    expect(screen.getByRole('textbox', { name: /工作原则/ })).toHaveValue('先理解现有代码和边界。\n保持改动聚焦并运行相关验证。\n不自行扩大权限或任务范围。')
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    const agent = bridge.commitManagedAgentCreation.mock.calls[0][1]
    expect(agent.functionId).toBe('engineering')
    expect(agent.mission).toBe('把已确认目标交付为可验证的软件成果。')
    expect(agent.instructions).toContain('可靠的研发 Agent')
    expect(agent.instructions).toContain('先理解现有代码和边界')
    expect(agent.responsibilities).toEqual([])
    expect(agent.ruleRefs).toEqual([])
    expect(agent.permissions).toEqual({ files: '未授予', commands: '未授予', network: '未授予', delegation: '未授予' })
    expect(bridge.commitManagedAgentCreation.mock.calls[0][2]).toContainEqual({
      path: 'config/permissions.yaml',
      content: 'schemaVersion: 1\npermissions:\n  files: "未授予"\n  commands: "未授予"\n  network: "未授予"\n  delegation: "未授予"',
    })
  })

  it('修改职能后切换模板需要确认，避免自定义值被静默覆盖', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '软件研发' }))
    fireEvent.click(screen.getByText('更多设置'))
    const functionInput = screen.getByRole('textbox', { name: '自定义职能' })
    fireEvent.change(functionInput, { target: { value: '开发者体验' } })

    fireEvent.click(screen.getByRole('button', { name: '产品规划' }))

    expect(screen.getByRole('dialog', { name: '替换当前模板内容？' })).toBeInTheDocument()
    expect(functionInput).toHaveValue('开发者体验')
  })

  it('修改模板字段后切换模板需要确认，且不覆盖名称', () => {
    renderPage()
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '软件研发' }))
    fireEvent.change(screen.getByRole('textbox', { name: /角色定位/ }), { target: { value: '自定义角色' } })

    fireEvent.click(screen.getByRole('button', { name: '产品规划' }))

    expect(screen.getByRole('dialog', { name: '替换当前模板内容？' })).toBeInTheDocument()
    expect(document.getElementById('field-角色定位（可选）')).toHaveValue('自定义角色')
    fireEvent.click(screen.getByRole('button', { name: '替换内容' }))
    expect(screen.queryByRole('dialog', { name: '替换当前模板内容？' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveValue('阿策')
    expect(screen.getByRole('textbox', { name: /角色定位/ })).toHaveValue('你是一名务实的产品 Agent，负责澄清需求、收敛范围并定义可验证结果。')
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

  it('忽略 legacy 工作区深链接，不创建绑定', async () => {
    bridge.desktop = true
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent))
    renderPage({ ...initialState, teams: [initialState.teams[0]] }, '/agents/new?workspace=legacy-project')
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    await waitFor(() => expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/工作区/)).not.toBeInTheDocument()
  })

  it('导入模式展示九个来源工具，并只开放真实支持的 Claude Code', () => {
    bridge.desktop = true
    renderPage(initialState, '/agents/new?mode=import')

    const tools = screen.getAllByRole('radio')
    expect(tools).toHaveLength(9)
    expect(screen.getByRole('group', { name: '来源工具' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeEnabled()
    for (const name of ['Claude Desktop', 'ChatGPT', 'Gemini CLI', 'Grok Build', 'OpenCode', 'OpenClaw', 'Hermes', 'Pi']) {
      expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeDisabled()
    }
    expect(screen.getByText(/当前仅支持导入 Claude Code 的 \.claude\/agents\/\*\.md 文件/)).toBeInTheDocument()
    expect(screen.getAllByText('暂不支持导入')).toHaveLength(8)
    expect(screen.queryByRole('combobox', { name: '来源工具' })).not.toBeInTheDocument()
  })

  it('Web 导入明确禁用本机文件选择', () => {
    renderPage(initialState, '/agents/new?mode=import')

    const selectFile = screen.getByRole('button', { name: /选择 Agent 文件/ })
    expect(selectFile).toBeDisabled()
    expect(screen.getByText('本机文件选择仅在 Bandi Desktop 中可用。')).toBeInTheDocument()
    fireEvent.click(selectFile)
    expect(bridge.selectClaudeAgentFile).not.toHaveBeenCalled()
  })

  it('导入模式通过文件选择和预览确认创建安全受管副本', async () => {
    bridge.desktop = true
    bridge.importClaudeAgent.mockImplementation(async (_path, _hash, _requestId, agent) => managedResult(agent))
    const { router } = renderPage(initialState, '/agents/new?mode=import')

    expect(screen.getByRole('dialog', { name: '导入 Agent' })).toBeInTheDocument()
    expect(screen.getByText(/当前仅支持导入 Claude Code 的 \.claude\/agents\/\*\.md 文件/)).toBeInTheDocument()
    expect(screen.queryByText('1 身份与组织')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入 Agent' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /选择 Agent 文件/ }))

    expect(await screen.findByRole('heading', { name: '导入预览' })).toBeInTheDocument()
    expect(screen.getByText('Claude Code · reviewer.md')).toBeInTheDocument()
    expect(screen.getByText('Reviews code')).toBeInTheDocument()
    expect(screen.getByText('Review carefully.')).toBeInTheDocument()
    expect(screen.getByText(/不导入 Memory、Skills、Rules、MCP 或权限/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '重新选择 Agent 文件' })).toHaveLength(1)
    expect(screen.getByText(`将添加到：${initialState.teams.find((team) => team.id === initialState.currentTeamId)?.name}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '导入 Agent' }))

    await waitFor(() => expect(bridge.importClaudeAgent).toHaveBeenCalledWith('/tmp/.claude/agents/reviewer.md', 'sha256:source', 'import-agent-fixed-agent-id', expect.objectContaining({ id: 'agent-backend-id', instructions: 'Review carefully.', teamId: initialState.currentTeamId }), expect.any(Array)))
    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/agent-backend-id'))
    expect(router.state.location.search).toBe('')
    expect(await screen.findByText('Agent 已导入')).toBeInTheDocument()
    expect(screen.getByText(/已创建 Bandi 受管副本，原文件保持不变/)).toBeInTheDocument()
    expect(screen.getByText(/下一步可在“技能”中配置 Skills/)).toBeInTheDocument()
  })

  it('遗留 reference 链接安全降级为新建 Agent', () => {
    renderPage(initialState, '/agents/new?mode=reference')

    expect(screen.getByRole('dialog', { name: '新建 Agent' })).toBeInTheDocument()
    expect(screen.queryByText(/外部 Agent 目录|登记外部 Agent|添加页面引用/)).not.toBeInTheDocument()
  })

  it('导入名称不合格时允许就地修正后继续', async () => {
    bridge.desktop = true
    bridge.previewClaudeAgent.mockResolvedValue({ toolId: 'claude-code', sourcePath: '/tmp/.claude/agents/reviewer.md', sourceFileName: 'reviewer.md', sourceBaselineHash: 'sha256:source', name: '123456', description: 'Reviews code', instructions: 'Review carefully.', recognizedFields: ['name'], ignoredFields: [] })
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
    bridge.commitManagedAgentCreation.mockImplementation(async (_requestId, agent) => managedResult(agent, 'team_pending'))
    renderPage({ ...initialState, teams: [initialState.teams[0]] })
    enterName()
    fireEvent.click(screen.getByRole('button', { name: '创建 Agent' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Agent 配置尚未完整保存，可从配置状态中的待处理项继续修复')
    expect(screen.getByRole('textbox', { name: /Agent 名称/ })).toHaveValue('阿策')
    expect(bridge.commitManagedAgentCreation).toHaveBeenCalledTimes(1)
  })

})
