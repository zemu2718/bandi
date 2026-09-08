import type { TeamDto } from './contracts'
import { getAccessibleAccent, normalizeHexColor } from './ui-preferences'

export const TEAM_COLOR_PRESETS = [
  ['默认黑', '#20201f'],
  ['蓝色', '#2563eb'],
  ['紫色', '#7c3aed'],
  ['青绿', '#0f766e'],
  ['橙色', '#c2410c'],
] as const

const DEFAULT_TEAM_COLOR = TEAM_COLOR_PRESETS[0][1]
const TEAM_MARK_PATTERN = /^[\p{L}\p{N}]{1,2}$/u
const ignoredWords = new Set(['team', '团队'])

export function normalizeTeamMark(value: string): string | undefined {
  const normalized = value.trim()
  return TEAM_MARK_PATTERN.test(normalized) ? normalized : undefined
}

export function deriveTeamMark(name: string): string {
  const parts = name.trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part && !ignoredWords.has(part.toLowerCase()))
  const mark = parts.length > 1
    ? parts.slice(0, 2).map((part) => Array.from(part)[0]).join('')
    : Array.from(parts[0] ?? '').slice(0, 2).join('')
  return mark.toUpperCase() || 'T'
}

export function resolveTeamIdentity(team: Pick<TeamDto, 'name' | 'mark' | 'color'>) {
  const color = TEAM_COLOR_PRESETS.some(([, preset]) => preset === normalizeHexColor(team.color ?? ''))
    ? normalizeHexColor(team.color ?? '')!
    : DEFAULT_TEAM_COLOR
  const accent = getAccessibleAccent(color)!
  return {
    mark: normalizeTeamMark(team.mark ?? '') ?? deriveTeamMark(team.name),
    color: accent.color,
    foreground: accent.foreground,
  }
}
