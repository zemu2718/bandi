import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@wdio/globals'
import { externalSentinelDirectory } from '../helpers/first-use-fixtures.js'
import { appDataPath, sandboxHome } from '../helpers/paths.js'

type JsonRecord = Record<string, unknown>
type ToolSnapshot = {
  revision: number
  selectedPlanId: string
  plans: Array<{ id: string; name: string; toolIds: string[] }>
}
type ResetPreview = {
  requestId: string
  previewRef: string
  confirmationText: string
  targets: Array<{ id: string; state: string }>
}
type ResetResult = { requiresRestart: boolean }

const invoke = <T>(command: string, args: JsonRecord = {}) => browser.tauri.execute(
  (tauri, commandName: string, payload: JsonRecord) => tauri.core.invoke(commandName, payload) as Promise<T>,
  command,
  args,
)

const preservedExternalFile = path.join(externalSentinelDirectory, 'factory-reset-preserved.txt')
const preservedClaudeFile = path.join(sandboxHome, '.claude', 'factory-reset-preserved.txt')

async function configureToolsAndReviewGuide() {
  let snapshot = await invoke<ToolSnapshot>('load_tool_configuration')
  snapshot = await invoke<ToolSnapshot>('create_tool_plan', {
    request: {
      plan: { id: 'coding', name: '编码方案', toolIds: ['claude-code'] },
      expectedRevision: snapshot.revision,
    },
  })
  snapshot = await invoke<ToolSnapshot>('create_tool_plan', {
    request: {
      plan: { id: 'review', name: '评审方案', toolIds: ['codex'] },
      expectedRevision: snapshot.revision,
    },
  })
  snapshot = await invoke<ToolSnapshot>('select_tool_plan', {
    request: { planId: 'review', expectedRevision: snapshot.revision },
  })
  expect(snapshot.selectedPlanId).toBe('review')

  await browser.execute(() => { window.location.hash = '#/guide' })
  await expect(browser.$('h1=从长期配置回到 Claude Code')).toBeDisplayed()
  await browser.waitUntil(
    async () => (await browser.$('body').getText()).includes('不会重置首次使用状态'),
    { timeoutMsg: '引导回顾未显示无损说明' },
  )

  const afterGuide = await invoke<ToolSnapshot>('load_tool_configuration')
  expect(afterGuide.selectedPlanId).toBe('review')
  expect(afterGuide.plans.map((plan) => plan.id)).toEqual(['default', 'coding', 'review'])
}

async function verifyPersistenceAndReset() {
  const snapshot = await invoke<ToolSnapshot>('load_tool_configuration')
  expect(snapshot.selectedPlanId).toBe('review')
  expect(snapshot.plans.map((plan) => plan.id)).toEqual(['default', 'coding', 'review'])

  await fs.writeFile(preservedExternalFile, 'external file preserved')
  await fs.mkdir(path.dirname(preservedClaudeFile), { recursive: true })
  await fs.writeFile(preservedClaudeFile, 'claude preserved')

  const preview = await invoke<ResetPreview>('preview_factory_reset', {
    request: { requestId: 'factory-reset-e2e' },
  })
  expect(preview.targets.find((target) => target.id === 'database')?.state).toBe('present')
  expect(JSON.stringify(preview)).not.toContain(appDataPath)
  expect(JSON.stringify(preview)).not.toContain(sandboxHome)

  const result = await invoke<ResetResult>('commit_factory_reset', {
    request: {
      requestId: preview.requestId,
      previewRef: preview.previewRef,
      confirmationText: preview.confirmationText,
    },
  })
  expect(result.requiresRestart).toBe(true)
  await expect(fs.readFile(preservedExternalFile, 'utf8')).resolves.toBe('external file preserved')
  await expect(fs.readFile(preservedClaudeFile, 'utf8')).resolves.toBe('claude preserved')
}

async function verifyFreshStateAfterReset() {
  await expect(browser.$('h1=先新建或导入一个长期 Agent')).toBeDisplayed()
  const snapshot = await invoke<ToolSnapshot>('load_tool_configuration')
  expect(snapshot.selectedPlanId).toBe('default')
  expect(snapshot.plans).toEqual([{ id: 'default', name: '默认方案', toolIds: [] }])
  await expect(fs.readFile(preservedExternalFile, 'utf8')).resolves.toBe('external file preserved')
  await expect(fs.readFile(preservedClaudeFile, 'utf8')).resolves.toBe('claude preserved')
}

describe('Desktop 设置与恢复真实闭环', () => {
  it('持久化工具方案、无损回顾引导并安全恢复出厂', async () => {
    if (process.env.BANDI_E2E_SETTINGS_PHASE === 'reset') return verifyPersistenceAndReset()
    if (process.env.BANDI_E2E_SETTINGS_PHASE === 'fresh') return verifyFreshStateAfterReset()
    return configureToolsAndReviewGuide()
  })
})
