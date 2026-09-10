import { useRef, useState, type Ref } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { MockBoundaryNote } from '../../components/app/page'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { agentFunctionLabels, type AgentFunction } from '../../domain'
import { useApp } from '../../state'
import { useUnsavedChangesGuard } from '../../hooks/use-unsaved-changes-guard'
import { AgentAvatarPicker } from '../../components/agents/agent-avatar-picker'
import { allocateAgentId, commitManagedAgentCreation, importClaudeAgent, isDesktopRuntime, previewClaudeAgent, selectClaudeAgentFile } from '../../desktop-bridge'
import type { ClaudeAgentPreviewDto } from '../../contracts'
import { normalizeAgentName, validateAgentName } from '../../agent-config-model'
import { AgentImportPanel } from './agent-import-panel'
import { agentTemplates, createAgentFromTemplate, createAgentPackageFiles } from './agent-creation'

type PersonalAgentCreateDialogProps = {
  open: boolean
  onClose: () => void
}

export function AgentCreatePage({ open = true, onClose }: Partial<PersonalAgentCreateDialogProps> = {}) {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const importMode = params.get('mode') === 'import'
  const [externalPath, setExternalPath] = useState('')
  const [selectingDirectory, setSelectingDirectory] = useState(false)
  const [importPreview, setImportPreview] = useState<ClaudeAgentPreviewDto>()
  const [requestId] = useState(() => `${importMode ? 'import' : 'create'}-agent-${crypto.randomUUID()}`)
  const [generatedId, setGeneratedId] = useState(() => isDesktopRuntime() ? '' : `agent-${crypto.randomUUID()}`)
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const teamId = state.currentTeamId ?? 'team-personal'
  const [functionId, setFunctionId] = useState<AgentFunction | ''>('')
  const [mission, setMission] = useState('')
  const [rolePrompt, setRolePrompt] = useState('')
  const [workingConstraints, setWorkingConstraints] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [avatar, setAvatar] = useState<File>()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<UserFacingError>()
  const [pendingTemplateId, setPendingTemplateId] = useState<string>()
  const [discardOpen, setDiscardOpen] = useState(false)
  const allowNavigation = useRef(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const desktop = isDesktopRuntime()
  const dirty = !committed && Boolean(name || functionId || mission || rolePrompt || workingConstraints || externalPath || avatar)
  const id = generatedId
  const teamValid = state.teams.length === 0 || Boolean(state.teams.some((team) => team.id === teamId))
  const normalizedName = normalizeAgentName(name)
  const nameError = validateAgentName(name)
  const duplicateName = Boolean(normalizedName) && state.agents.some((item) => normalizeAgentName(item.name).toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
  const duplicateId = Boolean(id) && state.agents.some((item) => item.id === id)
  const duplicate = duplicateName || duplicateId
  const visibleNameError = (submitted || nameTouched) ? nameError ?? (duplicateName ? '已有同名 Agent，请使用其他名称。' : undefined) : undefined
  const identityValid = Boolean(!nameError && teamValid && (!importMode || importPreview) && !duplicate)
  const unsavedChangesDialog = useUnsavedChangesGuard({
    dirty,
    resetDraft: () => setCommitted(true),
    shouldBlock: () => dirty && !allowNavigation.current,
  })

  const applyTemplate = (nextTemplateId: string) => {
    const template = agentTemplates.find((item) => item.id === nextTemplateId) ?? agentTemplates[0]
    setTemplateId(template.id)
    setFunctionId(template.functionId ?? '')
    setMission(template.mission)
    setRolePrompt(template.rolePrompt)
    setWorkingConstraints(template.workingConstraints)
    setPendingTemplateId(undefined)
  }
  const selectTemplate = (nextTemplateId: string) => {
    if (nextTemplateId === templateId) return
    const current = agentTemplates.find((item) => item.id === templateId) ?? agentTemplates[0]
    const templateFieldsChanged = mission !== current.mission || rolePrompt !== current.rolePrompt || workingConstraints !== current.workingConstraints
    if (templateFieldsChanged) setPendingTemplateId(nextTemplateId)
    else applyTemplate(nextTemplateId)
  }
  const closePersonalDialog = () => {
    if (saving) return
    if (dirty) {
      setDiscardOpen(true)
      return
    }
    if (onClose) onClose()
    else navigate('/agents', { replace: true })
  }
  const discardAndClose = () => {
    allowNavigation.current = true
    setCommitted(true)
    setDiscardOpen(false)
    if (onClose) onClose()
    else navigate('/agents', { replace: true })
  }

  const chooseImportFile = async () => {
    if (selectingDirectory) return
    setSelectingDirectory(true)
    setSaveError(undefined)
    try {
      const selected = await selectClaudeAgentFile()
      if (!selected) return
      const preview = await previewClaudeAgent(selected)
      setExternalPath(preview.sourcePath)
      setImportPreview(preview)
      setName(preview.name)
      setMission(preview.description ?? '')
    } catch (error) {
      setImportPreview(undefined)
      setSaveError(errorFromCause(
        error,
        '无法预览 Claude Agent',
        '没有导入任何内容。请检查所选文件后重试。',
      ))
    } finally {
      setSelectingDirectory(false)
    }
  }
  const focusFirstInvalidField = () => {
    if (nameError || duplicate) nameInputRef.current?.focus()
  }
  const submit = async () => {
    setSubmitted(true)
    setNameTouched(true)
    setSaveError(undefined)
    if (!identityValid || saving) {
      focusFirstInvalidField()
      return
    }
    let agentId = id
    if (desktop && !agentId) {
      try {
        agentId = await allocateAgentId(requestId)
        setGeneratedId(agentId)
      } catch (error) {
        setSaveError(errorFromCause(error, '无法创建 Agent', '系统无法分配 Agent ID。你的输入仍保留，请重试创建。'))
        return
      }
    }
    const effectiveMission = mission.trim() || (importMode ? '从已有 Agent 配置建立的长期受管记录。' : '')
    const blankTemplate = agentTemplates[0]
    const agent = {
      ...createAgentFromTemplate(
        agentId,
        teamId || 'team-personal',
        { ...blankTemplate, functionId: functionId || undefined, mission: effectiveMission, rolePrompt: rolePrompt.trim(), workingConstraints: workingConstraints.trim() },
        normalizedName,
        desktop,
      ),
      packageSource: importMode && importPreview
        ? { kind: 'managed-agent-import' as const, packageId: `agt_${agentId}`, strategy: 'managed-copy' as const, toolId: importPreview.toolId, sourceFileName: importPreview.sourceFileName, sourceBaselineHash: importPreview.sourceBaselineHash, importedAt: new Date().toISOString() }
        : createAgentFromTemplate(agentId, teamId || 'team-personal', blankTemplate, normalizedName, desktop).packageSource,
      avatarPath: avatar ? 'avatar.png' as const : undefined,
      instructions: importPreview?.instructions
        ?? [rolePrompt.trim(), workingConstraints.trim()].filter(Boolean).join('\n\n'),
    }
    setSaving(true)
    try {
      if (desktop) {
        const files = createAgentPackageFiles(agent)
        const result = importMode && importPreview
          ? await importClaudeAgent(importPreview.sourcePath, importPreview.sourceBaselineHash, requestId, agent, files)
          : await commitManagedAgentCreation(requestId, agent, files, avatar, teamId || undefined)
        dispatch({ type: 'SYNC_AGENT_RECOVERY', operation: result.operation, agent: result.agent })
        if (result.operation.status !== 'completed' || !result.agent) {
          throw new Error(result.operation.status === 'blocked'
            ? 'Agent 配置已在外部发生变化，Bandi 没有覆盖当前文件；请从配置状态中的待处理项查看。'
            : 'Agent 配置尚未完整保存，可从配置状态中的待处理项继续修复。')
        }
        dispatch({
          type: 'UPSERT_MANAGED_AGENT',
          agent: result.agent,
          message: '受管 Agent 配置已创建',
        })
      } else {
        dispatch({ type: 'CREATE_AGENT', agent })
      }
      dispatch({
        type: 'SHOW_NOTICE',
        notice: importMode
          ? desktop
            ? { tone: 'success', title: 'Agent 已导入', description: '已创建 Bandi 受管副本，原文件保持不变。' }
            : { tone: 'success', title: 'Agent 已导入', description: '已添加到当前演示；未写入本机配置。' }
          : desktop
            ? { tone: 'success', title: 'Agent 已创建', description: '长期配置已保存；任务使用与执行仍在你选择的外部 AI 编程工具中完成。' }
            : { tone: 'success', title: 'Agent 已创建', description: '已添加到当前演示；未写入本机配置。' },
      })
      allowNavigation.current = true
      setCommitted(true)
      navigate(`/agents/${agentId}`, { replace: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.startsWith('INVALID_AGENT_ID')) {
        setSaveError(errorFromCause(
          error,
          '无法创建 Agent',
          '系统生成的内部 ID 不可用。你的输入仍保留，请重试创建。',
        ))
      } else {
        setSaveError(errorFromCause(
          error,
          importMode ? '无法导入 Agent' : '无法创建 Agent',
          '你的输入仍保留。请检查本地服务后重试；若首页出现待处理项，请先从那里继续修复。',
        ))
      }
    } finally {
      setSaving(false)
    }
  }

  const personalDialog = <AppDialog
    open={open}
    onOpenChange={(nextOpen) => { if (!nextOpen) closePersonalDialog() }}
    title="新建 Agent"
    description="选择模板快速定义一个长期 Agent，所有预填内容都可以修改。"
    size="lg"
    footer={<>
      <Button type="button" variant="outline" disabled={saving} onClick={closePersonalDialog}>取消</Button>
      <Button type="submit" form="personal-agent-create-form" disabled={saving || !teamValid} aria-busy={saving}>{saving ? '正在创建…' : '创建 Agent'}</Button>
    </>}
  >
    <form id="personal-agent-create-form" className="space-y-6" onSubmit={(event) => { event.preventDefault(); void submit() }}>
      <fieldset>
        <legend className="text-sm font-semibold">套用模板</legend>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">一键预填描述、角色定位和工作方法；名称仍需自行填写。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {agentTemplates.map((template) => <button key={template.id || 'blank'} type="button" aria-pressed={templateId === template.id} onClick={() => selectTemplate(template.id)} className={`min-h-11 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${templateId === template.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{template.name}</button>)}
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{agentTemplates.find((template) => template.id === templateId)?.description}</p>
      </fieldset>
      <TextField ref={nameInputRef} label="Agent 名称" value={name} onChange={setName} onBlur={() => setNameTouched(true)} error={visibleNameError} help="用于列表、组织关系和外部 AI 编程工具中识别这个 Agent。" />
      <label className="block text-sm font-medium" htmlFor="agent-function">职能（可选）<select id="agent-function" className="mt-2 h-10 w-full px-3" value={functionId} onChange={(event) => setFunctionId(event.target.value as AgentFunction | '')}><option value="">未分类</option>{Object.entries(agentFunctionLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">用于在当前 Team 中分类和查找 Agent。</span></label>
      <TextField label="一句话描述（可选）" value={mission} onChange={setMission} help="概括这个 Agent 是做什么的，将保存为长期使命摘要。" />
      <TextArea label="角色定位（可选）" value={rolePrompt} onChange={setRolePrompt} help="说明它是谁、负责什么，以及应如何回应。" />
      <TextArea label="工作方法与约束（可选）" value={workingConstraints} onChange={setWorkingConstraints} help="将写入主指令；不会创建 Rules 资产，也不会增加权限。" />
      <details className="rounded-lg border border-border">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">更多设置（头像与 Team）</summary>
        <div className="space-y-5 border-t border-border p-4">
          <AgentAvatarPicker name={name} file={avatar} onChange={setAvatar} disabled={!desktop} help={desktop ? undefined : '头像上传仅在 Bandi Desktop 中可用；Web 演示使用名称首字符。'} />
          <div className="rounded-lg bg-muted/60 p-3 text-sm"><b>所属 Team</b><p className="mt-1 text-muted-foreground">{state.teams.find((item) => item.id === teamId)?.name ?? '当前 Team 不可用'}</p></div>
          {!teamValid && <p role="alert" className="text-sm text-danger">当前没有可用 Team，暂时无法创建 Agent。</p>}
        </div>
      </details>
      <MockBoundaryNote>{desktop ? '创建后可在 Agent 详情中继续完善权限、配置引用和长期记忆；任务使用与执行仍在你选择的外部 AI 编程工具中完成。' : '当前仅创建页面演示记录，不会写入本机配置。'}</MockBoundaryNote>
      {saveError && <ErrorNotice error={saveError} />}
    </form>
  </AppDialog>

  const importDialog = <AppDialog
    open={open}
    onOpenChange={(nextOpen) => { if (!nextOpen) closePersonalDialog() }}
    title="导入 Agent"
    description="从已有 Agent 文件创建 Bandi 受管副本，原文件不会被修改。"
    size="lg"
    footer={<>
      <Button type="button" variant="outline" disabled={saving} onClick={closePersonalDialog}>取消</Button>
      {importPreview && <Button type="button" disabled={saving || !teamValid} aria-busy={saving} onClick={() => void submit()}>{saving ? '正在导入…' : '导入 Agent'}</Button>}
    </>}
  >
    <div className="space-y-5">
      <AgentImportPanel desktop={desktop} preview={importPreview} selecting={selectingDirectory} saving={saving} onSelect={() => void chooseImportFile()} />
      {submitted && !importPreview && <p role="alert" className="text-xs text-danger">请选择并成功预览一个 Agent 文件。</p>}
      {importPreview && <>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/35 p-4 text-sm">
          <div className="min-w-0"><b className="block truncate">{importPreview.sourceFileName}</b><span className="text-xs text-muted-foreground">文件已读取，可在导入前确认内容。</span></div>
          <Button type="button" variant="outline" size="sm" disabled={selectingDirectory || saving} onClick={() => void chooseImportFile()}>重新选择</Button>
        </div>
        <TextField ref={nameInputRef} label="Agent 名称" value={name} onChange={setName} onBlur={() => setNameTouched(true)} error={visibleNameError ?? (submitted && duplicateId ? '系统生成的 Agent ID 已存在，请重试。' : undefined)} help="可在导入前修改；用于在 Bandi 和 AI 编程工具中识别这个 Agent。" />
        <section className="rounded-lg border border-border p-4" aria-labelledby="import-description-title">
          <h3 id="import-description-title" className="text-sm font-semibold">描述</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{importPreview.description || '来源文件未提供描述。'}</p>
        </section>
        <section className="rounded-lg border border-border p-4" aria-labelledby="import-instructions-title">
          <h3 id="import-instructions-title" className="text-sm font-semibold">Instructions</h3>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{importPreview.instructions}</pre>
        </section>
        <div className="rounded-lg bg-muted/60 p-4 text-sm">
          <b>将添加到当前 Team：{state.teams.find((item) => item.id === teamId)?.name ?? '个人 Team'}</b>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">长期配置和权限可在导入后按需设置；初始不授予文件、命令或网络权限。</p>
        </div>
        <MockBoundaryNote>只复制名称、描述和 Instructions；不导入 Memory、Skills、Rules、MCP 或权限。</MockBoundaryNote>
        {importPreview.ignoredFields.length > 0 && <details className="rounded-lg border border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{importPreview.ignoredFields.length} 个来源字段不会导入</summary><p className="mt-2 break-words font-mono [overflow-wrap:anywhere]">{importPreview.ignoredFields.join('、')}</p></details>}
      </>}
      {saveError && <ErrorNotice error={saveError} />}
    </div>
  </AppDialog>

  return <>
    {importMode ? importDialog : personalDialog}
    <AppDialog open={pendingTemplateId !== undefined} onOpenChange={(nextOpen) => { if (!nextOpen) setPendingTemplateId(undefined) }} title="替换当前模板内容？" description="将覆盖职能、一句话描述、角色定位和工作方法；名称、头像及 Team 不受影响。" size="sm" footer={<><Button variant="outline" onClick={() => setPendingTemplateId(undefined)}>继续编辑</Button><Button onClick={() => applyTemplate(pendingTemplateId ?? '')}>替换内容</Button></>}><p className="text-sm text-muted-foreground">你对当前模板内容的修改会被新模板预设替换。</p></AppDialog>
    <AppDialog open={discardOpen} onOpenChange={setDiscardOpen} title="放弃未保存内容？" description="关闭后会丢弃当前 Agent 的创建内容。" size="sm" footer={<><Button variant="outline" onClick={() => setDiscardOpen(false)}>继续编辑</Button><Button variant="danger" onClick={discardAndClose}>放弃并关闭</Button></>}><p className="text-sm text-muted-foreground">当前内容尚未写入任何文件。</p></AppDialog>
    {unsavedChangesDialog}
  </>
}

export function PersonalAgentCreateDialog(props: PersonalAgentCreateDialogProps) {
  return <AgentCreatePage {...props} />
}

function TextField({ ref, label, value, onChange, onBlur, error, help }: { ref?: Ref<HTMLInputElement>; label: string; value: string; onChange: (value: string) => void; onBlur?: () => void; error?: string; help?: string }) { const id = `field-${label}`; const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined; return <label htmlFor={id} className="block text-sm font-medium">{label}<input ref={ref} id={id} value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="mt-2 h-10 w-full px-3" />{help && <span id={`${id}-help`} className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{help}</span>}{error && <span id={`${id}-error`} className="mt-1 block text-xs text-danger">{error}</span>}</label> }
function TextArea({ label, value, onChange, error, help }: { label: string; value: string; onChange: (value: string) => void; error?: string; help?: string }) { const id = `field-${label}`; const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined; return <label htmlFor={id} className="block text-sm font-medium">{label}<textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} className="mt-2 min-h-28 w-full p-3" />{help && <span id={`${id}-help`} className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">{help}</span>}{error && <span id={`${id}-error`} className="mt-1 block text-xs text-danger">{error}</span>}</label> }
