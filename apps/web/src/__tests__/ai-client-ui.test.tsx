// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiClientIcon, AiClientLaunchAction } from '../components/ai-clients'
import { aiClients } from '../mock'
import { GlobalSheets } from '../sheets'
import { AppProvider, initialState, useApp, type State } from '../state'

const desktopBridge = vi.hoisted(() => ({ desktop: false, requestClientLaunchV3: vi.fn() }))

vi.mock('../desktop-bridge', () => ({
  isDesktopRuntime: () => desktopBridge.desktop,
  listAgents: () => Promise.resolve({ agents: [], diagnostics: [] }),
  listAgentRecoveryOperations: () => Promise.resolve([]),
  loadLongTermDomainSnapshotV4: () => Promise.resolve({ schemaVersion: 4, teams: [], taskBriefs: [] }),
  requestClientLaunchV3: desktopBridge.requestClientLaunchV3,
}))

function Harness({ agentId }: { agentId?: string }) {
  const { state } = useApp()
  return <><AiClientLaunchAction agentId={agentId} />{state.notice && <output>{state.notice.title} {state.notice.description}</output>}<GlobalSheets /></>
}

function renderLaunch(overrides: Partial<State> = {}, agentId?: string) {
  const state: State = { ...initialState, ...overrides, onboarding: { status: 'completed' } }
  return render(<MemoryRouter><AppProvider initialState={state}><Harness agentId={agentId} /></AppProvider></MemoryRouter>)
}

beforeEach(() => {
  desktopBridge.desktop = false
  desktopBridge.requestClientLaunchV3.mockReset()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AI 编程工具界面', () => {
  it('固定九工具正常状态都显示本地 Logo', () => {
    const { container } = render(<>{aiClients.map((client) => <AiClientIcon key={client.id} client={client} />)}</>)

    expect(container.querySelectorAll('img')).toHaveLength(9)
    for (const client of aiClients) expect(screen.queryByText(client.shortName)).not.toBeInTheDocument()
  })

  it('单个 Logo 加载失败时独立回退到文字徽标', () => {
    const { container } = render(<>{aiClients.map((client) => <AiClientIcon key={client.id} client={client} />)}</>)

    fireEvent.error(container.querySelectorAll('img')[2])
    expect(screen.getByText('CG')).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(8)
  })

  it('固定九工具都可进入上下文选择', () => {
    renderLaunch()
    fireEvent.click(screen.getByRole('button', { name: '选择 AI 编程工具' }))

    expect(screen.getAllByRole('menuitem')).toHaveLength(10)
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Desktop/ }))
    expect(screen.getByRole('dialog', { name: '在 Claude Desktop 中继续' })).toBeInTheDocument()
  })

  it('无需求时仍可打开上下文面板', async () => {
    renderLaunch()
    fireEvent.click(screen.getByRole('button', { name: '选择 AI 编程工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Code/ }))

    expect(screen.getByRole('dialog', { name: '在 Claude Code 中继续' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '不附加需求' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加需求' }))
    expect(screen.getByRole('option', { name: '不附加需求' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '复制上下文' })).toBeEnabled()
  })

  it('Agent 候选只包含所选 Team 的已启用成员', async () => {
    const teams = [
      { id: 'team-a', name: 'Team A', memberAgentIds: ['zhouce', 'songyan'], sharedAssetIds: [] },
      { id: 'team-b', name: 'Team B', memberAgentIds: ['zhiheng'], sharedAssetIds: [] },
    ]
    const agents = initialState.agents.map((agent) => ({ ...agent, teamId: agent.id === 'zhiheng' ? 'team-b' : 'team-a' }))
    renderLaunch({ teams, agents })
    fireEvent.click(screen.getByRole('button', { name: '选择 AI 编程工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Code/ }))

    expect(await screen.findByRole('option', { name: '周策' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '宋研' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('1. Team'), { target: { value: 'team-b' } })
    expect(await screen.findByRole('option', { name: '知衡' })).toBeInTheDocument()
  })

  it('Desktop 只提交稳定 ID 并显示启动请求结果', async () => {
    desktopBridge.desktop = true
    const agent = initialState.agents.find((item) => item.status === 'active')!
    const team = initialState.teams.find((item) => item.id === agent.teamId)!
    desktopBridge.requestClientLaunchV3.mockResolvedValue({
      clientId: 'claude-code', adapterId: 'claude-code-terminal-v1', terminalId: 'terminal', intent: 'start_with_context', teamId: team.id, agentId: agent.id,
      capability: { status: 'supported', reason: '打开请求已提交', evidence: [], remediation: [] }, outcome: 'manual_context_required', contextDelivery: 'manual_copy', manualPrompt: '已验证的上下文',
    })
    renderLaunch({ teams: [team] }, agent.id)
    fireEvent.click(screen.getByRole('button', { name: '选择 AI 编程工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Code/ }))
    fireEvent.click(await screen.findByRole('button', { name: '启动' }))

    await waitFor(() => expect(desktopBridge.requestClientLaunchV3).toHaveBeenCalledWith({
      clientId: 'claude-code', adapterId: 'claude-code-terminal-v1', terminalId: 'terminal', intent: 'start_with_context', teamId: team.id, agentId: agent.id, taskId: undefined,
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('上下文已复制，请手动粘贴')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('已验证的上下文')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('剪贴板失败时保留 Dialog 并显示手动复制入口', async () => {
    desktopBridge.desktop = true
    const agent = initialState.agents.find((item) => item.status === 'active')!
    const team = initialState.teams.find((item) => item.id === agent.teamId)!
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    desktopBridge.requestClientLaunchV3.mockResolvedValue({
      clientId: 'claude-code', adapterId: 'claude-code-terminal-v1', terminalId: 'terminal', intent: 'start_with_context', teamId: team.id, agentId: agent.id,
      capability: { status: 'supported', reason: '打开请求已提交', evidence: [], remediation: [] }, outcome: 'manual_context_required', contextDelivery: 'manual_copy', manualPrompt: '已验证的上下文',
    })
    renderLaunch({ teams: [team] }, agent.id)
    fireEvent.click(screen.getByRole('button', { name: '选择 AI 编程工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Code/ }))
    fireEvent.click(await screen.findByRole('button', { name: '启动' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('请手动选择并复制上下文')
    expect(screen.getByRole('dialog', { name: '在 Claude Code 中继续' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  it('不一致结果保持中性并不关闭 Dialog', async () => {
    desktopBridge.desktop = true
    const agent = initialState.agents.find((item) => item.status === 'active')!
    const team = initialState.teams.find((item) => item.id === agent.teamId)!
    desktopBridge.requestClientLaunchV3.mockResolvedValue({
      clientId: 'claude-code', adapterId: 'claude-code-terminal-v1', terminalId: 'terminal', intent: 'start_with_context', teamId: team.id, agentId: agent.id,
      capability: { status: 'supported', reason: '未知结果', evidence: [], remediation: [] }, outcome: 'terminal_launch_requested', contextDelivery: 'initial_prompt',
    })
    renderLaunch({ teams: [team] }, agent.id)
    fireEvent.click(screen.getByRole('button', { name: '选择 AI 编程工具' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Claude Code/ }))
    fireEvent.click(await screen.findByRole('button', { name: '启动' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认的启动结果')
    expect(screen.getByRole('dialog', { name: '在 Claude Code 中继续' })).toBeInTheDocument()
  })
})
