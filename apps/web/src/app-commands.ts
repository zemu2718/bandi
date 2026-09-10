import type { NavigateFunction } from 'react-router-dom'
import type { Dispatch } from 'react'
import type { Action } from './state'
import type { EditorSession } from './editor-session'
import type { EffectiveTheme } from './ui-preferences'

export const appCommandIds = [
  'navigation.back',
  'navigation.forward',
  'navigation.home',
  'navigation.agents',
  'navigation.organization',
  'navigation.tasks',
  'navigation.assets',
  'navigation.settings',
  'theme.toggle',
  'editor.save',
  'editor.cancel',
] as const

export type AppCommandId = typeof appCommandIds[number]

const navigationTargets: Partial<Record<AppCommandId, string>> = {
  'navigation.home': '/',
  'navigation.agents': '/agents',
  'navigation.organization': '/organization',
  'navigation.tasks': '/tasks',
  'navigation.assets': '/assets',
  'navigation.settings': '/settings',
}

export function isAppCommandId(value: unknown): value is AppCommandId {
  return typeof value === 'string' && appCommandIds.includes(value as AppCommandId)
}

export function executeAppCommand(
  command: AppCommandId,
  context: {
    navigate: NavigateFunction
    dispatch: Dispatch<Action>
    editor?: EditorSession
    effectiveTheme?: EffectiveTheme
    canGoBack?: boolean
    canGoForward?: boolean
  },
): boolean {
  if (command === 'navigation.back') {
    if (!context.canGoBack) return false
    context.navigate(-1)
    return true
  }
  if (command === 'navigation.forward') {
    if (!context.canGoForward) return false
    context.navigate(1)
    return true
  }
  const target = navigationTargets[command]
  if (target) {
    context.navigate(target)
    return true
  }
  if (command === 'theme.toggle') {
    context.dispatch({ type: 'THEME', effectiveTheme: context.effectiveTheme })
    return true
  }
  if (command === 'editor.save' && context.editor?.canSave) {
    context.editor.save()
    return true
  }
  if (command === 'editor.cancel' && context.editor) {
    context.editor.cancel()
    return true
  }
  return false
}
