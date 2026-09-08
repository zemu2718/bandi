import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UI_PREFERENCES,
  LEGACY_THEME_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY,
  contrastRatio,
  getAccessibleAccent,
  loadUiPreferences,
  parseUiPreferences,
  resolveTheme,
  saveUiPreferences,
} from '../ui-preferences'
import { MAIN_MENU_LAYOUT_STORAGE_KEY } from '../navigation-layout'

describe('UiPreferences', () => {
  it('逐字段回退非法值并保留合法字段', () => {
    const result = parseUiPreferences({ version: 1, theme: 'dark', density: 'invalid', terminal: 'ghostty', accentColor: '#2563EB', shellLabel: '  我的工作台  ' })
    expect(result.theme).toBe('dark')
    expect(result.terminal).toBe('ghostty')
    expect(result.density).toBe(DEFAULT_UI_PREFERENCES.density)
    expect(result.accentColor).toBe('#2563eb')
    expect(result.shellLabel).toBe('我的工作台')
  })

  it('保留圆润字体并回退未知字体', () => {
    expect(parseUiPreferences({ version: 1, interfaceFont: 'rounded' }).interfaceFont).toBe('rounded')
    expect(parseUiPreferences({ version: 1, interfaceFont: 'unknown' }).interfaceFont).toBe(DEFAULT_UI_PREFERENCES.interfaceFont)
  })

  it('保存并加载隐藏的 Agent 上下文栏偏好', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    }
    saveUiPreferences(storage, { ...DEFAULT_UI_PREFERENCES, mainMenuLayout: 'hidden' })

    expect(loadUiPreferences(storage).mainMenuLayout).toBe('hidden')
    expect(JSON.parse(data.get(UI_PREFERENCES_STORAGE_KEY)!)).not.toHaveProperty('recentAgentIds')
  })

  it('解析系统主题但不改变偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('为强调色自动选择合格前景', () => {
    const result = getAccessibleAccent('#2563eb')
    expect(result?.ratio).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(result!.color, result!.foreground)).toBeCloseTo(result!.ratio)
  })

  it('新 key 不存在时迁移旧主题和菜单偏好', () => {
    const data = new Map<string, string>([[LEGACY_THEME_STORAGE_KEY, 'dark'], [MAIN_MENU_LAYOUT_STORAGE_KEY, 'compact']])
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    }
    const result = loadUiPreferences(storage)
    expect(result.theme).toBe('dark')
    expect(result.mainMenuLayout).toBe('compact')
    expect(data.has(UI_PREFERENCES_STORAGE_KEY)).toBe(true)
    expect(data.has(LEGACY_THEME_STORAGE_KEY)).toBe(false)
  })
})
