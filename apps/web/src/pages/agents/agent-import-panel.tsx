import { FolderOpen } from 'lucide-react'
import { clientAdapterCatalog, type BuiltInClientId } from '../../client-adapters'
import type { ClaudeAgentPreviewDto } from '../../contracts'

const toolNames: Record<BuiltInClientId, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  codex: 'ChatGPT',
  'gemini-cli': 'Gemini CLI',
  'grok-build': 'Grok Build',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
  pi: 'Pi',
}

export function AgentImportPanel({
  desktop,
  preview,
  selecting,
  saving,
  onSelect,
}: {
  desktop: boolean
  preview?: ClaudeAgentPreviewDto
  selecting: boolean
  saving: boolean
  onSelect: () => void
}) {
  const importCapability = clientAdapterCatalog['claude-code'].agentImport
  return <div className="space-y-3">
    <label className="block text-sm font-medium">来源工具
      <select className="mt-2 h-10 w-full px-3" value="claude-code" disabled>
        {(Object.keys(clientAdapterCatalog) as BuiltInClientId[]).map((toolId) => {
          const capability = clientAdapterCatalog[toolId].agentImport
          return <option key={toolId} value={toolId} disabled={capability.status !== 'supported'}>{toolNames[toolId]}{capability.status === 'supported' ? '' : '（暂不支持导入）'}</option>
        })}
      </select>
    </label>
    <p className="text-xs leading-5 text-muted-foreground">当前仅支持导入 Claude Code 的 {importCapability.status === 'supported' ? importCapability.format : ''} 文件。其他工具的 Agent 文件暂不支持。</p>
    <button type="button" disabled={!desktop || selecting || saving} aria-busy={selecting} onClick={onSelect} className="flex min-h-36 w-full flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 py-6 text-center transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
      <FolderOpen size={28} aria-hidden="true" />
      <b className="mt-3 text-sm">{selecting ? '正在读取…' : preview ? '重新选择 Agent 文件' : '选择 Agent 文件'}</b>
      <span className="mt-1 text-xs text-muted-foreground">只读取通过系统选择器明确选择的单个文件</span>
    </button>
    {!desktop && <p className="text-xs text-muted-foreground">本机文件选择仅在 Bandi Desktop 中可用。</p>}
  </div>
}
