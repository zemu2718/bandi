use std::{collections::HashMap, path::Path};

use chrono::{Duration, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};

use crate::{
    domain_store,
    local_service::{
        self, BaselineRefDto, ConfigChangeDto, LoadEditorRequest, SaveConfigRequest,
        SaveConfigResult,
    },
};

use super::{
    contracts::{
        BackupRestoreEntryResultDto, BackupRestorePreviewDto, BackupRestorePreviewEntryDto,
        BackupRestoreResultDto, PreviewBackupRestoreRequest, RestoreBackupSnapshotRequest,
    },
    storage::{
        create_snapshot_internal, diagnostic, hash_bytes, load_entries, load_snapshot,
        validate_asset_ids, validate_id, verify_entry_content,
    },
};

fn config_change(kind: &str, value: String) -> Option<ConfigChangeDto> {
    Some(match kind {
        "instructions" => ConfigChangeDto::Instructions { value },
        "context" => ConfigChangeDto::Context { value },
        "rules" => ConfigChangeDto::Rules { value },
        "skills" => ConfigChangeDto::Skills { value },
        "mcp" => ConfigChangeDto::Mcp { value },
        "permissions" => ConfigChangeDto::Permissions { value },
        "sop" => ConfigChangeDto::Sop { value },
        "hooks" => ConfigChangeDto::Hooks { value },
        "commands" => ConfigChangeDto::Commands { value },
        _ => return None,
    })
}

pub(crate) fn preview_restore_at(
    database: &Path,
    managed_root: &Path,
    backup_root: &Path,
    request: PreviewBackupRestoreRequest,
) -> Result<BackupRestorePreviewDto, String> {
    if !validate_id(&request.request_id) || !validate_id(&request.snapshot_id) {
        return Err("Backup 恢复预览请求无效".into());
    }
    validate_asset_ids(&request.asset_ids)?;
    let connection = domain_store::open_at(database)?;
    let snapshot = load_snapshot(&connection, &request.snapshot_id)?;
    let stored = load_entries(&connection, &request.snapshot_id)?;
    let by_id: HashMap<_, _> = stored
        .into_iter()
        .map(|(entry, content_ref)| (entry.asset_id.clone(), (entry, content_ref)))
        .collect();
    let mut entries = Vec::new();
    let mut baselines = HashMap::new();
    for asset_id in &request.asset_ids {
        let Some((entry, content_ref)) = by_id.get(asset_id) else {
            entries.push(BackupRestorePreviewEntryDto {
                asset_id: asset_id.clone(),
                status: "unavailable".into(),
                snapshot_content_hash: hash_bytes(&[]),
                current_baseline: None,
                diagnostics: vec![diagnostic(
                    "backup_asset_not_in_snapshot",
                    "所选资产不在该 Backup 快照中",
                    "只选择快照中已有的资产",
                )],
            });
            continue;
        };
        let integrity = verify_entry_content(backup_root, entry, content_ref);
        let loaded = local_service::load_editor_at(
            managed_root,
            LoadEditorRequest {
                request_id: format!("preview-{}", entry.asset_id),
                asset_id: entry.asset_id.clone(),
            },
        );
        let (status, baseline, diagnostics) = match (integrity, loaded) {
            (Err(issue), _) => ("integrity_failed", None, vec![*issue]),
            (Ok(_), Err(_)) => (
                "missing_current",
                None,
                vec![diagnostic(
                    "backup_current_asset_missing",
                    "当前配置资产不存在或不可编辑",
                    "恢复资产注册或重新创建快照",
                )],
            ),
            (Ok(_), Ok(loaded)) => {
                baselines.insert(entry.asset_id.clone(), loaded.baseline_ref.clone());
                ("ready", Some(loaded.baseline_ref), Vec::new())
            }
        };
        entries.push(BackupRestorePreviewEntryDto {
            asset_id: entry.asset_id.clone(),
            status: status.into(),
            snapshot_content_hash: entry.snapshot_content_hash.clone(),
            current_baseline: baseline,
            diagnostics,
        });
    }
    let can_restore = entries.iter().all(|entry| entry.status == "ready");
    let expires_at =
        (Utc::now() + Duration::minutes(10)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let preview_ref = local_service::stable_id(
        "backup-preview",
        &format!(
            "{}:{}:{}:{}",
            snapshot.id,
            request.asset_ids.join(":"),
            snapshot.manifest_hash,
            expires_at
        ),
    );
    connection
        .execute(
            "INSERT INTO backup_restore_operations
             (id, snapshot_id, preview_ref, requested_asset_ids_json, current_baselines_json,
              status, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'previewed', ?6, ?7)",
            params![
                request.request_id,
                snapshot.id,
                preview_ref,
                serde_json::to_string(&request.asset_ids).map_err(|_| "无法序列化恢复资产范围")?,
                serde_json::to_string(&baselines).map_err(|_| "无法序列化恢复基线")?,
                expires_at,
                Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            ],
        )
        .map_err(|_| "无法记录 Backup 恢复预览".to_string())?;
    Ok(BackupRestorePreviewDto {
        request_id: request.request_id,
        preview_ref,
        snapshot_id: request.snapshot_id,
        expires_at,
        entries,
        can_restore,
        requires_confirmation: true,
    })
}

fn save_result(asset_id: String, result: SaveConfigResult) -> BackupRestoreEntryResultDto {
    match result {
        SaveConfigResult::Saved { revision, .. } => BackupRestoreEntryResultDto {
            asset_id,
            status: "restored".into(),
            revision_id: Some(revision.id),
            retryable: None,
            file_state: None,
            recovery_ref: None,
            diagnostics: Vec::new(),
        },
        SaveConfigResult::Unchanged { .. } => BackupRestoreEntryResultDto {
            asset_id,
            status: "skipped".into(),
            revision_id: None,
            retryable: None,
            file_state: None,
            recovery_ref: None,
            diagnostics: Vec::new(),
        },
        SaveConfigResult::BaselineChanged { diagnostics, .. } => BackupRestoreEntryResultDto {
            asset_id,
            status: "baseline_changed".into(),
            revision_id: None,
            retryable: None,
            file_state: None,
            recovery_ref: None,
            diagnostics,
        },
        SaveConfigResult::ConfirmationRequired { diagnostics, .. } => {
            let mut diagnostics = diagnostics;
            diagnostics.push(diagnostic(
                "backup_permission_expansion_blocked",
                "Backup 恢复不能扩大长期权限",
                "先在权限页面独立确认权限变更，再重新创建快照或恢复其他资产",
            ));
            BackupRestoreEntryResultDto {
                asset_id,
                status: "save_failed".into(),
                revision_id: None,
                retryable: Some(false),
                file_state: Some("unchanged".into()),
                recovery_ref: None,
                diagnostics,
            }
        }
        SaveConfigResult::ValidationFailed { diagnostics, .. } => BackupRestoreEntryResultDto {
            asset_id,
            status: "validation_failed".into(),
            revision_id: None,
            retryable: None,
            file_state: Some("unchanged".into()),
            recovery_ref: None,
            diagnostics,
        },
        SaveConfigResult::SaveFailed {
            diagnostics,
            retryable,
            file_state,
            recovery_ref,
            ..
        } => BackupRestoreEntryResultDto {
            asset_id,
            status: "save_failed".into(),
            revision_id: None,
            retryable: Some(retryable),
            file_state: Some(file_state),
            recovery_ref,
            diagnostics,
        },
    }
}

pub(crate) fn restore_snapshot_at(
    database: &Path,
    managed_root: &Path,
    revisions_root: &Path,
    backup_root: &Path,
    request: RestoreBackupSnapshotRequest,
) -> Result<BackupRestoreResultDto, String> {
    if !request.confirmed
        || !validate_id(&request.request_id)
        || !validate_id(&request.snapshot_id)
        || !validate_id(&request.preview_ref)
    {
        return Err("Backup 恢复需要有效的独立确认".into());
    }
    validate_asset_ids(&request.asset_ids)?;
    let connection = domain_store::open_at(database)?;
    load_snapshot(&connection, &request.snapshot_id)?;
    let preview: Option<(String, String, String, String)> = connection
        .query_row(
            "SELECT snapshot_id, requested_asset_ids_json, current_baselines_json, expires_at
             FROM backup_restore_operations
             WHERE preview_ref = ?1 AND status = 'previewed'",
            [&request.preview_ref],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|_| "无法读取 Backup 恢复预览".to_string())?;
    let Some((snapshot_id, asset_ids_json, baselines_json, expires_at)) = preview else {
        return Err("Backup 恢复预览不存在或已使用".into());
    };
    let preview_asset_ids: Vec<String> =
        serde_json::from_str(&asset_ids_json).map_err(|_| "Backup 恢复资产范围已损坏")?;
    let baselines: HashMap<String, BaselineRefDto> =
        serde_json::from_str(&baselines_json).map_err(|_| "Backup 恢复基线已损坏")?;
    if snapshot_id != request.snapshot_id
        || preview_asset_ids != request.asset_ids
        || chrono::DateTime::parse_from_rfc3339(&expires_at)
            .map_err(|_| "Backup 恢复预览过期时间无效")?
            < Utc::now()
        || baselines.len() != request.asset_ids.len()
    {
        return Err("Backup 恢复预览已过期或与本次恢复不匹配".into());
    }
    let stored = load_entries(&connection, &snapshot_id)?;
    let by_id: HashMap<_, _> = stored
        .into_iter()
        .map(|(entry, content_ref)| (entry.asset_id.clone(), (entry, content_ref)))
        .collect();
    drop(connection);

    let pre_restore = create_snapshot_internal(
        database,
        managed_root,
        backup_root,
        &format!("pre-{}", request.request_id),
        &request.asset_ids,
        "pre_restore",
    )?;
    let mut results = Vec::new();
    for (index, asset_id) in request.asset_ids.iter().enumerate() {
        results.push(restore_entry(
            database,
            managed_root,
            revisions_root,
            backup_root,
            index,
            asset_id,
            by_id.get(asset_id),
            baselines.get(asset_id),
        ));
    }
    let failures = results
        .iter()
        .filter(|entry| !matches!(entry.status.as_str(), "restored" | "skipped"))
        .count();
    let kind = if failures == 0 {
        "restored"
    } else if failures == results.len() {
        "restore_failed"
    } else {
        "partial_failure"
    };
    let result = BackupRestoreResultDto {
        kind: kind.into(),
        request_id: request.request_id,
        snapshot_id,
        pre_restore_snapshot_id: pre_restore.id,
        entries: results,
    };
    let connection = domain_store::open_at(database)?;
    let updated = connection
        .execute(
            "UPDATE backup_restore_operations
             SET pre_restore_snapshot_id = ?1, status = ?2, completed_at = ?3, result_json = ?4
             WHERE preview_ref = ?5 AND status = 'previewed'",
            params![
                result.pre_restore_snapshot_id,
                result.kind,
                Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
                serde_json::to_string(&result).map_err(|_| "无法序列化 Backup 恢复结果")?,
                request.preview_ref,
            ],
        )
        .map_err(|_| "无法记录 Backup 恢复结果".to_string())?;
    if updated != 1 {
        return Err("Backup 恢复预览已被使用".into());
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn restore_entry(
    database: &Path,
    managed_root: &Path,
    revisions_root: &Path,
    backup_root: &Path,
    index: usize,
    asset_id: &str,
    stored: Option<&(super::contracts::BackupSnapshotEntryDto, String)>,
    preview_baseline: Option<&BaselineRefDto>,
) -> BackupRestoreEntryResultDto {
    let Some((entry, content_ref)) = stored else {
        return failed_entry(
            asset_id,
            "integrity_failed",
            "backup_asset_not_in_snapshot",
            "恢复资产不在快照中",
            "停止恢复并重新预览",
        );
    };
    let content = match verify_entry_content(backup_root, entry, content_ref) {
        Ok(content) => content,
        Err(issue) => {
            return BackupRestoreEntryResultDto {
                asset_id: asset_id.into(),
                status: "integrity_failed".into(),
                revision_id: None,
                retryable: None,
                file_state: None,
                recovery_ref: None,
                diagnostics: vec![*issue],
            }
        }
    };
    let loaded = match local_service::load_editor_at(
        managed_root,
        LoadEditorRequest {
            request_id: format!("restore-load-{index}"),
            asset_id: asset_id.into(),
        },
    ) {
        Ok(loaded) => loaded,
        Err(message) => {
            return failed_entry(
                asset_id,
                "save_failed",
                "backup_current_asset_unavailable",
                &message,
                "恢复资产注册后重新预览",
            )
        }
    };
    let baseline_matches = preview_baseline.is_some_and(|baseline| {
        baseline.id == loaded.baseline_ref.id
            && baseline.asset_id == loaded.baseline_ref.asset_id
            && baseline.container_id == loaded.baseline_ref.container_id
            && baseline.asset_content_hash == loaded.baseline_ref.asset_content_hash
            && baseline.container_content_hash == loaded.baseline_ref.container_content_hash
    });
    if !baseline_matches {
        return failed_entry(
            asset_id,
            "baseline_changed",
            "backup_restore_baseline_changed",
            "配置在恢复预览后发生变化",
            "重新预览恢复影响",
        );
    }
    let Some(change) = config_change(&entry.kind, content) else {
        return failed_entry(
            asset_id,
            "save_failed",
            "backup_asset_kind_unsupported",
            "快照资产类型不支持恢复",
            "升级 Bandi 或重新创建快照",
        );
    };
    let Some(expected_owner) = local_service::load_asset_locator_at(managed_root, asset_id)
        .ok()
        .and_then(|locator| local_service::owner_from_locator(&locator, &entry.kind))
    else {
        return failed_entry(
            asset_id,
            "validation_failed",
            "backup_asset_owner_unavailable",
            "无法从目标资产定位信息确认 owner",
            "重新预览恢复影响",
        );
    };
    let result = local_service::save_config_registered_at(
        database,
        managed_root,
        revisions_root,
        SaveConfigRequest {
            request_id: format!("restore-save-{index}"),
            asset_id: asset_id.into(),
            expected_owner,
            change,
            expected_baseline: loaded.baseline_ref,
            base_content: loaded.canonical_content,
            confirmation_ref: None,
        },
    );
    save_result(asset_id.into(), result)
}

fn failed_entry(
    asset_id: &str,
    status: &str,
    code: &str,
    message: &str,
    remediation: &str,
) -> BackupRestoreEntryResultDto {
    BackupRestoreEntryResultDto {
        asset_id: asset_id.into(),
        status: status.into(),
        revision_id: None,
        retryable: None,
        file_state: None,
        recovery_ref: None,
        diagnostics: vec![diagnostic(code, message, remediation)],
    }
}

#[cfg(test)]
mod tests {
    use super::save_result;
    use crate::local_service::SaveConfigResult;

    #[test]
    fn save_failure_preserves_recovery_state() {
        let result = save_result(
            "asset-permissions-1".into(),
            SaveConfigResult::SaveFailed {
                request_id: "restore-save-1".into(),
                diagnostics: Vec::new(),
                retryable: true,
                file_state: "verified_written_revision_pending".into(),
                recovery_ref: Some("revision-backup-recovery-1".into()),
            },
        );

        assert_eq!(result.status, "save_failed");
        assert_eq!(result.retryable, Some(true));
        assert_eq!(
            result.file_state.as_deref(),
            Some("verified_written_revision_pending")
        );
        assert_eq!(
            result.recovery_ref.as_deref(),
            Some("revision-backup-recovery-1")
        );
    }
}
