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

describe('需求页', () => {
  const state: State = { ...initialState, taskBriefs: [task] }

  it('新建需求固定属于当前 Team 且不关联项目', () => {
    renderPage({ ...state, taskBriefs: [] })
    expect(screen.getAllByRole('button', { name: '新建需求' })).toHaveLength(1)
    expect(screen.getByText('还没有需求')).toBeInTheDocument()
    expect(screen.queryByText('新建一份简报，供所选 AI 工具在当前任务中使用。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建需求' }))
    const dialog = screen.getByRole('dialog', { name: '新建需求' })

    const more = within(dialog).getByText('补充更多信息').closest('details')
    expect(more).not.toHaveAttribute('open')
    fireEvent.click(within(dialog).getByRole('button', { name: '创建需求' }))
    expect(within(dialog).getByText('输入标题。')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /标题/ })).toHaveFocus()
    fireEvent.change(within(dialog).getByRole('textbox', { name: /标题/ }), { target: { value: '发布说明' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建需求' }))
    expect(within(dialog).getByText('填写想完成什么。')).toBeInTheDocument()
    expect(within(dialog).getByRole('textbox', { name: /^想完成什么/ })).toHaveFocus()
    expect(within(dialog).queryByRole('combobox', { name: /所属 Team|项目/ })).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByText('补充更多信息'))
    expect(more).toHaveAttribute('open')
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^想完成什么/ }), { target: { value: '汇总本次变更' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /相关背景/ }), { target: { value: '版本即将发布' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /任务要求/ }), { target: { value: '仅整理已验证内容' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: /希望得到什么/ }), { target: { value: '发布说明草稿' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '创建需求' }))
    expect(screen.getByLabelText('状态快照')).toHaveTextContent('"constraints":"仅整理已验证内容"')
  })

  it('可直接归档并恢复需求', () => {
    renderPage(state)
    expect(screen.getAllByRole('button', { name: '新建需求' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const dialog = screen.getByRole('dialog', { name: '编辑需求' })
    expect(within(dialog).getByText('补充更多信息').closest('details')).toHaveAttribute('open')
    expect(within(dialog).getByRole('textbox', { name: /任务要求/ })).toHaveValue('仅整理已验证内容')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))

    fireEvent.click(screen.getByRole('button', { name: '归档需求' }))
    expect(screen.getByRole('tab', { name: '已归档 1' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: '移出归档' }))
    expect(screen.getByRole('tab', { name: '已归档 0' })).toBeInTheDocument()
  })

  it('确认后只删除 TaskBrief', () => {
    renderPage(state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '编辑需求' })).getByRole('button', { name: '删除需求' }))
    const confirmation = screen.getByRole('dialog', { name: '删除需求' })
    expect(screen.getByLabelText('状态快照')).toHaveTextContent('task-a')
    fireEvent.click(within(confirmation).getByRole('button', { name: '删除需求' }))
    expect(screen.getByLabelText('状态快照')).not.toHaveTextContent('task-a')
  })

  it('不提供执行期状态或操作', () => {
    renderPage(state)
    for (const text of ['执行状态', '进度', 'Todo', '日志']) expect(screen.queryByText(text)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '完成任务' })).not.toBeInTheDocument()
  })
})
