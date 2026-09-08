// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskBriefsPage } from '../pages/tasks/task-briefs-page'
import { AppProvider, initialState, useApp, type State } from '../state'

beforeEach(() => vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id' }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const task = { id: 'task-a', teamId: initialState.currentTeamId, title: '整理发布说明', goal: '汇总本次变更', context: '版本即将发布', constraints: '仅整理已验证内容', expectedOutput: '发布说明草稿' }

function Probe() {
  const { state } = useApp()
  return <output aria-label="状态快照">{JSON.stringify(state.taskBriefs)}</output>
}

function renderPage(state: State) {
  return render(<AppProvider initialState={state}><TaskBriefsPage /><Probe /></AppProvider>)
}

describe('任务简报页', () => {
  const state: State = { ...initialState, taskBriefs: [task] }

  it('新建简报固定属于当前 Team 且不关联项目', () => {
    renderPage({ ...state, taskBriefs: [] })
    fireEvent.click(screen.getByRole('button', { name: '新建简报' }))
    const dialog = screen.getByRole('dialog', { name: '新建任务简报' })

    fireEvent.click(within(dialog).getByRole('button', { name: '保存简报' }))
    expect(within(dialog).getByText('请输入标题。')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /标题/ })).toHaveFocus()
    fireEvent.change(within(dialog).getByRole('textbox', { name: /标题/ }), { target: { value: '发布说明' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存简报' }))
    expect(within(dialog).getByText('请输入目标。')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /^目标/ })).toHaveFocus()
    expect(within(dialog).queryByRole('combobox', { name: /所属 Team|项目/ })).not.toBeInTheDocument()
  })

  it('可归档并恢复简报', () => {
    renderPage(state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    let dialog = screen.getByRole('dialog', { name: '编辑任务简报' })
    fireEvent.click(within(dialog).getByRole('button', { name: '归档任务简报' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存简报' }))
    expect(screen.getByRole('tab', { name: '已归档 1' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    dialog = screen.getByRole('dialog', { name: '编辑任务简报' })
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复任务简报' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '保存简报' }))
    expect(screen.getByRole('tab', { name: '已归档 0' })).toBeInTheDocument()
  })

  it('确认后只删除 TaskBrief', () => {
    renderPage(state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑任务简报' })).getByRole('button', { name: '删除任务简报' }))
    const confirmation = screen.getByRole('dialog', { name: '删除任务简报' })
    expect(screen.getByLabelText('状态快照')).toHaveTextContent('task-a')
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除任务简报' }))
    expect(screen.getByLabelText('状态快照')).not.toHaveTextContent('task-a')
  })

  it('不提供执行期状态或操作', () => {
    renderPage(state)
    for (const text of ['执行状态', '进度', 'Todo', '日志']) expect(screen.queryByText(text)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '完成任务' })).not.toBeInTheDocument()
  })
})
