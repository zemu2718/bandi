import { describe, expect, it, vi } from 'vitest'
import { executeAppCommand, isAppCommandId } from '../app-commands'

describe('app commands', () => {
  it('只接受白名单命令', () => {
    expect(isAppCommandId('navigation.agents')).toBe(true)
    expect(isAppCommandId('navigation.projects')).toBe(false)
    expect(isAppCommandId('navigation.tasks')).toBe(true)
    expect(isAppCommandId('navigation.workspaces')).toBe(false)
    expect(isAppCommandId('shell.exec')).toBe(false)
  })

  it('保留一级菜单外的配置状态导航命令', () => {
    const navigate = vi.fn()

    expect(executeAppCommand('navigation.home', {
      navigate,
      dispatch: vi.fn(),
    })).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('根据当前生效主题执行快捷切换', () => {
    const dispatch = vi.fn()

    expect(executeAppCommand('theme.toggle', {
      navigate: vi.fn(),
      dispatch,
      effectiveTheme: 'dark',
    })).toBe(true)
    expect(dispatch).toHaveBeenCalledWith({ type: 'THEME', effectiveTheme: 'dark' })
  })

  it('没有活动编辑器时不消费保存命令', () => {
    expect(executeAppCommand('editor.save', {
      navigate: vi.fn(),
      dispatch: vi.fn(),
    })).toBe(false)
  })

  it('保存命令调用活动编辑器原有处理器', () => {
    const save = vi.fn()
    expect(executeAppCommand('editor.save', {
      navigate: vi.fn(),
      dispatch: vi.fn(),
      editor: { id: 'instructions', dirty: true, canSave: true, save, cancel: vi.fn() },
    })).toBe(true)
    expect(save).toHaveBeenCalledOnce()
  })
})
