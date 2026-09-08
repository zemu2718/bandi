import type { AiClient } from './mock'
import { aiClients as builtInClients } from './mock'
import type {
  CustomToolDto,
  ToolConfigurationSnapshotDto,
  ToolPlanDto,
} from './desktop-bridge'
import type { ConfigurationEnvironment } from './domain'

export type ToolConfigurationState = {
  revision: number
  builtInToolIds: string[]
  customTools: CustomToolDto[]
}

export const emptyToolConfiguration: ToolConfigurationState = {
  revision: 0,
  builtInToolIds: [],
  customTools: [],
}

export function applyToolConfigurationSnapshot(snapshot: ToolConfigurationSnapshotDto) {
  const customClients: AiClient[] = snapshot.customTools.map((tool) => ({
    id: tool.id,
    kind: 'custom',
    name: tool.name,
    shortName: tool.name.slice(0, 2).toUpperCase(),
    description: '用户添加的自定义工具',
    detection: 'not-checked',
    persistence: 'memory-only',
  }))
  const allowed = new Set(snapshot.builtInToolIds)
  return {
    aiClients: [
      ...builtInClients.filter((client) => allowed.has(client.id)),
      ...customClients,
    ],
    configurationEnvironments: snapshot.plans.map(planToEnvironment),
    currentConfigurationEnvironmentId: snapshot.selectedPlanId,
    toolConfiguration: {
      revision: snapshot.revision,
      builtInToolIds: snapshot.builtInToolIds,
      customTools: snapshot.customTools,
    },
  }
}

export function planToEnvironment(plan: ToolPlanDto): ConfigurationEnvironment {
  return { id: plan.id, name: plan.name, clientIds: plan.toolIds, evidence: 'memory-only' }
}

export function environmentToPlan(environment: ConfigurationEnvironment): ToolPlanDto {
  return { id: environment.id, name: environment.name, toolIds: environment.clientIds }
}
