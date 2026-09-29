import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib'

const styles = cva('inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 active:translate-y-px max-sm:min-h-11', { variants: { variant: { default: 'bg-foreground text-background hover:bg-foreground/90', outline: 'border border-border bg-background hover:bg-muted', ghost: 'hover:bg-muted hover:text-foreground', danger: 'bg-danger text-white hover:bg-danger/90' }, size: { default: 'h-10 max-sm:h-11', sm: 'h-9 px-2.5 text-xs max-sm:h-11', icon: 'size-10 p-0 max-sm:size-11' } }, defaultVariants: { variant: 'default', size: 'default' } })

type Props = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof styles> & { asChild?: boolean }
export const Button = forwardRef<HTMLButtonElement, Props>(function Button({ className, variant, size, asChild, ...props }, ref) { const Comp = asChild ? Slot : 'button'; return <Comp ref={ref} className={cn(styles({ variant, size }), className)} {...props} /> })
