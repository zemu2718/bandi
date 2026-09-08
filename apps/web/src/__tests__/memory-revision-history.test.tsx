// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as desktopBridge from '../desktop-bridge'
import { MemoryRevisionHistory } from '../pages/agents/memory-revision-history'
import type { MemoryRevisionDto } from '../contracts'
import { formatDisplayTimestamp } from '../presentation'

const hash = `sha256:${'a'.repeat(64)}` as const
const revision: MemoryRevisionDto = {
  id: 'memory-revision-2',
  spaceId: 'memory-agent-zhouce',
  parentRevisionId: 'memory-revision-1',
  candidateId: 'memory-candidate-2',
  reviewDecisionId: 'memory-decision-2',
  proposerAgentId: 'zhouce',
  reviewPrincipal: { kind: 'agent', agentId: 'zhiheng' },
  sourceContentHash: hash,
  contentHash: hash,
  storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' },
  writeReceiptId: 'memory-write-2',
  writtenAt: '2026-09-01T00:02:00Z',
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('正式记忆版本历史', () => {
  it('加载期间显示真实进度状态', async () => {
    let resolve!: (value: MemoryRevisionDto[]) => void
    vi.spyOn(desktopBridge, 'listMemoryRevisions').mockReturnValue(new Promise((done) => { resolve = done }))
    render(<MemoryRevisionHistory spaceId="memory-agent-zhouce" />)

    fireEvent.click(screen.getByRole('button', { name: '正式版本历史' }))
    expect(screen.getByRole('status')).toHaveTextContent('正在加载正式版本历史')
    resolve([])
    await screen.findByText('当前记忆范围暂无正式版本。')
  })

  it('展示空历史且请求只包含空间稳定标识', async () => {
    const list = vi.spyOn(desktopBridge, 'listMemoryRevisions').mockResolvedValue([])
    render(<MemoryRevisionHistory spaceId="memory-agent-zhouce" />)
    fireEvent.click(screen.getByRole('button', { name: '正式版本历史' }))

    expect(await screen.findByText('当前记忆范围暂无正式版本。')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({ requestId: 'list-memory-revisions-memory-agent-zhouce', spaceId: 'memory-agent-zhouce' })
  })

  it('只读展示版本关联与当前正式版本', async () => {
    vi.spyOn(desktopBridge, 'listMemoryRevisions').mockResolvedValue([revision])
    render(<MemoryRevisionHistory spaceId="memory-agent-zhouce" currentRevisionId={revision.id} />)
    fireEvent.click(screen.getByRole('button', { name: '正式版本历史' }))

    expect(await screen.findByText(formatDisplayTimestamp(revision.writtenAt))).toBeInTheDocument()
    expect(screen.getByText('当前正式版本')).toBeInTheDocument()
    expect(screen.getByText(revision.id).closest('details')).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('版本详情'))
    expect(screen.getByText(revision.id)).toBeInTheDocument()
    expect(screen.getByText(revision.parentRevisionId!)).toBeInTheDocument()
    expect(screen.getByText(revision.candidateId)).toBeInTheDocument()
    expect(screen.queryByText(revision.writtenAt)).not.toBeInTheDocument()
    expect(screen.getByText(new RegExp(revision.reviewPrincipal.kind === 'agent' ? revision.reviewPrincipal.agentId : revision.reviewPrincipal.teamId))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /恢复/ })).not.toBeInTheDocument()
  })

  it('服务失败时保留对话框并显示错误', async () => {
    vi.spyOn(desktopBridge, 'listMemoryRevisions').mockRejectedValue(new Error('MemoryRevision 历史已损坏'))
    render(<MemoryRevisionHistory spaceId="memory-agent-zhouce" />)
    fireEvent.click(screen.getByRole('button', { name: '正式版本历史' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('MemoryRevision 历史已损坏')
    expect(screen.getByRole('dialog', { name: '正式记忆版本历史' })).toBeInTheDocument()
  })

  it('每次打开都会重新读取补记后的历史', async () => {
    const list = vi.spyOn(desktopBridge, 'listMemoryRevisions')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([revision])
    render(<MemoryRevisionHistory spaceId="memory-agent-zhouce" currentRevisionId={revision.id} />)

    fireEvent.click(screen.getByRole('button', { name: '正式版本历史' }))
    await screen.findByText('当前记忆范围暂无正式版本。')
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '正式版本历史' }))

    expect(await screen.findByText(revision.id)).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })
})
