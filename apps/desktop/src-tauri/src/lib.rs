use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

mod agent_service;
mod ai_adapters;
mod ai_tool_host;
mod backup_service;
mod claude_agent_import;
pub mod cli_service;
mod config_fs;
mod domain_store;
mod factory_reset;
mod host_integration;
mod host_integration_targets;
mod local_service;
mod memory_service;
mod memory_target;
mod shared_assets;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UiAsset {
    mime_type: &'static str,
    bytes: Vec<u8>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentPackageFile {
    path: String,
    content: String,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CreateManagedAgentRequest {
    agent_id: String,
    agent: serde_json::Value,
    files: Vec<AgentPackageFile>,
    avatar_bytes: Option<Vec<u8>>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentTeamReconcileRequest {
    team_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitManagedAgentCreationRequest {
    request_id: String,
    create: CreateManagedAgentRequest,
    team: Option<AgentTeamReconcileRequest>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitManagedAgentIdentityRequest {
    save: SaveManagedAgentIdentityRequest,
    team: Option<AgentTeamReconcileRequest>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportClaudeAgentRequest {
    source_path: String,
    expected_source_baseline_hash: String,
    confirmed: bool,
    commit: CommitManagedAgentCreationRequest,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportClaudeAgentPreviewResult {
    preview: claude_agent_import::ClaudeAgentPreviewDto,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContinueAgentRecoveryRequest {
    operation_id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentCommitResult {
    operation: agent_service::AgentRecoverySummaryDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    identity_result: Option<SaveManagedAgentIdentityResult>,
}

impl AgentCommitResult {
    fn new(
        operation: agent_service::AgentRecoveryOperation,
        agent: Option<serde_json::Value>,
    ) -> Self {
        Self {
            operation: (&operation).into(),
            agent,
            identity_result: None,
        }
    }

    fn identity(
        operation: agent_service::AgentRecoveryOperation,
        result: SaveManagedAgentIdentityResult,
    ) -> Self {
        Self {
            operation: (&operation).into(),
            agent: None,
            identity_result: Some(result),
        }
    }
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum AvatarChange {
    Keep,
    Replace { bytes: Vec<u8> },
    Remove,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveManagedAgentIdentityRequest {
    request_id: String,
    agent_id: String,
    agent: serde_json::Value,
    manifest: String,
    expected_baseline: local_service::BaselineRefDto,
    base_content: String,
    avatar: AvatarChange,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoverManagedAgentIdentityRequest {
    request_id: String,
    agent_id: String,
    asset_id: String,
    recovery_ref: String,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreManagedAgentIdentityRequest {
    request_id: String,
    agent_id: String,
    asset_id: String,
    revision_id: String,
    expected_baseline: local_service::BaselineRefDto,
    base_content: String,
    confirmed: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreviewManagedAgentDeletionRequest {
    request_id: String,
    agent_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommitManagedAgentDeletionRequest {
    request_id: String,
    agent_id: String,
    preview_ref: String,
    confirmation_text: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAgentDeletionPreviewDto {
    request_id: String,
    agent_id: String,
    preview_ref: String,
    confirmation_text: String,
    expires_at: String,
    package_fingerprint: String,
    impacts: serde_json::Value,
    can_commit: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAgentDeletionResultDto {
    request_id: String,
    agent_id: String,
    operation_id: String,
    created_at: String,
    status: String,
    deleted_config_revisions: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    safe_reason: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pending_cleanup: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAgentResult {
    agent: serde_json::Value,
    baseline_ref: local_service::BaselineRefDto,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ManagedAgentIdentityEditorResult {
    #[serde(rename = "assetId")]
    asset_id: String,
    #[serde(rename = "containerId")]
    container_id: String,
    locator: local_service::AssetLocatorDto,
    #[serde(rename = "canonicalContent")]
    canonical_content: String,
    #[serde(rename = "baselineRef")]
    baseline_ref: local_service::BaselineRefDto,
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SaveManagedAgentIdentityResult {
    Saved {
        #[serde(rename = "requestId")]
        request_id: String,
        agent: serde_json::Value,
        #[serde(rename = "baselineRef")]
        baseline_ref: local_service::BaselineRefDto,
        revision: Box<local_service::ConfigRevisionDto>,
        #[serde(rename = "writeReceipt")]
        write_receipt: local_service::WriteReceiptDto,
    },
    Unchanged {
        #[serde(rename = "requestId")]
        request_id: String,
        agent: serde_json::Value,
        #[serde(rename = "baselineRef")]
        baseline_ref: local_service::BaselineRefDto,
    },
    BaselineChanged {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "assetId")]
        asset_id: String,
        #[serde(rename = "containerId")]
        container_id: String,
        locator: local_service::AssetLocatorDto,
        base: local_service::ConfigSideDto,
        current: local_service::ConfigSideDto,
        proposed: local_service::ConfigSideDto,
        diagnostics: Vec<local_service::DiagnosticDto>,
    },
    ValidationFailed {
        #[serde(rename = "requestId")]
        request_id: String,
        diagnostics: Vec<local_service::DiagnosticDto>,
    },
    SaveFailed {
        #[serde(rename = "requestId")]
        request_id: String,
        diagnostics: Vec<local_service::DiagnosticDto>,
        retryable: bool,
        #[serde(rename = "fileState")]
        file_state: String,
        #[serde(rename = "recoveryRef", skip_serializing_if = "Option::is_none")]
        recovery_ref: Option<String>,
    },
}

#[cfg(test)]
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticDto {
    code: String,
    severity: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    range: Option<DiagnosticRangeDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    remediation: Option<String>,
}

#[cfg(test)]
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DiagnosticRangeDto {
    start_line: u32,
    start_column: u32,
    end_line: u32,
    end_column: u32,
}

#[cfg(test)]
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum LocalServiceEventDto {
    ConfigInvalidated {
        #[serde(rename = "eventId")]
        event_id: String,
        #[serde(rename = "occurredAt")]
        occurred_at: String,
        #[serde(rename = "assetIds")]
        asset_ids: Vec<String>,
        reason: String,
    },
}

fn validate_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn domain_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("bandi.db"))
        .map_err(|_| "无法访问本地领域数据库".into())
}

fn shared_assets_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("shared-assets"))
        .map_err(|_| "无法访问 Bandi 共享资产根".into())
}

#[tauri::command]
fn load_long_term_domain_snapshot_v4(
    app: tauri::AppHandle,
) -> Result<domain_store::LongTermDomainSnapshotDtoV4, String> {
    domain_store::load_long_term_domain_snapshot_v4_at(&domain_database_path(&app)?)
}

#[tauri::command]
fn save_team_v4(
    app: tauri::AppHandle,
    team: domain_store::TeamDtoV4,
) -> Result<domain_store::TeamDtoV4, String> {
    let _mutation = factory_reset::mutation_guard()?;
    domain_store::save_team_v4_at(&domain_database_path(&app)?, team)
}

#[tauri::command]
fn remove_team_v4(
    app: tauri::AppHandle,
    request: domain_store::RemoveTeamRequestV4,
) -> Result<(), String> {
    let _mutation = factory_reset::mutation_guard()?;
    domain_store::remove_team_v4_at(&domain_database_path(&app)?, request)
}

#[tauri::command]
fn save_task_brief_v4(
    app: tauri::AppHandle,
    task_brief: domain_store::TaskBriefDtoV4,
) -> Result<domain_store::TaskBriefDtoV4, String> {
    let _mutation = factory_reset::mutation_guard()?;
    domain_store::save_task_brief_v4_at(&domain_database_path(&app)?, task_brief)
}

#[tauri::command]
fn remove_task_brief_v4(
    app: tauri::AppHandle,
    request: domain_store::RemoveTaskBriefRequestV4,
) -> Result<(), String> {
    let _mutation = factory_reset::mutation_guard()?;
    domain_store::remove_task_brief_v4_at(&domain_database_path(&app)?, request)
}

#[tauri::command]
fn generate_entity_id(prefix: String, name: String) -> Result<String, String> {
    if !matches!(prefix.as_str(), "team" | "task") || name.trim().is_empty() {
        return Err("实体标识请求无效".into());
    }
    Ok(domain_store::stable_entity_id(&prefix, &name))
}

#[tauri::command]
fn allocate_agent_id(request_id: String) -> Result<String, String> {
    if !validate_identifier(&request_id) || request_id == "." || request_id == ".." {
        return Err("Agent 创建请求标识无效".into());
    }
    Ok(local_service::stable_id("agent", &request_id)[..30].to_string())
}

#[tauri::command]
fn discover_config(
    app: tauri::AppHandle,
    request: local_service::DiscoveryRequest,
) -> Result<local_service::DiscoveryResult, String> {
    let managed = managed_agent_dir(&app, "probe")?
        .parent()
        .ok_or_else(|| "AGENT_STORAGE_UNAVAILABLE: Agent 根目录无效".to_string())?
        .to_path_buf();
    let snapshot =
        domain_store::load_long_term_domain_snapshot_v4_at(&domain_database_path(&app)?)?;
    Ok(local_service::discover_with_shared_at(
        &managed,
        &shared_assets_root(&app)?,
        &snapshot,
        true,
        request,
    ))
}

#[tauri::command]
fn create_shared_asset(
    app: tauri::AppHandle,
    request: shared_assets::CreateSharedAssetRequest,
) -> Result<shared_assets::SharedAssetMutationResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    shared_assets::create_at(
        &domain_database_path(&app)?,
        &shared_assets_root(&app)?,
        &revisions_root(&app)?.join("shared-assets"),
        request,
        shared_assets::SharedAssetSourceDto::Authored,
    )
}

#[tauri::command]
fn select_shared_asset_import(
    app: tauri::AppHandle,
    request: shared_assets::SelectSharedAssetImportRequest,
) -> Result<Option<shared_assets::SharedAssetImportPreviewDto>, String> {
    let Some(selected) = app.dialog().file().blocking_pick_file() else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "SHARED_ASSET_SOURCE_INVALID: 选择结果不是本机文件".to_string())?;
    shared_assets::preview_import_at(path, request).map(Some)
}

#[tauri::command]
fn commit_shared_asset_import(
    app: tauri::AppHandle,
    request: shared_assets::CommitSharedAssetImportRequest,
) -> Result<shared_assets::SharedAssetMutationResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    shared_assets::commit_import_at(
        &domain_database_path(&app)?,
        &shared_assets_root(&app)?,
        &revisions_root(&app)?.join("shared-assets"),
        request,
    )
}

#[tauri::command]
fn load_shared_asset_editor(
    app: tauri::AppHandle,
    request: shared_assets::SharedAssetIdentityRequest,
) -> Result<shared_assets::SharedAssetEditorDto, String> {
    let snapshot =
        domain_store::load_long_term_domain_snapshot_v4_at(&domain_database_path(&app)?)?;
    shared_assets::load_editor_at(
        &shared_assets_root(&app)?,
        &revisions_root(&app)?.join("shared-assets"),
        &snapshot,
        request,
    )
}

#[tauri::command]
fn save_shared_asset(
    app: tauri::AppHandle,
    request: shared_assets::SaveSharedAssetRequest,
) -> Result<shared_assets::SharedAssetMutationResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let database = domain_database_path(&app)?;
    let snapshot = domain_store::load_long_term_domain_snapshot_v4_at(&database)?;
    let managed = managed_agent_dir(&app, "probe")?
        .parent()
        .ok_or_else(|| "AGENT_STORAGE_UNAVAILABLE: Agent 根目录无效".to_string())?
        .to_path_buf();
    let discovery = local_service::discover_with_shared_at(
        &managed,
        &shared_assets_root(&app)?,
        &snapshot,
        true,
        local_service::DiscoveryRequest {
            request_id: request.request_id.clone(),
            include_claude_user_root: false,
        },
    );
    let mut affected_agent_ids = discovery
        .references
        .iter()
        .filter(|reference| reference.target_asset_id == request.asset_id)
        .map(|reference| reference.referrer_id.clone())
        .collect::<Vec<_>>();
    affected_agent_ids.sort();
    affected_agent_ids.dedup();
    shared_assets::save_at(
        &shared_assets_root(&app)?,
        &revisions_root(&app)?.join("shared-assets"),
        &snapshot,
        request,
        affected_agent_ids,
    )
}

#[tauri::command]
fn repair_shared_asset_registration(
    app: tauri::AppHandle,
    request: shared_assets::SharedAssetIdentityRequest,
) -> Result<shared_assets::SharedAssetMutationResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    shared_assets::repair_registration_at(
        &domain_database_path(&app)?,
        &shared_assets_root(&app)?,
        &revisions_root(&app)?.join("shared-assets"),
        request,
    )
}

#[tauri::command]
fn recover_shared_asset_revision(
    app: tauri::AppHandle,
    request: shared_assets::RecoverSharedAssetRevisionRequest,
) -> Result<shared_assets::SharedAssetMutationResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let snapshot =
        domain_store::load_long_term_domain_snapshot_v4_at(&domain_database_path(&app)?)?;
    shared_assets::recover_revision_at(
        &shared_assets_root(&app)?,
        &revisions_root(&app)?.join("shared-assets"),
        &snapshot,
        request,
    )
}

#[tauri::command]
fn load_config_editor(
    app: tauri::AppHandle,
    request: local_service::LoadEditorRequest,
) -> Result<local_service::LoadEditorResult, String> {
    let managed = managed_agent_dir(&app, "probe")?
        .parent()
        .ok_or_else(|| "AGENT_STORAGE_UNAVAILABLE: Agent 根目录无效".to_string())?
        .to_path_buf();
    local_service::load_editor_at(&managed, request)
}

fn backup_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("backups"))
        .map_err(|_| "BACKUP_STORAGE_UNAVAILABLE: 无法访问本地快照目录".to_string())
}

fn revisions_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("revisions"))
        .map_err(|_| "REVISION_STORAGE_UNAVAILABLE: 无法访问配置版本目录".to_string())
}

#[tauri::command]
fn preview_factory_reset(
    app: tauri::AppHandle,
    request: factory_reset::PreviewFactoryResetRequest,
) -> Result<factory_reset::FactoryResetPreviewDto, String> {
    factory_reset::preview_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn commit_factory_reset(
    app: tauri::AppHandle,
    request: factory_reset::CommitFactoryResetRequest,
) -> Result<factory_reset::FactoryResetResultDto, String> {
    factory_reset::commit_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn restart_after_factory_reset(app: tauri::AppHandle) -> Result<(), String> {
    factory_reset::restart_guard_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法访问用户目录")?,
    )?;
    #[cfg(feature = "e2e")]
    {
        Ok(())
    }
    #[cfg(all(not(feature = "e2e"), debug_assertions))]
    {
        Err("FACTORY_RESET_MANUAL_RESTART_REQUIRED: 开发模式无法自动重新打开；请关闭当前窗口，并从开发菜单重新启动 Desktop".into())
    }
    #[cfg(all(not(feature = "e2e"), not(debug_assertions)))]
    {
        app.request_restart()
    }
}

#[tauri::command]
fn create_backup_snapshot(
    app: tauri::AppHandle,
    request: backup_service::CreateBackupSnapshotRequest,
) -> Result<backup_service::BackupSnapshotDto, String> {
    let _mutation = factory_reset::mutation_guard()?;
    backup_service::create_snapshot_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        &backup_root(&app)?,
        request,
    )
}

#[tauri::command]
fn list_backup_snapshots(
    app: tauri::AppHandle,
) -> Result<Vec<backup_service::BackupSnapshotDto>, String> {
    backup_service::list_snapshots_at(&domain_database_path(&app)?)
}

#[tauri::command]
fn preview_backup_restore(
    app: tauri::AppHandle,
    request: backup_service::PreviewBackupRestoreRequest,
) -> Result<backup_service::BackupRestorePreviewDto, String> {
    backup_service::preview_restore_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        &backup_root(&app)?,
        request,
    )
}

#[tauri::command]
fn restore_backup_snapshot(
    app: tauri::AppHandle,
    request: backup_service::RestoreBackupSnapshotRequest,
) -> Result<backup_service::BackupRestoreResultDto, String> {
    let _mutation = factory_reset::mutation_guard()?;
    backup_service::restore_snapshot_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        &revisions_root(&app)?,
        &backup_root(&app)?,
        request,
    )
}

#[tauri::command]
fn list_config_revisions(
    app: tauri::AppHandle,
    asset_id: String,
) -> Result<Vec<local_service::ConfigRevisionDto>, String> {
    local_service::list_revisions_at(&revisions_root(&app)?, &asset_id)
}

#[tauri::command]
fn read_config_revision_content(
    app: tauri::AppHandle,
    revision_id: String,
) -> Result<String, String> {
    local_service::read_revision_content_at(&revisions_root(&app)?, &revision_id)
}

#[tauri::command]
fn save_config(
    app: tauri::AppHandle,
    request: local_service::SaveConfigRequest,
) -> Result<local_service::SaveConfigResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let managed = managed_agent_dir(&app, "probe")?
        .parent()
        .ok_or_else(|| "AGENT_STORAGE_UNAVAILABLE: Agent 根目录无效".to_string())?
        .to_path_buf();
    Ok(local_service::save_config_registered_at(
        &domain_database_path(&app)?,
        &managed,
        &revisions_root(&app)?,
        request,
    ))
}

#[tauri::command]
fn recover_config_revision(
    app: tauri::AppHandle,
    request: local_service::RecoverConfigRevisionRequest,
) -> Result<local_service::SaveConfigResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let managed = managed_agent_dir(&app, "probe")?
        .parent()
        .ok_or_else(|| "AGENT_STORAGE_UNAVAILABLE: Agent 根目录无效".to_string())?
        .to_path_buf();
    Ok(local_service::recover_config_revision_registered_at(
        &domain_database_path(&app)?,
        &managed,
        &revisions_root(&app)?,
        request,
    ))
}

#[tauri::command]
fn restore_config_revision(
    app: tauri::AppHandle,
    request: local_service::RestoreConfigRevisionRequest,
) -> Result<local_service::SaveConfigResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let managed = managed_agent_dir(&app, "probe")?
        .parent()
        .ok_or_else(|| "AGENT_STORAGE_UNAVAILABLE: Agent 根目录无效".to_string())?
        .to_path_buf();
    Ok(local_service::restore_config_revision_registered_at(
        &domain_database_path(&app)?,
        &managed,
        &revisions_root(&app)?,
        request,
    ))
}

#[tauri::command]
fn list_host_integrations(
    app: tauri::AppHandle,
) -> Result<Vec<host_integration::HostIntegrationDto>, String> {
    Ok(host_integration::list_at(&app.path().home_dir().map_err(
        |_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问用户目录",
    )?))
}

#[tauri::command]
fn preview_host_integration_install(
    app: tauri::AppHandle,
    request: host_integration::HostIntegrationRequest,
) -> Result<host_integration::HostIntegrationPreviewDto, String> {
    host_integration::preview_install_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn commit_host_integration_install(
    app: tauri::AppHandle,
    request: host_integration::HostIntegrationCommitRequest,
) -> Result<host_integration::HostIntegrationResultDto, String> {
    let _mutation = factory_reset::mutation_guard()?;
    host_integration::commit_install_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn preview_host_integration_uninstall(
    app: tauri::AppHandle,
    request: host_integration::HostIntegrationRequest,
) -> Result<host_integration::HostIntegrationPreviewDto, String> {
    host_integration::preview_uninstall_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn commit_host_integration_uninstall(
    app: tauri::AppHandle,
    request: host_integration::HostIntegrationCommitRequest,
) -> Result<host_integration::HostIntegrationResultDto, String> {
    let _mutation = factory_reset::mutation_guard()?;
    host_integration::commit_uninstall_at(
        &app.path()
            .app_data_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问应用数据目录")?,
        &app.path()
            .home_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn reveal_host_directory(
    app: tauri::AppHandle,
    request: host_integration::HostIntegrationRequest,
) -> Result<host_integration::RevealHostDirectoryResultDto, String> {
    host_integration::reveal_at(
        &app.path()
            .home_dir()
            .map_err(|_| "HOST_INTEGRATION_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn list_ai_tool_host_statuses(
    app: tauri::AppHandle,
) -> Result<Vec<ai_tool_host::AiToolHostStatusDto>, String> {
    Ok(ai_tool_host::list_at(&app.path().home_dir().map_err(
        |_| "AI_TOOL_HOST_UNAVAILABLE: 无法访问用户目录",
    )?))
}

#[tauri::command]
fn open_ai_tool_install_page(
    request: ai_tool_host::AiToolHostRequest,
) -> Result<ai_tool_host::AiToolHostActionResultDto, String> {
    ai_tool_host::open_install_page(request)
}

#[tauri::command]
fn reveal_ai_tool_config_location(
    app: tauri::AppHandle,
    request: ai_tool_host::AiToolHostRequest,
) -> Result<ai_tool_host::AiToolHostActionResultDto, String> {
    ai_tool_host::reveal_config(
        &app.path()
            .home_dir()
            .map_err(|_| "AI_TOOL_HOST_UNAVAILABLE: 无法访问用户目录")?,
        request,
    )
}

#[tauri::command]
fn request_client_launch_v3(
    app: tauri::AppHandle,
    request: ai_adapters::ClientLaunchRequestV3,
) -> Result<ai_adapters::ClientLaunchResultV3, String> {
    let database = domain_database_path(&app)?;
    let agents_root = managed_agents_root(&app)?;
    ai_adapters::request_launch(request, |context| {
        domain_store::validate_client_launch_context_at(
            &database,
            &agents_root,
            context.team_id,
            context.agent_id,
            context.task_id,
        )
    })
}

fn asset_name(slot: &str) -> Result<(&'static str, usize), String> {
    match slot {
        "logo" => Ok(("logo.asset", 5 * 1024 * 1024)),
        "background" => Ok(("background.asset", 15 * 1024 * 1024)),
        _ => Err("INVALID_SLOT: 仅支持 logo 或 background".into()),
    }
}

const AGENT_AVATAR_LIMIT: usize = 5 * 1024 * 1024;

fn validate_agent_id(agent_id: &str) -> Result<(), String> {
    if validate_identifier(agent_id) && agent_id != "." && agent_id != ".." {
        Ok(())
    } else {
        Err("INVALID_AGENT_ID: Agent 标识无效".into())
    }
}

fn validate_avatar(bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() || bytes.len() > AGENT_AVATAR_LIMIT {
        return Err("INVALID_SIZE: 头像为空或超过 5 MiB".into());
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("INVALID_IMAGE: Agent 头像仅支持 PNG".into());
    }
    Ok(())
}

fn image_mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Ok("image/jpeg")
    } else {
        Err("INVALID_IMAGE: 仅支持 PNG 或 JPEG 图片".into())
    }
}

fn asset_path(app: &tauri::AppHandle, slot: &str) -> Result<PathBuf, String> {
    let (name, _) = asset_name(slot)?;
    app.path()
        .app_data_dir()
        .map(|path| path.join("ui-assets").join(name))
        .map_err(|_| "ASSET_STORAGE_UNAVAILABLE: 无法访问本机个性化资源目录".into())
}

#[tauri::command]
fn import_ui_asset(app: tauri::AppHandle, slot: String, bytes: Vec<u8>) -> Result<(), String> {
    let _mutation = factory_reset::mutation_guard()?;
    let (_, limit) = asset_name(&slot)?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err("INVALID_SIZE: 图片为空或超过该位置允许的大小".into());
    }
    image_mime(&bytes)?;
    let target = asset_path(&app, &slot)?;
    let require_existing = target.exists();
    config_fs::restricted_atomic_write(&target, &bytes, require_existing, "个性化图片")
        .map_err(|message| format!("ASSET_WRITE_FAILED: {message}"))
}

#[tauri::command]
fn read_ui_asset(app: tauri::AppHandle, slot: String) -> Result<Option<UiAsset>, String> {
    let target = asset_path(&app, &slot)?;
    if target.exists() {
        config_fs::ensure_regular_file(&target, "个性化图片")
            .map_err(|message| format!("ASSET_READ_FAILED: {message}"))?;
    }
    let bytes = match fs::read(target) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("ASSET_READ_FAILED: 无法读取个性化图片".into()),
    };
    let mime_type = image_mime(&bytes)?;
    Ok(Some(UiAsset { mime_type, bytes }))
}

#[tauri::command]
fn delete_ui_asset(app: tauri::AppHandle, slot: String) -> Result<(), String> {
    let _mutation = factory_reset::mutation_guard()?;
    let target = asset_path(&app, &slot)?;
    if target.exists() {
        config_fs::ensure_regular_file(&target, "个性化图片")
            .map_err(|message| format!("ASSET_DELETE_FAILED: {message}"))?;
    }
    match fs::remove_file(target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("ASSET_DELETE_FAILED: 无法移除个性化图片".into()),
    }
}

fn managed_agents_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map(|path| path.join(".bandi").join("agents"))
        .map_err(|_| "AGENT_STORAGE_UNAVAILABLE: 无法访问受管 Agent 目录".into())
}

fn managed_agent_dir(app: &tauri::AppHandle, agent_id: &str) -> Result<PathBuf, String> {
    validate_agent_id(agent_id)?;
    managed_agents_root(app).map(|path| path.join(format!("agt_{agent_id}")))
}

fn remove_legacy_project_files(agents_root: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(agents_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("AGENT_CLEANUP_FAILED: 无法读取受管 Agent 根".into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("AGENT_CLEANUP_FAILED: 受管 Agent 根不是普通目录".into());
    }
    for entry in fs::read_dir(agents_root)
        .map_err(|_| "AGENT_CLEANUP_FAILED: 无法扫描受管 Agent 根".to_string())?
    {
        let entry =
            entry.map_err(|_| "AGENT_CLEANUP_FAILED: 无法读取受管 Agent 条目".to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(agent_id) = name.strip_prefix("agt_") else {
            continue;
        };
        if !validate_identifier(agent_id) {
            continue;
        }
        let package_metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| "AGENT_CLEANUP_FAILED: 无法读取受管 AgentPackage".to_string())?;
        if package_metadata.file_type().is_symlink() || !package_metadata.is_dir() {
            continue;
        }
        let projects = entry.path().join("projects");
        let project_metadata = match fs::symlink_metadata(&projects) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("AGENT_CLEANUP_FAILED: 无法读取旧项目配置".into()),
        };
        if project_metadata.file_type().is_symlink() {
            fs::remove_file(projects)
                .map_err(|_| "AGENT_CLEANUP_FAILED: 无法移除旧项目配置链接".to_string())?;
        } else if project_metadata.is_dir() {
            fs::remove_dir_all(projects)
                .map_err(|_| "AGENT_CLEANUP_FAILED: 无法移除旧项目配置".to_string())?;
        } else {
            return Err("AGENT_CLEANUP_FAILED: 旧项目配置目标类型异常".into());
        }
    }
    Ok(())
}

fn validate_package_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.starts_with('/')
        || path.split('/').any(|segment| {
            segment.is_empty() || segment == "." || segment == ".." || !validate_identifier(segment)
        })
    {
        Err("INVALID_AGENT_FILE: AgentPackage 文件路径无效".into())
    } else {
        Ok(())
    }
}

fn write_package_file(root: &Path, file: &AgentPackageFile) -> Result<(), String> {
    validate_package_path(&file.path)?;
    config_fs::restricted_atomic_write(
        &root.join(&file.path),
        file.content.as_bytes(),
        false,
        "AgentPackage 文件",
    )
}

const REQUIRED_AGENT_PACKAGE_FILES: &[&str] = &[
    "agent.yaml",
    "instructions.md",
    "config/context.yaml",
    "config/skills.yaml",
    "config/rules.yaml",
    "config/mcp.yaml",
    "config/permissions.yaml",
    "config/sop.yaml",
    "config/hooks.yaml",
    "config/commands.yaml",
];

fn validate_agent_package_files(files: &[AgentPackageFile]) -> Result<(), String> {
    let mut paths = HashSet::new();
    for file in files {
        validate_package_path(&file.path)?;
        if file.path == "config/orchestration.yaml" {
            return Err("INVALID_AGENT_PACKAGE: config/orchestration.yaml 已不再受支持".into());
        }
        if !paths.insert(file.path.as_str()) {
            return Err(format!(
                "INVALID_AGENT_PACKAGE: 文件路径重复：{}",
                file.path
            ));
        }
    }
    for required in REQUIRED_AGENT_PACKAGE_FILES {
        if !paths.contains(required) {
            return Err(format!("INVALID_AGENT_PACKAGE: 缺少 {required}"));
        }
    }
    Ok(())
}

const AGENT_FUNCTION_IDS: &[&str] = &[
    "product",
    "design",
    "engineering",
    "testing",
    "research",
    "operations",
    "general",
    "other",
];

fn validate_agent_record(
    agent_id: &str,
    agent: &serde_json::Value,
    has_avatar: bool,
) -> Result<(), String> {
    let object = agent
        .as_object()
        .ok_or_else(|| "INVALID_AGENT_RECORD: Agent 记录必须是对象".to_string())?;
    const REMOVED_FIELDS: &[&str] = &[
        "roleId",
        "departmentId",
        "primaryDepartmentId",
        "managerAgentId",
        "serviceGrants",
        "orchestrationPolicy",
    ];
    if let Some(field) = REMOVED_FIELDS
        .iter()
        .find(|field| object.contains_key(**field))
    {
        return Err(format!(
            "INVALID_AGENT_RECORD: 已删除字段 {field} 不再受支持"
        ));
    }
    if object.get("id").and_then(serde_json::Value::as_str) != Some(agent_id) {
        return Err("INVALID_AGENT_RECORD: Agent ID 与请求不一致".into());
    }
    let name = object
        .get("name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "INVALID_AGENT_RECORD: Agent 名称必须是字符串".to_string())?;
    agent_service::validate_agent_name(name)
        .map_err(|message| format!("INVALID_AGENT_RECORD: {message}"))?;
    if object.get("functionId").is_some_and(|value| {
        value
            .as_str()
            .is_none_or(|function_id| !AGENT_FUNCTION_IDS.contains(&function_id))
    }) {
        return Err("INVALID_AGENT_RECORD: Agent 职能标识不受支持".into());
    }
    let avatar = object.get("avatarPath").and_then(serde_json::Value::as_str);
    if avatar.is_some_and(|value| value != "avatar.png")
        || has_avatar != (avatar == Some("avatar.png"))
    {
        return Err("INVALID_AGENT_RECORD: 头像引用与文件变更不一致".into());
    }
    Ok(())
}

fn write_agent_record(root: &Path, agent: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(agent)
        .map_err(|_| "INVALID_AGENT_RECORD: Agent 记录无法序列化".to_string())?;
    config_fs::restricted_atomic_write(
        &root.join(".bandi-agent.json"),
        &bytes,
        false,
        "Agent 索引记录",
    )
}

fn create_managed_agent_at(
    agents_root: &Path,
    request: CreateManagedAgentRequest,
) -> Result<ManagedAgentResult, String> {
    validate_agent_id(&request.agent_id)?;
    if let Some(bytes) = request.avatar_bytes.as_deref() {
        validate_avatar(bytes)?;
    }
    validate_agent_record(
        &request.agent_id,
        &request.agent,
        request.avatar_bytes.is_some(),
    )?;
    validate_agent_package_files(&request.files)?;
    let manifest = request
        .files
        .iter()
        .find(|file| file.path == "agent.yaml")
        .map(|file| file.content.clone())
        .ok_or_else(|| "INVALID_AGENT_PACKAGE: 缺少 agent.yaml".to_string())?;
    let target = agents_root.join(format!("agt_{}", request.agent_id));
    if target.exists() {
        return Err("AGENT_ALREADY_EXISTS: 受管 AgentPackage 已存在".into());
    }
    fs::create_dir_all(agents_root)
        .map_err(|_| "AGENT_WRITE_FAILED: 无法创建受管 Agent 根目录".to_string())?;
    let staging = agents_root.join(format!(".agt_{}.staging", request.agent_id));
    let _ = fs::remove_dir_all(&staging);
    let result = (|| {
        fs::create_dir(&staging)
            .map_err(|_| "AGENT_WRITE_FAILED: 无法创建 AgentPackage 临时目录".to_string())?;
        for file in &request.files {
            write_package_file(&staging, file)?;
        }
        if let Some(bytes) = request.avatar_bytes.as_deref() {
            config_fs::restricted_atomic_write(
                &staging.join("avatar.png"),
                bytes,
                false,
                "Agent 头像",
            )?;
        }
        write_agent_record(&staging, &request.agent)?;
        local_service::project_managed_agent_at(&staging, &request.agent_id)?;
        fs::rename(&staging, &target)
            .map_err(|_| "AGENT_WRITE_FAILED: 无法提交 AgentPackage".to_string())?;
        let (_, _, _, baseline_ref) = identity_asset_facts(&target, &request.agent_id, &manifest);
        Ok(ManagedAgentResult {
            agent: request.agent,
            baseline_ref,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn collect_package_fingerprint_entries(
    root: &Path,
    directory: &Path,
    entries: &mut Vec<(String, String)>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|_| "AGENT_READ_FAILED: 无法扫描 AgentPackage".to_string())?
    {
        let entry = entry.map_err(|_| "AGENT_READ_FAILED: 无法枚举 AgentPackage".to_string())?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| "AGENT_READ_FAILED: 无法检查 AgentPackage 内容".to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("AGENT_PACKAGE_REJECTED: AgentPackage 不允许符号链接".into());
        }
        if metadata.is_dir() {
            collect_package_fingerprint_entries(root, &entry.path(), entries)?;
        } else if metadata.is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|_| "AGENT_PACKAGE_REJECTED: AgentPackage 路径越界".to_string())?
                .to_string_lossy()
                .into_owned();
            let bytes = fs::read(entry.path())
                .map_err(|_| "AGENT_READ_FAILED: 无法读取 AgentPackage 内容".to_string())?;
            entries.push((relative, local_service::hash_bytes(&bytes)));
        } else {
            return Err("AGENT_PACKAGE_REJECTED: AgentPackage 包含非普通文件".into());
        }
    }
    Ok(())
}

fn managed_agent_deletion_facts(
    database: &Path,
    agents_root: &Path,
    revisions_root: &Path,
    agent_id: &str,
) -> Result<(String, serde_json::Value), String> {
    validate_agent_id(agent_id)?;
    let root = agents_root.join(format!("agt_{agent_id}"));
    let metadata = fs::symlink_metadata(&root)
        .map_err(|_| "AGENT_NOT_FOUND: 受管 AgentPackage 不存在".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("AGENT_PACKAGE_REJECTED: AgentPackage 必须是受管根内普通目录".into());
    }
    let canonical_root = fs::canonicalize(&root)
        .map_err(|_| "AGENT_READ_FAILED: 无法规范化 AgentPackage".to_string())?;
    let canonical_parent = fs::canonicalize(agents_root)
        .map_err(|_| "AGENT_READ_FAILED: 无法规范化受管 Agent 根".to_string())?;
    if canonical_root.parent() != Some(canonical_parent.as_path()) {
        return Err("AGENT_PACKAGE_REJECTED: AgentPackage 不在受管根直属目录".into());
    }
    local_service::project_managed_agent_at(&root, agent_id)?;
    let mut entries = Vec::new();
    collect_package_fingerprint_entries(&root, &root, &mut entries)?;
    entries.sort();
    let fingerprint = local_service::hash_bytes(
        serde_json::to_string(&entries)
            .map_err(|_| "AGENT_READ_FAILED: 无法生成 AgentPackage 指纹".to_string())?
            .as_bytes(),
    );
    let impacts = domain_store::managed_agent_deletion_impact_at(database, agent_id)?;
    let outbound_shared = entries
        .iter()
        .filter_map(|(path, _)| fs::read_to_string(root.join(path)).ok())
        .filter_map(|content| serde_yaml::from_str::<serde_json::Value>(&content).ok())
        .flat_map(|value| {
            let mut refs = Vec::new();
            collect_ref_ids(&value, &mut refs);
            refs
        })
        .collect::<Vec<_>>();
    let prefix = format!("agt_{agent_id}/");
    let config_revisions = fs::read_dir(revisions_root)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| fs::read(entry.path()).ok())
        .filter_map(|bytes| serde_json::from_slice::<local_service::ConfigRevisionDto>(&bytes).ok())
        .filter(|revision| {
            revision.locator.root_kind == local_service::RootKind::Managed
                && revision
                    .locator
                    .relative_path
                    .as_deref()
                    .is_some_and(|path| path.starts_with(&prefix))
        })
        .count();
    let mut static_referrers = Vec::new();
    if let Ok(packages) = fs::read_dir(agents_root) {
        for package in packages.flatten() {
            let name = package.file_name().to_string_lossy().into_owned();
            if name == format!("agt_{agent_id}") || !name.starts_with("agt_") {
                continue;
            }
            let metadata = match fs::symlink_metadata(package.path()) {
                Ok(value) if value.is_dir() && !value.file_type().is_symlink() => value,
                _ => continue,
            };
            let _ = metadata;
            let mut files = Vec::new();
            if collect_package_fingerprint_entries(&package.path(), &package.path(), &mut files)
                .is_ok()
                && files.iter().any(|(path, _)| {
                    fs::read_to_string(package.path().join(path))
                        .ok()
                        .and_then(|content| {
                            serde_yaml::from_str::<serde_json::Value>(&content).ok()
                        })
                        .is_some_and(|value| contains_agent_reference(&value, agent_id))
                })
            {
                static_referrers.push(name.trim_start_matches("agt_").to_string());
            }
        }
    }
    let raw = impacts;
    let impact = |id: String, label: &str, detail: String, remediation: Option<&str>| {
        serde_json::json!({
            "id": id,
            "label": label,
            "detail": detail,
            "remediation": remediation,
        })
    };
    let organization_relationships = raw["organizationRelationships"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(|value| impact(value.into(), "组织关系", value.into(), None))
        .collect::<Vec<_>>();
    let cleanup = &raw["cleanup"];
    let automatic_cleanup = [(
        "team_memberships",
        "Team 成员索引",
        cleanup["teamMemberships"].as_u64().unwrap_or(0),
    )]
    .into_iter()
    .filter(|(_, _, count)| *count > 0)
    .map(|(id, label, count)| impact(id.into(), label, format!("将自动清理 {count} 项"), None))
    .collect::<Vec<_>>();
    let mut blocker_codes = raw["blockers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_string)
        .collect::<Vec<_>>();
    blocker_codes.extend(
        static_referrers
            .into_iter()
            .map(|id| format!("agent_static_reference:{id}")),
    );
    let review_responsibilities = blocker_codes
        .iter()
        .filter(|value| value.starts_with("memory_responsibility_or_history:"))
        .map(|value| {
            impact(
                value.clone(),
                "长期记忆的审核责任或历史记录",
                "此 Agent 仍承担长期记忆审核责任，或存在必须保留的历史记录".into(),
                Some("先转移审核责任；必须保留的历史记录会阻止删除"),
            )
        })
        .collect::<Vec<_>>();
    let formal_memory = if raw["memoryReferences"].as_i64().unwrap_or(0) > 0 {
        vec![impact(
            "formal_memory".into(),
            "长期记忆",
            format!("存在 {} 项审核责任或历史记录", raw["memoryReferences"]),
            Some("先转移审核责任；必须保留的历史记录会阻止删除"),
        )]
    } else {
        Vec::new()
    };
    let blockers = blocker_codes
        .into_iter()
        .map(|value| {
            impact(
                value.clone(),
                "删除阻止项",
                value,
                Some("解除该关键职责或引用后重新预览"),
            )
        })
        .collect::<Vec<_>>();
    let impacts = serde_json::json!({
        "sharedAssetReferences": outbound_shared.into_iter().map(|id| impact(id.clone(), "共享资产引用", id, None)).collect::<Vec<_>>(),
        "organizationRelationships": organization_relationships,
        "reviewResponsibilities": review_responsibilities,
        "formalMemory": formal_memory,
        "automaticCleanup": automatic_cleanup,
        "historyAndBackups": [impact("config_revisions".into(), "配置版本与备份", format!("将删除 {config_revisions} 项配置版本；独立备份中的副本不会删除"), None)],
        "blockers": blockers,
    });
    Ok((fingerprint, impacts))
}

fn contains_agent_reference(value: &serde_json::Value, agent_id: &str) -> bool {
    match value {
        serde_json::Value::Object(object) => object.iter().any(|(key, child)| {
            ((key == "agentId" || key.ends_with("AgentId")) && child.as_str() == Some(agent_id))
                || ((key == "agentIds" || key.ends_with("AgentIds"))
                    && child.as_array().is_some_and(|values| {
                        values.iter().any(|value| value.as_str() == Some(agent_id))
                    }))
                || contains_agent_reference(child, agent_id)
        }),
        serde_json::Value::Array(values) => values
            .iter()
            .any(|child| contains_agent_reference(child, agent_id)),
        _ => false,
    }
}

fn collect_ref_ids(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(id) = object.get("refId").and_then(serde_json::Value::as_str) {
                output.push(id.to_string());
            }
            for child in object.values() {
                collect_ref_ids(child, output);
            }
        }
        serde_json::Value::Array(values) => {
            for child in values {
                collect_ref_ids(child, output);
            }
        }
        _ => {}
    }
}

fn identity_asset_facts(
    root: &Path,
    agent_id: &str,
    content: &str,
) -> (
    String,
    String,
    local_service::AssetLocatorDto,
    local_service::BaselineRefDto,
) {
    let asset_id = local_service::stable_id("asset", &format!("managed:{agent_id}:identity"));
    let container_id =
        local_service::stable_id("container", &format!("managed:{agent_id}:agent.yaml"));
    let content_hash = local_service::hash_bytes(content.as_bytes());
    let baseline_id = local_service::stable_id(
        "baseline",
        &format!("{asset_id}:{content_hash}:{content_hash}"),
    );
    let locator = local_service::AssetLocatorDto {
        root_kind: local_service::RootKind::Managed,
        display_path: root.join("agent.yaml").to_string_lossy().into_owned(),
        relative_path: Some(format!("agt_{agent_id}/agent.yaml")),
    };
    let baseline_ref = local_service::BaselineRefDto {
        id: baseline_id,
        asset_id: asset_id.clone(),
        container_id: container_id.clone(),
        asset_content_hash: content_hash.clone(),
        container_content_hash: content_hash,
        target_exists: true,
    };
    (asset_id, container_id, locator, baseline_ref)
}

fn load_managed_agent_identity_at(
    root: &Path,
    agent_id: &str,
) -> Result<ManagedAgentIdentityEditorResult, String> {
    validate_agent_id(agent_id)?;
    if !root.is_dir() {
        return Err("AGENT_NOT_FOUND: 受管 AgentPackage 不存在".into());
    }
    let manifest_path = root.join("agent.yaml");
    let canonical_content = fs::read_to_string(&manifest_path)
        .map_err(|_| "AGENT_READ_FAILED: 无法读取 agent.yaml".to_string())?;
    let (_, _, schema_version) =
        local_service::manifest_facts(&manifest_path).map_err(|diagnostic| diagnostic.message)?;
    if schema_version != 1 {
        return Err("AGENT_READ_ONLY: 当前 AgentPackage 版本不支持身份编辑".into());
    }
    let metadata = fs::symlink_metadata(&manifest_path)
        .map_err(|_| "AGENT_READ_FAILED: 无法检查 agent.yaml".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("AGENT_READ_ONLY: agent.yaml 必须是普通文件".into());
    }
    let (asset_id, container_id, locator, baseline_ref) =
        identity_asset_facts(root, agent_id, &canonical_content);
    Ok(ManagedAgentIdentityEditorResult {
        asset_id,
        container_id,
        locator,
        canonical_content,
        baseline_ref,
    })
}

#[tauri::command]
fn load_managed_agent_identity(
    app: tauri::AppHandle,
    agent_id: String,
) -> Result<ManagedAgentIdentityEditorResult, String> {
    let root = managed_agent_dir(&app, &agent_id)?;
    load_managed_agent_identity_at(&root, &agent_id)
}

fn identity_validation_failed(
    request_id: String,
    message: &str,
    remediation: &str,
) -> SaveManagedAgentIdentityResult {
    SaveManagedAgentIdentityResult::ValidationFailed {
        request_id,
        diagnostics: vec![local_service::diagnostic(
            "identity_request_invalid",
            "error",
            message,
            Some("agent.yaml".into()),
            Some(remediation),
        )],
    }
}

#[cfg(test)]
fn save_managed_agent_identity_at(
    root: &Path,
    revisions_root: &Path,
    request: SaveManagedAgentIdentityRequest,
) -> SaveManagedAgentIdentityResult {
    save_managed_agent_identity_with_revision_source(root, revisions_root, request, None, None)
}

fn save_managed_agent_identity_with_revision_source(
    root: &Path,
    revisions_root: &Path,
    request: SaveManagedAgentIdentityRequest,
    restored_from_revision_id: Option<String>,
    fixed_revision_id: Option<String>,
) -> SaveManagedAgentIdentityResult {
    let request_id = request.request_id.clone();
    if !validate_identifier(&request.request_id)
        || validate_agent_id(&request.agent_id).is_err()
        || request.manifest.len() > 1024 * 1024
        || request.base_content.len() > 1024 * 1024
        || request.manifest.contains('\0')
    {
        return identity_validation_failed(request_id, "身份保存请求无效", "刷新后重试");
    }
    if !root.is_dir() {
        return identity_validation_failed(
            request_id,
            "受管 AgentPackage 不存在",
            "返回 Agent 列表并重新发现",
        );
    }
    let manifest_path = root.join("agent.yaml");
    let current = match fs::read_to_string(&manifest_path) {
        Ok(content) => content,
        Err(_) => {
            return identity_validation_failed(
                request_id,
                "无法读取 agent.yaml",
                "检查 AgentPackage 完整性",
            )
        }
    };
    let (asset_id, container_id, locator, current_baseline) =
        identity_asset_facts(root, &request.agent_id, &current);
    let base_hash = local_service::hash_bytes(request.base_content.as_bytes());
    if request.expected_baseline.asset_content_hash != base_hash
        || request.expected_baseline.container_content_hash != base_hash
        || request.expected_baseline.asset_id != asset_id
        || request.expected_baseline.container_id != container_id
    {
        return identity_validation_failed(
            request_id,
            "编辑器原始 manifest 与服务签发基线不一致",
            "重新加载身份配置后重试",
        );
    }
    if request.expected_baseline.asset_content_hash != current_baseline.asset_content_hash
        || request.expected_baseline.container_content_hash
            != current_baseline.container_content_hash
    {
        return SaveManagedAgentIdentityResult::BaselineChanged {
            request_id,
            asset_id,
            container_id,
            locator,
            base: local_service::current_side(request.base_content),
            current: local_service::current_side(current),
            proposed: local_service::current_side(request.manifest),
            diagnostics: vec![local_service::diagnostic(
                "baseline_changed",
                "warning",
                "agent.yaml 已在编辑期间发生变化",
                Some("agent.yaml".into()),
                Some("比较当前内容后重新应用编辑"),
            )],
        };
    }
    if let AvatarChange::Replace { bytes } = &request.avatar {
        if let Err(message) = validate_avatar(bytes) {
            return identity_validation_failed(request_id, &message, "选择有效的 PNG 头像");
        }
    }
    let avatar_path = root.join("avatar.png");
    let has_avatar = match &request.avatar {
        AvatarChange::Keep => avatar_path.is_file(),
        AvatarChange::Replace { .. } => true,
        AvatarChange::Remove => false,
    };
    if let Err(message) = validate_agent_record(&request.agent_id, &request.agent, has_avatar) {
        return identity_validation_failed(request_id, &message, "修正身份字段与头像选择");
    }
    if current == request.manifest && matches!(&request.avatar, AvatarChange::Keep) {
        return SaveManagedAgentIdentityResult::Unchanged {
            request_id,
            agent: request.agent,
            baseline_ref: current_baseline,
        };
    }
    let old_avatar = fs::read(&avatar_path).ok();
    let record_path = root.join(".bandi-agent.json");
    let old_record = fs::read(&record_path).ok();
    let previous_hash = current_baseline.container_content_hash.clone();
    let write_result = (|| {
        match &request.avatar {
            AvatarChange::Keep => {}
            AvatarChange::Replace { bytes } => config_fs::restricted_atomic_write(
                &avatar_path,
                bytes,
                avatar_path.exists(),
                "Agent 头像",
            )?,
            AvatarChange::Remove => match fs::remove_file(&avatar_path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err("无法移除 Agent 头像".into()),
            },
        }
        config_fs::restricted_atomic_write(
            &manifest_path,
            request.manifest.as_bytes(),
            true,
            "Agent manifest",
        )?;
        write_agent_record(root, &request.agent)
    })();
    if let Err(message) = write_result {
        let _ = config_fs::restricted_atomic_write(
            &manifest_path,
            current.as_bytes(),
            true,
            "Agent manifest 回滚",
        );
        match old_avatar {
            Some(bytes) => {
                let _ = config_fs::restricted_atomic_write(
                    &avatar_path,
                    &bytes,
                    avatar_path.exists(),
                    "Agent 头像回滚",
                );
            }
            None => {
                let _ = fs::remove_file(&avatar_path);
            }
        }
        match old_record {
            Some(bytes) => {
                let _ = config_fs::restricted_atomic_write(
                    &record_path,
                    &bytes,
                    record_path.exists(),
                    "Agent 索引记录回滚",
                );
            }
            None => {
                let _ = fs::remove_file(&record_path);
            }
        }
        return SaveManagedAgentIdentityResult::SaveFailed {
            request_id,
            diagnostics: vec![local_service::diagnostic(
                "identity_save_failed",
                "error",
                &message,
                Some("agent.yaml".into()),
                Some("检查目录权限后重试"),
            )],
            retryable: true,
            file_state: "unchanged".into(),
            recovery_ref: None,
        };
    }
    let verified = match fs::read_to_string(&manifest_path) {
        Ok(content) if content == request.manifest => content,
        _ => {
            return SaveManagedAgentIdentityResult::SaveFailed {
                request_id,
                diagnostics: vec![local_service::diagnostic(
                    "identity_write_not_verified",
                    "error",
                    "agent.yaml 写后重读验证失败",
                    Some("agent.yaml".into()),
                    Some("重新发现 AgentPackage 文件状态"),
                )],
                retryable: false,
                file_state: "write_not_verified".into(),
                recovery_ref: None,
            }
        }
    };
    let (_, _, _, baseline_ref) = identity_asset_facts(root, &request.agent_id, &verified);
    let saved_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let receipt_id = local_service::stable_id(
        "receipt",
        &format!(
            "{asset_id}:{previous_hash}:{}:{saved_at}",
            baseline_ref.container_content_hash
        ),
    );
    let revision_id = fixed_revision_id.unwrap_or_else(|| {
        local_service::stable_id(
            "revision",
            &format!(
                "{asset_id}:{previous_hash}:{}:{saved_at}",
                baseline_ref.container_content_hash
            ),
        )
    });
    let receipt = local_service::WriteReceiptDto {
        id: receipt_id.clone(),
        container_id: container_id.clone(),
        previous_container_hash: previous_hash,
        written_container_hash: baseline_ref.container_content_hash.clone(),
        verified_at: saved_at.clone(),
        atomic_replace: true,
    };
    let revision = local_service::ConfigRevisionDto {
        id: revision_id,
        asset_id,
        container_id,
        locator,
        asset_content_hash: baseline_ref.asset_content_hash.clone(),
        container_content_hash: baseline_ref.container_content_hash.clone(),
        source_asset_baseline_hash: request.expected_baseline.asset_content_hash,
        source_container_baseline_hash: request.expected_baseline.container_content_hash,
        redacted: false,
        write_receipt_id: receipt_id,
        saved_at,
        summary: restored_from_revision_id
            .as_ref()
            .map_or_else(|| "保存身份与职责".into(), |id| format!("恢复自 {id}")),
        confirmation_refs: Vec::new(),
        restored_from_revision_id,
    };
    if local_service::append_revision(revisions_root, &revision, &verified).is_err() {
        return SaveManagedAgentIdentityResult::SaveFailed {
            request_id,
            diagnostics: vec![local_service::diagnostic(
                "revision_pending",
                "error",
                "身份与职责已验证写入，但 ConfigRevision 记录失败",
                Some("agent.yaml".into()),
                Some("保留 recovery 状态并修复本地存储"),
            )],
            retryable: false,
            file_state: "verified_written_revision_pending".into(),
            recovery_ref: Some(revision.id),
        };
    }
    SaveManagedAgentIdentityResult::Saved {
        request_id,
        agent: request.agent,
        baseline_ref,
        revision: Box::new(revision),
        write_receipt: receipt,
    }
}

fn agent_record_for_manifest(
    root: &Path,
    agent_id: &str,
    manifest: &str,
) -> Result<serde_json::Value, String> {
    let identity: serde_json::Value =
        serde_yaml::from_str(manifest).map_err(|_| "历史 agent.yaml 无法解析".to_string())?;
    let identity = identity
        .as_object()
        .ok_or_else(|| "历史 agent.yaml 必须是对象".to_string())?;
    if identity.get("id").and_then(serde_json::Value::as_str) != Some(agent_id)
        || identity
            .get("schemaVersion")
            .and_then(serde_json::Value::as_u64)
            != Some(1)
    {
        return Err("历史 agent.yaml 的稳定 id 或 schemaVersion 不匹配".into());
    }
    let record_path = root.join(".bandi-agent.json");
    let mut record: serde_json::Value = serde_json::from_slice(
        &fs::read(&record_path).map_err(|_| "无法读取 Agent 索引记录".to_string())?,
    )
    .map_err(|_| "Agent 索引记录已损坏".to_string())?;
    let record = record
        .as_object_mut()
        .ok_or_else(|| "Agent 索引记录必须是对象".to_string())?;
    const IDENTITY_FIELDS: &[&str] = &[
        "id",
        "name",
        "status",
        "teamId",
        "avatarPath",
        "mission",
        "functionId",
        "responsibilities",
        "deliverables",
        "decisionBoundaries",
        "escalationConditions",
        "prohibitions",
        "completionDefinition",
    ];
    for field in IDENTITY_FIELDS {
        match identity.get(*field) {
            Some(value) => {
                record.insert((*field).into(), value.clone());
            }
            None => {
                record.remove(*field);
            }
        }
    }
    let has_avatar = root.join("avatar.png").is_file();
    validate_agent_record(
        agent_id,
        &serde_json::Value::Object(record.clone()),
        has_avatar,
    )
    .map_err(|_| {
        "历史 manifest 的头像引用与当前固定 avatar.png 不一致，无法只恢复 manifest".to_string()
    })?;
    Ok(serde_json::Value::Object(record.clone()))
}

fn recover_managed_agent_identity_at(
    root: &Path,
    revisions_root: &Path,
    request: RecoverManagedAgentIdentityRequest,
) -> SaveManagedAgentIdentityResult {
    let request_id = request.request_id.clone();
    if !validate_identifier(&request.request_id)
        || validate_agent_id(&request.agent_id).is_err()
        || request.asset_id.len() > 160
        || !validate_identifier(&request.recovery_ref)
    {
        return identity_validation_failed(
            request_id,
            "身份版本补记请求无效",
            "重新加载身份配置后重试",
        );
    }
    let loaded = match load_managed_agent_identity_at(root, &request.agent_id) {
        Ok(value) => value,
        Err(message) => {
            return identity_validation_failed(request_id, &message, "重新发现 AgentPackage")
        }
    };
    if loaded.asset_id != request.asset_id {
        return identity_validation_failed(
            request_id,
            "恢复引用不属于当前身份资产",
            "重新加载身份配置后重试",
        );
    }
    if local_service::list_revisions_at(revisions_root, &request.asset_id)
        .is_ok_and(|items| items.iter().any(|item| item.id == request.recovery_ref))
    {
        let agent =
            match agent_record_for_manifest(root, &request.agent_id, &loaded.canonical_content) {
                Ok(value) => value,
                Err(message) => {
                    return identity_validation_failed(
                        request_id,
                        &message,
                        "修复 AgentPackage 索引",
                    )
                }
            };
        return SaveManagedAgentIdentityResult::Unchanged {
            request_id,
            agent,
            baseline_ref: loaded.baseline_ref,
        };
    }
    let saved_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let receipt_id = local_service::stable_id(
        "receipt-recovery",
        &format!("{}:{saved_at}", loaded.asset_id),
    );
    let revision = local_service::ConfigRevisionDto {
        id: request.recovery_ref,
        asset_id: loaded.asset_id.clone(),
        container_id: loaded.container_id.clone(),
        locator: loaded.locator,
        asset_content_hash: loaded.baseline_ref.asset_content_hash.clone(),
        container_content_hash: loaded.baseline_ref.container_content_hash.clone(),
        source_asset_baseline_hash: loaded.baseline_ref.asset_content_hash.clone(),
        source_container_baseline_hash: loaded.baseline_ref.container_content_hash.clone(),
        redacted: false,
        write_receipt_id: receipt_id,
        saved_at,
        summary: "补记已验证写入的身份与职责".into(),
        confirmation_refs: Vec::new(),
        restored_from_revision_id: None,
    };
    if local_service::append_revision(revisions_root, &revision, &loaded.canonical_content).is_err()
    {
        return SaveManagedAgentIdentityResult::SaveFailed {
            request_id,
            diagnostics: vec![local_service::diagnostic(
                "revision_pending",
                "error",
                "ConfigRevision 仍无法补记，agent.yaml 未再次写入",
                Some("agent.yaml".into()),
                Some("修复本地版本存储后重试恢复引用"),
            )],
            retryable: true,
            file_state: "verified_written_revision_pending".into(),
            recovery_ref: Some(revision.id),
        };
    }
    let agent = match agent_record_for_manifest(root, &request.agent_id, &loaded.canonical_content)
    {
        Ok(value) => value,
        Err(message) => {
            return identity_validation_failed(request_id, &message, "修复 AgentPackage 索引")
        }
    };
    let receipt = local_service::WriteReceiptDto {
        id: revision.write_receipt_id.clone(),
        container_id: revision.container_id.clone(),
        previous_container_hash: revision.container_content_hash.clone(),
        written_container_hash: revision.container_content_hash.clone(),
        verified_at: revision.saved_at.clone(),
        atomic_replace: true,
    };
    SaveManagedAgentIdentityResult::Saved {
        request_id,
        agent,
        baseline_ref: loaded.baseline_ref,
        revision: Box::new(revision),
        write_receipt: receipt,
    }
}

fn restore_managed_agent_identity_at(
    root: &Path,
    revisions_root: &Path,
    request: RestoreManagedAgentIdentityRequest,
) -> SaveManagedAgentIdentityResult {
    let request_id = request.request_id.clone();
    if !validate_identifier(&request.request_id)
        || validate_agent_id(&request.agent_id).is_err()
        || request.asset_id.len() > 160
        || !validate_identifier(&request.revision_id)
        || request.base_content.len() > 1024 * 1024
        || !request.confirmed
    {
        return identity_validation_failed(
            request_id,
            "身份历史恢复请求无效或尚未确认",
            "重新核对历史版本后确认恢复",
        );
    }
    let revisions = match local_service::list_revisions_at(revisions_root, &request.asset_id) {
        Ok(value) => value,
        Err(message) => {
            return identity_validation_failed(request_id, &message, "重新加载身份版本历史")
        }
    };
    if !revisions.iter().any(|item| item.id == request.revision_id) {
        return identity_validation_failed(
            request_id,
            "目标 ConfigRevision 不属于当前身份资产",
            "重新选择该身份资产的历史版本",
        );
    }
    let manifest =
        match local_service::read_revision_content_at(revisions_root, &request.revision_id) {
            Ok(value) => value,
            Err(message) => {
                return identity_validation_failed(request_id, &message, "修复本地版本记录后重试")
            }
        };
    let agent = match agent_record_for_manifest(root, &request.agent_id, &manifest) {
        Ok(value) => value,
        Err(message) => {
            return identity_validation_failed(request_id, &message, "选择与当前头像状态兼容的版本")
        }
    };
    let revision_id = request.revision_id;
    save_managed_agent_identity_with_revision_source(
        root,
        revisions_root,
        SaveManagedAgentIdentityRequest {
            request_id: request.request_id,
            agent_id: request.agent_id,
            agent,
            manifest,
            expected_baseline: request.expected_baseline,
            base_content: request.base_content,
            avatar: AvatarChange::Keep,
        },
        Some(revision_id),
        None,
    )
}

#[tauri::command]
fn recover_managed_agent_identity(
    app: tauri::AppHandle,
    request: RecoverManagedAgentIdentityRequest,
) -> Result<SaveManagedAgentIdentityResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let root = managed_agent_dir(&app, &request.agent_id)?;
    Ok(recover_managed_agent_identity_at(
        &root,
        &revisions_root(&app)?,
        request,
    ))
}

#[tauri::command]
fn restore_managed_agent_identity(
    app: tauri::AppHandle,
    request: RestoreManagedAgentIdentityRequest,
) -> Result<SaveManagedAgentIdentityResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let root = managed_agent_dir(&app, &request.agent_id)?;
    Ok(restore_managed_agent_identity_at(
        &root,
        &revisions_root(&app)?,
        request,
    ))
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentListResult {
    agents: Vec<serde_json::Value>,
    diagnostics: Vec<local_service::DiagnosticDto>,
}

fn agent_package_diagnostic(source: &str, message: &str) -> local_service::DiagnosticDto {
    let (code, detail) = message
        .split_once(": ")
        .unwrap_or(("AGENT_PACKAGE_INVALID", message));
    let path = [
        ".bandi-agent.json",
        "agent.yaml",
        "instructions.md",
        "config/context.yaml",
        "config/rules.yaml",
        "config/skills.yaml",
        "config/mcp.yaml",
        "config/permissions.yaml",
        "config/sop.yaml",
        "config/hooks.yaml",
        "config/commands.yaml",
    ]
    .into_iter()
    .find(|path| message.contains(path))
    .map(str::to_owned);
    let mut diagnostic = local_service::diagnostic(
        code,
        "error",
        detail,
        path,
        Some("检查该 AgentPackage 后重新读取"),
    );
    diagnostic.source = Some(source.into());
    diagnostic
}

fn list_managed_agents_at(root: &Path) -> Result<AgentListResult, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AgentListResult {
                agents: Vec::new(),
                diagnostics: Vec::new(),
            })
        }
        Err(_) => return Err("AGENT_READ_FAILED: 无法扫描受管 Agent 目录".into()),
    };
    let mut result = AgentListResult {
        agents: Vec::new(),
        diagnostics: Vec::new(),
    };
    for entry in entries {
        let entry = entry.map_err(|_| "AGENT_READ_FAILED: 无法枚举受管 Agent 目录")?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some(agent_id) = file_name.strip_prefix("agt_") else {
            continue;
        };
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(metadata) => metadata,
            Err(_) => {
                result.diagnostics.push(agent_package_diagnostic(
                    &file_name,
                    "AGENT_READ_FAILED: 无法检查 AgentPackage",
                ));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            result.diagnostics.push(agent_package_diagnostic(
                &file_name,
                "AGENT_PACKAGE_REJECTED: AgentPackage 必须是受管根内普通目录",
            ));
            continue;
        }
        match local_service::project_managed_agent_at(&entry.path(), agent_id) {
            Ok(agent) => result.agents.push(agent),
            Err(message) => result
                .diagnostics
                .push(agent_package_diagnostic(&file_name, &message)),
        }
    }
    result.agents.sort_by(|left, right| {
        left.get("id")
            .and_then(serde_json::Value::as_str)
            .cmp(&right.get("id").and_then(serde_json::Value::as_str))
    });
    Ok(result)
}

#[tauri::command]
fn list_managed_agents(app: tauri::AppHandle) -> Result<AgentListResult, String> {
    list_managed_agents_at(&managed_agents_root(&app)?)
}

fn deletion_preview_ref(
    expires_at: i64,
    request_id: &str,
    agent_id: &str,
    fingerprint: &str,
    impacts: &serde_json::Value,
) -> String {
    let digest = local_service::stable_id(
        "agent-delete-preview",
        &format!(
            "{expires_at}:{request_id}:{agent_id}:{fingerprint}:{}",
            local_service::hash_bytes(impacts.to_string().as_bytes())
        ),
    );
    format!("{expires_at}-{digest}")
}

fn preview_managed_agent_deletion_at(
    database: &Path,
    agents_root: &Path,
    revisions_root: &Path,
    request: PreviewManagedAgentDeletionRequest,
    fixed_expires_at: Option<i64>,
) -> Result<ManagedAgentDeletionPreviewDto, String> {
    if !validate_identifier(&request.request_id) {
        return Err("AGENT_DELETE_INVALID: requestId 无效".into());
    }
    let (fingerprint, impacts) =
        managed_agent_deletion_facts(database, agents_root, revisions_root, &request.agent_id)?;
    let canonical_agent = local_service::project_managed_agent_at(
        &agents_root.join(format!("agt_{}", request.agent_id)),
        &request.agent_id,
    )?;
    let canonical_name = canonical_agent
        .get("name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "AGENT_CANONICAL_INVALID: Agent 名称缺失".to_string())?;
    agent_service::validate_agent_name(canonical_name)
        .map_err(|message| format!("AGENT_CANONICAL_INVALID: {message}"))?;
    let expires_at = fixed_expires_at
        .unwrap_or_else(|| (Utc::now() + chrono::Duration::minutes(15)).timestamp());
    let preview_ref = deletion_preview_ref(
        expires_at,
        &request.request_id,
        &request.agent_id,
        &fingerprint,
        &impacts,
    );
    let can_commit = impacts
        .get("blockers")
        .and_then(serde_json::Value::as_array)
        .is_some_and(Vec::is_empty);
    Ok(ManagedAgentDeletionPreviewDto {
        confirmation_text: format!("永久删除 {canonical_name}"),
        expires_at: chrono::DateTime::from_timestamp(expires_at, 0)
            .ok_or_else(|| "AGENT_DELETE_INVALID: 预览有效期无效".to_string())?
            .to_rfc3339(),
        request_id: request.request_id,
        agent_id: request.agent_id,
        preview_ref,
        package_fingerprint: fingerprint,
        impacts,
        can_commit,
    })
}

#[tauri::command]
fn preview_managed_agent_deletion(
    app: tauri::AppHandle,
    request: PreviewManagedAgentDeletionRequest,
) -> Result<ManagedAgentDeletionPreviewDto, String> {
    preview_managed_agent_deletion_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        &revisions_root(&app)?,
        request,
        None,
    )
}

fn finish_managed_agent_deletion(
    database: &Path,
    agents_root: &Path,
    revisions_root: &Path,
    operation: &agent_service::AgentRecoveryOperation,
) -> Result<ManagedAgentDeletionResultDto, String> {
    let live = agents_root.join(format!("agt_{}", operation.agent_id));
    let quarantine = agents_root.join(format!(".agt_{}.delete", operation.agent_id));
    let mut current = operation.clone();
    if current.status == "prepared" {
        match (live.exists(), quarantine.exists()) {
            (true, false) => fs::rename(&live, &quarantine)
                .map_err(|_| "AGENT_DELETE_FAILED: 无法隔离 AgentPackage".to_string())?,
            (false, true) => {}
            _ => return Err("AGENT_DELETE_BLOCKED: AgentPackage 与隔离目录状态冲突".into()),
        }
        match agent_service::set_operation_status_at(
            database,
            &current.id,
            "filesystem_committed",
            None,
        ) {
            Ok(operation) => current = operation,
            Err(error) => {
                let _ = fs::rename(&quarantine, &live);
                return Err(error);
            }
        }
    }
    if current.status == "filesystem_committed" {
        if !quarantine.exists() || live.exists() {
            return Err("AGENT_DELETE_BLOCKED: 隔离后的 AgentPackage 状态冲突".into());
        }
        if let Err(error) =
            domain_store::delete_agent_relations_at(database, &current.id, &current.agent_id)
        {
            let _ = agent_service::set_operation_status_at(database, &current.id, "blocked", None);
            let _ = fs::rename(&quarantine, &live);
            return Err(error);
        }
        current = agent_service::get_operation_at(database, &current.id)?;
    }
    let mut deleted_config_revisions = 0;
    let mut safe_reason = None;
    let mut pending_cleanup = Vec::new();
    if current.status == "database_committed" {
        if !quarantine.exists() || live.exists() {
            safe_reason =
                Some("Agent 配置已删除，但隔离目录状态需要人工检查。请勿重复删除。".into());
            pending_cleanup.push("检查受管配置隔离目录".into());
        } else {
            match local_service::remove_managed_agent_revisions_at(
                revisions_root,
                &current.agent_id,
            ) {
                Ok(count) => deleted_config_revisions = count,
                Err(_) => {
                    safe_reason =
                        Some("Agent 配置已删除，但部分配置版本仍待清理。请勿重复删除。".into());
                    pending_cleanup.push("清理配置版本".into());
                }
            }
            if pending_cleanup.is_empty() && fs::remove_dir_all(&quarantine).is_err() {
                safe_reason =
                    Some("Agent 配置已删除，但部分本机文件仍待清理。请勿重复删除。".into());
                pending_cleanup.push("清理受管配置文件".into());
            }
            if pending_cleanup.is_empty() {
                current = agent_service::complete_delete_operation_at(database, &current.id)?;
            }
        }
    }
    let status = if current.status == "database_committed" {
        "cleanup_pending".to_string()
    } else {
        current.status.clone()
    };
    Ok(ManagedAgentDeletionResultDto {
        request_id: current.request_id,
        agent_id: current.agent_id,
        operation_id: current.id,
        created_at: current.created_at,
        status,
        deleted_config_revisions,
        safe_reason,
        pending_cleanup,
    })
}

#[tauri::command]
fn commit_managed_agent_deletion(
    app: tauri::AppHandle,
    request: CommitManagedAgentDeletionRequest,
) -> Result<ManagedAgentDeletionResultDto, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let database = domain_database_path(&app)?;
    let agents_root = managed_agents_root(&app)?;
    let revisions = revisions_root(&app)?;
    let expires_at = request
        .preview_ref
        .split_once('-')
        .and_then(|(value, _)| value.parse::<i64>().ok())
        .ok_or_else(|| "AGENT_DELETE_PREVIEW_INVALID: previewRef 无效".to_string())?;
    if Utc::now().timestamp() > expires_at {
        return Err("AGENT_DELETE_PREVIEW_EXPIRED: 删除预览已过期".into());
    }
    let preview = preview_managed_agent_deletion_at(
        &database,
        &agents_root,
        &revisions,
        PreviewManagedAgentDeletionRequest {
            request_id: request.request_id.clone(),
            agent_id: request.agent_id.clone(),
        },
        Some(expires_at),
    )?;
    if !preview.can_commit || request.preview_ref != preview.preview_ref {
        return Err("AGENT_DELETE_TARGET_CHANGED: 删除目标或影响已变化，请重新预览".into());
    }
    if request.confirmation_text != preview.confirmation_text {
        return Err("AGENT_DELETE_CONFIRMATION_MISMATCH: 确认文字不匹配".into());
    }
    let payload =
        serde_json::json!({ "previewRef": preview.preview_ref, "impacts": preview.impacts });
    let operation = agent_service::prepare_operation_at(
        &database,
        &request.request_id,
        &request.agent_id,
        "delete",
        &preview.package_fingerprint,
        None,
        &payload,
    )?;
    finish_managed_agent_deletion(&database, &agents_root, &revisions, &operation)
}

#[tauri::command]
fn list_agents(app: tauri::AppHandle) -> Result<AgentListResult, String> {
    let mut result = list_managed_agents_at(&managed_agents_root(&app)?)?;
    result.agents.extend(
        agent_service::list_external_agents_at(&domain_database_path(&app)?)?
            .into_iter()
            .map(|reference| {
                let mut metadata = reference.metadata;
                if let Some(object) = metadata.as_object_mut() {
                    object.insert(
                        "packagePath".into(),
                        serde_json::Value::String(reference.canonical_root.clone()),
                    );
                    object.insert(
                        "packageSource".into(),
                        serde_json::json!({
                            "kind": "external-reference",
                            "externalPath": reference.canonical_root,
                            "strategy": "reference-only"
                        }),
                    );
                }
                metadata
            }),
    );
    result.agents.sort_by(|left, right| {
        left.get("id")
            .and_then(serde_json::Value::as_str)
            .cmp(&right.get("id").and_then(serde_json::Value::as_str))
    });
    Ok(result)
}

fn finish_agent_team(
    database: &Path,
    agents_root: &Path,
    operation: &agent_service::AgentRecoveryOperation,
) -> Result<agent_service::AgentRecoveryOperation, String> {
    match operation.payload.get("team").cloned() {
        None | Some(serde_json::Value::Null) => {
            agent_service::complete_operation_at(database, &operation.id)
        }
        Some(value) => {
            let team: AgentTeamReconcileRequest = serde_json::from_value(value)
                .map_err(|_| "Agent commit team payload 已损坏".to_string())?;
            domain_store::reconcile_agent_team_at(
                database,
                agents_root,
                &operation.id,
                &operation.agent_id,
                &team.team_id,
            )?;
            agent_service::get_operation_at(database, &operation.id)
        }
    }
}

fn append_agent_commit_revision(
    agents_root: &Path,
    revisions_root: &Path,
    operation: &agent_service::AgentRecoveryOperation,
    summary: &str,
) -> Result<(), String> {
    let fixed_revision_id = operation
        .fixed_revision_id
        .as_ref()
        .ok_or_else(|| "Agent commit 缺少 fixed revision".to_string())?;
    let root = agents_root.join(format!("agt_{}", operation.agent_id));
    let loaded = load_managed_agent_identity_at(&root, &operation.agent_id)?;
    if local_service::list_revisions_at(revisions_root, &loaded.asset_id)?
        .iter()
        .any(|revision| revision.id == *fixed_revision_id)
    {
        return Ok(());
    }
    let saved_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let revision = local_service::ConfigRevisionDto {
        id: fixed_revision_id.clone(),
        asset_id: loaded.asset_id,
        container_id: loaded.container_id,
        locator: loaded.locator,
        asset_content_hash: loaded.baseline_ref.asset_content_hash.clone(),
        container_content_hash: loaded.baseline_ref.container_content_hash.clone(),
        source_asset_baseline_hash: loaded.baseline_ref.asset_content_hash,
        source_container_baseline_hash: loaded.baseline_ref.container_content_hash,
        redacted: false,
        write_receipt_id: local_service::stable_id("agent-commit-receipt", fixed_revision_id),
        saved_at,
        summary: summary.into(),
        confirmation_refs: Vec::new(),
        restored_from_revision_id: None,
    };
    local_service::append_revision(revisions_root, &revision, &loaded.canonical_content)
        .map_err(|_| "Agent commit revision 无法记录".to_string())
}

fn load_committed_agent(agents_root: &Path, agent_id: &str) -> Result<serde_json::Value, String> {
    local_service::project_managed_agent_at(&agents_root.join(format!("agt_{agent_id}")), agent_id)
}

fn block_if_manifest_changed(
    database: &Path,
    agents_root: &Path,
    operation: &agent_service::AgentRecoveryOperation,
) -> Result<bool, String> {
    let manifest = agents_root
        .join(format!("agt_{}", operation.agent_id))
        .join("agent.yaml");
    let current = match fs::read(&manifest) {
        Ok(bytes) => local_service::hash_bytes(&bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("无法核验 Agent commit manifest".into()),
    };
    if current != operation.expected_manifest_hash {
        agent_service::set_operation_status_at(database, &operation.id, "blocked", None)?;
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
fn preview_claude_agent(
    request: claude_agent_import::PreviewClaudeAgentRequest,
) -> Result<ImportClaudeAgentPreviewResult, String> {
    Ok(ImportClaudeAgentPreviewResult {
        preview: claude_agent_import::preview(request)?,
    })
}

#[tauri::command]
fn import_claude_agent(
    app: tauri::AppHandle,
    mut request: ImportClaudeAgentRequest,
) -> Result<AgentCommitResult, String> {
    if !request.confirmed {
        return Err("CLAUDE_AGENT_CONFIRMATION_REQUIRED: 导入受管副本前必须明确确认".into());
    }
    let preview =
        claude_agent_import::verify(&request.source_path, &request.expected_source_baseline_hash)?;
    let instructions = request
        .commit
        .create
        .files
        .iter()
        .find(|file| file.path == "instructions.md")
        .ok_or_else(|| "INVALID_AGENT_PACKAGE: 缺少 instructions.md".to_string())?;
    if instructions.content != preview.instructions {
        return Err("CLAUDE_AGENT_INVALID: 受管 Instructions 必须来自已复核的来源正文".into());
    }
    if request.commit.create.avatar_bytes.is_some() {
        return Err("CLAUDE_AGENT_INVALID: 单文件导入不接受额外头像内容".into());
    }
    let agent = request
        .commit
        .create
        .agent
        .as_object_mut()
        .ok_or_else(|| "INVALID_AGENT_RECORD: Agent 记录必须是对象".to_string())?;
    agent.insert(
        "packageSource".into(),
        serde_json::json!({
            "kind": "managed-agent-import",
            "packageId": format!("agt_{}", request.commit.create.agent_id),
            "strategy": "managed-copy",
            "toolId": preview.tool_id,
            "sourceFileName": preview.source_file_name,
            "sourceBaselineHash": preview.source_baseline_hash,
            "importedAt": Utc::now().to_rfc3339(),
        }),
    );
    commit_managed_agent_creation(app, request.commit)
}

#[tauri::command]
fn commit_managed_agent_creation(
    app: tauri::AppHandle,
    request: CommitManagedAgentCreationRequest,
) -> Result<AgentCommitResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let database = domain_database_path(&app)?;
    let agents_root = managed_agents_root(&app)?;
    let manifest = request
        .create
        .files
        .iter()
        .find(|file| file.path == "agent.yaml")
        .ok_or_else(|| "INVALID_AGENT_PACKAGE: 缺少 agent.yaml".to_string())?;
    let agent_id = request.create.agent_id.clone();
    let fixed_revision_id = local_service::stable_id("agent-create-revision", &request.request_id);
    let payload = serde_json::json!({ "create": request.create, "team": request.team });
    let mut operation = agent_service::prepare_operation_at(
        &database,
        &request.request_id,
        &agent_id,
        "create",
        &local_service::hash_bytes(manifest.content.as_bytes()),
        Some(&fixed_revision_id),
        &payload,
    )?;
    let mut agent = None;
    if operation.status == "prepared" {
        let manifest_path = agents_root
            .join(format!("agt_{agent_id}"))
            .join("agent.yaml");
        if manifest_path.exists() {
            if block_if_manifest_changed(&database, &agents_root, &operation)? {
                return Ok(AgentCommitResult::new(
                    agent_service::get_operation_at(&database, &operation.id)?,
                    None,
                ));
            }
        } else {
            let create: CreateManagedAgentRequest =
                serde_json::from_value(payload["create"].clone())
                    .map_err(|_| "Agent create payload 已损坏".to_string())?;
            create_managed_agent_at(&agents_root, create)?;
            agent = Some(load_committed_agent(&agents_root, &agent_id)?);
        }
        operation = agent_service::set_operation_status_at(
            &database,
            &operation.id,
            "filesystem_committed",
            None,
        )?;
    }
    if operation.status == "filesystem_committed" {
        operation = agent_service::set_operation_status_at(
            &database,
            &operation.id,
            "revision_pending",
            None,
        )?;
    }
    if operation.status == "revision_pending" {
        append_agent_commit_revision(
            &agents_root,
            &revisions_root(&app)?,
            &operation,
            "创建 AgentPackage",
        )?;
        operation =
            agent_service::set_operation_status_at(&database, &operation.id, "team_pending", None)?;
    }
    if operation.status == "team_pending" {
        operation = finish_agent_team(&database, &agents_root, &operation)?;
    }
    if agent.is_none() && operation.status == "completed" {
        agent = Some(load_committed_agent(&agents_root, &agent_id)?);
    }
    Ok(AgentCommitResult::new(operation, agent))
}

#[tauri::command]
fn commit_managed_agent_identity(
    app: tauri::AppHandle,
    request: CommitManagedAgentIdentityRequest,
) -> Result<AgentCommitResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let database = domain_database_path(&app)?;
    let agents_root = managed_agents_root(&app)?;
    let expected_hash = local_service::hash_bytes(request.save.manifest.as_bytes());
    let payload = serde_json::json!({ "save": request.save, "team": request.team });
    let save: SaveManagedAgentIdentityRequest = serde_json::from_value(payload["save"].clone())
        .map_err(|_| "Agent identity payload 已损坏".to_string())?;
    let fixed_revision_id = local_service::stable_id("agent-identity-revision", &save.request_id);
    let mut operation = agent_service::prepare_operation_at(
        &database,
        &save.request_id,
        &save.agent_id,
        "identity_update",
        &expected_hash,
        Some(&fixed_revision_id),
        &payload,
    )?;
    if operation.status != "prepared"
        && block_if_manifest_changed(&database, &agents_root, &operation)?
    {
        return Ok(AgentCommitResult::new(
            agent_service::get_operation_at(&database, &operation.id)?,
            None,
        ));
    }
    let mut agent = None;
    if operation.status == "prepared" {
        match save_managed_agent_identity_with_revision_source(
            &agents_root.join(format!("agt_{}", save.agent_id)),
            &revisions_root(&app)?,
            save,
            None,
            Some(fixed_revision_id),
        ) {
            SaveManagedAgentIdentityResult::Saved {
                agent: value,
                revision,
                ..
            } => {
                agent = Some(value);
                operation = agent_service::set_operation_status_at(
                    &database,
                    &operation.id,
                    "filesystem_committed",
                    Some(&revision.id),
                )?;
            }
            SaveManagedAgentIdentityResult::Unchanged { agent: value, .. } => {
                agent = Some(value);
                operation = agent_service::set_operation_status_at(
                    &database,
                    &operation.id,
                    "filesystem_committed",
                    None,
                )?;
            }
            result => {
                if matches!(
                    &result,
                    SaveManagedAgentIdentityResult::SaveFailed {
                        recovery_ref: Some(_),
                        file_state,
                        ..
                    } if file_state == "verified_written_revision_pending"
                ) {
                    operation = agent_service::set_operation_status_at(
                        &database,
                        &operation.id,
                        "revision_pending",
                        None,
                    )?;
                }
                return Ok(AgentCommitResult::identity(operation, result));
            }
        }
    }
    if operation.status == "filesystem_committed" {
        operation =
            agent_service::set_operation_status_at(&database, &operation.id, "team_pending", None)?;
    }
    if operation.status == "team_pending" {
        operation = finish_agent_team(&database, &agents_root, &operation)?;
    }
    Ok(AgentCommitResult::new(operation, agent))
}

#[tauri::command]
fn list_agent_recovery_summaries(
    app: tauri::AppHandle,
    agent_id: Option<String>,
) -> Result<Vec<agent_service::AgentRecoverySummaryDto>, String> {
    agent_service::list_recovery_summaries_at(&domain_database_path(&app)?, agent_id.as_deref())
}

#[tauri::command]
fn continue_agent_recovery(
    app: tauri::AppHandle,
    request: ContinueAgentRecoveryRequest,
) -> Result<AgentCommitResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    let database = domain_database_path(&app)?;
    let agents_root = managed_agents_root(&app)?;
    let operation = agent_service::get_operation_at(&database, &request.operation_id)?;
    if operation.operation_kind == "delete" {
        let _ = finish_managed_agent_deletion(
            &database,
            &agents_root,
            &revisions_root(&app)?,
            &operation,
        )?;
        return Ok(AgentCommitResult::new(
            agent_service::get_operation_at(&database, &request.operation_id)?,
            None,
        ));
    }
    if matches!(operation.status.as_str(), "completed" | "blocked") {
        let agent = if operation.status == "completed" {
            Some(load_committed_agent(&agents_root, &operation.agent_id)?)
        } else {
            None
        };
        return Ok(AgentCommitResult::new(operation, agent));
    }
    if operation.status != "prepared"
        && block_if_manifest_changed(&database, &agents_root, &operation)?
    {
        return Ok(AgentCommitResult::new(
            agent_service::get_operation_at(&database, &request.operation_id)?,
            None,
        ));
    }
    match operation.operation_kind.as_str() {
        "create" => {
            if operation.status == "prepared" {
                let request_id = operation.request_id.clone();
                let create = serde_json::from_value(operation.payload["create"].clone())
                    .map_err(|_| "Agent create recovery payload 已损坏".to_string())?;
                let team = serde_json::from_value(
                    operation
                        .payload
                        .get("team")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null),
                )
                .map_err(|_| "Agent team recovery payload 已损坏".to_string())?;
                commit_managed_agent_creation(
                    app,
                    CommitManagedAgentCreationRequest {
                        request_id,
                        create,
                        team,
                    },
                )
            } else {
                let mut current = operation;
                if current.status == "filesystem_committed" {
                    current = agent_service::set_operation_status_at(
                        &database,
                        &current.id,
                        "revision_pending",
                        None,
                    )?;
                }
                if current.status == "revision_pending" {
                    append_agent_commit_revision(
                        &agents_root,
                        &revisions_root(&app)?,
                        &current,
                        "创建 AgentPackage",
                    )?;
                    current = agent_service::set_operation_status_at(
                        &database,
                        &current.id,
                        "team_pending",
                        None,
                    )?;
                }
                Ok(AgentCommitResult::new(
                    finish_agent_team(&database, &agents_root, &current)?,
                    None,
                ))
            }
        }
        "identity_update" => {
            if operation.status == "revision_pending" {
                let save: SaveManagedAgentIdentityRequest =
                    serde_json::from_value(operation.payload["save"].clone())
                        .map_err(|_| "Agent identity recovery payload 已损坏".to_string())?;
                let recovery_ref = operation
                    .fixed_revision_id
                    .clone()
                    .ok_or_else(|| "revision_pending operation 缺少 fixed revision".to_string())?;
                let loaded = load_managed_agent_identity_at(
                    &agents_root.join(format!("agt_{}", save.agent_id)),
                    &save.agent_id,
                )?;
                let recovered = recover_managed_agent_identity_at(
                    &agents_root.join(format!("agt_{}", save.agent_id)),
                    &revisions_root(&app)?,
                    RecoverManagedAgentIdentityRequest {
                        request_id: format!("recover-{}", operation.request_id),
                        agent_id: save.agent_id,
                        asset_id: loaded.asset_id,
                        recovery_ref,
                    },
                );
                if !matches!(
                    recovered,
                    SaveManagedAgentIdentityResult::Saved { .. }
                        | SaveManagedAgentIdentityResult::Unchanged { .. }
                ) {
                    return Err("Agent identity revision 仍无法补记".into());
                }
                let current = agent_service::set_operation_status_at(
                    &database,
                    &operation.id,
                    "team_pending",
                    None,
                )?;
                return Ok(AgentCommitResult::new(
                    finish_agent_team(&database, &agents_root, &current)?,
                    None,
                ));
            }
            if operation.status == "prepared" {
                let save = serde_json::from_value(operation.payload["save"].clone())
                    .map_err(|_| "Agent identity recovery payload 已损坏".to_string())?;
                let team = serde_json::from_value(
                    operation
                        .payload
                        .get("team")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null),
                )
                .map_err(|_| "Agent team recovery payload 已损坏".to_string())?;
                commit_managed_agent_identity(app, CommitManagedAgentIdentityRequest { save, team })
            } else {
                let mut current = operation;
                if current.status == "filesystem_committed" {
                    current = agent_service::set_operation_status_at(
                        &database,
                        &current.id,
                        "team_pending",
                        None,
                    )?;
                }
                Ok(AgentCommitResult::new(
                    finish_agent_team(&database, &agents_root, &current)?,
                    None,
                ))
            }
        }
        _ => Err("Agent commit operation kind 无效".into()),
    }
}

#[tauri::command]
fn discover_memory_spaces(
    app: tauri::AppHandle,
    request: memory_service::DiscoverMemorySpacesRequest,
) -> Result<memory_service::DiscoverMemorySpacesResult, String> {
    memory_service::discover_spaces_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        request,
    )
}

#[tauri::command]
fn load_memory(
    app: tauri::AppHandle,
    request: memory_service::LoadMemoryRequest,
) -> Result<memory_service::LoadedMemoryDto, String> {
    memory_service::load_memory_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        request,
    )
}

#[tauri::command]
fn save_memory(
    app: tauri::AppHandle,
    request: memory_service::SaveMemoryRequest,
) -> Result<memory_service::SaveMemoryResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    memory_service::save_memory_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        request,
    )
}

#[tauri::command]
fn list_memory_revisions(
    app: tauri::AppHandle,
    request: memory_service::ListMemoryRevisionsRequest,
) -> Result<Vec<memory_service::MemoryRevisionDto>, String> {
    memory_service::list_revisions_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        request,
    )
}

#[tauri::command]
fn recover_memory_revision(
    app: tauri::AppHandle,
    request: memory_service::RecoverMemoryRevisionRequest,
) -> Result<memory_service::SaveMemoryResult, String> {
    let _mutation = factory_reset::mutation_guard()?;
    memory_service::recover_revision_at(
        &domain_database_path(&app)?,
        &managed_agents_root(&app)?,
        request,
    )
}

#[tauri::command]
fn read_agent_avatar(app: tauri::AppHandle, agent_id: String) -> Result<Option<UiAsset>, String> {
    let bytes = match fs::read(managed_agent_dir(&app, &agent_id)?.join("avatar.png")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("AGENT_READ_FAILED: 无法读取 Agent 头像".into()),
    };
    validate_avatar(&bytes)?;
    Ok(Some(UiAsset {
        mime_type: "image/png",
        bytes,
    }))
}

const COMMAND_EVENT: &str = "bandi://app-command";
const COMMAND_IDS: &[&str] = &[
    "navigation.home",
    "navigation.agents",
    "navigation.organization",
    "navigation.tasks",
    "navigation.assets",
    "navigation.settings",
    "theme.toggle",
    "editor.save",
    "editor.cancel",
];

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "e2e")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if factory_reset::cleanup_committed_at(
                &app.path().app_data_dir()?,
                &app.path().home_dir()?,
            )
            .is_err()
            {
                let handle = app.handle().clone();
                let _ = std::thread::spawn(move || {
                    handle
                        .dialog()
                        .message("Bandi 无法完成重置后的安全清理，因此尚未启动，也不会创建新数据。请检查应用数据目录权限后重新打开 Bandi。")
                        .title("无法完成重置")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                })
                .join();
                return Err(std::io::Error::other("FACTORY_RESET_CLEANUP_FAILED").into());
            }
            remove_legacy_project_files(&managed_agents_root(&app.handle())?)
                .map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_long_term_domain_snapshot_v4,
            save_team_v4,
            remove_team_v4,
            save_task_brief_v4,
            remove_task_brief_v4,
            generate_entity_id,
            allocate_agent_id,
            discover_memory_spaces,
            load_memory,
            save_memory,
            list_memory_revisions,
            recover_memory_revision,
            preview_factory_reset,
            commit_factory_reset,
            restart_after_factory_reset,
            create_backup_snapshot,
            list_backup_snapshots,
            preview_backup_restore,
            restore_backup_snapshot,
            discover_config,
            create_shared_asset,
            select_shared_asset_import,
            commit_shared_asset_import,
            load_shared_asset_editor,
            save_shared_asset,
            repair_shared_asset_registration,
            recover_shared_asset_revision,
            load_config_editor,
            list_config_revisions,
            read_config_revision_content,
            save_config,
            recover_config_revision,
            restore_config_revision,
            list_host_integrations,
            preview_host_integration_install,
            commit_host_integration_install,
            preview_host_integration_uninstall,
            commit_host_integration_uninstall,
            reveal_host_directory,
            list_ai_tool_host_statuses,
            open_ai_tool_install_page,
            reveal_ai_tool_config_location,
            request_client_launch_v3,
            import_ui_asset,
            read_ui_asset,
            delete_ui_asset,
            read_agent_avatar,
            preview_claude_agent,
            import_claude_agent,
            load_managed_agent_identity,
            recover_managed_agent_identity,
            restore_managed_agent_identity,
            list_managed_agents,
            preview_managed_agent_deletion,
            commit_managed_agent_deletion,
            list_agents,
            commit_managed_agent_creation,
            commit_managed_agent_identity,
            continue_agent_recovery,
            list_agent_recovery_summaries
        ])
        .menu(|app| {
            let application = SubmenuBuilder::new(app, "Bandi")
                .about(None)
                .separator()
                .text("navigation.settings", "设置…")
                .separator()
                .hide()
                .hide_others()
                .separator()
                .quit()
                .build()?;
            let edit = SubmenuBuilder::new(app, "编辑")
                .item(
                    &MenuItemBuilder::with_id("editor.save", "保存配置")
                        .accelerator("CmdOrCtrl+S")
                        .build(app)?,
                )
                .text("editor.cancel", "取消编辑")
                .separator()
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let navigate = SubmenuBuilder::new(app, "导航")
                .text("navigation.home", "配置状态")
                .text("navigation.agents", "Agents")
                .text("navigation.organization", "组织")
                .text("navigation.tasks", "任务")
                .text("navigation.assets", "资产")
                .separator()
                .text("theme.toggle", "切换主题")
                .build()?;
            let window = SubmenuBuilder::new(app, "窗口")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            MenuBuilder::new(app)
                .item(&application)
                .item(&edit)
                .item(&navigate)
                .item(&window)
                .build()
        })
        .on_menu_event(|app, event| {
            let command = event.id().as_ref();
            if COMMAND_IDS.contains(&command) {
                let _ = app.emit(COMMAND_EVENT, command);
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 Bandi Desktop 失败");
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use super::{
        asset_name, create_managed_agent_at, image_mime, list_managed_agents_at,
        load_managed_agent_identity_at, preview_managed_agent_deletion_at,
        recover_managed_agent_identity_at, remove_legacy_project_files,
        restore_managed_agent_identity_at, save_managed_agent_identity_at, validate_agent_id,
        validate_avatar, AgentPackageFile, AvatarChange, CreateManagedAgentRequest, DiagnosticDto,
        LocalServiceEventDto, PreviewManagedAgentDeletionRequest,
        RecoverManagedAgentIdentityRequest, RestoreManagedAgentIdentityRequest,
        SaveManagedAgentIdentityRequest, SaveManagedAgentIdentityResult, AGENT_AVATAR_LIMIT,
        COMMAND_IDS, REQUIRED_AGENT_PACKAGE_FILES,
    };

    #[test]
    fn legacy_project_cleanup_stays_inside_managed_packages_and_does_not_follow_links() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join("agents");
        let package = agents.join("agt_alpha");
        let external = root.path().join("external");
        fs::create_dir_all(&package).unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::write(external.join("sentinel.txt"), "keep").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&external, package.join("projects")).unwrap();
        #[cfg(not(unix))]
        fs::create_dir_all(package.join("projects")).unwrap();

        remove_legacy_project_files(&agents).unwrap();

        assert!(!package.join("projects").exists());
        assert_eq!(
            fs::read_to_string(external.join("sentinel.txt")).unwrap(),
            "keep"
        );
    }

    #[test]
    fn menu_commands_are_whitelisted() {
        assert!(COMMAND_IDS.contains(&"editor.save"));
        assert!(!COMMAND_IDS.contains(&"shell.exec"));
    }

    #[test]
    fn tauri_commands_require_explicit_main_window_permissions() {
        let build_script = include_str!("../build.rs");
        let source = include_str!("lib.rs");
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("默认 capability 应为有效 JSON");
        assert_eq!(capability["windows"], serde_json::json!(["main"]));

        let permissions = capability["permissions"]
            .as_array()
            .expect("capability permissions 应为数组");
        assert!(permissions.iter().all(|permission| {
            permission
                .as_str()
                .is_some_and(|value| !value.contains('*'))
        }));

        let commands = build_script
            .lines()
            .filter_map(|line| {
                let value = line.trim().strip_suffix(',')?;
                value.strip_prefix('"')?.strip_suffix('"')
            })
            .collect::<Vec<_>>();
        assert!(!commands.is_empty());
        for command in commands {
            assert!(
                source.contains(&format!("            {command},"))
                    || source.contains(&format!("            {command}\n")),
                "{command} 未注册到 invoke_handler"
            );
            assert!(
                permissions
                    .iter()
                    .any(|permission| permission == &format!("allow-{}", command.replace('_', "-"))),
                "{command} 未向主窗口显式授权"
            );
        }
    }

    #[test]
    fn asset_reference_graph_matches_shared_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/asset-reference-graph.valid.json"
        ))
        .expect("共享资产引用图 fixture 应为 JSON");
        let nodes: Vec<crate::shared_assets::SharedAssetNodeDto> =
            serde_json::from_value(fixture["sharedAssets"].clone())
                .expect("共享资产节点应可反序列化");
        let references: Vec<crate::local_service::AssetReferenceDto> =
            serde_json::from_value(fixture["references"].clone())
                .expect("共享资产引用应可反序列化");
        assert_eq!(
            serde_json::to_value(nodes).unwrap(),
            fixture["sharedAssets"]
        );
        assert_eq!(
            serde_json::to_value(references).unwrap(),
            fixture["references"]
        );
    }

    #[test]
    fn core_contracts_match_shared_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../packages/contracts/fixtures/core-contracts.valid.json"
        ))
        .expect("核心共享 fixture 应为 JSON");
        let baseline: crate::local_service::BaselineRefDto =
            serde_json::from_value(fixture["baseline"].clone())
                .expect("Baseline fixture 应可反序列化");
        assert_eq!(serde_json::to_value(baseline).unwrap(), fixture["baseline"]);
        let diagnostic: DiagnosticDto = serde_json::from_value(fixture["diagnostic"].clone())
            .expect("Diagnostic fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(diagnostic).unwrap(),
            fixture["diagnostic"]
        );
        let event: LocalServiceEventDto =
            serde_json::from_value(fixture["event"].clone()).expect("Event fixture 应可反序列化");
        assert_eq!(serde_json::to_value(event).unwrap(), fixture["event"]);
        let request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["saveRequest"].clone())
                .expect("SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            fixture["saveRequest"]
        );
        let context_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["contextSaveRequest"].clone())
                .expect("Context SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(context_request).unwrap(),
            fixture["contextSaveRequest"]
        );
        let rules_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["rulesSaveRequest"].clone())
                .expect("Rules SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(rules_request).unwrap(),
            fixture["rulesSaveRequest"]
        );
        let skills_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["skillsSaveRequest"].clone())
                .expect("Skills SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(skills_request).unwrap(),
            fixture["skillsSaveRequest"]
        );
        let mcp_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["mcpSaveRequest"].clone())
                .expect("MCP SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(mcp_request).unwrap(),
            fixture["mcpSaveRequest"]
        );
        let sop_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["sopSaveRequest"].clone())
                .expect("SOP SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(sop_request).unwrap(),
            fixture["sopSaveRequest"]
        );
        let hooks_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["hooksSaveRequest"].clone())
                .expect("Hooks SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(hooks_request).unwrap(),
            fixture["hooksSaveRequest"]
        );
        let commands_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["commandsSaveRequest"].clone())
                .expect("Commands SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(commands_request).unwrap(),
            fixture["commandsSaveRequest"]
        );
        let permissions_request: crate::local_service::SaveConfigRequest =
            serde_json::from_value(fixture["permissionsSaveRequest"].clone())
                .expect("Permissions SaveConfig fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(permissions_request).unwrap(),
            fixture["permissionsSaveRequest"]
        );
        let confirmation_result: crate::local_service::SaveConfigResult =
            serde_json::from_value(fixture["confirmationRequired"].clone())
                .expect("confirmation_required fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(confirmation_result).unwrap(),
            fixture["confirmationRequired"]
        );
        let recovery: RecoverManagedAgentIdentityRequest =
            serde_json::from_value(fixture["identityRecoveryRequest"].clone())
                .expect("Identity recovery fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(recovery).unwrap(),
            fixture["identityRecoveryRequest"]
        );
        let restore: RestoreManagedAgentIdentityRequest =
            serde_json::from_value(fixture["identityRestoreRequest"].clone())
                .expect("Identity restore fixture 应可反序列化");
        assert_eq!(
            serde_json::to_value(restore).unwrap(),
            fixture["identityRestoreRequest"]
        );
    }

    #[test]
    fn ui_asset_slots_are_whitelisted() {
        assert_eq!(asset_name("logo"), Ok(("logo.asset", 5 * 1024 * 1024)));
        assert_eq!(
            asset_name("background"),
            Ok(("background.asset", 15 * 1024 * 1024))
        );
        assert!(asset_name("../config").is_err());
    }

    #[test]
    fn ui_assets_only_accept_png_and_jpeg_signatures() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\nrest"), Ok("image/png"));
        assert_eq!(image_mime(&[0xff, 0xd8, 0xff, 0xe0]), Ok("image/jpeg"));
        assert!(image_mime(b"<svg></svg>").is_err());
        assert!(image_mime(&[]).is_err());
    }

    #[test]
    fn agent_avatar_and_id_are_validated() {
        assert!(validate_agent_id("agent-1").is_ok());
        assert!(validate_agent_id("../agent").is_err());
        assert!(validate_avatar(b"\x89PNG\r\n\x1a\nrest").is_ok());
        assert!(validate_avatar(b"not png").is_err());
        assert!(validate_avatar(&vec![0; AGENT_AVATAR_LIMIT + 1]).is_err());
    }

    fn minimal_agent_package_files(manifest: &str) -> Vec<AgentPackageFile> {
        [
            ("agent.yaml", manifest),
            ("instructions.md", ""),
            (
                "config/context.yaml",
                "schemaVersion: 1\ncontextPolicy:\n  enabled: false\n  triggerRatio: 0.8\n  targetRatio: 0.5\n  protectRecentTurns: 6\n  protectOpeningTurns: 2\ncontextWindowTokens: 200000\noutputProfileId: \"\"\noutputParameterBindings: []\n",
            ),
            ("config/skills.yaml", "schemaVersion: 1\nskills:\n  []\n"),
            ("config/rules.yaml", "schemaVersion: 1\nrules:\n  []\n"),
            ("config/mcp.yaml", "schemaVersion: 1\nmcp:\n  []\n"),
            (
                "config/permissions.yaml",
                "schemaVersion: 1\npermissions:\n  files: \"未授予\"\n  commands: \"未授予\"\n  network: \"未授予\"\n  delegation: \"未授予\"\n",
            ),
            ("config/sop.yaml", "schemaVersion: 1\nsop:\n  []\n"),
            ("config/hooks.yaml", "schemaVersion: 1\nhooks: []\n"),
            ("config/commands.yaml", "schemaVersion: 1\ncommands: []\n"),
        ]
        .into_iter()
        .map(|(path, content)| AgentPackageFile {
            path: path.into(),
            content: content.into(),
        })
        .collect()
    }

    #[test]
    fn managed_agent_creation_requires_complete_unique_canonical_files() {
        let manifest = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\n";
        for required in REQUIRED_AGENT_PACKAGE_FILES {
            let root = tempfile::tempdir().unwrap();
            let files = minimal_agent_package_files(manifest)
                .into_iter()
                .filter(|file| file.path != *required)
                .collect();
            let result = create_managed_agent_at(
                root.path(),
                CreateManagedAgentRequest {
                    agent_id: "test-agent".into(),
                    agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent", "avatarPath": null }),
                    files,
                    avatar_bytes: None,
                },
            );
            assert!(
                result.err().unwrap().contains(&format!("缺少 {required}")),
                "{required} 缺失时应拒绝创建"
            );
            assert!(!root.path().join("agt_test-agent").exists());
            assert!(!root.path().join(".agt_test-agent.staging").exists());
        }

        let root = tempfile::tempdir().unwrap();
        let mut files = minimal_agent_package_files(manifest);
        files.push(
            files
                .iter()
                .find(|file| file.path == "config/rules.yaml")
                .unwrap()
                .clone(),
        );
        let result = create_managed_agent_at(
            root.path(),
            CreateManagedAgentRequest {
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent", "avatarPath": null }),
                files,
                avatar_bytes: None,
            },
        );
        assert!(result
            .err()
            .unwrap()
            .contains("文件路径重复：config/rules.yaml"));
        assert!(!root.path().join("agt_test-agent").exists());
    }

    #[test]
    fn managed_agent_creation_validates_staging_before_commit() {
        let root = tempfile::tempdir().unwrap();
        let manifest = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\n";
        let mut files = minimal_agent_package_files(manifest);
        files
            .iter_mut()
            .find(|file| file.path == "config/rules.yaml")
            .unwrap()
            .content = "rules: [".into();

        let result = create_managed_agent_at(
            root.path(),
            CreateManagedAgentRequest {
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent", "avatarPath": null }),
                files,
                avatar_bytes: None,
            },
        );

        assert!(result.err().unwrap().contains("AGENT_CANONICAL_INVALID"));
        assert!(!root.path().join("agt_test-agent").exists());
        assert!(!root.path().join(".agt_test-agent.staging").exists());
    }

    #[test]
    fn managed_agent_creation_rejects_removed_orchestration_file() {
        let root = tempfile::tempdir().unwrap();
        let manifest = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\n";
        let mut files = minimal_agent_package_files(manifest);
        files.push(AgentPackageFile {
            path: "config/orchestration.yaml".into(),
            content: "schemaVersion: 1\n".into(),
        });

        let result = create_managed_agent_at(
            root.path(),
            CreateManagedAgentRequest {
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent", "avatarPath": null }),
                files,
                avatar_bytes: None,
            },
        );

        assert!(result
            .err()
            .unwrap()
            .contains("config/orchestration.yaml 已不再受支持"));
        assert!(!root.path().join("agt_test-agent").exists());
        assert!(!root.path().join(".agt_test-agent.staging").exists());
    }

    #[test]
    fn managed_agent_identity_saves_revision_and_checks_baseline() {
        let root = tempfile::tempdir().expect("应创建隔离目录");
        let manifest = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\n";
        let created = create_managed_agent_at(
            root.path(),
            CreateManagedAgentRequest {
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent", "avatarPath": "avatar.png" }),
                files: minimal_agent_package_files(manifest),
                avatar_bytes: Some(b"\x89PNG\r\n\x1a\nrest".to_vec()),
            },
        )
        .expect("隔离目录中的 AgentPackage 应创建成功");
        assert_eq!(
            created.baseline_ref.asset_content_hash,
            crate::local_service::hash_bytes(manifest.as_bytes())
        );

        let package = root.path().join("agt_test-agent");
        let revisions = root.path().join("revisions");
        let loaded = load_managed_agent_identity_at(&package, "test-agent")
            .expect("应加载真实 identity baseline");
        let updated = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\nname: updated\n";
        let saved = save_managed_agent_identity_at(
            &package,
            &revisions,
            SaveManagedAgentIdentityRequest {
                request_id: "save-identity".into(),
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent", "avatarPath": null }),
                manifest: updated.into(),
                expected_baseline: loaded.baseline_ref.clone(),
                base_content: loaded.canonical_content.clone(),
                avatar: AvatarChange::Remove,
            },
        );
        let SaveManagedAgentIdentityResult::Saved {
            baseline_ref,
            revision,
            ..
        } = saved
        else {
            panic!("正确基线应返回 saved");
        };
        assert!(!package.join("avatar.png").exists());
        assert_eq!(
            baseline_ref.asset_content_hash,
            crate::local_service::hash_bytes(updated.as_bytes())
        );
        assert_eq!(
            crate::local_service::read_revision_content_at(&revisions, &revision.id).unwrap(),
            updated
        );

        let reloaded = load_managed_agent_identity_at(&package, "test-agent").unwrap();
        std::fs::write(
            package.join("agent.yaml"),
            "schemaVersion: 1\nid: test-agent\nteamId: team-personal\nname: external\n",
        )
        .unwrap();
        let changed = save_managed_agent_identity_at(
            &package,
            &revisions,
            SaveManagedAgentIdentityRequest {
                request_id: "save-conflict".into(),
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "测试 Agent" }),
                manifest:
                    "schemaVersion: 1\nid: test-agent\nteamId: team-personal\nname: proposed\n"
                        .into(),
                expected_baseline: reloaded.baseline_ref,
                base_content: reloaded.canonical_content,
                avatar: AvatarChange::Keep,
            },
        );
        assert!(matches!(
            changed,
            SaveManagedAgentIdentityResult::BaselineChanged { .. }
        ));
    }

    fn canonical_agent_fixture(root: &Path) -> PathBuf {
        let files = vec![
            ("agent.yaml", "schemaVersion: 1\nid: alpha\nname: Canonical\nteamId: team-personal\nstatus: active\nmission: canonical mission\nresponsibilities: []\ndeliverables: []\ndecisionBoundaries: []\nescalationConditions: []\nprohibitions: []\ncompletionDefinition: []\n"),
            ("instructions.md", "# Canonical\n"),
            ("config/context.yaml", "schemaVersion: 1\ncontextPolicy:\n  enabled: true\n  triggerRatio: 0.8\n  targetRatio: 0.5\n  protectRecentTurns: 6\n  protectOpeningTurns: 2\ncontextWindowTokens: 200000\noutputProfileId: \"\"\noutputParameterBindings: []\n"),
            ("config/rules.yaml", "schemaVersion: 1\nrules:\n  []\n"),
            ("config/skills.yaml", "schemaVersion: 1\nskills:\n  []\n"),
            ("config/mcp.yaml", "schemaVersion: 1\nmcp:\n  []\n"),
            ("config/permissions.yaml", "schemaVersion: 1\npermissions:\n  files: \"仅当前工作区\"\n  commands: \"构建与测试\"\n  network: \"禁止\"\n  delegation: \"禁止\"\n"),
            ("config/sop.yaml", "schemaVersion: 1\nsop:\n  []\n"),
            ("config/hooks.yaml", "schemaVersion: 1\nhooks: []\n"),
            ("config/commands.yaml", "schemaVersion: 1\ncommands: []\n"),
            ("projects/project-1/config.yaml", "schemaVersion: 1\nprojectBinding: { projectId: project-1, instructions: old binding, ruleIds: [], skillIds: [], mcpIds: [] }\n"),
        ];
        let stale = serde_json::json!({
            "id": "alpha",
            "name": "Stale",
            "status": "inactive",
            "packageSource": { "kind": "bandi-managed", "packageId": "agt_alpha", "strategy": "managed" }
        });
        create_managed_agent_at(
            root,
            CreateManagedAgentRequest {
                agent_id: "alpha".into(),
                agent: stale,
                files: files
                    .into_iter()
                    .map(|(path, content)| AgentPackageFile {
                        path: path.into(),
                        content: content.into(),
                    })
                    .collect(),
                avatar_bytes: None,
            },
        )
        .unwrap();
        root.join("agt_alpha")
    }

    #[test]
    fn deletion_preview_accepts_active_agent_and_changes_with_target() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join("agents");
        fs::create_dir(&agents).unwrap();
        let package = canonical_agent_fixture(&agents);
        let database = root.path().join("bandi.db");
        let revisions = root.path().join("revisions");
        let request = || PreviewManagedAgentDeletionRequest {
            request_id: "delete-alpha".into(),
            agent_id: "alpha".into(),
        };

        let first = preview_managed_agent_deletion_at(
            &database,
            &agents,
            &revisions,
            request(),
            Some(1_900_000_000),
        )
        .unwrap();
        assert!(first.can_commit);
        assert_eq!(first.confirmation_text, "永久删除 Canonical");
        assert_eq!(first.agent_id, "alpha");
        let manifest = fs::read_to_string(package.join("agent.yaml"))
            .unwrap()
            .replace("name: Canonical", "name: Renamed");
        fs::write(package.join("agent.yaml"), manifest).unwrap();
        let second = preview_managed_agent_deletion_at(
            &database,
            &agents,
            &revisions,
            request(),
            Some(1_900_000_000),
        )
        .unwrap();
        assert_eq!(second.confirmation_text, "永久删除 Renamed");
        assert_eq!(second.agent_id, "alpha");
        assert_ne!(first.preview_ref, second.preview_ref);
    }

    #[test]
    fn managed_agent_deletion_quarantines_and_completes() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join("agents");
        fs::create_dir(&agents).unwrap();
        let package = canonical_agent_fixture(&agents);
        let manifest = fs::read_to_string(package.join("agent.yaml"))
            .unwrap()
            .replace("status: active", "status: archived");
        fs::write(package.join("agent.yaml"), manifest).unwrap();
        let database = root.path().join("bandi.db");
        let revisions = root.path().join("revisions");
        let (fingerprint, impacts) =
            super::managed_agent_deletion_facts(&database, &agents, &revisions, "alpha").unwrap();
        let operation = crate::agent_service::prepare_operation_at(
            &database,
            "delete-alpha",
            "alpha",
            "delete",
            &fingerprint,
            None,
            &serde_json::json!({"impacts": impacts}),
        )
        .unwrap();

        let result =
            super::finish_managed_agent_deletion(&database, &agents, &revisions, &operation)
                .unwrap();

        assert_eq!(result.status, "completed");
        assert!(!agents.join("agt_alpha").exists());
        assert!(!agents.join(".agt_alpha.delete").exists());
    }

    #[test]
    fn managed_agent_deletion_reports_cleanup_pending_after_database_commit() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join("agents");
        fs::create_dir(&agents).unwrap();
        let package = canonical_agent_fixture(&agents);
        let manifest = fs::read_to_string(package.join("agent.yaml"))
            .unwrap()
            .replace("status: active", "status: archived");
        fs::write(package.join("agent.yaml"), manifest).unwrap();
        let database = root.path().join("bandi.db");
        let revisions = root.path().join("revisions");
        fs::create_dir(&revisions).unwrap();
        let (fingerprint, impacts) =
            super::managed_agent_deletion_facts(&database, &agents, &revisions, "alpha").unwrap();
        let operation = crate::agent_service::prepare_operation_at(
            &database,
            "delete-alpha-pending",
            "alpha",
            "delete",
            &fingerprint,
            None,
            &serde_json::json!({"impacts": impacts}),
        )
        .unwrap();
        fs::remove_dir(&revisions).unwrap();
        fs::write(&revisions, "not a directory").unwrap();

        let result =
            super::finish_managed_agent_deletion(&database, &agents, &revisions, &operation)
                .unwrap();

        assert_eq!(result.status, "cleanup_pending");
        assert_eq!(result.operation_id, operation.id);
        assert_eq!(result.pending_cleanup, vec!["清理配置版本"]);
        assert!(result.safe_reason.unwrap().contains("请勿重复删除"));
        assert!(!agents.join("agt_alpha").exists());
        assert!(agents.join(".agt_alpha.delete").exists());
        assert_eq!(
            crate::agent_service::get_operation_at(&database, &operation.id)
                .unwrap()
                .status,
            "database_committed"
        );
    }

    #[test]
    fn managed_agent_list_accepts_missing_empty_reference_files() {
        let cases = [
            ("config/rules.yaml", "ruleRefs"),
            ("config/skills.yaml", "skillRefs"),
            ("config/mcp.yaml", "mcpRefs"),
            ("config/sop.yaml", "sopRefs"),
            ("config/hooks.yaml", "hookRefs"),
            ("config/commands.yaml", "commandRefs"),
        ];
        for (path, field) in cases {
            let root = tempfile::tempdir().unwrap();
            let package = canonical_agent_fixture(root.path());
            std::fs::remove_file(package.join(path)).unwrap();
            let listed = list_managed_agents_at(root.path()).unwrap();
            assert_eq!(listed.agents[0][field], serde_json::json!([]), "{path}");
            assert!(
                !listed.agents[0]["files"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|file| file["path"] == path),
                "{path} 不应作为不存在的文件进入投影"
            );
            assert!(listed.diagnostics.is_empty());
        }
    }

    #[test]
    fn managed_agent_list_rejects_invalid_optional_reference_file() {
        let root = tempfile::tempdir().unwrap();
        let package = canonical_agent_fixture(root.path());
        std::fs::write(package.join("config/rules.yaml"), "rules: [").unwrap();
        let result = list_managed_agents_at(root.path()).unwrap();
        assert!(result.agents.is_empty());
        assert_eq!(result.diagnostics[0].code, "AGENT_CANONICAL_INVALID");
        assert_eq!(
            result.diagnostics[0].path.as_deref(),
            Some("config/rules.yaml")
        );
    }

    #[test]
    fn managed_agent_list_reports_missing_index_and_broken_canonical_files() {
        let root = tempfile::tempdir().unwrap();
        let package = canonical_agent_fixture(root.path());
        std::fs::remove_file(package.join(".bandi-agent.json")).unwrap();
        let missing = list_managed_agents_at(root.path()).unwrap();
        assert!(missing.agents.is_empty());
        assert_eq!(missing.diagnostics[0].code, "AGENT_INDEX_MISSING");

        let root = tempfile::tempdir().unwrap();
        let package = canonical_agent_fixture(root.path());
        std::fs::remove_file(package.join("config/permissions.yaml")).unwrap();
        let broken = list_managed_agents_at(root.path()).unwrap();
        assert!(broken.agents.is_empty());
        assert_eq!(broken.diagnostics[0].code, "AGENT_CANONICAL_MISSING");
        assert_eq!(
            broken.diagnostics[0].path.as_deref(),
            Some("config/permissions.yaml")
        );
    }

    #[test]
    fn managed_identity_recovery_and_restore_preserve_history() {
        let root = tempfile::tempdir().unwrap();
        let manifest = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\nname: original\n";
        create_managed_agent_at(
            root.path(),
            CreateManagedAgentRequest {
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "original", "avatarPath": null }),
                files: minimal_agent_package_files(manifest),
                avatar_bytes: None,
            },
        )
        .unwrap();
        let package = root.path().join("agt_test-agent");
        let revisions = root.path().join("revisions");
        let loaded = load_managed_agent_identity_at(&package, "test-agent").unwrap();
        let updated = "schemaVersion: 1\nid: test-agent\nteamId: team-personal\nname: updated\n";
        let saved = save_managed_agent_identity_at(
            &package,
            &revisions,
            SaveManagedAgentIdentityRequest {
                request_id: "save-first".into(),
                agent_id: "test-agent".into(),
                agent: serde_json::json!({ "id": "test-agent", "name": "updated", "avatarPath": null }),
                manifest: updated.into(),
                expected_baseline: loaded.baseline_ref,
                base_content: loaded.canonical_content,
                avatar: AvatarChange::Keep,
            },
        );
        let SaveManagedAgentIdentityResult::Saved { revision, .. } = saved else {
            panic!("首次 identity 保存应成功");
        };
        let current = load_managed_agent_identity_at(&package, "test-agent").unwrap();
        let restored = restore_managed_agent_identity_at(
            &package,
            &revisions,
            RestoreManagedAgentIdentityRequest {
                request_id: "restore-identity".into(),
                agent_id: "test-agent".into(),
                asset_id: current.asset_id.clone(),
                revision_id: revision.id.clone(),
                expected_baseline: current.baseline_ref,
                base_content: current.canonical_content,
                confirmed: true,
            },
        );
        assert!(matches!(
            restored,
            SaveManagedAgentIdentityResult::Unchanged { .. }
        ));

        let recovery_ref = "revision-recovery".to_string();
        let recovered = recover_managed_agent_identity_at(
            &package,
            &revisions,
            RecoverManagedAgentIdentityRequest {
                request_id: "recover-identity".into(),
                agent_id: "test-agent".into(),
                asset_id: current.asset_id,
                recovery_ref: recovery_ref.clone(),
            },
        );
        assert!(matches!(
            recovered,
            SaveManagedAgentIdentityResult::Saved { .. }
        ));
        assert_eq!(
            crate::local_service::read_revision_content_at(&revisions, &recovery_ref).unwrap(),
            updated
        );
        assert_eq!(
            crate::local_service::read_revision_content_at(&revisions, &revision.id).unwrap(),
            updated
        );
    }
}
