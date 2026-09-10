import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Image, Trash2, Undo2, Upload } from 'lucide-react'
import { EntityTabPanel, EntityTabs } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { deleteUiAsset, importUiAsset, isDesktopRuntime, readUiAsset, type UiAssetSlot } from '../../desktop-bridge'
import { useRegisterEditorSession } from '../../editor-session'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { useApp } from '../../state'
import {
  DEFAULT_UI_PREFERENCES,
  getAccessibleAccent,
  type UiPreferences,
} from '../../ui-preferences'
import { TEAM_COLOR_PRESETS } from '../../team-identity'

const accentPresets = TEAM_COLOR_PRESETS
const sections = [
  ['personalization-theme', '主题与颜色'],
  ['personalization-display', '字体与显示'],
  ['personalization-background', '工作台背景'],
] as const
const fieldClass = 'mt-2 h-11 w-full rounded-lg px-3'
type SectionId = typeof sections[number][0]
type Errors = Partial<Record<UiAssetSlot | 'general', string>>

export function PersonalizationSection() {
  const { state, dispatch, setUiPreferencesPreview } = useApp()
  const canonicalRef = useRef(state.uiPreferences)
  const cleanupRef = useRef<() => void>(() => undefined)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState(state.uiPreferences)
  const [backgroundFile, setBackgroundFile] = useState<File>()
  const [removeBackground, setRemoveBackground] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [customAccentOpen, setCustomAccentOpen] = useState(() => !accentPresets.some(([, color]) => color === state.uiPreferences.accentColor))
  const [restoreDefaultsOpen, setRestoreDefaultsOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionId>('personalization-theme')
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

  const accent = getAccessibleAccent(draft.accentColor)
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.uiPreferences) || Boolean(backgroundFile || removeBackground)
  const canSave = dirty && Boolean(accent) && !saving
  const update = <K extends keyof UiPreferences>(key: K, value: UiPreferences[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const backgroundPreview = useMemo(() => backgroundFile ? URL.createObjectURL(backgroundFile) : removeBackground || !draft.backgroundAsset ? undefined : backgroundUrl, [backgroundFile, backgroundUrl, draft.backgroundAsset, removeBackground])
  useEffect(() => () => { if (backgroundFile && backgroundPreview) URL.revokeObjectURL(backgroundPreview) }, [backgroundFile, backgroundPreview])

  const accentValid = Boolean(accent)
  const effectiveDraft = useMemo<UiPreferences>(() => ({
    ...draft,
    accentColor: accentValid ? draft.accentColor : state.uiPreferences.accentColor,
  }), [accentValid, draft, state.uiPreferences.accentColor])
  useEffect(() => {
    if (!dirty) { setUiPreferencesPreview(undefined); return }
    setUiPreferencesPreview(effectiveDraft, {
      background: backgroundFile ? backgroundPreview : removeBackground || !effectiveDraft.backgroundAsset ? null : backgroundPreview,
    })
  }, [backgroundFile, backgroundPreview, dirty, effectiveDraft, removeBackground, setUiPreferencesPreview])
  cleanupRef.current = () => setUiPreferencesPreview(undefined)
  useEffect(() => () => cleanupRef.current(), [])
  const chooseFile = (slot: UiAssetSlot, file?: File) => {
    if (!file) return
    const limit = slot === 'logo' ? 5 : 15
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > limit * 1024 * 1024) {
      setErrors((current) => ({ ...current, [slot]: `${slot === 'logo' ? '工作台标识' : '背景图片'}仅支持 PNG 或 JPEG，且不能超过 ${limit} MB。` }))
      return
    }
    setErrors((current) => ({ ...current, [slot]: undefined, general: undefined }))
    if (slot === 'logo') { setLogoFile(file); setRemoveLogo(false) }
    else { setBackgroundFile(file); setRemoveBackground(false) }
  }
  const removeAsset = (slot: UiAssetSlot) => {
    setErrors((current) => ({ ...current, [slot]: undefined }))
    if (slot === 'logo') { if (logoFile) setLogoFile(undefined); else setRemoveLogo(true) }
    else if (backgroundFile) setBackgroundFile(undefined); else setRemoveBackground(true)
  }
  const undoRemove = (slot: UiAssetSlot) => slot === 'logo' ? setRemoveLogo(false) : setRemoveBackground(false)
  const reset = () => {
    setDraft(canonicalRef.current); setLogoFile(undefined); setBackgroundFile(undefined); setRemoveLogo(false); setRemoveBackground(false); setErrors({}); setUiPreferencesPreview(undefined)
  }
  const restoreDefaults = () => {
    setDraft({ ...DEFAULT_UI_PREFERENCES }); setLogoFile(undefined); setBackgroundFile(undefined)
    setRemoveLogo(Boolean(state.uiPreferences.logoAsset)); setRemoveBackground(Boolean(state.uiPreferences.backgroundAsset))
    setCustomAccentOpen(false); setRestoreDefaultsOpen(false); setErrors({})
  }
  const save = async () => {
    if (!canSave) return
    setSaving(true); setErrors({})
    try {
      if (logoFile) await importUiAsset('logo', logoFile)
      if (backgroundFile) await importUiAsset('background', backgroundFile)
      const preferences: UiPreferences = {
        ...draft,
        shellLabel: normalizeShellLabel(draft.shellLabel),
        logoAsset: logoFile ? { kind: 'local_asset', assetId: 'logo' } : removeLogo ? undefined : draft.logoAsset,
        backgroundAsset: backgroundFile ? { kind: 'local_asset', assetId: 'background' } : removeBackground ? undefined : draft.backgroundAsset,
      }
      canonicalRef.current = preferences
      dispatch({ type: 'UPDATE_UI_PREFERENCES', preferences })
      setDraft(preferences); setLogoFile(undefined); setBackgroundFile(undefined)
      const removals = [
        removeLogo && { slot: 'logo' as const, result: deleteUiAsset('logo') },
        removeBackground && { slot: 'background' as const, result: deleteUiAsset('background') },
      ].filter((item): item is { slot: UiAssetSlot; result: Promise<void> } => Boolean(item))
      const results = await Promise.allSettled(removals.map((item) => item.result))
      const failed = new Set(results.flatMap((result, index) => result.status === 'rejected' ? [removals[index].slot] : []))
      setRemoveLogo(failed.has('logo')); setRemoveBackground(failed.has('background'))
      if (failed.size) setErrors(Object.fromEntries([...failed].map((slot) => [slot, '偏好已保存，但旧图片未能清理。再次保存可重试。'])))
    } catch (cause) {
      setErrors({ general: cause instanceof Error ? cause.message : String(cause) })
    } finally { setSaving(false) }
  }

  const unsavedDialog = useUnsavedChangesGuard({ dirty, resetDraft: reset })
  useRegisterEditorSession(dirty ? { id: 'settings:personalization', dirty, canSave, save: () => void save(), cancel: reset } : undefined)
  const showSection = (id: SectionId) => {
    setActiveSection(id)
    if (typeof scrollAreaRef.current?.scrollTo === 'function') scrollAreaRef.current.scrollTo({ top: 0 })
  }

  return <div className="flex min-h-0 min-w-0 max-w-full flex-col lg:h-full">
    <EntityTabs
      tabs={sections.map(([id, label]) => ({ id, label }))}
      active={activeSection}
      onChange={(id) => showSection(id as SectionId)}
      scope="personalization"
      ariaLabel="外观设置章节"
      variant="segmented"
      className="mb-5 shrink-0"
      tabListClassName="sm:w-full sm:min-w-0 [&>button]:sm:min-w-0 [&>button]:sm:flex-1"
    />

    <div ref={scrollAreaRef} data-testid="personalization-scroll-area" className={`min-h-0 min-w-0 flex-1 space-y-5 lg:overscroll-contain lg:overflow-y-auto lg:pr-2 ${dirty ? 'pb-28' : 'pb-8'}`}>
        <EntityTabPanel tabId="personalization-brand" activeTab={activeSection} scope="personalization">
          <SettingsSection id="personalization-brand" title="品牌与标识" description="自定义当前设备上的辅助标识；Bandi 正式名称与 Rail Logo 保持不变。">
            <label className="block max-w-xl text-sm font-medium">工作台名称<input className={fieldClass} value={draft.shellLabel ?? ''} maxLength={41} aria-invalid={labelInvalid} aria-describedby={labelInvalid ? 'shell-label-error' : 'shell-label-help'} onChange={(event) => update('shellLabel', event.target.value)} /><span id={labelInvalid ? 'shell-label-error' : 'shell-label-help'} className={`mt-2 block text-xs font-normal ${labelInvalid ? 'text-danger' : 'text-muted-foreground'}`}>{labelInvalid ? '名称最多 40 个字符，请缩短后保存。' : '显示在工作台辅助品牌区域，不会修改产品名或桌面图标。'}</span></label>
            <div className="mt-5 max-w-sm">{desktop ? <AssetPicker label="工作台标识" slot="logo" preview={logoPreview} pendingRemoval={removeLogo} error={errors.logo} onChoose={chooseFile} onRemove={() => removeAsset('logo')} onUndo={() => undoRemove('logo')} /> : <DesktopAssetNote label="工作台标识" />}</div>
          </SettingsSection>
        </EntityTabPanel>

        <EntityTabPanel tabId="personalization-theme" activeTab={activeSection} scope="personalization">
        <SettingsSection id="personalization-theme" title="主题与颜色" description="选择工作台明暗模式和交互强调色。">
          <ChoiceCards label="外观模式" value={draft.theme} onChange={(value) => update('theme', value as UiPreferences['theme'])} columns={3} options={[["system", "跟随系统", "自动适应系统"], ["light", "亮色", "明亮清晰"], ["dark", "暗色", "柔和低眩光"]]} />
          <div className="mt-5"><span className="text-sm font-medium">强调色</span><div className="mt-2 flex flex-wrap gap-2">{accentPresets.map(([name, color]) => <button type="button" key={color} aria-label={name} aria-pressed={draft.accentColor === color} onClick={() => { update('accentColor', color); setCustomAccentOpen(false) }} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ borderColor: draft.accentColor === color ? color : undefined }}><span className="size-4 rounded-full" style={{ background: color }} />{name}{draft.accentColor === color && <Check size={14} aria-hidden="true" />}</button>)}</div><Button className="mt-3" type="button" variant="outline" aria-expanded={customAccentOpen} aria-controls="custom-accent-field" onClick={() => setCustomAccentOpen((open) => !open)}>自定义颜色</Button>{customAccentOpen && <div id="custom-accent-field" className="max-w-sm"><label className="mt-3 block text-sm">颜色值<input className={`${fieldClass} font-mono`} value={draft.accentColor} aria-invalid={!accent} aria-describedby="accent-help" onChange={(event) => update('accentColor', event.target.value)} /></label><p id="accent-help" className={`mt-2 text-xs ${accent ? 'text-muted-foreground' : 'text-danger'}`}>{accent ? `文字颜色已自动适配 · 对比度 ${accent.ratio.toFixed(2)}:1` : '请输入完整的 #RRGGBB 色值。'}</p></div>}</div>
        </SettingsSection>
        </EntityTabPanel>

        <EntityTabPanel tabId="personalization-display" activeTab={activeSection} scope="personalization">
        <SettingsSection id="personalization-display" title="字体与显示" description="字体、字号和间距分别调整，便于获得舒适的阅读密度。">
          <ChoiceCards label="界面字体" value={draft.interfaceFont} onChange={(value) => update('interfaceFont', value as UiPreferences['interfaceFont'])} columns={3} options={[["bandi", "Bandi 默认", "清晰、克制"], ["system", "系统字体", "贴近操作系统"], ["rounded", "圆润字体", "柔和、亲切"]]} />
          <div className="mt-5"><ChoiceCards label="等宽字体" value={draft.monoFont} onChange={(value) => update('monoFont', value as UiPreferences['monoFont'])} columns={2} options={[["system", "系统等宽", "适合路径与标识"], ["classic", "经典等宽", "传统代码字形"]]} /></div>
          <div className="mt-5 grid gap-5 md:grid-cols-2"><ChoiceCards label="文字大小" value={draft.fontScale} onChange={(value) => update('fontScale', value as UiPreferences['fontScale'])} columns={3} options={[["small", "小", "紧凑阅读"], ["default", "标准", "默认大小"], ["large", "大", "更易阅读"]]} /><ChoiceCards label="界面密度" value={draft.density} onChange={(value) => update('density', value as UiPreferences['density'])} columns={3} options={[["compact", "紧凑", "更多内容"], ["default", "标准", "均衡间距"], ["comfortable", "宽松", "更大间距"]]} /></div>
        </SettingsSection>
        </EntityTabPanel>

        <EntityTabPanel tabId="personalization-layout" activeTab={activeSection} scope="personalization">
        <SettingsSection id="personalization-layout" title="布局" description="调整 Agent 上下文栏占用的空间。">
          <ChoiceCards label="Agent 上下文栏" value={draft.mainMenuLayout} onChange={(value) => update('mainMenuLayout', value as MainMenuLayoutPreference)} columns={2} options={[["follow-window", "自动（推荐）", "随窗口宽度调整"], ["expanded", "固定展开", "宽屏显示完整内容"], ["compact", "紧凑显示", "仅保留必要入口"], ["hidden", "隐藏", "可随时在此恢复"]]} />
          <div className="mt-5 rounded-lg border border-border bg-muted/45 p-4"><span className="text-sm font-medium">界面语言</span><p className="mt-1 text-sm">简体中文</p><p className="mt-1 text-xs text-muted-foreground">当前版本仅提供简体中文。</p></div>
        </SettingsSection>
        </EntityTabPanel>

        <EntityTabPanel tabId="personalization-background" activeTab={activeSection} scope="personalization">
        <SettingsSection id="personalization-background" title="工作台背景" description="背景效果与图片只影响当前设备。">
          <ChoiceCards label="背景效果" value={draft.backgroundStyle} onChange={(value) => update('backgroundStyle', value as UiPreferences['backgroundStyle'])} columns={2} options={[["plain", "纯净", "单色背景"], ["soft", "柔和层次", "轻微色彩层次"]]} />
          <div className="mt-5 max-w-lg">{desktop ? <AssetPicker label="背景图片（可选）" slot="background" preview={backgroundPreview} pendingRemoval={removeBackground} error={errors.background} onChoose={chooseFile} onRemove={() => removeAsset('background')} onUndo={() => undoRemove('background')} /> : <DesktopAssetNote label="背景图片（可选）" />}</div>
          {backgroundPreview && !removeBackground && <div className="mt-5 grid gap-5 sm:grid-cols-2"><SelectField label="图片显示方式" value={draft.backgroundFit} onChange={(value) => update('backgroundFit', value as UiPreferences['backgroundFit'])} options={[["cover", "铺满裁切"], ["contain", "完整显示"]]} /><label className="text-sm font-medium">背景遮罩：{draft.backgroundDim}%<input className="mt-4 w-full" type="range" min="0" max="80" step="5" value={draft.backgroundDim} onChange={(event) => update('backgroundDim', Number(event.target.value))} /><span className="mt-1 flex justify-between text-xs font-normal text-muted-foreground"><span>弱</span><span>强</span></span></label></div>}
        </SettingsSection>
        </EntityTabPanel>

        <section className="rounded-xl border border-dashed border-border p-5"><b className="text-sm">恢复默认外观</b><p className="mt-1 text-sm text-muted-foreground">先将当前草稿恢复为初始设置，保存后才会生效。</p><Button className="mt-4" variant="outline" disabled={saving} onClick={() => setRestoreDefaultsOpen(true)}>恢复默认…</Button></section>
        {errors.general && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">保存失败：{errors.general}。请检查后重试。</p>}
        {dirty && <div data-testid="personalization-actions" role="status" aria-live="polite" className="sticky bottom-4 z-10 mt-5 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur max-[959px]:static max-[959px]:flex-col max-[959px]:items-stretch"><p className="text-sm text-muted-foreground">{saving ? '正在保存…' : '有未保存的更改 · 仅当前设备'}</p><div className="flex gap-2 max-[959px]:grid max-[959px]:grid-cols-2"><Button className="max-[959px]:w-full" variant="outline" disabled={saving} onClick={reset}>取消</Button><Button className="max-[959px]:w-full" disabled={!canSave} onClick={() => void save()}>{saving ? '保存中…' : '保存更改'}</Button></div></div>}
      </div>

    <AppDialog open={restoreDefaultsOpen} onOpenChange={setRestoreDefaultsOpen} title="恢复默认外观？" description="当前草稿将恢复为初始设置，仍需保存后才会应用。" size="sm" footer={<><Button variant="outline" onClick={() => setRestoreDefaultsOpen(false)}>保留当前设置</Button><Button onClick={restoreDefaults}>恢复默认</Button></>}><p className="text-sm text-muted-foreground">已保存的工作台标识和背景会标记为待移除；不会影响 Bandi 正式品牌、Agent、版本历史或备份。</p></AppDialog>
    {unsavedDialog}
  </div>
}

function SettingsSection({ id, title, description, children }: { id: SectionId; title: string; description: string; children: ReactNode }) {
  return <section id={id} className="panel scroll-mt-32 p-5 xl:scroll-mt-20"><h3 className="text-base font-semibold">{title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p><div className="mt-5">{children}</div></section>
}

function ChoiceCards({ label, value, options, columns, onChange }: { label: string; value: string; options: readonly (readonly [string, string, string])[]; columns: 2 | 3; onChange: (value: string) => void }) {
  return <fieldset><legend className="text-sm font-medium">{label}</legend><div className={`mt-2 grid grid-cols-1 gap-2 ${columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>{options.map(([id, title, description]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={`min-h-20 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'}`}><span className="flex items-center justify-between gap-2 text-sm font-medium">{title}{value === id && <Check size={15} aria-hidden="true" />}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></button>)}</div></fieldset>
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (value: string) => void }) {
  return <label className="block text-sm font-medium">{label}<select className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
}

function DesktopAssetNote({ label }: { label: string }) {
  return <div className="rounded-lg border border-border bg-muted/45 p-4"><span className="text-sm font-medium">{label}</span><p className="mt-1 text-xs leading-5 text-muted-foreground">图片选择和预览仅在 Bandi Desktop 中可用。</p></div>
}

function AssetPicker({ label, slot, preview, pendingRemoval, error, onChoose, onRemove, onUndo }: { label: string; slot: UiAssetSlot; preview?: string; pendingRemoval: boolean; error?: string; onChoose: (slot: UiAssetSlot, file?: File) => void; onRemove: () => void; onUndo: () => void }) {
  const errorId = `${slot}-asset-error`
  return <div><span className="text-sm font-medium">{label}</span><div className="mt-2 grid min-h-32 place-items-center overflow-hidden rounded-xl border bg-muted">{pendingRemoval ? <div className="p-5 text-center"><Trash2 size={24} className="mx-auto text-muted-foreground" aria-hidden="true" /><p className="mt-2 text-sm font-medium">保存后移除</p><Button className="mt-3" type="button" variant="outline" size="sm" onClick={onUndo}><Undo2 size={14} aria-hidden="true" />撤销移除</Button></div> : preview ? <img src={preview} alt={`${label}预览`} className={`max-h-52 w-full ${slot === 'logo' ? 'object-contain p-5' : 'object-cover'}`} /> : <Image size={28} className="text-muted-foreground" aria-hidden="true" />}</div><div className="mt-2 flex flex-wrap gap-2"><label className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><Upload size={15} aria-hidden="true" />{preview ? '替换图片' : '选择图片'}<input type="file" className="sr-only" accept="image/png,image/jpeg" aria-describedby={error ? errorId : undefined} onChange={(event) => { onChoose(slot, event.target.files?.[0]); event.currentTarget.value = '' }} /></label>{preview && !pendingRemoval && <Button type="button" variant="outline" aria-label={`移除${label}`} onClick={onRemove}><Trash2 size={15} aria-hidden="true" />移除</Button>}</div>{error && <p id={errorId} role="alert" className="mt-2 text-xs leading-5 text-danger">{error}</p>}</div>
}
