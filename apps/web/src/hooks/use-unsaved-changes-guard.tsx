import { useCallback, useRef } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'
import { AppDialog } from '../components/ui/dialog'
import { Button } from '../components/ui/button'

type GuardOptions = {
  dirty: boolean
  resetDraft: () => void
  shouldBlock?: () => boolean
}

export function UnsavedChangesGuard({ dirty, resetDraft, shouldBlock }: GuardOptions) {
  return useUnsavedChangesGuard({ dirty, resetDraft, shouldBlock })
}

export function useUnsavedChangesGuard({ dirty, resetDraft, shouldBlock }: GuardOptions) {
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const blocker = useBlocker(shouldBlock ?? (() => dirtyRef.current))

  useBeforeUnload(useCallback((event) => {
    if (!dirty) return
    event.preventDefault()
  }, [dirty]))

  const dialog = <AppDialog
    open={blocker.state === 'blocked'}
    onOpenChange={(open) => { if (!open && blocker.state === 'blocked') blocker.reset() }}
    title="放弃未保存的更改？"
    description="离开后，这些更改将无法恢复。"
    size="sm"
    footer={<>
      <Button autoFocus variant="outline" onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>继续编辑</Button>
      <Button variant="danger" onClick={() => { dirtyRef.current = false; resetDraft(); if (blocker.state === 'blocked') blocker.proceed() }}>放弃更改</Button>
    </>}
  />

  return dialog
}
