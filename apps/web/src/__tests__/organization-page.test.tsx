// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyDepartmentRedirect, OrganizationPage, TeamDetailPage } from '../pages/organization/organization-pages'
import { GlobalSheets } from '../sheets'
import { AppProvider, initialState } from '../state'
import * as desktopBridge from '../desktop-bridge'

const NativeRequest = globalThis.Request

beforeEach(() => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined })
    }
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderOrganization(initialEntry = '/organization', state = initialState) {
  const router = createMemoryRouter([{
    path: '/',
    element: <AppProvider initialState={state}><Outlet /><GlobalSheets /></AppProvider>,
    children: [
      { path: 'organization', element: <OrganizationPage /> },
      { path: 'organization/teams/:id', element: <TeamDetailPage /> },
      { path: 'organization/departments/:id', element: <LegacyDepartmentRedirect /> },
    ],
  }], { initialEntries: [initialEntry] })
  return { router, ...render(<RouterProvider router={router} />) }
}

const rootWithChildren = initialState.departments.find((department) => initialState.departments.some((item) => item.parentDepartmentId === department.id))!
const child = initialState.departments.find((department) => department.parentDepartmentId === rootWithChildren.id)!

describe('组织页', () => {
  it('独立展开和折叠部门，不改变右侧 Team 概览', () => {
    renderOrganization(`/organization?team=${rootWithChildren.teamId}`)

    const toggle = screen.getByRole('button', { name: `收起${rootWithChildren.name}` })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: child.name })).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: child.name })).not.toBeInTheDocument()
    expect(screen.getByText(initialState.teams.find((team) => team.id === rootWithChildren.teamId)!.mission!)).toBeInTheDocument()
  })

  it('在同一组织页选择部门并展示详情', async () => {
    const { router } = renderOrganization(`/organization?team=${rootWithChildren.teamId}`)

    fireEvent.click(screen.getByRole('button', { name: child.name }))

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/organization'))
    expect(router.state.location.search).toContain(`team=${child.teamId}`)
    expect(router.state.location.search).toContain(`department=${child.id}`)
    expect(screen.getByRole('button', { name: child.name })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: child.name })).toBeInTheDocument()
    expect(screen.getByText(child.mission)).toBeInTheDocument()
    expect(screen.getByText('部门职责')).toBeInTheDocument()
    expect(screen.getByText('部门层级')).toBeInTheDocument()
    expect(screen.getByText('岗位设置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加岗位' })).toBeInTheDocument()
    expect(screen.getByText('部门成员')).toBeInTheDocument()
    expect(screen.getByText('跨部门服务')).toBeInTheDocument()
    expect(screen.getByLabelText('共 0 项跨部门服务')).toBeInTheDocument()
    expect(screen.getByText(/只汇总其他 Agent/)).toBeInTheDocument()
    expect(screen.queryByText('有效')).not.toBeInTheDocument()
  })

  it('Team概览使用统一的中文实体术语', () => {
    renderOrganization(`/organization?team=${rootWithChildren.teamId}`)

    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.queryByText('Company')).not.toBeInTheDocument()
    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument()
  })

  it('编辑部门时只读展示所属Team，并只允许从本部门成员选择主管', () => {
    renderOrganization(`/organization?team=${child.teamId}&department=${child.id}`)

    fireEvent.click(screen.getByRole('button', { name: '编辑部门' }))

    const dialog = screen.getByRole('dialog', { name: '编辑部门' })
    expect(within(dialog).getByText('所属Team')).toBeInTheDocument()
    expect(within(dialog).getByText(initialState.teams.find((team) => team.id === child.teamId)!.name)).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: '所属Team' })).not.toBeInTheDocument()
    const manager = within(dialog).getByRole('combobox', { name: '部门主管' })
    const memberNames = initialState.agents.filter((agent) => child.memberAgentIds.includes(agent.id) && agent.teamId === child.teamId && agent.status === 'active').map((agent) => agent.name)
    expect(within(manager).getAllByRole('option').map((option) => option.textContent)).toEqual(['未设置', ...memberNames])
    expect(within(dialog).getByText(/设置主管关系不会授予/)).toBeInTheDocument()
    expect(within(dialog).queryByText('Team')).not.toBeInTheDocument()
  })

  it('创建 Team 可预览自动标识并选择文字和颜色', () => {
    renderOrganization()
    fireEvent.click(screen.getByRole('button', { name: '编辑Team' }))
    const dialog = screen.getByRole('dialog', { name: '编辑Team' })
    const name = within(dialog).getByRole('textbox', { name: '名称' })
    const mark = within(dialog).getByRole('textbox', { name: '文字标识' })

    fireEvent.change(name, { target: { value: 'Bandi Studio' } })
    expect(within(dialog).getByText('BS')).toBeInTheDocument()
    fireEvent.change(mark, { target: { value: '研发组' } })
    expect(mark).toHaveAttribute('aria-invalid', 'true')
    expect(within(dialog).getByText('请输入 1–2 个字母或数字。')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '保存演示配置' })).toBeDisabled()
    fireEvent.change(mark, { target: { value: 'RD' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '蓝色' }))
    expect(within(dialog).getByRole('button', { name: '蓝色' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(dialog).getByRole('button', { name: '保存演示配置' }))

    expect(screen.getByRole('heading', { name: 'Bandi Studio' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑Team' }))
    const reopened = screen.getByRole('dialog', { name: '编辑Team' })
    expect(within(reopened).getByRole('textbox', { name: '文字标识' })).toHaveValue('RD')
    expect(within(reopened).getByRole('button', { name: '蓝色' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('深链接自动显示所选部门并展开祖先', () => {
    renderOrganization(`/organization?team=${child.teamId}&department=${child.id}`)

    expect(screen.getByRole('button', { name: `收起${rootWithChildren.name}` })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: child.name })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: child.name })).toBeInTheDocument()
  })

  it('Web 模式保存部门主管治理关系', async () => {
    const governedDepartment = initialState.departments.find((item) => item.id === 'dev')!
    const departmentManager = initialState.agents.find((agent) => governedDepartment.memberAgentIds.includes(agent.id) && agent.id !== governedDepartment.managerAgentId)!

    renderOrganization(`/organization?team=${governedDepartment.teamId}&department=${governedDepartment.id}`)
    fireEvent.click(screen.getByRole('button', { name: '编辑部门' }))
    const dialog = screen.getByRole('dialog', { name: '编辑部门' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: '部门主管' }), { target: { value: departmentManager.id } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存演示配置' }))
    fireEvent.click(screen.getByRole('button', { name: '编辑部门' }))
    expect(within(screen.getByRole('dialog', { name: '编辑部门' })).getByRole('combobox', { name: '部门主管' })).toHaveValue(departmentManager.id)
  })

  it('岗位重名错误具体说明并关联名称字段', () => {
    renderOrganization(`/organization?team=${child.teamId}&department=${child.id}`)
    fireEvent.click(screen.getByRole('button', { name: '添加岗位' }))
    const dialog = screen.getByRole('dialog', { name: '添加岗位' })
    const existing = initialState.roles.find((role) => role.teamId === child.teamId)!
    const nameInput = within(dialog).getByRole('textbox', { name: '岗位名称' })
    fireEvent.change(nameInput, { target: { value: existing.name } })
    expect(nameInput).toHaveAttribute('aria-describedby', 'role-name-error')
    expect(within(dialog).getByText(`同一Team内已有名为“${existing.name}”的岗位，请使用其他名称。`)).toHaveAttribute('id', 'role-name-error')
  })

  it('Desktop 岗位使用后端稳定 ID 并回写规范化结果', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const generateId = vi.spyOn(desktopBridge, 'generateEntityId').mockResolvedValue('role-persisted')
    const saveRole = vi.spyOn(desktopBridge, 'saveRoleV2').mockImplementation(async (role) => ({
      ...role,
      name: `${role.name}（规范化）`,
    }))
    renderOrganization(`/organization?team=${child.teamId}&department=${child.id}`)

    fireEvent.click(screen.getByRole('button', { name: '添加岗位' }))
    const dialog = screen.getByRole('dialog', { name: '添加岗位' })
    fireEvent.change(within(dialog).getByLabelText('岗位名称'), { target: { value: '质量负责人' } })
    fireEvent.change(within(dialog).getByLabelText('岗位使命'), { target: { value: '维护交付质量' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存岗位' }))

    await vi.waitFor(() => expect(saveRole).toHaveBeenCalledWith(expect.objectContaining({
      id: 'role-persisted',
      teamId: child.teamId,
      departmentId: child.id,
      name: '质量负责人',
    })))
    expect(generateId).toHaveBeenCalledWith('role', `${child.id}-质量负责人`)
    expect(await screen.findByText('质量负责人（规范化）')).toBeInTheDocument()
  })

  it('成员较多时显示摘要，并可在全部成员中搜索', () => {
    const baseAgent = initialState.agents[0]
    const agents = Array.from({ length: 7 }, (_, index) => ({
      ...baseAgent,
      id: `member-${index + 1}`,
      name: index === 6 ? '特别成员' : `成员 ${index + 1}`,
    }))
    const state = {
      ...initialState,
      agents,
      departments: initialState.departments.map((department) => department.id === child.id
        ? { ...department, memberAgentIds: agents.map((agent) => agent.id) }
        : department),
    }

    renderOrganization(`/organization?team=${child.teamId}&department=${child.id}`, state)

    expect(screen.getByLabelText('共 7 位成员')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看全部 7 位成员' })).toBeInTheDocument()
    expect(screen.queryByText('特别成员')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看全部 7 位成员' }))
    const dialog = screen.getByRole('dialog', { name: `${child.name}成员` })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '搜索成员' }), { target: { value: '特别' } })
    expect(within(dialog).getByText('特别成员')).toBeInTheDocument()
    expect(within(dialog).queryByText('成员 1')).not.toBeInTheDocument()
  })

  it('Team query 和详情深链会同步当前 Team', async () => {
    const target = initialState.teams.find((team) => team.id !== initialState.currentTeamId)!
    const state = { ...initialState, currentTeamId: initialState.currentTeamId }
    const queryView = renderOrganization(`/organization?team=${target.id}`, state)

    expect(screen.getByText(target.mission!)).toBeInTheDocument()
    queryView.unmount()

    renderOrganization(`/organization/teams/${target.id}`, state)
    expect(screen.getByRole('heading', { name: target.name })).toBeInTheDocument()
    expect(screen.getByText(target.boundary!)).toBeInTheDocument()
  })

  it('忽略无效部门并兼容旧部门链接', async () => {
    const team = initialState.teams.find((item) => item.id === child.teamId)!
    const invalid = renderOrganization(`/organization?team=${team.id}&department=missing`)
    expect(screen.getByText(team.mission!)).toBeInTheDocument()
    invalid.unmount()

    const legacy = renderOrganization(`/organization/departments/${child.id}`)
    await vi.waitFor(() => expect(legacy.router.state.location.pathname).toBe('/organization'))
    expect(legacy.router.state.location.search).toBe(`?team=${child.teamId}&department=${child.id}`)
    expect(screen.getByRole('heading', { name: child.name })).toBeInTheDocument()
  })
})
