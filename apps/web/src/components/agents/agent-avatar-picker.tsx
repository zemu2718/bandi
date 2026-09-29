import { useEffect, useId, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'

const maxAvatarBytes = 5 * 1024 * 1024

export function AgentAvatarPicker({ name, file, onChange, disabled, help }: { name: string; file?: File; onChange: (file?: File) => void; disabled?: boolean; help?: string }) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!file) { setPreview(undefined); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const choose = (next?: File) => {
    setError(undefined)
    if (!next) return
    if (next.type !== 'image/png') { setError('仅支持 PNG 图片。'); return }
    if (next.size > maxAvatarBytes) { setError('头像不能超过 5 MiB。'); return }
    onChange(next)
  }

  return <div className="sm:col-span-2">
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={disabled}
        aria-label={file ? '更换 Agent 头像' : '选择 Agent 头像'}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
        onClick={() => inputRef.current?.click()}
        className="group relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : name.trim().slice(0, 1) || 'A'}
        {!disabled && <span className="absolute inset-0 grid place-items-center bg-foreground/70 text-background opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ImagePlus size={18} aria-hidden="true" /></span>}
      </button>
      <input ref={inputRef} id={id} type="file" accept="image/png" className="sr-only" disabled={disabled} onChange={(event) => { choose(event.target.files?.[0]); event.currentTarget.value = '' }} />
      <div className="min-w-0 flex-1">
        <b className="text-sm">Agent 头像（可选）</b>
        <p id={`${id}-help`} className="mt-1 text-xs leading-5 text-muted-foreground">{help ?? (file ? '点击头像可更换图片。PNG，最大 5 MiB。' : '点击头像选择图片。PNG，最大 5 MiB。')}</p>
        {file && <Button className="mt-1 -ml-2" type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}><Trash2 size={14} aria-hidden="true" />移除</Button>}
      </div>
    </div>
    {error && <p id={`${id}-error`} role="alert" className="mt-2 text-xs text-danger">{error}</p>}
  </div>
}
