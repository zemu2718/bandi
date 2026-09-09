import { describe, expect, it } from 'vitest'
import { assetKindLabel, assetParseStatusLabel, assetScopeLabel, formatDisplayTimestamp, formatRelativeExpiry, memoryScopeLabel } from '../presentation'

describe('界面展示格式', () => {
  const utc = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' } satisfies Intl.DateTimeFormatOptions

  it('按用户语言展示 ISO 时间并兼容已有相对时间文案', () => {
    expect(formatDisplayTimestamp('2026-09-02T21:07:27+00:00', 'zh-CN', utc)).toBe('2026年9月2日 21:07')
    expect(formatDisplayTimestamp('2026-09-02T21:07:27Z', 'zh-CN', utc)).toBe('2026年9月2日 21:07')
    expect(formatDisplayTimestamp('刚刚', 'zh-CN', utc)).toBe('刚刚')
    expect(formatDisplayTimestamp('未知时间', 'zh-CN', utc)).toBe('未知时间')
  })

  it('展示删除预览的相对有效期', () => {
    const now = Date.parse('2026-09-03T10:00:00Z')
    expect(formatRelativeExpiry('2026-09-03T10:14:00Z', now)).toBe('约14分钟后过期')
    expect(formatRelativeExpiry('2026-09-03T10:00:30Z', now)).toBe('不到 1 分钟后过期')
    expect(formatRelativeExpiry('2026-09-03T10:00:00Z', now)).toBe('已过期')
    expect(formatRelativeExpiry('未知时间', now)).toBe('有效期未知')
  })

  it('按明确的类型和枚举映射界面文案', () => {
    expect(memoryScopeLabel('agent_long_term')).toBe('Agent 长期记忆')
    expect(assetKindLabel('unknown')).toBe('未知资产类型')
    expect(memoryScopeLabel('unknown')).toBe('未知记忆范围')
    expect(assetParseStatusLabel('parsed')).toBe('正常')
    expect(assetParseStatusLabel('unknown')).toBe('未知状态')
    expect(assetScopeLabel('公司共享')).toBe('Team 共享')
    expect(assetScopeLabel('Agent 自有')).toBe('Agent 自有')
  })
})
