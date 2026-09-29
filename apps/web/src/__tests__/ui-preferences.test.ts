import { describe, expect, it } from 'vitest'
import {
  DEFAULT_UI_PREFERENCES,
  LEGACY_THEME_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY,
  accentPassesTheme,
  compositeColor,
  constrainAccent,
  contrastRatio,
  getAccessibleAccent,
  hexToRgb,
  hsvToRgb,
  loadUiPreferences,
  parseUiPreferences,
  resolveTheme,
  rgbToHex,
  rgbToHsv,
  saveUiPreferences,
} from '../ui-preferences'
describe('UiPreferences', () => {
  it('逐字段回退非法值并保留合法字段', () => {
    const result = parseUiPreferences({ version: 1, theme: 'dark', density: 'invalid', terminal: 'ghostty', accentColor: '#2563EB' })
    expect(result.theme).toBe('dark')
    expect(result.terminal).toBe('ghostty')
    expect(result.density).toBe(DEFAULT_UI_PREFERENCES.density)
    expect(result.accentColor).toBe('#2563eb')
    expect(result.accentOpacity).toBe(100)
  })

  it('兼容旧偏好并将透明度约束到可用范围', () => {
    const constrained = parseUiPreferences({ version: 1, accentOpacity: 48 })
    expect(constrained.accentOpacity).toBeGreaterThan(48)
    expect(accentPassesTheme(getAccessibleAccent(constrained.accentColor, constrained.accentOpacity)!, 'system')).toBe(true)
    expect(parseUiPreferences({ version: 1, accentOpacity: -1 }).accentOpacity).toBe(100)
    expect(parseUiPreferences({ version: 1, accentOpacity: 101 }).accentOpacity).toBe(100)
    expect(parseUiPreferences({ version: 1, accentOpacity: Number.NaN }).accentOpacity).toBe(100)
  })

  it('保留圆润字体并回退未知字体', () => {
    expect(parseUiPreferences({ version: 1, interfaceFont: 'rounded' }).interfaceFont).toBe('rounded')
    expect(parseUiPreferences({ version: 1, interfaceFont: 'unknown' }).interfaceFont).toBe(DEFAULT_UI_PREFERENCES.interfaceFont)
  })

  it('只接受严格布尔值的首次 Team 初始化跳过偏好', () => {
    expect(parseUiPreferences({ version: 1, firstUseTeamSetupDismissed: true }).firstUseTeamSetupDismissed).toBe(true)
    expect(parseUiPreferences({ version: 1, firstUseTeamSetupDismissed: 'true' }).firstUseTeamSetupDismissed).toBe(false)
  })

  it('保存并加载界面偏好', () => {
    const data = new Map<string, string>()
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    }
    saveUiPreferences(storage, { ...DEFAULT_UI_PREFERENCES, density: 'compact' })

    expect(loadUiPreferences(storage).density).toBe('compact')
  })

  it('解析系统主题但不改变偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('转换 HEX、RGB 与 HSV', () => {
    expect(hexToRgb('#2563eb')).toEqual({ r: 37, g: 99, b: 235 })
    expect(rgbToHex({ r: 37, g: 99, b: 235 })).toBe('#2563eb')
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 })
    expect(hsvToRgb({ h: 240, s: 100, v: 100 })).toEqual({ r: 0, g: 0, b: 255 })
    expect(rgbToHex(hsvToRgb(rgbToHsv({ r: 128, g: 128, b: 128 })))).toBe('#808080')
  })

  it('先合成透明色再计算亮暗主题对比度', () => {
    expect(rgbToHex(compositeColor({ r: 0, g: 0, b: 0 }, 50, { r: 255, g: 255, b: 255 }))).toBe('#808080')
    expect(rgbToHex(compositeColor({ r: 10, g: 20, b: 30 }, 0, { r: 255, g: 255, b: 255 }))).toBe('#ffffff')
    expect(rgbToHex(compositeColor({ r: 10, g: 20, b: 30 }, 100, { r: 255, g: 255, b: 255 }))).toBe('#0a141e')

    const result = getAccessibleAccent('#2563eb', 70)!
    expect(result.cssColor).toBe('rgb(37 99 235 / 0.7)')
    expect(result.light.textRatio).not.toBeCloseTo(result.dark.textRatio)
    expect(result.light.foreground).toMatch(/^#(?:ffffff|000000)$/)
    expect(result.dark.foreground).toMatch(/^#(?:ffffff|000000)$/)
  })

  it('将颜色和透明度约束为亮暗主题都可用', () => {
    const unchanged = constrainAccent('#767676', 100)
    expect(unchanged).toMatchObject({ color: '#767676', opacity: 100 })

    for (const color of ['#000000', '#ffffff', '#2563eb']) {
      const result = constrainAccent(color, 5)
      expect(accentPassesTheme(result.accent, 'system')).toBe(true)
      expect(result.opacity).toBeGreaterThanOrEqual(result.minimumOpacity)
      expect(constrainAccent(result.color, result.opacity)).toMatchObject({
        color: result.color,
        opacity: result.opacity,
      })
      if (result.minimumOpacity > 0) {
        expect(accentPassesTheme(getAccessibleAccent(result.color, result.minimumOpacity - 1)!, 'system')).toBe(false)
      }
    }
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })

  it('新 key 不存在时迁移旧主题', () => {
    const data = new Map<string, string>([[LEGACY_THEME_STORAGE_KEY, 'dark']])
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    }
    const result = loadUiPreferences(storage)
    expect(result.theme).toBe('dark')
    expect(data.has(UI_PREFERENCES_STORAGE_KEY)).toBe(true)
    expect(data.has(LEGACY_THEME_STORAGE_KEY)).toBe(false)
  })
})
