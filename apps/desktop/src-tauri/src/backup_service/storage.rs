use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};

use crate::{
    config_fs::{ensure_regular_directory, ensure_regular_file, restricted_atomic_write},
    domain_store,
    local_service::{self, DiagnosticDto, LoadEditorRequest},
};

use super::contracts::{BackupSnapshotDto, BackupSnapshotEntryDto, CreateBackupSnapshotRequest};

pub(super) const MAX_BACKUP_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_BACKUP_ASSETS: usize = 256;

pub(super) fn validate_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

pub(super) fn validate_asset_ids(values: &[String]) -> Result<(), String> {
    if values.is_empty() || values.len() > MAX_BACKUP_ASSETS {
        return Err("Backup 资产范围必须包含 1 到 256 项".into());
    }
    let mut unique = HashSet::new();
    if values
        .iter()
        .any(|value| !validate_id(value) || !unique.insert(value))
    {
        return Err("Backup 资产标识无效或重复".into());
    }
    Ok(())
}

pub(super) fn hash_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

pub(super) fn diagnostic(code: &str, message: &str, remediation: &str) -> DiagnosticDto {
    DiagnosticDto {
        code: code.into(),
        severity: "error".into(),
        message: message.into(),
        source: None,
        field: None,
        path: None,
        remediation: Some(remediation.into()),
    }
}

fn ensure_storage_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|_| "无法创建 Backup 存储目录".to_string())?;
    ensure_regular_directory(root, "Backup 存储目录")
}

fn content_relative_path(snapshot_id: &str, asset_id: &str) -> String {
    format!("{snapshot_id}/{asset_id}.content")
}

pub(super) fn content_path(root: &Path, content_ref: &str) -> Result<PathBuf, String> {
    let mut parts = content_ref.split('/');
    let snapshot_id = parts.next().unwrap_or_default();
    let file = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || !validate_id(snapshot_id)
        || !file.ends_with(".content")
        || !validate_id(file.trim_end_matches(".content"))
    {
        return Err("Backup 内容引用无效".into());
    }
    Ok(root.join(snapshot_id).join(file))
}

pub(super) fn load_entries(
    connection: &rusqlite::Connection,
    snapshot_id: &str,
) -> Result<Vec<(BackupSnapshotEntryDto, String)>, String> {
    let mut statement = connection
        .prepare(
            "SELECT asset_id, container_id, asset_kind, locator_json,
                    asset_content_hash, container_content_hash, snapshot_content_hash,
                    size_bytes, redacted, content_ref
             FROM backup_snapshot_entries
             WHERE snapshot_id = ?1
             ORDER BY asset_id ASC",
        )
        .map_err(|_| "无法读取 Backup 快照条目".to_string())?;
    let rows = statement
        .query_map([snapshot_id], |row| {
            let locator_json: String = row.get(3)?;
            let locator = serde_json::from_str(&locator_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    locator_json.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok((
                BackupSnapshotEntryDto {
                    asset_id: row.get(0)?,
                    container_id: row.get(1)?,
                    kind: row.get(2)?,
                    locator,
                    asset_content_hash: row.get(4)?,
                    container_content_hash: row.get(5)?,
                    snapshot_content_hash: row.get(6)?,
                    size_bytes: u64::try_from(row.get::<_, i64>(7)?).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            7,
                            rusqlite::types::Type::Integer,
                            Box::new(error),
                        )
                    })?,
                    redacted: row.get(8)?,
                },
                row.get(9)?,
            ))
        })
        .map_err(|_| "无法读取 Backup 快照条目".to_string())?;
    let entries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Backup 快照条目已损坏".to_string())?;
    if entries
        .iter()
        .any(|(entry, _)| entry.kind == "orchestration")
    {
        return Err("旧版 Backup 含 orchestration 资产，拒绝预览或恢复整个快照".into());
    }
    Ok(entries)
}

fn manifest_hash(entries: &[BackupSnapshotEntryDto]) -> Result<String, String> {
    let bytes = serde_json::to_vec(entries).map_err(|_| "无法序列化 Backup manifest")?;
    Ok(hash_bytes(&bytes))
}

pub(super) fn load_snapshot(
    connection: &rusqlite::Connection,
    snapshot_id: &str,
) -> Result<BackupSnapshotDto, String> {
    let metadata: Option<(String, String, String, i64, String, String)> = connection
        .query_row(
            "SELECT kind, scope, created_at, entry_count, manifest_hash, integrity
             FROM backup_snapshots WHERE id = ?1",
            [snapshot_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "无法读取 Backup 快照".to_string())?;
    let Some((kind, scope, created_at, entry_count, stored_manifest, integrity)) = metadata else {
        return Err("Backup 快照不存在".into());
    };
    let entries: Vec<_> = load_entries(connection, snapshot_id)?
        .into_iter()
        .map(|(entry, _)| entry)
        .collect();
    let actual_manifest = manifest_hash(&entries)?;
    let integrity = if actual_manifest == stored_manifest
        && usize::try_from(entry_count).ok() == Some(entries.len())
        && integrity == "verified"
    {
        "verified"
    } else {
        "failed"
    };
    Ok(BackupSnapshotDto {
        id: snapshot_id.into(),
        kind,
        scope,
        created_at,
        entry_count: u64::try_from(entry_count).map_err(|_| "Backup 快照条目数无效")?,
        manifest_hash: stored_manifest,
        integrity: integrity.into(),
        entries,
    })
}

pub(super) fn create_snapshot_internal(
    database: &Path,
    managed_root: &Path,
    backup_root: &Path,
    request_id: &str,
    asset_ids: &[String],
    kind: &str,
) -> Result<BackupSnapshotDto, String> {
    validate_asset_ids(asset_ids)?;
    if !validate_id(request_id) || !matches!(kind, "manual" | "pre_restore") {
        return Err("Backup 快照请求无效".into());
    }
    ensure_storage_root(backup_root)?;
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let snapshot_id = local_service::stable_id(
        "backup-snapshot",
        &format!("{kind}:{request_id}:{created_at}:{}", asset_ids.join(":")),
    );
    let snapshot_dir = backup_root.join(&snapshot_id);
    fs::create_dir(&snapshot_dir).map_err(|_| "无法创建 Backup 快照目录".to_string())?;

    let result = create_snapshot_after_directory(
        database,
        managed_root,
        backup_root,
        request_id,
        asset_ids,
        kind,
        created_at,
        snapshot_id,
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&snapshot_dir);
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn create_snapshot_after_directory(
    database: &Path,
    managed_root: &Path,
    backup_root: &Path,
    _request_id: &str,
    asset_ids: &[String],
    kind: &str,
    created_at: String,
    snapshot_id: String,
) -> Result<BackupSnapshotDto, String> {
    let mut records = Vec::new();
    for (index, asset_id) in asset_ids.iter().enumerate() {
        let loaded = local_service::load_editor_at(
            managed_root,
            LoadEditorRequest {
                request_id: format!("backup-load-{index}"),
                asset_id: asset_id.clone(),
            },
        )?;
        if loaded.redacted || !loaded.asset.writable {
            return Err(format!("资产 {} 不可加入 Backup", loaded.asset.id));
        }
        let bytes = loaded.canonical_content.as_bytes();
        if bytes.len() > MAX_BACKUP_CONTENT_BYTES {
            return Err(format!("资产 {} 超出 Backup 大小限制", loaded.asset.id));
        }
        let content_ref = content_relative_path(&snapshot_id, &loaded.asset.id);
        let target = content_path(backup_root, &content_ref)?;
        restricted_atomic_write(&target, bytes, false, "Backup 快照内容")?;
        let locator = local_service::load_asset_locator_at(managed_root, &loaded.asset.id)?;
        records.push((
            BackupSnapshotEntryDto {
                asset_id: loaded.asset.id,
                container_id: loaded.asset.container_id,
                kind: loaded.asset.kind,
                locator,
                asset_content_hash: loaded.baseline_ref.asset_content_hash,
                container_content_hash: loaded.baseline_ref.container_content_hash,
                snapshot_content_hash: hash_bytes(bytes),
                size_bytes: bytes.len() as u64,
                redacted: false,
            },
            content_ref,
        ));
    }
    records.sort_by(|left, right| left.0.asset_id.cmp(&right.0.asset_id));
    let entries: Vec<_> = records.iter().map(|(entry, _)| entry.clone()).collect();
    let manifest_hash = manifest_hash(&entries)?;
    let snapshot = BackupSnapshotDto {
        id: snapshot_id.clone(),
        kind: kind.into(),
        scope: "files".into(),
        created_at: created_at.clone(),
        entry_count: entries.len() as u64,
        manifest_hash: manifest_hash.clone(),
        integrity: "verified".into(),
        entries,
    };

    let mut connection = domain_store::open_at(database)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 Backup 快照事务".to_string())?;
    transaction
        .execute(
            "INSERT INTO backup_snapshots
             (id, kind, scope, created_at, entry_count, manifest_hash, integrity)
             VALUES (?1, ?2, 'files', ?3, ?4, ?5, 'verified')",
            params![
                snapshot_id,
                kind,
                created_at,
                i64::try_from(records.len()).map_err(|_| "Backup 快照条目过多")?,
                manifest_hash
            ],
        )
        .map_err(|_| "无法记录 Backup 快照".to_string())?;
    for (entry, content_ref) in &records {
        let locator = serde_json::to_string(&entry.locator)
            .map_err(|_| "无法序列化 Backup locator".to_string())?;
        transaction
            .execute(
                "INSERT INTO backup_snapshot_entries
                 (snapshot_id, asset_id, container_id, asset_kind, locator_json,
                  asset_content_hash, container_content_hash, snapshot_content_hash,
                  size_bytes, redacted, content_ref)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)",
                params![
                    snapshot.id,
                    entry.asset_id,
                    entry.container_id,
                    entry.kind,
                    locator,
                    entry.asset_content_hash,
                    entry.container_content_hash,
                    entry.snapshot_content_hash,
                    i64::try_from(entry.size_bytes).map_err(|_| "Backup 快照内容大小无效")?,
                    content_ref,
                ],
            )
            .map_err(|_| "无法记录 Backup 快照条目".to_string())?;
    }
    transaction
        .commit()
        .map_err(|_| "无法提交 Backup 快照事务".to_string())?;
    Ok(snapshot)
}

pub(crate) fn create_snapshot_at(
    database: &Path,
    managed_root: &Path,
    backup_root: &Path,
    request: CreateBackupSnapshotRequest,
) -> Result<BackupSnapshotDto, String> {
    if request.scope.kind != "files" {
        return Err("首版 Backup 只支持 files scope".into());
    }
    create_snapshot_internal(
        database,
        managed_root,
        backup_root,
        &request.request_id,
        &request.scope.asset_ids,
        "manual",
    )
}

pub(crate) fn list_snapshots_at(database: &Path) -> Result<Vec<BackupSnapshotDto>, String> {
    let connection = domain_store::open_at(database)?;
    let mut statement = connection
        .prepare("SELECT id FROM backup_snapshots ORDER BY created_at DESC, id DESC")
        .map_err(|_| "无法读取 Backup 快照历史".to_string())?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|_| "无法读取 Backup 快照历史".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Backup 快照历史已损坏".to_string())?;
    ids.iter()
        .map(|id| load_snapshot(&connection, id))
        .collect()
}

pub(super) fn verify_entry_content(
    backup_root: &Path,
    entry: &BackupSnapshotEntryDto,
    content_ref: &str,
) -> Result<String, Box<DiagnosticDto>> {
    let target = content_path(backup_root, content_ref).map_err(|_| {
        Box::new(diagnostic(
            "backup_content_ref_invalid",
            "Backup 内容引用无效",
            "不要恢复该快照，并重新创建本地快照",
        ))
    })?;
    let snapshot_dir = target.parent().ok_or_else(|| {
        Box::new(diagnostic(
            "backup_content_ref_invalid",
            "Backup 内容引用无效",
            "不要恢复该快照，并重新创建本地快照",
        ))
    })?;
    if ensure_regular_directory(backup_root, "Backup 存储目录").is_err()
        || ensure_regular_directory(snapshot_dir, "Backup 快照目录").is_err()
        || ensure_regular_file(&target, "Backup 内容文件").is_err()
    {
        return Err(Box::new(diagnostic(
            "backup_content_invalid",
            "Backup 存储路径或内容文件类型无效",
            "不要恢复该快照，并重新创建本地快照",
        )));
    }
    let metadata = fs::symlink_metadata(&target).map_err(|_| {
        Box::new(diagnostic(
            "backup_content_missing",
            "Backup 内容文件不存在",
            "不要恢复该快照，并检查本地快照存储",
        ))
    })?;
    if metadata.len() > MAX_BACKUP_CONTENT_BYTES as u64 {
        return Err(Box::new(diagnostic(
            "backup_content_invalid",
            "Backup 内容文件大小无效",
            "不要恢复该快照，并重新创建本地快照",
        )));
    }
    let bytes = fs::read(target).map_err(|_| {
        Box::new(diagnostic(
            "backup_content_unreadable",
            "无法读取 Backup 内容",
            "检查本地快照存储权限",
        ))
    })?;
    if bytes.len() as u64 != entry.size_bytes || hash_bytes(&bytes) != entry.snapshot_content_hash {
        return Err(Box::new(diagnostic(
            "backup_integrity_failed",
            "Backup 内容完整性校验失败",
            "不要恢复该快照，并重新创建本地快照",
        )));
    }
    String::from_utf8(bytes).map_err(|_| {
        Box::new(diagnostic(
            "backup_content_not_utf8",
            "Backup 配置内容不是有效 UTF-8",
            "不要恢复该快照",
        ))
    })
}
