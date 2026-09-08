import { describe, expect, it } from 'vitest'
import type { AgentFile } from '../domain'
import { buildAgentPackageTree, findAgentPackageNode, getDefaultAgentPackagePath, normalizeAgentPackagePath } from '../agent-package'

const files: AgentFile[] = [
  { path: 'agent.yaml', type: '身份', status: '已保存', scope: { kind: 'agent-root' } },
  { path: 'instructions.md', type: '指令', status: '已保存', scope: { kind: 'agent-root' } },
  { path: 'config/rules.yaml', type: '规则', status: '已保存', scope: { kind: 'agent-root' } },
]

describe('AgentPackage 目录树', () => {
  it('从扁平事实派生多层目录且不修改输入', () => {
    const before = structuredClone(files)
    const tree = buildAgentPackageTree(files)
    expect(findAgentPackageNode(tree, 'config')?.kind).toBe('directory')
    expect(files).toEqual(before)
  })

  it('同级目录排在文件前且各自按名称排序', () => {
    const tree = buildAgentPackageTree(files)
    expect(tree.map((item) => item.path)).toEqual(['config', 'agent.yaml', 'instructions.md'])
  })

  it('忽略重复和非法路径', () => {
    const tree = buildAgentPackageTree([...files, files[0], { ...files[0], path: '../secret' }])
    expect(tree.filter((item) => item.path === 'agent.yaml')).toHaveLength(1)
    expect(findAgentPackageNode(tree, '../secret')).toBeUndefined()
    expect(normalizeAgentPackagePath('/absolute')).toBeUndefined()
  })

  it('优先选择 agent.yaml', () => expect(getDefaultAgentPackagePath(files)).toBe('agent.yaml'))
})
