// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiClientLaunchAction } from '../components/ai-clients'
import { GlobalSheets } from '../sheets'
import { AppProvider, initialState, useApp, type State } from '../state'

const desktopBridge = vi.hoisted(() => ({ desktop: false, requestClientLaunchV3: vi.fn() }))

vi.mock('../desktop-bridge', () => ({
  isDesktopRuntime: () => desktopBridge.desktop,
  listAgents: () => Promise.resolve({ agents: [], diagnostics: [] }),
  listAgentRecoveryOperations: () => Promise.resolve([]),
  loadLongTermDomainSnapshotV4: () => Promise.resolve({ schemaVersion: 4, teams: [], taskBriefs: [] }),
  loadToolConfiguration: () => Promise.resolve({ revision: 0, selectedPlanId: 'default', builtInToolIds: [], plans: [{ id: 'default', name: '默认方案', toolIds: [] }], customTools: [] }),
  requestClientLaunchV3: desktopBridge.requestClientLaunchV3,
}))

function Harness({ agentId }: { agentId?: string }) {
  const { state } = useApp()
  const location = useLocation()
  return <><AiClientLaunchAction agentId={agentId} />{state.notice && <output>{state.notice.title} {state.notice.description}</output>}<output aria-label="当前地址">{location.pathname}{location.search}</output><GlobalSheets /></>
}

function renderLaunch(clientIds: string[], overrides: Partial<State> = {}, agentId?: string) {
  const state: State = {
    ...initialState,
    ...overrides,
    onboarding: { status: 'completed' },
    configurationEnvironments: initialState.configurationEnvironments.map((item) => item.id === 'personal' ? { ...item, clientIds } : item),
  }
  return render(<MemoryRouter><AppProvider initialState={state}><Harness agentId={agentId} /></AppProvider></MemoryRouter>)
}

beforeEach(() => {
  desktopBridge.desktop = false
  desktopBridge.requestClientLaunchV3.mockReset()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('AI 编程工具界面', () => {
  it('不支持上下文启动的工具直接打开配置', () => {
    renderLaunch(['claude-desktop'])

    fireEvent.click(screen.getByRole('button', { name: '查看 Claude Desktop 配置' }))

    expect(screen.getByLabelText('当前地址')).toHaveTextContent('/settings?section=tools')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('无 TaskBrief 时仍可打开上下文面板', async () => {
    renderLaunch(['claude-code'])

    fireEvent.click(screen.getByRole('button', { name: '在 Claude Code 中继续' }))

    expect(screen.getByRole('dialog', { name: '在 Claude Code 中继续' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '跳过任务简报' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '添加任务简报' }))
    expect(screen.getByRole('option', { name: '跳过任务简报' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '复制上下文' })).toBeEnabled()
  })

  it('Agent 候选只包含所选 Team 的已启用成员', async () => {
    const teams = [
      { id: 'team-a', name: 'Team A', memberAgentIds: ['zhouce', 'songyan'], sharedAssetIds: [] },
      { id: 'team-b', name: 'Team B', memberAgentIds: ['zhiheng'], sharedAssetIds: [] },
    ]
    const agents = initialState.agents.map((agent) => ({
      ...agent,
      teamId: agent.id === 'zhiheng' ? 'team-b' : 'team-a',
    }))
    renderLaunch(['claude-code'], { teams, agents })
    fireEvent.click(screen.getByRole('button', { name: '在 Claude Code 中继续' }))

    expect(await screen.findByRole('option', { name: '周策' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '宋研' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '知衡' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('1. Team'), { target: { value: 'team-b' } })
    expect(await screen.findByRole('option', { name: '知衡' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '周策' })).not.toBeInTheDocument()
  })

  it('Desktop 只提交 Team、Agent 与可选 TaskBrief ID', async () => {
    desktopBridge.desktop = true
    const agent = initialState.agents.find((item) => item.status === 'active')!
    const team = initialState.teams.find((item) => item.id === agent.teamId)!
    desktopBridge.requestClientLaunchV3.mockResolvedValue({
      clientId: 'claude-code', adapterId: 'claude-code-terminal-v1', terminalId: 'terminal', intent: 'start_with_context', teamId: team.id, agentId: agent.id,
      capability: { status: 'supported', reason: '上下文已准备', evidence: [], remediation: [] }, outcome: 'context_prepared',
    })
    renderLaunch(['claude-code'], { teams: [team] }, agent.id)
    fireEvent.click(screen.getByRole('button', { name: '在 Claude Code 中继续' }))
    fireEvent.click(await screen.findByRole('button', { name: '准备上下文' }))

    await waitFor(() => expect(desktopBridge.requestClientLaunchV3).toHaveBeenCalledWith({
      clientId: 'claude-code', adapterId: 'claude-code-terminal-v1', terminalId: 'terminal', intent: 'start_with_context', teamId: team.id, agentId: agent.id,
      taskId: undefined,
    }))
    expect(await screen.findByText(/上下文已准备/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

})
