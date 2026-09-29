import { forwardRef } from 'react'
import {
  agentFunctionLabels,
  normalizeAgentFunction,
  type AgentFunction,
} from '../../domain'

const allPresets = Object.keys(agentFunctionLabels) as AgentFunction[]

export const AgentFunctionInput = forwardRef<HTMLInputElement, {
  id: string
  value?: string
  onChange: (value: string) => void
  error?: string
  label?: string
  help?: string
  suggestions?: string[]
  presets?: AgentFunction[]
}>(({ id, value, onChange, error, suggestions = [], presets = allPresets, label = '职能（可选）', help = '选择一个主要职能，或输入更具体的自定义职能。' }, ref) => {
  const normalized = normalizeAgentFunction(value)
  const selectedPreset = normalized && normalized in agentFunctionLabels
    ? normalized as AgentFunction
    : undefined
  const customValue = selectedPreset ? '' : value ?? ''
  const customSuggestions = suggestions.filter((suggestion) => suggestion !== customValue)
  const helpId = `${id}-help`
  const errorId = `${id}-error`

  return <fieldset className="min-w-0 text-sm">
    <legend className="font-medium">{label}</legend>
    <div className="mt-2 flex flex-wrap gap-2">
      {presets.map((preset) => <button
        key={preset}
        type="button"
        aria-pressed={selectedPreset === preset}
        onClick={() => onChange(selectedPreset === preset ? '' : preset)}
        className={`min-h-9 rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedPreset === preset ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`}
      >{agentFunctionLabels[preset]}</button>)}
      {customSuggestions.map((suggestion) => <button
        key={suggestion}
        type="button"
        aria-pressed="false"
        onClick={() => onChange(suggestion)}
        className="min-h-9 rounded-full border border-border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >{suggestion}</button>)}
    </div>
    <label htmlFor={id} className="mt-3 block text-xs font-normal text-muted-foreground">自定义职能</label>
    <input
      ref={ref}
      id={id}
      maxLength={40}
      value={customValue}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={Boolean(error)}
      aria-describedby={[help && helpId, error && errorId].filter(Boolean).join(' ') || undefined}
      className="mt-1.5 h-10 w-full px-3 text-sm text-foreground"
      placeholder="例如：前端研发"
    />
    {help && <span id={helpId} className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{help}</span>}
    {error && <span id={errorId} className="mt-1 block text-xs font-normal text-danger">{error}</span>}
  </fieldset>
})

AgentFunctionInput.displayName = 'AgentFunctionInput'
