import { describe, expect, it } from 'vitest'
import { deriveTeamMark, normalizeTeamMark, resolveTeamIdentity } from '../team-identity'

describe('Team 文字标识', () => {
  it.each([
    ['个人 Team', '个人'],
    ['星河科技', '星河'],
    ['Bandi Studio', 'BS'],
    ['Team Alpha', 'AL'],
    ['1233', '12'],
    ['---', 'T'],
  ])('%s 自动生成 %s', (name, mark) => {
    expect(deriveTeamMark(name)).toBe(mark)
  })

  it('只接受一至两个字母或数字', () => {
    expect(normalizeTeamMark(' A1 ')).toBe('A1')
    expect(normalizeTeamMark('个人')).toBe('个人')
    expect(normalizeTeamMark('ABC')).toBeUndefined()
    expect(normalizeTeamMark('↑')).toBeUndefined()
    expect(normalizeTeamMark('😀')).toBeUndefined()
  })

  it('优先使用合法覆盖并为颜色选择可读前景', () => {
    expect(resolveTeamIdentity({ name: '星河科技', mark: 'XH', color: '#2563EB' })).toEqual({
      mark: 'XH',
      color: '#2563eb',
      foreground: '#ffffff',
    })
  })
})
