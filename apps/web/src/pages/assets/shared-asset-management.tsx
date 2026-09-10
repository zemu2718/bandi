import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { EmptyState, FieldRow, MonoPath, PageHeader, StatusBadge } from '../../components/app/page'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { useApp } from '../../state'
import type { ConfigSide, Diagnostic, ManageableSharedAssetKind, SharedAssetEditorDto, SharedAssetImportPreviewDto, SharedAssetMutationResult } from '../../contracts'
import { commitSharedAssetImport, createSharedAsset, loadSharedAssetEditor, recoverSharedAssetRevision, repairSharedAssetRegistration, saveSharedAsset, selectSharedAssetImport } from '../../desktop-bridge'
import { assetKindLabel } from '../../presentation'

const kindOptions: { value: ManageableSharedAssetKind; label: string }[] = [
  { value: 'skill', label: 'Skill' }, { value: 'rule', label: 'Rule' }, { value: 'mcp', label: 'MCP' }, { value: 'sop', label: 'SOP' },
]

function diagnosticText(items?: Diagnostic[]): string {
  return items?.map((item) => item.message).join('；') || '操作未完成，请重新扫描后重试。'
}

function pendingResult(result: SharedAssetMutationResult): { message: string; registrationPending: boolean; recoveryRef?: string } | undefined {
  if (result.kind === 'registration_pending') return { message: diagnosticText(result.diagnostics), registrationPending: true }
  if (result.kind === 'revision_pending') return { message: diagnosticText(result.diagnostics), registrationPending: false, recoveryRef: result.recoveryRef }
}

export function CreateSharedAssetDialog({ open, onOpenChange, teamId, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; teamId: string; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<ManageableSharedAssetKind>('skill')
  const [name, setName] = useState('')
  const [assetId, setAssetId] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [repairAssetId, setRepairAssetId] = useState('')
  const [revisionRecovery, setRevisionRecovery] = useState<{ assetId: string; recoveryRef: string }>()
  const submit = async () => {
    if (!name.trim() || !assetId.trim() || !content.trim()) { setError('请填写名称、稳定标识和正文。'); return }
    setBusy(true); setError('')
    try {
      const result = await createSharedAsset({ requestId: crypto.randomUUID(), teamId, assetId: assetId.trim(), name: name.trim(), kind, content })
      if (result.kind === 'saved') { onOpenChange(false); await onSaved(); return }
      const pending = pendingResult(result)
      setRepairAssetId(pending?.registrationPending ? result.asset.id : '')
      setRevisionRecovery(pending?.recoveryRef ? { assetId: result.asset.id, recoveryRef: pending.recoveryRef } : undefined)
      setError(pending?.message ?? '操作未完成，请重新扫描后重试。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }
  const repair = async () => { setBusy(true); try { await repairSharedAssetRegistration({ requestId: crypto.randomUUID(), assetId: repairAssetId }); onOpenChange(false); await onSaved() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const recover = async () => { if (!revisionRecovery) return; setBusy(true); try { const result = await recoverSharedAssetRevision({ requestId: crypto.randomUUID(), ...revisionRecovery }); if (result.kind === 'saved') { onOpenChange(false); await onSaved() } else setError(pendingResult(result)?.message ?? '版本仍未补记，请重试。') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  return <AppDialog open={open} onOpenChange={onOpenChange} title="新增共享资产" description="创建 Bandi 受管资产，之后由 Agent 通过稳定标识引用。" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>{repairAssetId && <Button variant="outline" disabled={busy} onClick={repair}>修复资产登记</Button>}{revisionRecovery && <Button variant="outline" disabled={busy} onClick={recover}>补记资产版本</Button>}<Button disabled={busy || Boolean(repairAssetId || revisionRecovery)} onClick={submit}>{busy ? '正在处理…' : '创建资产'}</Button></>}>
    <div className="grid gap-4"><label className="text-sm font-medium">类型<select className="mt-2 h-10 w-full px-3" value={kind} onChange={(event) => setKind(event.target.value as ManageableSharedAssetKind)}>{kindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="text-sm font-medium">名称<input className="mt-2 h-10 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="text-sm font-medium">稳定标识<input aria-describedby={error ? 'create-shared-error' : undefined} className="mt-2 h-10 w-full px-3 font-mono" value={assetId} onChange={(event) => setAssetId(event.target.value)} placeholder="skill-code-review" /></label><label className="text-sm font-medium">正文<textarea className="mt-2 min-h-52 w-full p-3 font-mono text-sm" value={content} onChange={(event) => setContent(event.target.value)} /></label>{error && <p id="create-shared-error" role="alert" className="text-sm text-danger">{error}</p>}</div>
  </AppDialog>
}

export function ImportSharedAssetDialog({ open, onOpenChange, teamId, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; teamId: string; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<ManageableSharedAssetKind>('skill')
  const [preview, setPreview] = useState<SharedAssetImportPreviewDto>()
  const [name, setName] = useState('')
  const [assetId, setAssetId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [repairAssetId, setRepairAssetId] = useState('')
  const [revisionRecovery, setRevisionRecovery] = useState<{ assetId: string; recoveryRef: string }>()
  const select = async () => { setBusy(true); setError(''); try { const next = await selectSharedAssetImport(crypto.randomUUID(), teamId, kind); if (next) { setPreview(next); setName(next.suggestedName); setAssetId(next.suggestedId) } } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const commit = async () => { if (!preview) return; setBusy(true); setError(''); try { const result = await commitSharedAssetImport({ requestId: crypto.randomUUID(), previewRef: preview.previewRef, expectedSourceHash: preview.sourceHash, teamId, assetId: assetId.trim(), name: name.trim(), confirmed: true }); if (result.kind === 'saved') { onOpenChange(false); await onSaved(); return } const pending = pendingResult(result); setRepairAssetId(pending?.registrationPending ? result.asset.id : ''); setRevisionRecovery(pending?.recoveryRef ? { assetId: result.asset.id, recoveryRef: pending.recoveryRef } : undefined); setError(pending?.message ?? '操作未完成，请重新扫描后重试。') } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setError(message.includes('SHARED_ASSET_SOURCE_CHANGED') ? '来源文件已变化，请重新选择并预览。' : message) } finally { setBusy(false) } }
  const repair = async () => { setBusy(true); try { await repairSharedAssetRegistration({ requestId: crypto.randomUUID(), assetId: repairAssetId }); onOpenChange(false); await onSaved() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const recover = async () => { if (!revisionRecovery) return; setBusy(true); try { const result = await recoverSharedAssetRevision({ requestId: crypto.randomUUID(), ...revisionRecovery }); if (result.kind === 'saved') { onOpenChange(false); await onSaved() } else setError(pendingResult(result)?.message ?? '版本仍未补记，请重试。') } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  return <AppDialog open={open} onOpenChange={onOpenChange} title="导入共享资产" description="系统选择器只授权本次文件；Bandi 保存受管副本，不保留原始路径。" footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>{repairAssetId && <Button variant="outline" disabled={busy} onClick={repair}>修复资产登记</Button>}{revisionRecovery && <Button variant="outline" disabled={busy} onClick={recover}>补记资产版本</Button>}{preview && <Button disabled={busy || !name.trim() || !assetId.trim() || Boolean(repairAssetId || revisionRecovery)} onClick={commit}>确认导入</Button>}</>}><div className="grid gap-4"><label className="text-sm font-medium">资产类型<select disabled={Boolean(preview)} className="mt-2 h-10 w-full px-3" value={kind} onChange={(event) => setKind(event.target.value as ManageableSharedAssetKind)}>{kindOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{!preview ? <Button variant="outline" disabled={busy} onClick={select}>{busy ? '正在打开…' : '选择本机文件'}</Button> : <><FieldRow label="来源文件">{preview.fileName}</FieldRow><FieldRow label="大小">{preview.size} 字节</FieldRow><label className="text-sm font-medium">名称<input className="mt-2 h-10 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} /></label><label className="text-sm font-medium">稳定标识<input className="mt-2 h-10 w-full px-3 font-mono" value={assetId} onChange={(event) => setAssetId(event.target.value)} /></label></>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}</div></AppDialog>
}

export function SharedAssetDetail({ assetId }: { assetId: string }) {
  const { state } = useApp(); const navigate = useNavigate()
  const node = state.sharedAssets.find((item) => item.id === assetId)
  const [editor, setEditor] = useState<SharedAssetEditorDto>(); const [content, setContent] = useState(''); const [editing, setEditing] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [challenge, setChallenge] = useState<{ ref: string; agents: string[] }>(); const [conflict, setConflict] = useState<{ base: ConfigSide; current: ConfigSide; proposed: ConfigSide }>(); const [recoveryRef, setRecoveryRef] = useState<string>()
  const refs = state.assetReferences.filter((item) => item.targetAssetId === assetId && item.targetTeamId === node?.teamId)
  const agents = [...new Set(refs.map((item) => item.referrerId))]
  const load = async () => { setBusy(true); setError(''); try { const loaded = await loadSharedAssetEditor(crypto.randomUUID(), assetId); setEditor(loaded); setContent(loaded.canonicalContent); setEditing(true) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const save = async (confirmationRef?: string) => { if (!editor) return; setBusy(true); setError(''); try { const result = await saveSharedAsset({ requestId: crypto.randomUUID(), assetId, expectedBaseline: editor.baselineRef, baseContent: editor.canonicalContent, proposedContent: content, confirmationRef }); if (result.kind === 'saved' || result.kind === 'unchanged') { setEditing(false); setChallenge(undefined); navigate('/assets') } else if (result.kind === 'confirmation_required') setChallenge({ ref: result.challenge.id, agents: result.affectedAgentIds ?? agents }); else if (result.kind === 'baseline_changed') { setConflict({ base: result.base, current: result.current, proposed: result.proposed }); setError('资产已在外部变化，Bandi 未覆盖文件。请比较三方内容后重新打开编辑器。') } else { if (result.kind === 'save_failed' && result.recoveryRef) setRecoveryRef(result.recoveryRef); setError(diagnosticText(result.diagnostics)) } } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const recover = async () => { if (!recoveryRef) return; setBusy(true); setError(''); try { const result = await recoverSharedAssetRevision({ requestId: crypto.randomUUID(), assetId, recoveryRef }); if (result.kind === 'saved') navigate('/assets'); else { const pending = pendingResult(result); setError(pending?.message ?? '版本仍未补记，请重试。') } } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const dirty = editing && editor ? content !== editor.canonicalContent : false
  const unsaved = useUnsavedChangesGuard({ dirty, resetDraft: () => { setContent(editor?.canonicalContent ?? ''); setEditing(false) } })
  if (!node) return <EmptyState title="找不到共享资产" description="资产可能已变化，请返回资产池重新扫描。" action={<Button asChild><Link to="/assets">返回资产池</Link></Button>} />
  return <><PageHeader title={node.name} description={`${assetKindLabel(node.kind)} · 独立共享资产`} action={node.writable && <Button disabled={busy} onClick={editing ? () => save() : load}>{editing ? '保存更新' : '编辑资产'}</Button>} /><div className="grid gap-5 lg:grid-cols-[1fr_320px]"><section className="panel p-5">{editing ? <label className="text-sm font-medium">资产正文<textarea className="mt-2 min-h-96 w-full p-4 font-mono text-sm" value={content} onChange={(event) => setContent(event.target.value)} /></label> : <><FieldRow label="稳定标识"><MonoPath>{node.id}</MonoPath></FieldRow><FieldRow label="受管位置"><MonoPath>{node.locator.relativePath ?? node.locator.displayPath}</MonoPath></FieldRow><FieldRow label="状态"><StatusBadge tone={node.parseStatus === 'parsed' ? 'success' : 'danger'}>{node.parseStatus === 'parsed' ? '可用' : '需处理'}</StatusBadge></FieldRow></>}{error && <div role="alert" className="mt-4 text-sm text-danger">{error}{recoveryRef && <div className="mt-2"><Button variant="outline" onClick={recover}>补记资产版本</Button></div>}</div>}{conflict && <div className="mt-5 grid gap-3 lg:grid-cols-3"><ConflictSide title="编辑起点" side={conflict.base} /><ConflictSide title="当前文件" side={conflict.current} /><ConflictSide title="本次修改" side={conflict.proposed} /></div>}</section><aside className="panel p-5"><b>使用它的 Agent</b><div className="mt-3 space-y-2">{agents.map((id) => <Link key={id} className="block rounded-lg border border-border p-3 hover:bg-muted" to={`/agents/${id}?tab=${node.kind === 'rule' ? 'rules' : node.kind === 'skill' ? 'skills' : node.kind}`}>{state.agents.find((item) => item.id === id)?.name ?? id}</Link>)}{!agents.length && <p className="text-sm text-muted-foreground">暂无 Agent 引用。</p>}</div></aside></div><AppDialog open={Boolean(challenge)} onOpenChange={(open) => { if (!open) setChallenge(undefined) }} title="确认共享影响" description="保存会更新所有引用此资产的 Agent 所读取的共享正文。" footer={<><Button variant="outline" onClick={() => setChallenge(undefined)}>返回编辑</Button><Button disabled={busy} onClick={() => save(challenge?.ref)}>确认并保存</Button></>}><p className="text-sm">受影响 Agent：{challenge?.agents.map((id) => state.agents.find((item) => item.id === id)?.name ?? id).join('、') || '无'}</p></AppDialog>{unsaved}</>
}

function ConflictSide({ title, side }: { title: string; side: ConfigSide }) {
  return <section className="min-w-0 rounded-lg border border-border p-3"><b className="text-xs">{title}</b><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{side.redacted ? '内容已隐藏' : side.content}</pre></section>
}
