import {
  MAIN_MENU_LAYOUT_STORAGE_KEY,
  parseMainMenuLayoutPreference,
  type MainMenuLayoutPreference,
} from './navigation-layout'
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
export type UiAssetSlot = 'logo' | 'background'

export type LocalUiAssetRef = {
  kind: 'local_asset'
  assetId: UiAssetSlot
}

export type UiPreferences = {
  version: 1
  theme: ThemePreference
  mainMenuLayout: MainMenuLayoutPreference
  accentColor: string
  interfaceFont: InterfaceFont
  monoFont: MonoFont
  fontScale: FontScale
  density: UiDensity
  backgroundStyle: BackgroundStyle
  backgroundFit: BackgroundFit
  backgroundDim: number
  terminal: TerminalId
  shellLabel?: string
  logoAsset?: LocalUiAssetRef
  backgroundAsset?: LocalUiAssetRef
  firstUseTeamSetupDismissed: boolean
}

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  version: 1,
  theme: 'system',
  mainMenuLayout: 'follow-window',
  accentColor: '#20201f',
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

export function normalizeShellLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized && normalized.length <= 40 ? normalized : undefined
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
  return {
    version: 1,
    theme: oneOf(value.theme, ['system', 'light', 'dark'], DEFAULT_UI_PREFERENCES.theme),
    mainMenuLayout: parseMainMenuLayoutPreference(value.mainMenuLayout),
    accentColor: typeof value.accentColor === 'string'
      ? normalizeHexColor(value.accentColor) ?? DEFAULT_UI_PREFERENCES.accentColor
      : DEFAULT_UI_PREFERENCES.accentColor,
    interfaceFont: oneOf(value.interfaceFont, ['bandi', 'system', 'rounded'], DEFAULT_UI_PREFERENCES.interfaceFont),
    monoFont: oneOf(value.monoFont, ['system', 'classic'], DEFAULT_UI_PREFERENCES.monoFont),
    fontScale: oneOf(value.fontScale, ['small', 'default', 'large'], DEFAULT_UI_PREFERENCES.fontScale),
    density: oneOf(value.density, ['compact', 'default', 'comfortable'], DEFAULT_UI_PREFERENCES.density),
    backgroundStyle: oneOf(value.backgroundStyle, ['plain', 'soft'], DEFAULT_UI_PREFERENCES.backgroundStyle),
    backgroundFit: oneOf(value.backgroundFit, ['cover', 'contain'], DEFAULT_UI_PREFERENCES.backgroundFit),
    backgroundDim: dim,
    terminal: oneOf(value.terminal, ['system', 'terminal', 'iterm2', 'warp', 'ghostty', 'wezterm', 'kitty', 'alacritty'], DEFAULT_UI_PREFERENCES.terminal),
    shellLabel: normalizeShellLabel(value.shellLabel),
    logoAsset: parseAssetRef(value.logoAsset, 'logo'),
    backgroundAsset: parseAssetRef(value.backgroundAsset, 'background'),
    firstUseTeamSetupDismissed: typeof value.firstUseTeamSetupDismissed === 'boolean'
      ? value.firstUseTeamSetupDismissed
      : DEFAULT_UI_PREFERENCES.firstUseTeamSetupDismissed,
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): EffectiveTheme {
  return preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference
}

function luminance(hex: string): number {
  const color = normalizeHexColor(hex) ?? '#000000'
  const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

export function getAccessibleAccent(color: string): { color: string; foreground: '#ffffff' | '#000000'; ratio: number } | undefined {
  const normalized = normalizeHexColor(color)
  if (!normalized) return undefined
  const whiteRatio = contrastRatio(normalized, '#ffffff')
  const blackRatio = contrastRatio(normalized, '#000000')
  const foreground = whiteRatio >= blackRatio ? '#ffffff' : '#000000'
  return { color: normalized, foreground, ratio: Math.max(whiteRatio, blackRatio) }
}

export function loadUiPreferences(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): UiPreferences {
  const current = storage.getItem(UI_PREFERENCES_STORAGE_KEY)
  if (current !== null) {
    try { return parseUiPreferences(JSON.parse(current)) } catch { return { ...DEFAULT_UI_PREFERENCES } }
  }

  const migrated: UiPreferences = {
    ...DEFAULT_UI_PREFERENCES,
    theme: oneOf(storage.getItem(LEGACY_THEME_STORAGE_KEY), ['light', 'dark'], DEFAULT_UI_PREFERENCES.theme),
    mainMenuLayout: parseMainMenuLayoutPreference(storage.getItem(MAIN_MENU_LAYOUT_STORAGE_KEY)),
  }
  storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(migrated))
  storage.removeItem(LEGACY_THEME_STORAGE_KEY)
  storage.removeItem(MAIN_MENU_LAYOUT_STORAGE_KEY)
  return migrated
}

export function saveUiPreferences(storage: Pick<Storage, 'setItem'>, preferences: UiPreferences): void {
  storage.setItem(UI_PREFERENCES_STORAGE_KEY, JSON.stringify(parseUiPreferences(preferences)))
}
