import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { cn } from '../../lib'

type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  size?: DialogSize
  dismissible?: boolean
}

const sizes: Record<DialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
}

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: Props) {
  const triggerRef = useRef<HTMLElement | null>(null)
  if (open && !triggerRef.current && document.activeElement instanceof HTMLElement) triggerRef.current = document.activeElement

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => {
      if (next || dismissible) onOpenChange(next)
    }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px] data-[state=open]:animate-fade" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => { if (!dismissible) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (!dismissible) event.preventDefault() }}
          onInteractOutside={(event) => { if (!dismissible) event.preventDefault() }}
          onCloseAutoFocus={(event) => {
            if (!triggerRef.current?.isConnected) return
            event.preventDefault()
            triggerRef.current.focus()
            triggerRef.current = null
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none',
            sizes[size],
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5 max-sm:px-4 max-sm:py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1 break-words text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            {dismissible && <DialogPrimitive.Close
              className="grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
              aria-label="关闭"
            >
              <X size={18} aria-hidden="true" />
            </DialogPrimitive.Close>}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-6 max-sm:p-4">{children}</div>
          {footer && (
            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-muted/30 px-6 py-4 max-sm:px-4 [&>*]:max-sm:flex-1">
              {footer}
            </footer>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
