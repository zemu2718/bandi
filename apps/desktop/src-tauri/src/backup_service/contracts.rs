use serde::{Deserialize, Serialize};

use crate::local_service::{AssetLocatorDto, BaselineRefDto, DiagnosticDto};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupFilesScopeDto {
    pub(crate) kind: String,
    pub(crate) asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateBackupSnapshotRequest {
    pub(crate) request_id: String,
    pub(crate) scope: BackupFilesScopeDto,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupSnapshotEntryDto {
    pub(crate) asset_id: String,
    pub(crate) container_id: String,
    pub(crate) kind: String,
    pub(crate) locator: AssetLocatorDto,
    pub(crate) asset_content_hash: String,
    pub(crate) container_content_hash: String,
    pub(crate) snapshot_content_hash: String,
    pub(crate) size_bytes: u64,
    pub(crate) redacted: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupSnapshotDto {
    pub(crate) id: String,
    pub(crate) kind: String,
    pub(crate) scope: String,
    pub(crate) created_at: String,
    pub(crate) entry_count: u64,
    pub(crate) manifest_hash: String,
    pub(crate) integrity: String,
    pub(crate) entries: Vec<BackupSnapshotEntryDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreviewBackupRestoreRequest {
    pub(crate) request_id: String,
    pub(crate) snapshot_id: String,
    pub(crate) asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupRestorePreviewEntryDto {
    pub(crate) asset_id: String,
    pub(crate) status: String,
    pub(crate) snapshot_content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_baseline: Option<BaselineRefDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupRestorePreviewDto {
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) snapshot_id: String,
    pub(crate) expires_at: String,
    pub(crate) entries: Vec<BackupRestorePreviewEntryDto>,
    pub(crate) can_restore: bool,
    pub(crate) requires_confirmation: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoreBackupSnapshotRequest {
    pub(crate) request_id: String,
    pub(crate) snapshot_id: String,
    pub(crate) asset_ids: Vec<String>,
    pub(crate) preview_ref: String,
    pub(crate) confirmed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupRestoreEntryResultDto {
    pub(crate) asset_id: String,
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) revision_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) retryable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) file_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recovery_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BackupRestoreResultDto {
    pub(crate) kind: String,
    pub(crate) request_id: String,
    pub(crate) snapshot_id: String,
    pub(crate) pre_restore_snapshot_id: String,
    pub(crate) entries: Vec<BackupRestoreEntryResultDto>,
}
