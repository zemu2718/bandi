export type BuiltInClientId =
  | 'claude-code'
  | 'claude-desktop'
  | 'codex'
  | 'gemini-cli'
  | 'grok-build'
  | 'opencode'
  | 'openclaw'
  | 'hermes'
  | 'pi'

export type ClientAdapterId =
  | 'claude-code-terminal-v1'
  | 'claude-desktop-config-v1'
  | 'codex-terminal-v1'
  | 'gemini-cli-terminal-v1'
  | 'grok-build-config-v1'
  | 'opencode-terminal-v1'
  | 'openclaw-terminal-v1'
  | 'hermes-terminal-v1'
  | 'pi-terminal-v1'

export type ClientLaunchDescriptor = {
  clientId: BuiltInClientId
  adapterId: ClientAdapterId
}

export const clientAdapterCatalog: Record<BuiltInClientId, {
  adapterId: ClientAdapterId
  launch?: ClientLaunchDescriptor
  agentImport: { status: 'supported'; format: string } | { status: 'unavailable'; reason: string }
}> = {
  'claude-code': {
    adapterId: 'claude-code-terminal-v1',
    launch: { clientId: 'claude-code', adapterId: 'claude-code-terminal-v1' },
    agentImport: { status: 'supported', format: '.claude/agents/*.md' },
  },
  'claude-desktop': { adapterId: 'claude-desktop-config-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
  codex: {
    adapterId: 'codex-terminal-v1',
    launch: { clientId: 'codex', adapterId: 'codex-terminal-v1' },
    agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' },
  },
  'gemini-cli': { adapterId: 'gemini-cli-terminal-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
  'grok-build': { adapterId: 'grok-build-config-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
  opencode: { adapterId: 'opencode-terminal-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
  openclaw: { adapterId: 'openclaw-terminal-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
  hermes: { adapterId: 'hermes-terminal-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
  pi: { adapterId: 'pi-terminal-v1', agentImport: { status: 'unavailable', reason: '未确认可导入的独立 Agent 文件格式' } },
}

export function launchDescriptor(clientId: string): ClientLaunchDescriptor | undefined {
  return clientId in clientAdapterCatalog
    ? clientAdapterCatalog[clientId as BuiltInClientId].launch
    : undefined
}
