import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@wdio/globals'
import { appDataPath, sandboxHome } from '../helpers/paths.js'

type JsonRecord = Record<string, unknown>
type HostAsset = {
  hostInstanceId: string
  kind: string
  package: { packageFingerprint: string; fileCount: number }
}
type ScanResult = { scanGeneration: string; assets: HostAsset[] }
type Preview = { previewRef: string; sourceFingerprint: string }
type Mutation = { kind: string; asset?: { id: string; source: { kind: string; importedHash?: string } } }
type Discovery = { sharedAssets: Array<{ id: string; source: { kind: string; importedHash?: string } }> }
type Editor = { canonicalContent: string; packageFiles: Array<{ path: string; bytes: number[] }> }

const invoke = <T>(session: WebdriverIO.Browser, command: string, args: JsonRecord = {}) => session.tauri.execute(
  (tauri, commandName: string, payload: JsonRecord) => tauri.core.invoke(commandName, payload) as Promise<T>,
  command,
  args,
)

const skillPath = path.join(sandboxHome, '.claude', 'skills', 'review')

async function prepareSource() {
  if (!skillPath.startsWith(`${sandboxHome}${path.sep}`)) throw new Error('E2E 资产来源未隔离到 sandbox HOME')
  await fs.mkdir(path.join(skillPath, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(skillPath, 'assets'), { recursive: true })
  await fs.writeFile(path.join(skillPath, 'SKILL.md'), '# Review\n')
  await fs.writeFile(path.join(skillPath, 'scripts', 'run.sh'), 'exit 0\n')
  await fs.writeFile(path.join(skillPath, 'assets', 'data.bin'), Buffer.from([0, 159, 146, 150]))
}

async function scanSkill(session: WebdriverIO.Browser, requestId: string) {
  const result = await invoke<ScanResult>(session, 'scan_host_assets', {
    request: { requestId, toolIds: ['claude-code'] },
  })
  const skill = result.assets.find((asset) => asset.kind === 'skill')
  expect(skill).toBeDefined()
  expect(skill?.package.fileCount).toBe(3)
  return { result, skill: skill! }
}

describe('Host asset lifecycle', () => {
  it('在隔离 HOME 中扫描、查看并导入完整 Skill 包', async () => {
    await prepareSource()
    const catalog = await invoke<{ tools: Array<{ toolId: string; capabilities: { canInstallFromBandi: boolean; canUpdateFromBandi: boolean } }> }>(browser, 'get_host_asset_catalog')
    expect(catalog.tools).toHaveLength(9)
    expect(catalog.tools.every((tool) => !tool.capabilities.canInstallFromBandi && !tool.capabilities.canUpdateFromBandi)).toBe(true)

    const { result, skill } = await scanSkill(browser, 'e2e-scan-host')
    const detail = await invoke<{ entrypointContent: string; files: unknown[] }>(browser, 'load_host_asset_detail', {
      request: { requestId: 'e2e-detail-host', hostInstanceId: skill.hostInstanceId, scanGeneration: result.scanGeneration },
    })
    expect(detail.entrypointContent).toBe('# Review\n')
    expect(detail.files).toHaveLength(3)

    const preview = await invoke<Preview>(browser, 'preview_host_asset_action', {
      request: { requestId: 'e2e-preview-host', hostInstanceId: skill.hostInstanceId, scanGeneration: result.scanGeneration, action: 'import', teamId: 'team-personal', assetId: 'skill-host-review' },
    })
    const committed = await invoke<Mutation>(browser, 'commit_host_asset_action', {
      request: { requestId: 'e2e-commit-host', action: 'import', previewRef: preview.previewRef, sourceFingerprint: preview.sourceFingerprint, confirmed: true },
    })
    expect(committed.kind).toBe('saved')
    expect(committed.asset?.source).toMatchObject({ kind: 'imported', importedHash: preview.sourceFingerprint })

    const canonical = path.join(appDataPath, 'shared-assets', 'skill-host-review')
    expect(await fs.readFile(path.join(canonical, 'assets', 'data.bin'))).toEqual(Buffer.from([0, 159, 146, 150]))
    expect(await fs.readFile(path.join(canonical, 'scripts', 'run.sh'), 'utf8')).toBe('exit 0\n')
    const discovery = await invoke<Discovery>(browser, 'discover_config', { request: { requestId: 'e2e-discover-host' } })
    expect(discovery.sharedAssets).toContainEqual(expect.objectContaining({ id: 'skill-host-review', source: expect.objectContaining({ kind: 'imported', importedHash: preview.sourceFingerprint }) }))
    const editor = await invoke<Editor>(browser, 'load_shared_asset_editor', { request: { requestId: 'e2e-editor-host', assetId: 'skill-host-review' } })
    expect(editor.canonicalContent).toBe('# Review\n')
    expect(editor.packageFiles.map((file) => file.path)).toEqual(['SKILL.md', 'assets/data.bin', 'scripts/run.sh'])
  })

  it('预览后来源变化时拒绝写入 Bandi', async () => {
    await prepareSource()
    const { result, skill } = await scanSkill(browser, 'e2e-scan-changed')
    const preview = await invoke<Preview>(browser, 'preview_host_asset_action', {
      request: { requestId: 'e2e-preview-changed', hostInstanceId: skill.hostInstanceId, scanGeneration: result.scanGeneration, action: 'import', teamId: 'team-personal', assetId: 'skill-host-changed' },
    })
    await fs.writeFile(path.join(skillPath, 'SKILL.md'), '# Changed\n')
    await expect(invoke(browser, 'commit_host_asset_action', {
      request: { requestId: 'e2e-commit-changed', action: 'import', previewRef: preview.previewRef, sourceFingerprint: preview.sourceFingerprint, confirmed: true },
    })).rejects.toThrow(/HOST_ASSET_SOURCE_CHANGED/)
    await expect(fs.stat(path.join(appDataPath, 'shared-assets', 'skill-host-changed'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
