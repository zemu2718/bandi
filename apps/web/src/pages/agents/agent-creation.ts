import {
  getAgentConfigPath,
  serializeAgentConfig,
  snapshotAgentConfig,
  type AgentConfigPayload,
} from '../../agent-config-model'
import type { AgentFunction, FullAgent } from '../../domain'
import type { AgentPackageFileInput } from '../../desktop-bridge'

export type AgentTemplate = {
  id: string
  name: string
  description: string
  functionId: AgentFunction | undefined
  mission: string
  rolePrompt: string
  workingConstraints: string
}

export const agentTemplates = [
  { id: '', name: '空白 Agent', description: '从空白定义开始。', functionId: undefined, mission: '', rolePrompt: '', workingConstraints: '' },
  { id: 'product', name: '产品', description: '预填产品目标、范围与验证要求。', functionId: 'product', mission: '澄清用户问题并定义可验证的产品目标。', rolePrompt: '你是一名务实的产品 Agent，负责澄清需求、收敛范围并定义可验证结果。', workingConstraints: '区分用户问题、产品目标和实现方案。\n明确约束与未决问题。\n不代替用户做高风险产品决策。' },
  { id: 'design', name: '设计', description: '预填体验设计与可访问性要求。', functionId: 'design', mission: '把产品目标转化为清晰、一致且可访问的体验。', rolePrompt: '你是一名克制的设计 Agent，负责信息结构、交互和界面质量。', workingConstraints: '优先复用现有设计系统。\n覆盖关键状态和键盘操作。\n不以视觉装饰替代信息层级。' },
  { id: 'engineering', name: '研发', description: '预填软件交付与验证要求。', functionId: 'engineering', mission: '把已确认目标交付为可验证的软件成果。', rolePrompt: '你是一名可靠的研发 Agent，负责实现、验证并说明技术取舍。', workingConstraints: '先理解现有代码和边界。\n保持改动聚焦并运行相关验证。\n不自行扩大权限或任务范围。' },
  { id: 'testing', name: '测试', description: '预填质量验证与缺陷证据要求。', functionId: 'testing', mission: '验证关键行为并提供可复现的质量证据。', rolePrompt: '你是一名严谨的测试 Agent，负责发现可复现问题并确认修复结果。', workingConstraints: '围绕验收标准设计验证。\n记录输入、步骤、结果和环境。\n不把推测写成已确认缺陷。' },
] as const satisfies ReadonlyArray<AgentTemplate>

export function createAgentFromTemplate(
  id: string,
  teamId: string,
  template: AgentTemplate,
  name = `${template.name} Agent`,
  desktop = false,
): FullAgent {
  return {
    id,
    name,
    status: 'active',
    packageSchema: { schemaVersion: 1, compatibility: 'current' },
    config: '配置完整',
    updated: '刚刚',
    teamId,
    functionId: template.functionId,
    mission: template.mission,
    responsibilities: [],
    deliverables: [],
    decisionBoundaries: [],
    escalationConditions: [],
    prohibitions: [],
    completionDefinition: [],
    packagePath: `~/.bandi/agents/agt_${id}/`,
    packageSource: desktop
      ? { kind: 'bandi-managed', packageId: `agt_${id}`, strategy: 'managed' }
      : { kind: 'bandi-demo', strategy: 'create-demo' },
    instructions: [template.rolePrompt, template.workingConstraints].filter(Boolean).join('\n\n'),
    skillRefs: [],
    ruleRefs: [],
    mcpRefs: [],
    contextPolicy: { enabled: false, triggerRatio: 0.8, targetRatio: 0.5, protectRecentTurns: 6, protectOpeningTurns: 2 },
    contextWindowTokens: 200_000,
    outputParameterBindings: [],
    hookRefs: [],
    commandRefs: [],
    permissions: { files: '未授予', commands: '未授予', network: '未授予', delegation: '未授予' },
    sopRefs: [],
    files: [],
  }
}

export function createAgentPackageFiles(agent: FullAgent): AgentPackageFileInput[] {
  const kinds: AgentConfigPayload['kind'][] = [
    'identity', 'instructions', 'context', 'skills', 'rules', 'mcp',
    'permissions', 'sop', 'hooks', 'commands',
  ]
  return kinds.flatMap((kind) => {
    const payload = snapshotAgentConfig(agent, kind)
    if (!payload) return []
    const path = getAgentConfigPath(payload)
    const content = serializeAgentConfig(agent, payload)
    return path && content !== undefined ? [{ path, content }] : []
  })
}
