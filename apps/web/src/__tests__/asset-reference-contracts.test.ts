import { describe, expect, it } from 'vitest'
import fixture from '../../../../packages/contracts/fixtures/asset-reference-graph.valid.json'
import type { AssetReferenceDto, SharedAssetNodeDto } from '../contracts'

describe('共享资产引用图合同', () => {
  it('保留 Bandi 本体定位和稳定引用状态', () => {
    const sharedAssets = fixture.sharedAssets as SharedAssetNodeDto[]
    const references = fixture.references as AssetReferenceDto[]

    expect(sharedAssets[0]).toMatchObject({ id: 'skill-review', kind: 'skill', teamId: 'xinghe' })
    expect(sharedAssets[0].locator.rootKind).toBe('bandi')
    expect(references[0]).toMatchObject({ targetAssetId: sharedAssets[0].id, state: 'resolved' })
    expect(references[0].targetLocator?.rootKind).toBe('bandi')
  })
})
