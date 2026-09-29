import type { TerminalId } from './terminal-model'

export const UI_PREFERENCES_STORAGE_KEY = 'bandi-ui-preferences-v1'
export const LEGACY_THEME_STORAGE_KEY = 'bandi-theme'

export type ThemePreference = 'system' | 'light' | 'dark'
export type EffectiveTheme = 'light' | 'dark'
export type InterfaceFont = 'bandi' | 'system' | 'rounded'
export type MonoFont = 'system' | 'classic'
export type FontScale = 'small' | 'default' | 'large'
export type UiDensity = 'compact' | 'default' | 'comfortable'
export type BackgroundStyle = 'plain' | 'soft'
export type BackgroundFit = 'cover' | 'contain'
export type UiAssetSlot = 'background'

export type LocalUiAssetRef = {
  kind: 'local_asset'
  assetId: UiAssetSlot
}

export type UiPreferences = {
  version: 1
  theme: ThemePreference
  accentColor: string
  accentOpacity: number
  interfaceFont: InterfaceFont
  monoFont: MonoFont
  fontScale: FontScale
  density: UiDensity
  backgroundStyle: BackgroundStyle
  backgroundFit: BackgroundFit
  backgroundDim: number
  terminal: TerminalId
  backgroundAsset?: LocalUiAssetRef
  firstUseTeamSetupDismissed: boolean
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  theme: 'system',
  accentColor: '#767676',
  accentOpacity: 100,
  interfaceFont: 'bandi',
  monoFont: 'system',
  fontScale: 'default',
  density: 'default',
  backgroundStyle: 'plain',
  backgroundFit: 'cover',
  backgroundDim: 36,
  terminal: 'terminal',
  firstUseTeamSetupDismissed: false,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === 'string' && values.includes(value as T) ? value as T : fallback

export function normalizeHexColor(value: string): string | undefined {
  const trimmed = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : undefined
}

function parseAssetRef(value: unknown, slot: UiAssetSlot): LocalUiAssetRef | undefined {
  return isRecord(value) && value.kind === 'local_asset' && value.assetId === slot
    ? { kind: 'local_asset', assetId: slot }
    : undefined
}

export function parseUiPreferences(value: unknown): UiPreferences {
  if (!isRecord(value) || value.version !== 1) return { ...DEFAULT_UI_PREFERENCES }
  const dim = typeof value.backgroundDim === 'number' && Number.isInteger(value.backgroundDim)
    ? Math.min(80, Math.max(0, value.backgroundDim))
    : DEFAULT_UI_PREFERENCES.backgroundDim
  const requestedColor = typeof value.accentColor === 'string'
    ? normalizeHexColor(value.accentColor) ?? DEFAULT_UI_PREFERENCES.accentColor
    : DEFAULT_UI_PREFERENCES.accentColor
  const requestedOpacity = typeof value.accentOpacity === 'number' && Number.isInteger(value.accentOpacity)
    && value.accentOpacity >= 0 && value.accentOpacity <= 100
    ? value.accentOpacity
    : DEFAULT_UI_PREFERENCES.accentOpacity
  const accent = constrainAccent(requestedColor, requestedOpacity)
  return {
    version: 1,
    theme: oneOf(value.theme, ['system', 'light', 'dark'], DEFAULT_UI_PREFERENCES.theme),
    accentColor: accent.color,
    accentOpacity: accent.opacity,
    interfaceFont: oneOf(value.interfaceFont, ['bandi', 'system', 'rounded'], DEFAULT_UI_PREFERENCES.interfaceFont),
    monoFont: oneOf(value.monoFont, ['system', 'classic'], DEFAULT_UI_PREFERENCES.monoFont),
    fontScale: oneOf(value.fontScale, ['small', 'default', 'large'], DEFAULT_UI_PREFERENCES.fontScale),
    density: oneOf(value.density, ['compact', 'default', 'comfortable'], DEFAULT_UI_PREFERENCES.density),
    backgroundStyle: oneOf(value.backgroundStyle, ['plain', 'soft'], DEFAULT_UI_PREFERENCES.backgroundStyle),
    backgroundFit: oneOf(value.backgroundFit, ['cover', 'contain'], DEFAULT_UI_PREFERENCES.backgroundFit),
    backgroundDim: dim,
    terminal: oneOf(value.terminal, ['system', 'terminal', 'iterm2', 'warp', 'ghostty', 'wezterm', 'kitty', 'alacritty'], DEFAULT_UI_PREFERENCES.terminal),
    backgroundAsset: parseAssetRef(value.backgroundAsset, 'background'),
    firstUseTeamSetupDismissed: typeof value.firstUseTeamSetupDismissed === 'boolean'
      ? value.firstUseTeamSetupDismissed
      : DEFAULT_UI_PREFERENCES.firstUseTeamSetupDismissed,
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): EffectiveTheme {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference
}

export type RgbColor = { r: number; g: number; b: number }
export type HsvColor = { h: number; s: number; v: number }
export type AccentThemeResult = {
  foreground: '#ffffff' | '#000000'
  textRatio: number
  nonTextRatio: number
  passes: boolean
}

export type AccessibleAccent = {
  color: string
  cssColor: string
  foreground: '#ffffff' | '#000000'
  ratio: number
  light: AccentThemeResult
  dark: AccentThemeResult
}

// 与 styles.css 中的页面和卡片表面保持同步。
const THEME_SURFACES = {
  light: ['#f6f6f5', '#fdfdfc'],
  dark: ['#121211', '#191918'],
} as const

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function hexToRgb(value: string): RgbColor | undefined {
  const color = normalizeHexColor(value)
  if (!color) return undefined
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  }
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function rgbToHsv({ r, g, b }: RgbColor): HsvColor {
  const [red, green, blue] = [r, g, b].map((value) => clamp(value, 0, 255) / 255)
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let h = 0
  if (delta) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6)
    else if (max === green) h = 60 * ((blue - red) / delta + 2)
    else h = 60 * ((red - green) / delta + 4)
  }
  return { h: h < 0 ? h + 360 : h, s: max ? (delta / max) * 100 : 0, v: max * 100 }
}

export function hsvToRgb({ h, s, v }: HsvColor): RgbColor {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 100) / 100
  const value = clamp(v, 0, 100) / 100
  const chroma = value * saturation
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
  const match = value - chroma
  const [r, g, b] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x]
  return { r: (r + match) * 255, g: (g + match) * 255, b: (b + match) * 255 }
}

export function compositeColor(foreground: RgbColor, opacity: number, background: RgbColor): RgbColor {
  const alpha = clamp(opacity, 0, 100) / 100
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  }
}

function luminance(hex: string): number {
  const color = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 }
  const channels = [color.r, color.g, color.b].map((value) => value / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

function evaluateAccentTheme(color: RgbColor, opacity: number, surfaces: readonly string[]): AccentThemeResult {
  const displayed = surfaces.map((surface) => {
    const background = hexToRgb(surface)!
    return { color: rgbToHex(compositeColor(color, opacity, background)), surface }
  })
  const whiteRatio = Math.min(...displayed.map(({ color: value }) => contrastRatio(value, '#ffffff')))
  const blackRatio = Math.min(...displayed.map(({ color: value }) => contrastRatio(value, '#000000')))
  const foreground = whiteRatio >= blackRatio ? '#ffffff' : '#000000'
  const textRatio = Math.max(whiteRatio, blackRatio)
  const nonTextRatio = Math.min(...displayed.map(({ color: value, surface }) => contrastRatio(value, surface)))
  return { foreground, textRatio, nonTextRatio, passes: textRatio >= 4.5 && nonTextRatio >= 3 }
}

export function getAccessibleAccent(color: string, opacity = 100): AccessibleAccent | undefined {
  const normalized = normalizeHexColor(color)
  const rgb = normalized && hexToRgb(normalized)
  if (!normalized || !rgb || !Number.isFinite(opacity) || opacity < 0 || opacity > 100) return undefined
  const light = evaluateAccentTheme(rgb, opacity, THEME_SURFACES.light)
  const dark = evaluateAccentTheme(rgb, opacity, THEME_SURFACES.dark)
  return {
    color: normalized,
    cssColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${opacity / 100})`,
    foreground: light.foreground,
    ratio: light.textRatio,
    light,
    dark,
  }
}

export function accentPassesTheme(accent: AccessibleAccent, theme: ThemePreference): boolean {
  return theme === 'system' ? accent.light.passes && accent.dark.passes : accent[theme].passes
}

export type ConstrainedAccent = {
  color: string
  opacity: number
  minimumOpacity: number
  accent: AccessibleAccent
}

const ACCENT_FALLBACK = '#767676'
const MINIMUM_ACCENT_OPACITY = 82

const accessibleInBothThemes = (color: string, opacity: number) => {
  const accent = getAccessibleAccent(color, opacity)
  return Boolean(accent && accentPassesTheme(accent, 'system'))
}

function constrainAccentColor(color: string, opacity: number): string {
  if (accessibleInBothThemes(color, opacity)) return color
  const rgb = hexToRgb(color)!
  const hsv = rgbToHsv(rgb)
  const values = Array.from({ length: 101 }, (_, value) => value)
    .sort((left, right) => Math.abs(left - hsv.v) - Math.abs(right - hsv.v) || left - right)
  for (const value of values) {
    const candidate = rgbToHex(hsvToRgb({ ...hsv, v: value }))
    if (accessibleInBothThemes(candidate, opacity)) return candidate
  }

  const fallback = hexToRgb(ACCENT_FALLBACK)!
  for (let step = 1; step <= 100; step += 1) {
    const amount = step / 100
    const candidate = rgbToHex({
      r: rgb.r + (fallback.r - rgb.r) * amount,
      g: rgb.g + (fallback.g - rgb.g) * amount,
      b: rgb.b + (fallback.b - rgb.b) * amount,
    })
    if (accessibleInBothThemes(candidate, opacity)) return candidate
  }
  return ACCENT_FALLBACK
}

export function constrainAccent(color: string, opacity: number): ConstrainedAccent {
  const normalized = normalizeHexColor(color) ?? DEFAULT_UI_PREFERENCES.accentColor
  const requestedOpacity = Number.isFinite(opacity) ? Math.round(clamp(opacity, 0, 100)) : 100
  const constrainedOpacity = Math.max(requestedOpacity, MINIMUM_ACCENT_OPACITY)
  const constrainedColor = constrainAccentColor(normalized, constrainedOpacity)
  return {
    color: constrainedColor,
    opacity: constrainedOpacity,
    minimumOpacity: MINIMUM_ACCENT_OPACITY,
    accent: getAccessibleAccent(constrainedColor, constrainedOpacity)!,
  }
}

export function loadUiPreferences(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): UiPreferences {
  const current = storage.getItem(UI_PREFERENCES_STORAGE_KEY)
  if (current !== null) {
    try { return parseUiPreferences(JSON.parse(current)) } catch { return { ...DEFAULT_UI_PREFERENCES } }
  }

  const migrated: UiPreferences = {
    ...DEFAULT_UI_PREFERENCES,
    theme: oneOf(storage.getItem(LEGACY_THEME_STORAGE_KEY), ['light', 'dark'], DEFAULT_UI_PREFERENCES.theme),
  }
  storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(migrated))
  storage.removeItem(LEGACY_THEME_STORAGE_KEY)
  return migrated
}

export function saveUiPreferences(storage: Pick<Storage, 'setItem'>, preferences: UiPreferences): void {
  storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(parseUiPreferences(preferences)))
}
