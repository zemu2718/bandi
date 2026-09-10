// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as desktopBridge from '../desktop-bridge'
import { MemoryRevisionHistory } from '../pages/agents/memory-revision-history'
import type { LoadedMemoryDto, MemoryRevisionDto } from '../contracts'

const hash = `sha256:${'a'.repeat(64)}` as const
const revision: MemoryRevisionDto = {
  id: 'memory-revision-2',
  spaceId: 'memory-agent-zhouce',
  parentRevisionId: 'memory-revision-1',
  sourceContentHash: hash,
  contentHash: hash,
  writeReceiptId: 'memory-write-2',
  writtenAt: '2026-09-01T00:02:00Z',
}
const memory: LoadedMemoryDto = {
  requestId: 'load-memory',
  space: {
    id: revision.spaceId,
    agentId: 'zhouce',
    state: 'active',
    storageProfileVersion: 'memory-v4',
    storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' },
    currentRevisionId: revision.id,
    contentHash: hash,
    updatedAt: revision.writtenAt,
  },
  content: '当前内容',
  baselineRef: { id: 'baseline', assetId: revision.spaceId, containerId: revision.spaceId, assetContentHash: hash, containerContentHash: hash, targetExists: true },
}

const renderHistory = (onRestored = vi.fn(), onRevisionPending = vi.fn()) => render(<MemoryRevisionHistory agentId="zhouce" memory={memory} onRestored={onRestored} onRevisionPending={onRevisionPending} />)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('长期记忆版本历史', () => {
  it('展示空历史且请求携带 Agent 与空间标识', async () => {
    const list = vi.spyOn(desktopBridge, 'listMemoryRevisions').mockResolvedValue([])
    renderHistory()
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))

    expect(await screen.findByText('长期记忆暂无历史版本。')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({ requestId: `list-memory-revisions-${revision.spaceId}`, spaceId: revision.spaceId, agentId: 'zhouce' })
  })

  it('读取历史正文并确认恢复为新版本', async () => {
    const restoredMemory = { ...memory, content: '历史内容' }
    vi.spyOn(desktopBridge, 'listMemoryRevisions').mockResolvedValue([revision])
    vi.spyOn(desktopBridge, 'readMemoryRevisionContent').mockResolvedValue('历史内容')
    const restore = vi.spyOn(desktopBridge, 'restoreMemoryRevision').mockResolvedValue({
      kind: 'saved', requestId: 'restore', memory: restoredMemory, revision,
      writeReceipt: { id: 'write', containerId: revision.spaceId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: revision.writtenAt, atomicReplace: true },
    })
    const onRestored = vi.fn()
    renderHistory(onRestored)
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))

    expect(await screen.findByText('历史内容')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '恢复为新版本' }))
    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'zhouce', spaceId: revision.spaceId, revisionId: revision.id, confirmed: true })))
    expect(onRestored).toHaveBeenCalledWith(restoredMemory)
  })

  it('恢复正文后版本待补记时交回编辑页处理', async () => {
    vi.spyOn(desktopBridge, 'listMemoryRevisions').mockResolvedValue([revision])
    vi.spyOn(desktopBridge, 'readMemoryRevisionContent').mockResolvedValue('历史内容')
    const pending = {
      kind: 'revision_pending' as const,
      requestId: 'restore',
      journalId: 'journal-restore',
      writeReceipt: { id: 'write', containerId: revision.spaceId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: revision.writtenAt, atomicReplace: true },
      diagnostics: [],
    }
    vi.spyOn(desktopBridge, 'restoreMemoryRevision').mockResolvedValue(pending)
    const onRevisionPending = vi.fn()
    renderHistory(vi.fn(), onRevisionPending)
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))

    expect(await screen.findByText('历史内容')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '恢复为新版本' }))
    await waitFor(() => expect(onRevisionPending).toHaveBeenCalledWith(pending))
    expect(screen.queryByRole('dialog', { name: '长期记忆版本历史' })).not.toBeInTheDocument()
  })

  it('服务失败时保留对话框并将原始信息放入技术详情', async () => {
    vi.spyOn(desktopBridge, 'listMemoryRevisions').mockRejectedValue(new Error('MemoryRevision 历史已损坏'))
    renderHistory()
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法加载版本历史')
    expect(screen.getByRole('dialog', { name: '长期记忆版本历史' })).toBeInTheDocument()
  })
})
