import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import assetReferenceFixture from '../../../../packages/contracts/fixtures/asset-reference-graph.valid.json'
import invalidAiToolHostFixture from '../../../../packages/contracts/fixtures/ai-tool-host.invalid.json'
import aiToolHostFixture from '../../../../packages/contracts/fixtures/ai-tool-host.valid.json'
import backupFixture from '../../../../packages/contracts/fixtures/backup-local.valid.json'
import invalidClientLaunchV3 from '../../../../packages/contracts/fixtures/client-launch-v3.invalid.json'
import validClientLaunchV3 from '../../../../packages/contracts/fixtures/client-launch-v3.valid.json'
import invalidMemoryV4Fixture from '../../../../packages/contracts/fixtures/formal-memory-v4.invalid.json'
import memoryV4Fixture from '../../../../packages/contracts/fixtures/formal-memory-v4.valid.json'
import invalidTeamV4Fixture from '../../../../packages/contracts/fixtures/team-snapshot-v4.invalid.json'
import teamV4Fixture from '../../../../packages/contracts/fixtures/team-snapshot-v4.valid.json'
import assetReferenceSchema from '../../../../packages/contracts/schemas/asset-reference-graph.schema.json'
import aiToolHostSchema from '../../../../packages/contracts/schemas/ai-tool-host.schema.json'
import backupSchema from '../../../../packages/contracts/schemas/backup-local.schema.json'
import clientLaunchV3Schema from '../../../../packages/contracts/schemas/client-launch-v3.schema.json'
import memoryV4Schema from '../../../../packages/contracts/schemas/formal-memory-v4.schema.json'
import teamV4Schema from '../../../../packages/contracts/schemas/team-snapshot-v4.schema.json'

function validator(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  return ajv.compile(schema)
}

describe('共享 JSON Schema', () => {
  it.each([
    ['共享资产引用图', assetReferenceSchema, assetReferenceFixture],
    ['AI 工具主机请求', aiToolHostSchema, aiToolHostFixture],
    ['本地备份', backupSchema, backupFixture],
  ])('%s 的有效 fixture 通过 Draft 2020-12 校验', (_name, schema, fixture) => {
    const validate = validator(schema)
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true)
  })

  it.each([
    ['Team 快照 v4', teamV4Schema, teamV4Fixture],
    ['正式记忆 v4', memoryV4Schema, memoryV4Fixture],
    ['客户端启动 v3', clientLaunchV3Schema, validClientLaunchV3],
  ])('%s 的有效 fixture 通过校验', (_name, schema, fixture) => {
    const validate = validator(schema)
    expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true)
  })

  it.each([
    ['Team 快照 v4', teamV4Schema, invalidTeamV4Fixture],
    ['AI 工具主机请求', aiToolHostSchema, invalidAiToolHostFixture],
    ['正式记忆 v4', memoryV4Schema, invalidMemoryV4Fixture],
    ['客户端启动 v3', clientLaunchV3Schema, invalidClientLaunchV3],
  ])('%s 拒绝无效 fixture', (_name, schema, fixture) => {
    const validate = validator(schema)
    expect(validate(fixture)).toBe(false)
  })

  it('Team 快照 v4 拒绝旧组织字段与非法展示字段', () => {
    const validate = validator(teamV4Schema)
    for (const legacyField of ['departments', 'roles', 'serviceGrants']) {
      const legacySnapshot = structuredClone(teamV4Fixture) as Record<string, unknown>
      legacySnapshot[legacyField] = []
      expect(validate(legacySnapshot)).toBe(false)
      expect(validate.errors?.some((error) => error.keyword === 'additionalProperties')).toBe(true)
    }

    const oldVersion = structuredClone(teamV4Fixture)
    oldVersion.schemaVersion = 3
    expect(validate(oldVersion)).toBe(false)

    const legacyTeam = structuredClone(teamV4Fixture)
    Object.assign(legacyTeam.teams[0], { departmentIds: [] })
    expect(validate(legacyTeam)).toBe(false)

    const invalidMark = structuredClone(teamV4Fixture)
    invalidMark.teams[0].mark = '示例组'
    expect(validate(invalidMark)).toBe(false)

    const invalidColor = structuredClone(teamV4Fixture)
    invalidColor.teams[0].color = '#ffffff'
    expect(validate(invalidColor)).toBe(false)
  })

  it('正式记忆 v4 拒绝旧范围、候选与审核字段', () => {
    const validate = validator(memoryV4Schema)
    const oldVersion = structuredClone(memoryV4Fixture)
    Object.assign(oldVersion.space, { storageProfileVersion: 'memory-v3' })
    expect(validate(oldVersion)).toBe(false)

    const oldScope = structuredClone(memoryV4Fixture)
    Object.assign(oldScope.space, {
      scopeType: 'agent_workspace',
      scopeKey: { kind: 'agent_workspace', agentId: 'zhouce', workspaceId: 'workspace-bandi' },
    })
    expect(validate(oldScope)).toBe(false)

    for (const legacyField of ['candidate', 'reviewRequest']) {
      const legacyBundle = structuredClone(memoryV4Fixture) as Record<string, unknown>
      legacyBundle[legacyField] = {}
      expect(validate(legacyBundle)).toBe(false)
      expect(validate.errors?.some((error) => error.keyword === 'additionalProperties')).toBe(true)
    }

    const legacyReview = structuredClone(memoryV4Fixture)
    Object.assign(legacyReview.space, {
      stewardAgentId: 'zhouce',
      reviewPrincipal: { kind: 'agent', agentId: 'zhiheng' },
      reviewPolicy: 'independent_reviewer',
    })
    expect(validate(legacyReview)).toBe(false)
  })

  it('资产与备份合同拒绝 department、orchestration 和 review 字段', () => {
    const validateAsset = validator(assetReferenceSchema)
    const legacyAsset = structuredClone(assetReferenceFixture)
    Object.assign(legacyAsset.sharedAssets[0], { departmentId: 'department-product', review: {} })
    expect(validateAsset(legacyAsset)).toBe(false)

    const validateBackup = validator(backupSchema)
    const legacyBackup = structuredClone(backupFixture)
    legacyBackup.snapshot.entries[0].kind = 'orchestration'
    expect(validateBackup(legacyBackup)).toBe(false)

    const reviewedBackup = structuredClone(backupFixture)
    Object.assign(reviewedBackup.snapshot, { review: {} })
    expect(validateBackup(reviewedBackup)).toBe(false)
  })
})
