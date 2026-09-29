import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Image, Trash2, Undo2, Upload } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { deleteUiAsset, importUiAsset, isDesktopRuntime, readUiAsset, type UiAssetSlot } from '../../desktop-bridge'
import { useRegisterEditorSession } from '../../editor-session'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { useApp } from '../../state'
import {
  DEFAULT_UI_PREFERENCES,
  constrainAccent,
  type UiPreferences,
} from '../../ui-preferences'
import { AccentColorPicker } from './accent-color-picker'

const accentPresets = [
  ['石墨色', '#767676'],
  ['蓝色', '#2563eb'],
  ['紫色', '#7c3aed'],
  ['青色', '#0f766e'],
  ['橙色', '#c2410c'],
] as const
const fieldClass = 'mt-2 h-11 w-full rounded-lg px-3'
type SectionId = 'personalization-theme' | 'personalization-display' | 'personalization-background'
type Errors = Partial<Record<UiAssetSlot | 'general', string>>
type AppearancePreferences = Pick<UiPreferences,
  | 'theme'
  | 'accentColor'
  | 'accentOpacity'
  | 'interfaceFont'
  | 'monoFont'
  | 'fontScale'
  | 'density'
  | 'backgroundStyle'
  | 'backgroundFit'
  | 'backgroundDim'
  | 'backgroundAsset'
>

function appearancePreferences(preferences: UiPreferences): AppearancePreferences {
  const { theme, accentColor, accentOpacity, interfaceFont, monoFont, fontScale, density, backgroundStyle, backgroundFit, backgroundDim, backgroundAsset } = preferences
  return { theme, accentColor, accentOpacity, interfaceFont, monoFont, fontScale, density, backgroundStyle, backgroundFit, backgroundDim, backgroundAsset }
}

const sameAppearance = (left: AppearancePreferences, right: AppearancePreferences) =>
  JSON.stringify(left) === JSON.stringify(right)

export function PersonalizationSection() {
  const { state, dispatch, setUiPreferencesPreview } = useApp()
  const cleanupRef = useRef<() => void>(() => undefined)
  const [canonical, setCanonical] = useState(() => appearancePreferences(state.uiPreferences))
  const canonicalRef = useRef(canonical)
  const [draft, setDraft] = useState(() => appearancePreferences(state.uiPreferences))
  const [backgroundFile, setBackgroundFile] = useState<File>()
  const [removeBackground, setRemoveBackground] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [customAccentOpen, setCustomAccentOpen] = useState(() => !accentPresets.some(([, color]) => color === state.uiPreferences.accentColor))
  const desktop = isDesktopRuntime()

  useEffect(() => {
    if (!desktop) return
    let disposed = false
    readUiAsset('background').then((background) => {
      if (disposed) { if (background) URL.revokeObjectURL(background); return }
      setBackgroundUrl(background)
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [desktop])
  useEffect(() => () => { if (backgroundUrl) URL.revokeObjectURL(backgroundUrl) }, [backgroundUrl])

  const dirty = !sameAppearance(draft, canonical) || Boolean(backgroundFile || removeBackground)
  const canSave = dirty && !saving
  const update = <K extends keyof AppearancePreferences>(key: K, value: AppearancePreferences[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const updateAccent = (color: string, opacity: number) => {
    const accent = constrainAccent(color, opacity)
    setDraft((current) => ({ ...current, accentColor: accent.color, accentOpacity: accent.opacity }))
    setUiPreferencesPreview({ ...state.uiPreferences, ...draft, accentColor: accent.color, accentOpacity: accent.opacity })
  }
  useEffect(() => {
    const next = appearancePreferences(state.uiPreferences)
    if (sameAppearance(next, canonicalRef.current)) return
    const hasLocalChanges = !sameAppearance(draft, canonicalRef.current) || Boolean(backgroundFile || removeBackground)
    canonicalRef.current = next
    setCanonical(next)
    if (!hasLocalChanges) setDraft(next)
  }, [backgroundFile, draft, removeBackground, state.uiPreferences])
  const backgroundPreview = useMemo(() => backgroundFile ? URL.createObjectURL(backgroundFile) : removeBackground || !draft.backgroundAsset ? undefined : backgroundUrl, [backgroundFile, backgroundUrl, draft.backgroundAsset, removeBackground])
  useEffect(() => () => { if (backgroundFile && backgroundPreview) URL.revokeObjectURL(backgroundPreview) }, [backgroundFile, backgroundPreview])

  const effectiveDraft = useMemo<UiPreferences>(() => ({
    ...state.uiPreferences,
    ...draft,
  }), [draft, state.uiPreferences])
  useEffect(() => {
    if (!dirty) { setUiPreferencesPreview(undefined); return }
    setUiPreferencesPreview(effectiveDraft, {
      background: backgroundFile ? backgroundPreview : removeBackground || !effectiveDraft.backgroundAsset ? null : backgroundPreview,
    })
  }, [backgroundFile, backgroundPreview, dirty, effectiveDraft, removeBackground, setUiPreferencesPreview])
  cleanupRef.current = () => setUiPreferencesPreview(undefined)
  useEffect(() => () => cleanupRef.current(), [])
  const chooseFile = (_slot: UiAssetSlot, file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setErrors((current) => ({ ...current, background: '背景图片仅支持 PNG 或 JPEG，且不能超过 15 MB。' }))
      return
    }
    setErrors((current) => ({ ...current, background: undefined, general: undefined }))
    setBackgroundFile(file)
    setRemoveBackground(false)
  }
  const removeBackgroundAsset = () => {
    setErrors((current) => ({ ...current, background: undefined }))
    if (backgroundFile) setBackgroundFile(undefined)
    else setRemoveBackground(true)
  }
  const reset = () => {
    setDraft(canonicalRef.current); setBackgroundFile(undefined); setRemoveBackground(false); setErrors({}); setUiPreferencesPreview(undefined)
  }
  const restoreDefaults = () => {
    setDraft(appearancePreferences(DEFAULT_UI_PREFERENCES)); setBackgroundFile(undefined)
    setRemoveBackground(Boolean(state.uiPreferences.backgroundAsset))
    setCustomAccentOpen(false); setErrors({})
  }
  const save = async () => {
    if (!canSave) return
    setSaving(true); setErrors({})
    try {
      if (backgroundFile) await importUiAsset('background', backgroundFile)
      const preferences: UiPreferences = {
        ...state.uiPreferences,
        ...draft,
        backgroundAsset: backgroundFile ? { kind: 'local_asset', assetId: 'background' } : removeBackground ? undefined : draft.backgroundAsset,
      }
      const savedAppearance = appearancePreferences(preferences)
      canonicalRef.current = savedAppearance
      setCanonical(savedAppearance)
      dispatch({ type: 'UPDATE_UI_PREFERENCES', preferences })
      setDraft(savedAppearance); setBackgroundFile(undefined)
      if (removeBackground) {
        try {
          await deleteUiAsset('background')
          setRemoveBackground(false)
        } catch {
          setErrors({ background: '偏好已保存，但旧图片未能清理。再次保存可重试。' })
        }
      }
    } catch (cause) {
      setErrors({ general: cause instanceof Error ? cause.message : String(cause) })
    } finally { setSaving(false) }
  }

  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  useRegisterEditorSession(dirty ? { id: 'settings:personalization', dirty, canSave, save: () => void save(), cancel: reset } : undefined)

  return <div className={`min-w-0 space-y-5 ${dirty ? 'pb-28' : 'pb-8'}`}>
    <SettingsSection id="personalization-theme" title="主题与颜色" description="选择工作台明暗模式和交互强调色。">
      <ChoiceCards label="外观模式" value={draft.theme} preview="theme" onChange={(value) => update('theme', value as UiPreferences['theme'])} columns={3} options={[["system", "跟随系统", "自动适应系统"], ["light", "亮色", "明亮清晰"], ["dark", "暗色", "柔和低眩光"]]} />
      <div className="mt-5"><span className="text-sm font-medium">强调色</span><div className="mt-2 flex flex-wrap gap-2">{accentPresets.map(([name, color]) => <button type="button" key={color} aria-label={name} aria-pressed={draft.accentColor === color && draft.accentOpacity === 100} onClick={() => { updateAccent(color, 100); setCustomAccentOpen(false) }} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ borderColor: draft.accentColor === color && draft.accentOpacity === 100 ? color : undefined }}><span className="size-4 rounded-full" style={{ background: color }} />{name}{draft.accentColor === color && draft.accentOpacity === 100 && <Check size={14} aria-hidden="true" />}</button>)}</div><Button className="mt-3" type="button" variant="outline" aria-expanded={customAccentOpen} aria-controls="custom-accent-field" onClick={() => setCustomAccentOpen((open) => !open)}>自定义颜色</Button>{customAccentOpen && <div id="custom-accent-field"><AccentColorPicker color={draft.accentColor} opacity={draft.accentOpacity} onChange={updateAccent} /></div>}</div>
    </SettingsSection>

    <SettingsSection id="personalization-display" title="字体与显示" description="字体、字号和间距分别调整，便于获得舒适的阅读密度。">
      <ChoiceCards label="界面字体" value={draft.interfaceFont} onChange={(value) => update('interfaceFont', value as UiPreferences['interfaceFont'])} columns={3} options={[["bandi", "默认", "清晰、克制"], ["system", "系统字体", "贴近操作系统"], ["rounded", "圆润字体", "柔和、亲切"]]} />
      <div className="mt-5"><ChoiceCards label="等宽字体" value={draft.monoFont} onChange={(value) => update('monoFont', value as UiPreferences['monoFont'])} columns={2} options={[["system", "系统等宽", "适合路径与标识"], ["classic", "经典等宽", "传统代码字形"]]} /></div>
      <div className="mt-5 grid gap-5 md:grid-cols-2"><ChoiceCards label="文字大小" value={draft.fontScale} onChange={(value) => update('fontScale', value as UiPreferences['fontScale'])} columns={3} options={[["small", "小", "紧凑阅读"], ["default", "标准", "默认大小"], ["large", "大", "更易阅读"]]} /><ChoiceCards label="界面密度" value={draft.density} onChange={(value) => update('density', value as UiPreferences['density'])} columns={3} options={[["compact", "紧凑", "更多内容"], ["default", "标准", "均衡间距"], ["comfortable", "宽松", "更大间距"]]} /></div>
      <DisplayPreview draft={draft} />
    </SettingsSection>

    <SettingsSection id="personalization-background" title="工作台背景" description="背景效果与图片只影响当前设备。">
      <ChoiceCards label="背景效果" value={draft.backgroundStyle} onChange={(value) => update('backgroundStyle', value as UiPreferences['backgroundStyle'])} columns={2} options={[["plain", "纯净", "单色背景"], ["soft", "柔和层次", "轻微色彩层次"]]} />
      <div className="mt-5 max-w-lg">{desktop ? <AssetPicker label="背景图片（可选）" slot="background" preview={backgroundPreview} pendingRemoval={removeBackground} error={errors.background} onChoose={chooseFile} onRemove={removeBackgroundAsset} onUndo={() => setRemoveBackground(false)} /> : <DesktopAssetNote label="背景图片（可选）" />}</div>
      {backgroundPreview && !removeBackground && <div className="mt-5 grid gap-5 sm:grid-cols-2"><SelectField label="图片显示方式" value={draft.backgroundFit} onChange={(value) => update('backgroundFit', value as UiPreferences['backgroundFit'])} options={[["cover", "铺满裁切"], ["contain", "完整显示"]]} /><label className="text-sm font-medium">背景遮罩：{draft.backgroundDim}%<input className="mt-4 w-full" type="range" min="0" max="80" step="5" value={draft.backgroundDim} onChange={(event) => update('backgroundDim', Number(event.target.value))} /><span className="mt-1 flex justify-between text-xs font-normal text-muted-foreground"><span>弱</span><span>强</span></span></label></div>}
    </SettingsSection>

    <section className="rounded-xl border border-dashed border-border p-5"><b className="text-sm">恢复默认外观</b><p className="mt-1 text-sm text-muted-foreground">先将当前草稿恢复为初始设置，保存后才会生效。</p><Button className="mt-4" variant="outline" disabled={saving} onClick={restoreDefaults}>恢复默认</Button></section>
    {errors.general && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">保存失败：{errors.general}。请检查后重试。</p>}
    {dirty && <div data-testid="personalization-actions" role="status" aria-live="polite" className="sticky bottom-4 z-10 mt-5 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur max-[959px]:static max-[959px]:flex-col max-[959px]:items-stretch"><p className="text-sm text-muted-foreground">{saving ? '正在保存…' : '有未保存的更改 · 仅当前设备'}</p><div className="flex gap-2 max-[959px]:grid max-[959px]:grid-cols-2"><Button className="max-[959px]:w-full" variant="outline" disabled={saving} onClick={reset}>取消</Button><Button className="max-[959px]:w-full" disabled={!canSave} onClick={() => void save()}>{saving ? '保存中…' : '保存更改'}</Button></div></div>}
    {unsavedDialog}
  </div>
}

function SettingsSection({ id, title, description, children }: { id: SectionId; title: string; description: string; children: ReactNode }) {
  return <section id={id} className="panel scroll-mt-32 p-5 xl:scroll-mt-20"><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p><div className="mt-5">{children}</div></section>
}

function ChoiceCards({ label, value, options, columns, preview, onChange }: { label: string; value: string; options: readonly (readonly [string, string, string])[]; columns: 2 | 3; preview?: 'theme'; onChange: (value: string) => void }) {
  return <fieldset><legend className="text-sm font-medium">{label}</legend><div className={`mt-2 grid grid-cols-1 gap-2 ${columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{options.map(([id, title, description]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={`min-h-20 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'}`}>{preview === 'theme' && <ThemePreview mode={id} />}<span className="flex items-center justify-between gap-2 text-sm font-medium">{title}{value === id && <Check size={15} aria-hidden="true" />}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></button>)}</div></fieldset>
}

function ThemePreview({ mode }: { mode: string }) {
  const dark = mode === 'dark'
  return <span aria-hidden="true" className={`mb-3 block overflow-hidden rounded-md border p-2 ${dark ? 'border-zinc-700 bg-zinc-950' : mode === 'light' ? 'border-zinc-200 bg-white' : 'border-border bg-gradient-to-r from-white to-zinc-900'}`}><span className={`block h-1.5 w-1/3 rounded-full ${dark ? 'bg-zinc-600' : 'bg-zinc-300'}`} /><span className={`mt-2 block h-5 rounded ${dark ? 'bg-zinc-800' : 'bg-zinc-100'}`} /></span>
}

function DisplayPreview({ draft }: { draft: AppearancePreferences }) {
  const size = draft.fontScale === 'small' ? 'text-xs' : draft.fontScale === 'large' ? 'text-base' : 'text-sm'
  const spacing = draft.density === 'compact' ? 'space-y-1 p-3' : draft.density === 'comfortable' ? 'space-y-4 p-5' : 'space-y-2 p-4'
  return <div data-testid="display-preview" className={`mt-5 rounded-lg border border-border bg-muted/35 ${spacing} ${size}`}><b className="block">显示效果</b><p className="text-muted-foreground">清晰呈现 Team、Agent 与长期配置。</p><code className="block font-mono text-xs text-muted-foreground">~/.bandi/agents/example</code></div>
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium">{label}<select className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}

function DesktopAssetNote({ label }: { label: string }) {
  return <div><span className="text-sm font-medium">{label}</span><p className="mt-1 text-xs leading-5 text-muted-foreground">图片选择和预览仅在 Bandi Desktop 中可用。</p></div>
}

function AssetPicker({ label, slot, preview, pendingRemoval, error, onChoose, onRemove, onUndo }: { label: string; slot: UiAssetSlot; preview?: string; pendingRemoval: boolean; error?: string; onChoose: (slot: UiAssetSlot, file?: File) => void; onRemove: () => void; onUndo: () => void }) {
  const errorId = `${slot}-asset-error`
  return <div><span className="text-sm font-medium">{label}</span><div className="mt-2 grid min-h-32 place-items-center overflow-hidden rounded-xl border bg-muted">{pendingRemoval ? <div className="p-5 text-center"><Trash2 size={24} className="mx-auto text-muted-foreground" aria-hidden="true" /><p className="mt-2 text-sm font-medium">保存后移除</p><Button className="mt-3" type="button" variant="outline" size="sm" onClick={onUndo}><Undo2 size={14} aria-hidden="true" />撤销移除</Button></div> : preview ? <img src={preview} alt={`${label}预览`} className="max-h-52 w-full object-cover" /> :<Image size={28} className="text-muted-foreground" aria-hidden="true" />}</div><div className="mt-2 flex flex-wrap gap-2"><label className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><Upload size={15} aria-hidden="true" />{preview ? '替换图片' : '选择图片'}<input type="file" className="sr-only" accept="image/png,image/jpeg" aria-describedby={error ? errorId : undefined} onChange={(event) => { onChoose(slot, event.target.files?.[0]); event.currentTarget.value = '' }} /></label>{preview && !pendingRemoval && <Button type="button" variant="outline" aria-label={`移除${label}`} onClick={onRemove}><Trash2 size={15} aria-hidden="true" />移除</Button>}</div>{error && <p id={errorId} role="alert" className="mt-2 text-xs leading-5 text-danger">{error}</p>}</div>
}
