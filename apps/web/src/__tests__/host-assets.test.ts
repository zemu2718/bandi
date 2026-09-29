import { describe, expect, it } from 'vitest'
import { filterHostAssets } from '../host-assets'
import type { HostAssetSummaryDto } from '../contracts'

const hash = `sha256:${'a'.repeat(64)}` as const
const asset = (changes: Partial<HostAssetSummaryDto> = {}): HostAssetSummaryDto => ({
  hostInstanceId: 'host-review', toolId: 'claude-code', rootId: 'skills', packageKey: 'review', name: '代码审查', kind: 'skill', relativeLocation: 'skills/review',
  package: { containerKind: 'directory', entrypoint: 'SKILL.md', packageFingerprint: hash, entrypointHash: hash, fileCount: 2, totalBytes: 256 }, parseStatus: 'parsed', diagnostics: [], ...changes,
})

describe('外部资产筛选', () => {
  it('按元数据、工具、类型和状态筛选', () => {
    const rows = [asset(), asset({ hostInstanceId: 'host-instructions', toolId: 'codex', kind: 'instructions', name: '团队说明', relativeLocation: 'AGENTS.md', packageKey: 'agents' })]
    expect(filterHostAssets(rows, { query: 'review', toolId: 'claude-code', kind: 'skill', status: 'parsed' }).map((item) => item.hostInstanceId)).toEqual(['host-review'])
    expect(filterHostAssets(rows, { kind: 'instructions' }).map((item) => item.hostInstanceId)).toEqual(['host-instructions'])
  })
})
