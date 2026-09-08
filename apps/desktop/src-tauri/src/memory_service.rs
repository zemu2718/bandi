use std::path::Path;

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{
    config_fs::restricted_atomic_write,
    domain_store, local_service,
    memory_target::{self, ResolvedMemoryTarget},
};

const MAX_MEMORY_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemorySpaceDto {
    pub(crate) id: String,
    pub(crate) agent_id: String,
    pub(crate) state: String,
    pub(crate) storage_profile_version: String,
    pub(crate) storage_locator: local_service::AssetLocatorDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_revision_id: Option<String>,
    pub(crate) content_hash: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedMemoryDto {
    pub(crate) request_id: String,
    pub(crate) space: MemorySpaceDto,
    pub(crate) content: String,
    pub(crate) baseline_ref: local_service::BaselineRefDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryRevisionDto {
    pub(crate) id: String,
    pub(crate) space_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_revision_id: Option<String>,
    pub(crate) source_content_hash: String,
    pub(crate) content_hash: String,
    pub(crate) write_receipt_id: String,
    pub(crate) written_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiscoverMemorySpacesRequest {
    pub(crate) request_id: String,
    pub(crate) agent_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoverMemorySpacesResult {
    pub(crate) request_id: String,
    pub(crate) spaces: Vec<MemorySpaceDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadMemoryRequest {
    pub(crate) request_id: String,
    pub(crate) space_id: String,
    pub(crate) agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveMemoryRequest {
    pub(crate) request_id: String,
    pub(crate) space_id: String,
    pub(crate) agent_id: String,
    pub(crate) content: String,
    pub(crate) content_hash: String,
    pub(crate) expected_baseline: local_service::BaselineRefDto,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListMemoryRevisionsRequest {
    pub(crate) request_id: String,
    pub(crate) space_id: String,
    pub(crate) agent_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecoverMemoryRevisionRequest {
    pub(crate) request_id: String,
    pub(crate) journal_id: String,
    pub(crate) space_id: String,
    pub(crate) agent_id: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum SaveMemoryResult {
    Saved {
        request_id: String,
        memory: LoadedMemoryDto,
        revision: MemoryRevisionDto,
        write_receipt: local_service::WriteReceiptDto,
    },
    BaselineChanged {
        request_id: String,
        current: LoadedMemoryDto,
        proposed_content_hash: String,
        diagnostics: Vec<local_service::DiagnosticDto>,
    },
    RevisionPending {
        request_id: String,
        journal_id: String,
        write_receipt: local_service::WriteReceiptDto,
        diagnostics: Vec<local_service::DiagnosticDto>,
    },
    ValidationFailed {
        request_id: String,
        diagnostics: Vec<local_service::DiagnosticDto>,
    },
    SaveFailed {
        request_id: String,
        diagnostics: Vec<local_service::DiagnosticDto>,
        retryable: bool,
        file_state: String,
    },
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true)
}

fn validate_request_id(value: &str) -> Result<(), String> {
    memory_target::validate_id(value, "请求标识")
}

fn locator(target: &ResolvedMemoryTarget) -> local_service::AssetLocatorDto {
    local_service::AssetLocatorDto {
        root_kind: target.root_kind.clone(),
        display_path: target.relative_path.clone(),
        relative_path: Some(target.relative_path.clone()),
    }
}

fn baseline(
    target: &ResolvedMemoryTarget,
    content: &str,
    exists: bool,
) -> local_service::BaselineRefDto {
    let hash = local_service::hash_bytes(content.as_bytes());
    local_service::BaselineRefDto {
        id: local_service::stable_id(
            "memory-baseline",
            &format!("{}:{hash}:{exists}", target.space_id),
        ),
        asset_id: target.space_id.clone(),
        container_id: target.space_id.clone(),
        asset_content_hash: hash.clone(),
        container_content_hash: hash,
        target_exists: exists,
    }
}

fn baseline_matches(
    expected: &local_service::BaselineRefDto,
    actual: &local_service::BaselineRefDto,
) -> bool {
    expected.id == actual.id
        && expected.asset_id == actual.asset_id
        && expected.container_id == actual.container_id
        && expected.asset_content_hash == actual.asset_content_hash
        && expected.container_content_hash == actual.container_content_hash
        && expected.target_exists == actual.target_exists
}

fn stored_space(
    connection: &rusqlite::Connection,
    target: &ResolvedMemoryTarget,
    file_hash: &str,
) -> Result<MemorySpaceDto, String> {
    let stored = connection
        .query_row(
            "SELECT agent_id, state, current_revision_id, content_hash, updated_at FROM memory_spaces WHERE id = ?1",
            [&target.space_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?)),
        )
        .optional()
        .map_err(|_| "无法读取 MemorySpace".to_string())?;
    if let Some((agent_id, state, revision_id, _stored_hash, updated_at)) = stored {
        if agent_id != target.agent_id {
            return Err("MemorySpace Agent 归属已损坏".into());
        }
        Ok(MemorySpaceDto {
            id: target.space_id.clone(),
            agent_id,
            state,
            storage_profile_version: memory_target::PROFILE_VERSION.into(),
            storage_locator: locator(target),
            current_revision_id: revision_id,
            content_hash: file_hash.into(),
            updated_at,
        })
    } else {
        Ok(MemorySpaceDto {
            id: target.space_id.clone(),
            agent_id: target.agent_id.clone(),
            state: target.state.into(),
            storage_profile_version: memory_target::PROFILE_VERSION.into(),
            storage_locator: locator(target),
            current_revision_id: None,
            content_hash: file_hash.into(),
            updated_at: now(),
        })
    }
}

fn load_target(
    database: &Path,
    target: ResolvedMemoryTarget,
    request_id: String,
) -> Result<LoadedMemoryDto, String> {
    let (content, exists) = memory_target::read(&target)?;
    let facts = baseline(&target, &content, exists);
    let connection = domain_store::open_at(database)?;
    let space = stored_space(&connection, &target, &facts.asset_content_hash)?;
    Ok(LoadedMemoryDto {
        request_id,
        space,
        content,
        baseline_ref: facts,
    })
}

pub(crate) fn discover_spaces_at(
    database: &Path,
    agents_root: &Path,
    request: DiscoverMemorySpacesRequest,
) -> Result<DiscoverMemorySpacesResult, String> {
    validate_request_id(&request.request_id)?;
    memory_target::validate_id(&request.agent_id, "Agent 标识")?;
    let mut spaces = Vec::new();
    for target in memory_target::discover_requested(agents_root, &request.agent_id)? {
        let loaded = load_target(database, target, request.request_id.clone())?;
        spaces.push(loaded.space);
    }
    Ok(DiscoverMemorySpacesResult {
        request_id: request.request_id,
        spaces,
    })
}

pub(crate) fn load_memory_at(
    database: &Path,
    agents_root: &Path,
    request: LoadMemoryRequest,
) -> Result<LoadedMemoryDto, String> {
    validate_request_id(&request.request_id)?;
    let target =
        memory_target::resolve_requested(agents_root, &request.space_id, &request.agent_id)?;
    load_target(database, target, request.request_id)
}

fn validation(request_id: String, code: &str, message: &str) -> SaveMemoryResult {
    SaveMemoryResult::ValidationFailed {
        request_id,
        diagnostics: vec![local_service::diagnostic(
            code, "error", message, None, None,
        )],
    }
}

fn revision_from_journal(
    journal_id: &str,
    space_id: String,
    parent_revision_id: Option<String>,
    source_content_hash: String,
    content_hash: String,
    written_at: String,
) -> MemoryRevisionDto {
    MemoryRevisionDto {
        id: local_service::stable_id("memory-revision", journal_id),
        space_id,
        parent_revision_id,
        source_content_hash,
        content_hash,
        write_receipt_id: local_service::stable_id("memory-write", journal_id),
        written_at,
    }
}

fn receipt(revision: &MemoryRevisionDto) -> local_service::WriteReceiptDto {
    local_service::WriteReceiptDto {
        id: revision.write_receipt_id.clone(),
        container_id: revision.space_id.clone(),
        previous_container_hash: revision.source_content_hash.clone(),
        written_container_hash: revision.content_hash.clone(),
        verified_at: revision.written_at.clone(),
        atomic_replace: true,
    }
}

fn record_revision(
    connection: &mut rusqlite::Connection,
    revision: &MemoryRevisionDto,
    journal_id: &str,
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 MemoryRevision 事务".to_string())?;
    transaction
        .execute(
            "INSERT INTO memory_revisions (id, space_id, parent_revision_id, source_content_hash, content_hash, write_receipt_id, written_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![revision.id, revision.space_id, revision.parent_revision_id, revision.source_content_hash, revision.content_hash, revision.write_receipt_id, revision.written_at],
        )
        .and_then(|_| transaction.execute(
            "UPDATE memory_spaces SET current_revision_id = ?1, content_hash = ?2, updated_at = ?3 WHERE id = ?4",
            params![revision.id, revision.content_hash, revision.written_at, revision.space_id],
        ))
        .and_then(|_| transaction.execute(
            "UPDATE memory_write_journal SET status = 'completed', completed_at = ?1 WHERE id = ?2 AND status IN ('pending_write', 'written_pending_revision')",
            params![revision.written_at, journal_id],
        ))
        .map_err(|_| "无法记录 MemoryRevision".to_string())?;
    transaction
        .commit()
        .map_err(|_| "无法提交 MemoryRevision".to_string())
}

pub(crate) fn save_memory_at(
    database: &Path,
    agents_root: &Path,
    request: SaveMemoryRequest,
) -> Result<SaveMemoryResult, String> {
    validate_request_id(&request.request_id)?;
    if request.content.len() > MAX_MEMORY_BYTES || request.content.contains('\0') {
        return Ok(validation(
            request.request_id,
            "memory_content_invalid",
            "Memory 内容无效或过大",
        ));
    }
    let proposed_hash = local_service::hash_bytes(request.content.as_bytes());
    if proposed_hash != request.content_hash {
        return Ok(validation(
            request.request_id,
            "memory_content_hash_mismatch",
            "Memory 内容 hash 不匹配",
        ));
    }
    let target =
        memory_target::resolve_requested(agents_root, &request.space_id, &request.agent_id)?;
    let current = load_target(database, target.clone(), request.request_id.clone())?;
    if current.space.state != "active" {
        return Ok(validation(
            request.request_id,
            "memory_space_read_only",
            "MemorySpace 只读",
        ));
    }
    if !baseline_matches(&request.expected_baseline, &current.baseline_ref) {
        return Ok(SaveMemoryResult::BaselineChanged {
            request_id: request.request_id,
            current,
            proposed_content_hash: proposed_hash,
            diagnostics: vec![local_service::diagnostic(
                "memory_baseline_changed",
                "warning",
                "正式 Memory 已发生变化",
                None,
                Some("重新载入后再保存"),
            )],
        });
    }

    let timestamp = now();
    let journal_id = local_service::stable_id(
        "memory-journal",
        &format!(
            "{}:{}:{}",
            request.request_id, request.space_id, proposed_hash
        ),
    );
    let revision = revision_from_journal(
        &journal_id,
        request.space_id.clone(),
        current.space.current_revision_id.clone(),
        current.baseline_ref.asset_content_hash.clone(),
        proposed_hash.clone(),
        timestamp.clone(),
    );
    let write_receipt = receipt(&revision);
    let mut connection = domain_store::open_at(database)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 Memory 写入事务".to_string())?;
    transaction.execute(
        "INSERT INTO memory_spaces (id, agent_id, state, current_revision_id, content_hash, updated_at) VALUES (?1, ?2, 'active', ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET agent_id = excluded.agent_id, content_hash = excluded.content_hash, updated_at = excluded.updated_at",
        params![request.space_id, request.agent_id, current.space.current_revision_id, current.baseline_ref.asset_content_hash, timestamp],
    ).and_then(|_| transaction.execute(
        "INSERT INTO memory_write_journal (id, space_id, revision_id, previous_content_hash, written_content_hash, status, created_at, completed_at) VALUES (?1, ?2, ?3, ?4, ?5, 'pending_write', ?6, NULL)",
        params![journal_id, request.space_id, revision.id, revision.source_content_hash, revision.content_hash, timestamp],
    )).map_err(|_| "无法记录 Memory 写入日志".to_string())?;
    transaction
        .commit()
        .map_err(|_| "无法提交 Memory 写入日志".to_string())?;

    if let Err(message) =
        memory_target::ensure_safe_chain(&target.root, &target.relative_path, true).and_then(|_| {
            restricted_atomic_write(
                &target.target,
                request.content.as_bytes(),
                current.baseline_ref.target_exists,
                "正式 Memory",
            )
        })
    {
        let _ = connection.execute(
            "UPDATE memory_write_journal SET status = 'write_failed', completed_at = ?1 WHERE id = ?2 AND status = 'pending_write'",
            params![now(), journal_id],
        );
        return Ok(SaveMemoryResult::SaveFailed {
            request_id: request.request_id,
            diagnostics: vec![local_service::diagnostic(
                "memory_write_failed",
                "error",
                &message,
                None,
                Some("确认目标可写并重新载入后重试"),
            )],
            retryable: true,
            file_state: "unchanged".into(),
        });
    }
    let (verified, _) = memory_target::read(&target)?;
    if local_service::hash_bytes(verified.as_bytes()) != proposed_hash {
        return Ok(SaveMemoryResult::SaveFailed {
            request_id: request.request_id,
            diagnostics: vec![local_service::diagnostic(
                "memory_write_not_verified",
                "error",
                "正式 Memory 写后验证失败",
                None,
                None,
            )],
            retryable: false,
            file_state: "write_not_verified".into(),
        });
    }
    if connection
        .execute(
            "UPDATE memory_write_journal SET status = 'written_pending_revision' WHERE id = ?1 AND status = 'pending_write'",
            [&journal_id],
        )
        .is_err()
    {
        return Ok(SaveMemoryResult::RevisionPending {
            request_id: request.request_id,
            journal_id,
            write_receipt,
            diagnostics: vec![local_service::diagnostic(
                "memory_revision_pending",
                "warning",
                "正式 Memory 已写入，但写入日志状态尚未更新",
                None,
                Some("使用补记版本操作，不要重复写入文件"),
            )],
        });
    }
    if record_revision(&mut connection, &revision, &journal_id).is_err() {
        return Ok(SaveMemoryResult::RevisionPending {
            request_id: request.request_id,
            journal_id,
            write_receipt,
            diagnostics: vec![local_service::diagnostic(
                "memory_revision_pending",
                "warning",
                "正式 Memory 已写入，但版本尚未记录",
                None,
                Some("使用补记版本操作，不要重复写入文件"),
            )],
        });
    }
    let memory = load_target(database, target, request.request_id.clone())?;
    Ok(SaveMemoryResult::Saved {
        request_id: request.request_id,
        memory,
        revision,
        write_receipt,
    })
}

pub(crate) fn list_revisions_at(
    database: &Path,
    agents_root: &Path,
    request: ListMemoryRevisionsRequest,
) -> Result<Vec<MemoryRevisionDto>, String> {
    validate_request_id(&request.request_id)?;
    memory_target::resolve_requested(agents_root, &request.space_id, &request.agent_id)?;
    let connection = domain_store::open_at(database)?;
    let mut statement = connection.prepare(
        "SELECT id, space_id, parent_revision_id, source_content_hash, content_hash, write_receipt_id, written_at FROM memory_revisions WHERE space_id = ?1 ORDER BY written_at DESC, id DESC",
    ).map_err(|_| "无法读取 MemoryRevision 历史".to_string())?;
    let revisions = statement
        .query_map([request.space_id], |row| {
            Ok(MemoryRevisionDto {
                id: row.get(0)?,
                space_id: row.get(1)?,
                parent_revision_id: row.get(2)?,
                source_content_hash: row.get(3)?,
                content_hash: row.get(4)?,
                write_receipt_id: row.get(5)?,
                written_at: row.get(6)?,
            })
        })
        .map_err(|_| "无法读取 MemoryRevision 历史".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "MemoryRevision 历史已损坏".to_string())?;
    Ok(revisions)
}

pub(crate) fn recover_revision_at(
    database: &Path,
    agents_root: &Path,
    request: RecoverMemoryRevisionRequest,
) -> Result<SaveMemoryResult, String> {
    validate_request_id(&request.request_id)?;
    memory_target::validate_id(&request.journal_id, "写入日志标识")?;
    let target =
        memory_target::resolve_requested(agents_root, &request.space_id, &request.agent_id)?;
    let mut connection = domain_store::open_at(database)?;
    let row = connection.query_row(
        "SELECT revision_id, previous_content_hash, written_content_hash, status, created_at FROM memory_write_journal WHERE id = ?1 AND space_id = ?2",
        params![request.journal_id, request.space_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?)),
    ).optional().map_err(|_| "无法读取 Memory 写入日志".to_string())?.ok_or_else(|| "Memory 写入日志不存在".to_string())?;
    if !matches!(row.3.as_str(), "pending_write" | "written_pending_revision") {
        return Ok(validation(
            request.request_id,
            "memory_revision_not_pending",
            "当前写入日志没有待补记版本",
        ));
    }
    let loaded = load_target(database, target.clone(), request.request_id.clone())?;
    if loaded.baseline_ref.asset_content_hash != row.2 {
        return Ok(SaveMemoryResult::SaveFailed {
            request_id: request.request_id,
            diagnostics: vec![local_service::diagnostic(
                "memory_recovery_file_changed",
                "error",
                "正式 Memory 文件已在补记前变化",
                None,
                Some("停止补记并重新核对正式文件"),
            )],
            retryable: false,
            file_state: "write_not_verified".into(),
        });
    }
    let revision = MemoryRevisionDto {
        id: row.0,
        space_id: request.space_id,
        parent_revision_id: loaded.space.current_revision_id,
        source_content_hash: row.1,
        content_hash: row.2,
        write_receipt_id: local_service::stable_id("memory-write", &request.journal_id),
        written_at: row.4,
    };
    let write_receipt = receipt(&revision);
    record_revision(&mut connection, &revision, &request.journal_id)?;
    let memory = load_target(database, target, request.request_id.clone())?;
    Ok(SaveMemoryResult::Saved {
        request_id: request.request_id,
        memory,
        revision,
        write_receipt,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_reject_legacy_review_fields() {
        assert!(
            serde_json::from_value::<SaveMemoryRequest>(serde_json::json!({
                "requestId": "request-1",
                "spaceId": "memory-agent-agent-1",
                "agentId": "agent-1",
                "content": "memory",
                "contentHash": "hash",
                "expectedBaseline": {
                    "id": "baseline",
                    "assetId": "memory-agent-agent-1",
                    "containerId": "memory-agent-agent-1",
                    "assetContentHash": "hash",
                    "containerContentHash": "hash"
                },
                "reviewPrincipal": { "kind": "chairman_user", "teamId": "team-1" }
            }))
            .is_err()
        );
    }

    #[test]
    fn baseline_checks_identity_hash_and_existence() {
        let target = local_service::BaselineRefDto {
            id: "id".into(),
            asset_id: "space".into(),
            container_id: "space".into(),
            asset_content_hash: "hash".into(),
            container_content_hash: "hash".into(),
            target_exists: false,
        };
        let mut changed = target.clone();
        changed.target_exists = true;
        assert!(baseline_matches(&target, &target));
        assert!(!baseline_matches(&target, &changed));
    }
}
