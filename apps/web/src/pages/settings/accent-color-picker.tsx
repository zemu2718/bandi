import { useEffect, useState } from 'react'
import { constrainAccent, normalizeHexColor } from '../../ui-preferences'

type Props = {
  color: string
  opacity: number
  onChange: (color: string, opacity: number) => void
}

export function AccentColorPicker({ color, opacity, onChange }: Props) {
  const constrained = constrainAccent(color, opacity)
  const [hexInput, setHexInput] = useState(color)
  useEffect(() => setHexInput(color), [color])
  const apply = (nextColor: string, nextOpacity = opacity) => {
    const next = constrainAccent(nextColor, nextOpacity)
    onChange(next.color, next.opacity)
  }

  return <div className="mt-3 w-full max-w-72 rounded-lg border border-border bg-muted/20 p-2">
    <div className="flex items-center gap-2">
      <span className="size-10 overflow-hidden rounded border border-border" style={{ backgroundColor: color }}>
        <input type="color" value={color} aria-label="颜色" className="size-full cursor-pointer opacity-0" onChange={(event) => apply(event.currentTarget.value)} />
      </span>
      <input value={hexInput} onChange={(event) => { const next = event.currentTarget.value; setHexInput(next); if (normalizeHexColor(next)) apply(next) }} onBlur={() => setHexInput(color)} aria-label="HEX" className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono" />
    </div>
    <label className="mt-2 block text-xs font-medium">透明度：{opacity}%
      <input type="range" min={constrained.minimumOpacity} max="100" value={opacity} aria-label="透明度" aria-valuetext={`${opacity}%`} className="color-range mt-1 h-8 w-full" onChange={(event) => apply(color, Number(event.target.value))} />
    </label>
  </div>
}
