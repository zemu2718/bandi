import { describe, expect, it } from 'vitest'
import type { SopStep } from '../domain'
import { validateSopSteps } from '../sop-validation'

const step = (changes: Partial<SopStep> = {}): SopStep => ({
  id: 'step-1',
  title: '准备配置',
  objective: '准备输入',
  input: '',
  output: '',
  owner: '产品负责人',
  dependsOn: [],
  ...changes,
})

describe('SOP 步骤校验', () => {
  it('接受合法无环步骤', () => {
    expect(validateSopSteps([
      step(),
      step({ id: 'step-2', title: '保存配置', dependsOn: ['step-1'] }),
    ])).toEqual([])
  })

  it('识别空字段与重复 ID', () => {
    const errors = validateSopSteps([
      step({ title: '', owner: '' }),
      step({ title: '第二步' }),
    ])
    expect(errors).toContain('步骤 1缺少标题。')
    expect(errors).toContain('步骤 1缺少责任主体。')
    expect(errors).toContain('步骤 ID“step-1”重复。')
  })

  it('识别未知依赖和自依赖', () => {
    const errors = validateSopSteps([
      step({ dependsOn: ['step-1', 'missing'] }),
    ])
    expect(errors).toContain('步骤“step-1”不能依赖自身。')
    expect(errors).toContain('步骤“step-1”依赖了不存在的“missing”。')
  })

  it('识别循环依赖', () => {
    const errors = validateSopSteps([
      step({ dependsOn: ['step-2'] }),
      step({ id: 'step-2', dependsOn: ['step-1'] }),
    ])
    expect(errors).toContain('步骤依赖存在循环引用。')
  })
})
