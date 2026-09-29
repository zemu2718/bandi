import fs from 'node:fs/promises'
import path from 'node:path'
import { expect } from '@wdio/globals'
import { externalSentinelDirectory } from '../helpers/first-use-fixtures.js'
import { appDataPath, sandboxHome } from '../helpers/paths.js'

type JsonRecord = Record<string, unknown>
type ToolHostStatus = { toolId: string; availability: string }
type ToolHostSnapshot = { statuses: ToolHostStatus[] }
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

async function reviewToolsAndGuide() {
  const { statuses } = await invoke<ToolHostSnapshot>('list_ai_tool_host_statuses', { request: { forceRefresh: false } })
  expect(statuses).toHaveLength(9)
  expect(new Set(statuses.map((item) => item.toolId)).size).toBe(9)

  await browser.execute(() => { window.location.hash = '#/tools' })
  await expect(browser.$('h1=AI 工具')).toBeDisplayed()
  const guideButton = await browser.$('button[aria-label="使用指南"]')
  await guideButton.click()
  await expect(browser.$('h2=把长期上下文带到 AI 工具')).toBeDisplayed()
  await expect(browser.$('[role="dialog"]*=任务执行、权限、日志和验收都在所选工具中完成')).toBeDisplayed()
  await browser.$('button=开始使用').click()
  await expect(browser.$('h2=从一个 Agent 开始')).toBeDisplayed()
  await expect(browser.$('button=新建 Agent')).toBeDisplayed()
  await expect(browser.$('button=导入已有 Agent')).toBeDisplayed()
  await browser.$('button=备份与恢复').click()
  await expect(browser.$('h2=安全保存和恢复配置')).toBeDisplayed()
  await browser.$('button=查看备份与恢复').click()
  await expect(browser.$('h1=设置')).toBeDisplayed()
}

async function verifyPersistenceAndReset() {
  const { statuses } = await invoke<ToolHostSnapshot>('list_ai_tool_host_statuses', { request: { forceRefresh: false } })
  expect(statuses).toHaveLength(9)

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
  await browser.execute(() => localStorage.removeItem('bandi-ui-preferences-v1'))
  await invoke<void>('restart_after_factory_reset')
  await expect(fs.readFile(preservedExternalFile, 'utf8')).resolves.toBe('external file preserved')
  await expect(fs.readFile(preservedClaudeFile, 'utf8')).resolves.toBe('claude preserved')
}

async function verifyFreshStateAfterReset() {
  await browser.execute(() => localStorage.removeItem('bandi-ui-preferences-v1'))
  await browser.refresh()
  await expect(browser.$('h1=创建你的第一个长期 Agent')).toBeDisplayed()
  const { statuses } = await invoke<ToolHostSnapshot>('list_ai_tool_host_statuses', { request: { forceRefresh: false } })
  expect(statuses).toHaveLength(9)
  await expect(fs.readFile(preservedExternalFile, 'utf8')).resolves.toBe('external file preserved')
  await expect(fs.readFile(preservedClaudeFile, 'utf8')).resolves.toBe('claude preserved')
}

describe('Desktop 设置与恢复真实闭环', () => {
  it('检查固定工具目录、无损回顾引导并安全重置 Bandi', async () => {
    if (process.env.BANDI_E2E_SETTINGS_PHASE === 'reset') return verifyPersistenceAndReset()
    if (process.env.BANDI_E2E_SETTINGS_PHASE === 'fresh') return verifyFreshStateAfterReset()
    return reviewToolsAndGuide()
  })
})
