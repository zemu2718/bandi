import { Check, FolderOpen } from 'lucide-react'
import { AiClientIcon } from '../../components/ai-clients'
import { clientAdapterCatalog } from '../../client-adapters'
import type { ClaudeAgentPreviewDto } from '../../contracts'
import { aiClients } from '../../mock'

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
  const selectLabel = selecting ? '正在读取…' : preview ? '重新选择 Agent 文件' : '选择 Agent 文件'
  return <div className="space-y-4">
    <fieldset>
      <legend className="text-sm font-semibold">来源工具</legend>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {aiClients.map((client) => {
          const capability = clientAdapterCatalog[client.id].agentImport
          const supported = capability.status === 'supported'
          return <label key={client.id} className={`flex min-w-0 items-center gap-3 rounded-lg border p-3 focus-within:ring-2 focus-within:ring-ring ${supported ? 'border-foreground bg-muted/35' : 'border-border text-muted-foreground'}`}>
            <input type="radio" name="agent-import-tool" value={client.id} checked={supported} disabled={!supported} readOnly className="sr-only" />
            <AiClientIcon client={client} size={22} tile />
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm text-foreground">{client.name}</b>
              <span className="mt-0.5 block text-xs leading-4">{supported ? '支持导入' : '暂不支持导入'}</span>
            </span>
            {supported && <span className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground text-background" aria-hidden="true"><Check size={13} strokeWidth={2.5} /></span>}
          </label>
        })}
      </div>
    </fieldset>
    <p className="text-xs leading-5 text-muted-foreground">当前仅支持导入 Claude Code 的 {importCapability.status === 'supported' ? importCapability.format : ''} 文件。</p>
    <button type="button" disabled={!desktop || selecting || saving} aria-busy={selecting} aria-label={selectLabel} onClick={onSelect} className="flex min-h-20 w-full items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
      <FolderOpen size={22} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0">
        <b className="block text-sm">{selectLabel}</b>
        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">只读取通过系统选择器明确选择的单个文件</span>
      </span>
    </button>
    {!desktop && <p className="text-xs text-muted-foreground">本机文件选择仅在 Bandi Desktop 中可用。</p>}
  </div>
}
