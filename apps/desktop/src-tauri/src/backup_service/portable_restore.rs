use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::portable::{create_portable_snapshot_at, PortableEntryKind, PortableSnapshotEntryDto};
use crate::config_fs::{ensure_regular_directory, ensure_regular_file, restricted_atomic_write};
use crate::memory_service::{self, LoadMemoryRequest, SaveMemoryRequest, SaveMemoryResult};

const PREVIEW_TTL: Duration = Duration::minutes(10);
const MAX_PREVIEW_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum PortableRestoreScopeDto {
    All,
    Team { team_id: String },
    Agent { agent_id: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableTeamDependencyDto {
    pub(crate) id: String,
    pub(crate) member_agent_ids: Vec<String>,
    pub(crate) shared_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableAgentDependencyDto {
    pub(crate) id: String,
    pub(crate) team_id: String,
    pub(crate) shared_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableOwnedDependencyDto {
    pub(crate) id: String,
    pub(crate) owner_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestoreGraphDto {
    pub(crate) teams: Vec<PortableTeamDependencyDto>,
    pub(crate) agents: Vec<PortableAgentDependencyDto>,
    pub(crate) task_briefs: Vec<PortableOwnedDependencyDto>,
    pub(crate) shared_assets: Vec<PortableOwnedDependencyDto>,
    pub(crate) memories: Vec<PortableOwnedDependencyDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestoreClosureDto {
    pub(crate) team_ids: Vec<String>,
    pub(crate) agent_ids: Vec<String>,
    pub(crate) task_brief_ids: Vec<String>,
    pub(crate) shared_asset_ids: Vec<String>,
    pub(crate) memory_ids: Vec<String>,
}

pub(crate) fn dependency_closure(
    graph: &PortableRestoreGraphDto,
    scope: &PortableRestoreScopeDto,
) -> Result<PortableRestoreClosureDto, String> {
    let teams = unique_by_id(&graph.teams, |item| &item.id, "Team")?;
    let agents = unique_by_id(&graph.agents, |item| &item.id, "Agent")?;
    let tasks = unique_by_id(&graph.task_briefs, |item| &item.id, "TaskBrief")?;
    let assets = unique_by_id(&graph.shared_assets, |item| &item.id, "共享资产")?;
    let memories = unique_by_id(&graph.memories, |item| &item.id, "Memory")?;

    let mut team_ids = BTreeSet::new();
    let mut agent_ids = BTreeSet::new();
    match scope {
        PortableRestoreScopeDto::All => {
            team_ids.extend(teams.keys().cloned());
            agent_ids.extend(agents.keys().cloned());
        }
        PortableRestoreScopeDto::Team { team_id } => {
            let team = teams
                .get(team_id)
                .ok_or_else(|| "便携恢复范围中的 Team 不存在".to_string())?;
            team_ids.insert(team_id.clone());
            agent_ids.extend(team.member_agent_ids.iter().cloned());
        }
        PortableRestoreScopeDto::Agent { agent_id } => {
            let agent = agents
                .get(agent_id)
                .ok_or_else(|| "便携恢复范围中的 Agent 不存在".to_string())?;
            team_ids.insert(agent.team_id.clone());
            agent_ids.insert(agent_id.clone());
        }
    }

    let mut asset_ids = BTreeSet::new();
    for team_id in &team_ids {
        let team = teams
            .get(team_id)
            .ok_or_else(|| format!("依赖的 Team 不存在: {team_id}"))?;
        if !matches!(scope, PortableRestoreScopeDto::Agent { .. }) {
            asset_ids.extend(team.shared_asset_ids.iter().cloned());
        }
    }
    for agent_id in &agent_ids {
        let agent = agents
            .get(agent_id)
            .ok_or_else(|| format!("依赖的 Agent 不存在: {agent_id}"))?;
        if !team_ids.contains(&agent.team_id) {
            return Err(format!("Agent {agent_id} 的 Team 依赖不在恢复闭包中"));
        }
        asset_ids.extend(agent.shared_asset_ids.iter().cloned());
    }
    for asset_id in &asset_ids {
        let asset = assets
            .get(asset_id)
            .ok_or_else(|| format!("依赖的共享资产不存在: {asset_id}"))?;
        if !team_ids.contains(&asset.owner_id) {
            return Err(format!("共享资产 {asset_id} 的 Team 依赖不在恢复闭包中"));
        }
    }

    let selected_for_owner = |owner_id: &str| match scope {
        PortableRestoreScopeDto::All => true,
        PortableRestoreScopeDto::Team { team_id } => owner_id == team_id,
        PortableRestoreScopeDto::Agent { .. } => false,
    };
    let task_ids = tasks
        .values()
        .filter(|task| selected_for_owner(&task.owner_id))
        .map(|task| task.id.clone())
        .collect();
    let memory_ids = memories
        .values()
        .filter(|memory| agent_ids.contains(&memory.owner_id))
        .map(|memory| memory.id.clone())
        .collect();

    Ok(PortableRestoreClosureDto {
        team_ids: team_ids.into_iter().collect(),
        agent_ids: agent_ids.into_iter().collect(),
        task_brief_ids: task_ids,
        shared_asset_ids: asset_ids.into_iter().collect(),
        memory_ids,
    })
}

fn unique_by_id<'a, T>(
    items: &'a [T],
    id: impl Fn(&T) -> &String,
    label: &str,
) -> Result<BTreeMap<String, &'a T>, String> {
    let mut indexed = BTreeMap::new();
    for item in items {
        let value = id(item);
        validate_id(value)?;
        if indexed.insert(value.clone(), item).is_some() {
            return Err(format!("{label} 标识重复: {value}"));
        }
    }
    Ok(indexed)
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestoreEntityDto {
    pub(crate) kind: String,
    pub(crate) id: String,
    pub(crate) content_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PortableRestorePlanEntryDto {
    Create { kind: String, id: String },
    Update { kind: String, id: String },
    Preserve { kind: String, id: String },
}

pub(crate) fn plan_upsert_and_preserve(
    current: &[PortableRestoreEntityDto],
    incoming: &[PortableRestoreEntityDto],
) -> Result<Vec<PortableRestorePlanEntryDto>, String> {
    let current = index_entities(current, "当前数据")?;
    let incoming = index_entities(incoming, "便携备份")?;
    let mut plan = Vec::with_capacity(current.len().max(incoming.len()));

    for (key, entity) in &incoming {
        plan.push(match current.get(key) {
            None => PortableRestorePlanEntryDto::Create {
                kind: entity.kind.clone(),
                id: entity.id.clone(),
            },
            Some(existing) if existing.content_hash != entity.content_hash => {
                PortableRestorePlanEntryDto::Update {
                    kind: entity.kind.clone(),
                    id: entity.id.clone(),
                }
            }
            Some(_) => PortableRestorePlanEntryDto::Preserve {
                kind: entity.kind.clone(),
                id: entity.id.clone(),
            },
        });
    }
    for (key, entity) in current {
        if !incoming.contains_key(&key) {
            plan.push(PortableRestorePlanEntryDto::Preserve {
                kind: entity.kind.clone(),
                id: entity.id.clone(),
            });
        }
    }
    Ok(plan)
}

fn index_entities<'a>(
    entities: &'a [PortableRestoreEntityDto],
    label: &str,
) -> Result<BTreeMap<(String, String), &'a PortableRestoreEntityDto>, String> {
    let mut indexed = BTreeMap::new();
    for entity in entities {
        validate_id(&entity.kind)?;
        validate_id(&entity.id)?;
        if !entity.content_hash.starts_with("sha256:") {
            return Err(format!("{label}包含无效内容 hash"));
        }
        let key = (entity.kind.clone(), entity.id.clone());
        if indexed.insert(key, entity).is_some() {
            return Err(format!("{label}包含重复实体"));
        }
    }
    Ok(indexed)
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestorePreviewDto {
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) package_hash: String,
    pub(crate) scope: PortableRestoreScopeDto,
    pub(crate) expires_at: String,
    pub(crate) closure: PortableRestoreClosureDto,
    pub(crate) entries: Vec<PortableRestorePlanEntryDto>,
    pub(crate) can_restore: bool,
    pub(crate) requires_confirmation: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestoreResultEntryDto {
    pub(crate) kind: String,
    pub(crate) id: String,
    pub(crate) status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) revision_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) write_receipt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recovery_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) retryable: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestoreResultDto {
    pub(crate) request_id: String,
    pub(crate) package_hash: String,
    pub(crate) pre_restore_snapshot_id: String,
    pub(crate) status: String,
    pub(crate) entries: Vec<PortableRestoreResultEntryDto>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestorePreviewRecord {
    pub(crate) preview: PortableRestorePreviewDto,
    pub(crate) created_at: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPreviewRecord {
    record: PortableRestorePreviewRecord,
    record_hash: String,
}

pub(crate) fn persist_preview_record_at(
    root: &Path,
    record: &PortableRestorePreviewRecord,
    now: DateTime<Utc>,
) -> Result<(), String> {
    validate_preview_record(record, now)?;
    ensure_preview_root(root)?;
    let path = preview_path(root, &record.preview.preview_ref)?;
    if path.exists() {
        return Err("便携恢复预览记录已存在".into());
    }
    let bytes = serde_json::to_vec(record).map_err(|_| "无法序列化便携恢复预览记录")?;
    let stored = StoredPreviewRecord {
        record: record.clone(),
        record_hash: hash_bytes(&bytes),
    };
    let bytes = serde_json::to_vec(&stored).map_err(|_| "无法序列化便携恢复预览记录")?;
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return Err("便携恢复预览记录过大".into());
    }
    restricted_atomic_write(&path, &bytes, false, "便携恢复预览记录")
}

pub(crate) fn load_preview_record_at(
    root: &Path,
    preview_ref: &str,
    expected_package_hash: &str,
    expected_scope: &PortableRestoreScopeDto,
    now: DateTime<Utc>,
) -> Result<PortableRestorePreviewRecord, String> {
    ensure_regular_directory(root, "便携恢复预览目录")?;
    let path = preview_path(root, preview_ref)?;
    ensure_regular_file(&path, "便携恢复预览记录")?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| "无法检查便携恢复预览记录")?;
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Err("便携恢复预览记录过大".into());
    }
    let bytes = fs::read(&path).map_err(|_| "无法读取便携恢复预览记录")?;
    let stored: StoredPreviewRecord =
        serde_json::from_slice(&bytes).map_err(|_| "便携恢复预览记录已损坏")?;
    let record_bytes =
        serde_json::to_vec(&stored.record).map_err(|_| "无法校验便携恢复预览记录")?;
    if hash_bytes(&record_bytes) != stored.record_hash
        || stored.record.preview.preview_ref != preview_ref
        || stored.record.preview.package_hash != expected_package_hash
        || &stored.record.preview.scope != expected_scope
    {
        return Err("便携恢复预览记录与恢复请求不匹配".into());
    }
    validate_preview_record(&stored.record, now)?;
    Ok(stored.record)
}

pub(crate) fn consume_preview_record_at(
    root: &Path,
    preview_ref: &str,
    expected_package_hash: &str,
    expected_scope: &PortableRestoreScopeDto,
    now: DateTime<Utc>,
) -> Result<PortableRestorePreviewRecord, String> {
    let record = load_preview_record_at(
        root,
        preview_ref,
        expected_package_hash,
        expected_scope,
        now,
    )?;
    let path = preview_path(root, preview_ref)?;
    fs::remove_file(path).map_err(|_| "无法消费便携恢复预览记录".to_string())?;
    Ok(record)
}

fn ensure_preview_root(root: &Path) -> Result<(), String> {
    match fs::symlink_metadata(root) {
        Ok(_) => ensure_regular_directory(root, "便携恢复预览目录"),
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let parent = root
                .parent()
                .ok_or_else(|| "便携恢复预览目录无效".to_string())?;
            ensure_regular_directory(parent, "便携恢复预览父目录")?;
            fs::create_dir(root).map_err(|_| "无法创建便携恢复预览目录".to_string())?;
            ensure_regular_directory(root, "便携恢复预览目录")
        }
        Err(_) => Err("无法检查便携恢复预览目录".into()),
    }
}

fn preview_path(root: &Path, preview_ref: &str) -> Result<PathBuf, String> {
    validate_id(preview_ref)?;
    Ok(root.join(format!("{preview_ref}.json")))
}

fn validate_preview_record(
    record: &PortableRestorePreviewRecord,
    now: DateTime<Utc>,
) -> Result<(), String> {
    validate_id(&record.preview.request_id)?;
    validate_id(&record.preview.preview_ref)?;
    if !record.preview.package_hash.starts_with("sha256:") || !record.preview.requires_confirmation
    {
        return Err("便携恢复预览记录无效".into());
    }
    let created_at = parse_time(&record.created_at)?;
    let expires_at = parse_time(&record.preview.expires_at)?;
    if created_at > now || expires_at <= now || expires_at - created_at != PREVIEW_TTL {
        return Err("便携恢复预览已过期或有效期无效".into());
    }
    Ok(())
}

pub(crate) fn preview_expiry(now: DateTime<Utc>) -> String {
    (now + PREVIEW_TTL).to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn restore_entry_selected(
    entry: &PortableSnapshotEntryDto,
    closure: &PortableRestoreClosureDto,
) -> bool {
    match entry.kind {
        PortableEntryKind::Domain => true,
        PortableEntryKind::AgentFile | PortableEntryKind::Memory => entry
            .path
            .split('/')
            .nth(1)
            .and_then(|value| value.strip_prefix("agt_"))
            .is_some_and(|id| closure.agent_ids.iter().any(|selected| selected == id)),
        PortableEntryKind::SharedAssetFile => entry.path.split('/').nth(1).is_some_and(|id| {
            closure
                .shared_asset_ids
                .iter()
                .any(|selected| selected == id)
        }),
    }
}

fn parse_time(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| "便携恢复预览时间无效".to_string())
}

fn validate_id(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    valid
        .then_some(())
        .ok_or_else(|| "便携恢复标识无效".to_string())
}

fn hash_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableRestoreRequest {
    pub(crate) request_id: String,
    pub(crate) snapshot_id: String,
    pub(crate) scope: PortableRestoreScopeDto,
    pub(crate) preview_ref: Option<String>,
    #[serde(default)]
    pub(crate) confirmed: bool,
}

fn restore_graph(
    manifest: &crate::backup_service::PortableSnapshotManifestV1,
    snapshot_dir: &Path,
) -> Result<PortableRestoreGraphDto, String> {
    let mut graph = PortableRestoreGraphDto {
        teams: vec![],
        agents: vec![],
        task_briefs: vec![],
        shared_assets: vec![],
        memories: vec![],
    };
    for entry in &manifest.entries {
        let parts = entry.path.split('/').collect::<Vec<_>>();
        match entry.kind {
            PortableEntryKind::Domain => {
                let bytes = fs::read(snapshot_dir.join(&entry.object_ref))
                    .map_err(|_| "便携领域数据读取失败".to_string())?;
                let domain: crate::domain_store::LongTermDomainSnapshotDtoV4 =
                    serde_json::from_slice(&bytes)
                        .map_err(|_| "便携领域数据解析失败".to_string())?;
                graph.teams = domain
                    .teams
                    .iter()
                    .map(|team| PortableTeamDependencyDto {
                        id: team.id.clone(),
                        member_agent_ids: team.member_agent_ids.clone(),
                        shared_asset_ids: team.shared_asset_ids.clone(),
                    })
                    .collect();
                graph.task_briefs = domain
                    .task_briefs
                    .iter()
                    .map(|task| PortableOwnedDependencyDto {
                        id: task.id.clone(),
                        owner_id: task.team_id.clone(),
                    })
                    .collect();
                for team in &domain.teams {
                    for agent_id in &team.member_agent_ids {
                        if !graph.agents.iter().any(|agent| agent.id == *agent_id) {
                            graph.agents.push(PortableAgentDependencyDto {
                                id: agent_id.clone(),
                                team_id: team.id.clone(),
                                shared_asset_ids: vec![],
                            });
                        }
                    }
                    for asset_id in &team.shared_asset_ids {
                        if !graph
                            .shared_assets
                            .iter()
                            .any(|asset| asset.id == *asset_id)
                        {
                            graph.shared_assets.push(PortableOwnedDependencyDto {
                                id: asset_id.clone(),
                                owner_id: team.id.clone(),
                            });
                        }
                    }
                }
            }
            PortableEntryKind::AgentFile if parts.len() >= 2 => {
                let id = parts[1].trim_start_matches("agt_").to_string();
                if !graph.agents.iter().any(|a| a.id == id) {
                    graph.agents.push(PortableAgentDependencyDto {
                        id,
                        team_id: String::new(),
                        shared_asset_ids: vec![],
                    });
                }
            }
            PortableEntryKind::SharedAssetFile if parts.len() >= 2 => {
                let id = parts[1].to_string();
                if !graph.shared_assets.iter().any(|a| a.id == id) {
                    graph.shared_assets.push(PortableOwnedDependencyDto {
                        id,
                        owner_id: String::new(),
                    });
                }
            }
            PortableEntryKind::Memory if parts.len() >= 2 => {
                let id = parts[1].trim_start_matches("agt_").to_string();
                graph.memories.push(PortableOwnedDependencyDto {
                    id: format!("memory-agent-{id}"),
                    owner_id: id,
                });
            }
            _ => {}
        }
    }
    for team in &graph.teams {
        for agent_id in &team.member_agent_ids {
            if let Some(agent) = graph.agents.iter_mut().find(|agent| agent.id == *agent_id) {
                agent.team_id = team.id.clone();
            }
        }
        for asset_id in &team.shared_asset_ids {
            if let Some(asset) = graph
                .shared_assets
                .iter_mut()
                .find(|asset| asset.id == *asset_id)
            {
                asset.owner_id = team.id.clone();
            }
        }
    }
    Ok(graph)
}

pub(crate) fn preview_portable_restore_at(
    snapshot_root: &Path,
    preview_root: &Path,
    request: &PortableRestoreRequest,
) -> Result<PortableRestorePreviewDto, String> {
    validate_id(&request.request_id)?;
    validate_id(&request.snapshot_id)?;
    let manifest = crate::backup_service::portable::read_portable_snapshot_at(
        snapshot_root,
        &request.snapshot_id,
    )?;
    let graph = restore_graph(&manifest, &snapshot_root.join(&request.snapshot_id))?;
    let closure = dependency_closure(&graph, &request.scope)?;
    let incoming = manifest
        .entries
        .iter()
        .filter(|entry| restore_entry_selected(entry, &closure))
        .map(|e| PortableRestoreEntityDto {
            kind: format!("{:?}", e.kind).to_lowercase(),
            id: e.path.clone(),
            content_hash: e.content_hash.clone(),
        })
        .collect::<Vec<_>>();
    let entries = plan_upsert_and_preserve(&[], &incoming)?;
    let now = Utc::now();
    let preview = PortableRestorePreviewDto {
        request_id: request.request_id.clone(),
        preview_ref: crate::local_service::stable_id(
            "portable-restore-preview",
            &format!("{}:{}", request.request_id, manifest.manifest_hash),
        ),
        package_hash: manifest.manifest_hash.clone(),
        scope: request.scope.clone(),
        expires_at: preview_expiry(now),
        closure,
        entries,
        can_restore: true,
        requires_confirmation: true,
        diagnostics: vec![],
    };
    persist_preview_record_at(
        preview_root,
        &PortableRestorePreviewRecord {
            preview: preview.clone(),
            created_at: now.to_rfc3339_opts(SecondsFormat::Secs, true),
        },
        now,
    )?;
    Ok(preview)
}

fn restore_managed_agent_package_for_restore(
    agents_root: &Path,
    revisions_root: &Path,
    payload: &super::portable::PortableAgentPackagePayload,
) -> Result<(), String> {
    let root = agents_root.join(format!("agt_{}", payload.agent_id));
    if !root.is_dir() {
        return Err("便携恢复不支持创建缺失的 AgentPackage；已拒绝写入".into());
    }
    for file in &payload.files {
        if matches!(file.path.as_str(), "agent.yaml" | ".bandi-agent.json") {
            continue;
        }
        let current = fs::read_to_string(root.join(&file.path))
            .map_err(|_| "便携恢复 AgentPackage 文件不可验证；已拒绝写入".to_string())?;
        if current != file.content {
            return Err("便携恢复 AgentPackage 文件与当前基线不一致；已拒绝写入".into());
        }
    }
    if let Some(expected) = &payload.avatar_bytes {
        if fs::read(root.join("avatar.png")).ok().as_deref() != Some(expected.as_slice()) {
            return Err("便携恢复 Agent 头像与当前基线不一致；已拒绝写入".into());
        }
    }
    crate::save_managed_agent_identity_for_restore(
        &root,
        revisions_root,
        payload.agent_id.clone(),
        payload.agent.clone(),
        payload.manifest.clone(),
    )
}

pub(crate) fn restore_portable_snapshot_at(
    database: &Path,
    snapshot_root: &Path,
    preview_root: &Path,
    agents_root: &Path,
    shared_assets_root: &Path,
    revisions_root: &Path,
    request: PortableRestoreRequest,
) -> Result<PortableRestoreResultDto, String> {
    if !request.confirmed {
        return Err("便携恢复必须单独确认".into());
    }
    let manifest = crate::backup_service::portable::read_portable_snapshot_at(
        snapshot_root,
        &request.snapshot_id,
    )?;
    let preview_ref = request
        .preview_ref
        .as_deref()
        .ok_or_else(|| "缺少便携恢复预览引用".to_string())?;
    let preview = load_preview_record_at(
        preview_root,
        preview_ref,
        &manifest.manifest_hash,
        &request.scope,
        Utc::now(),
    )?;
    let pre_restore = create_portable_snapshot_at(
        database,
        agents_root,
        shared_assets_root,
        snapshot_root,
        crate::backup_service::CreatePortableSnapshotRequest {
            request_id: format!("pre-{}", request.request_id),
            include_memory: manifest.include_memory,
        },
    )?;
    // 保护快照成功后立即消费预览，保证恢复请求不可重放。
    let mut results = Vec::new();
    consume_preview_record_at(
        preview_root,
        preview_ref,
        &manifest.manifest_hash,
        &request.scope,
        Utc::now(),
    )?;
    for payload in manifest
        .agent_packages
        .iter()
        .filter(|p| preview.preview.closure.agent_ids.contains(&p.agent_id))
    {
        let result =
            restore_managed_agent_package_for_restore(agents_root, revisions_root, payload);
        results.push(PortableRestoreResultEntryDto {
            kind: "agent_package".into(),
            id: payload.agent_id.clone(),
            status: if result.is_ok() {
                "restored"
            } else {
                "restore_failed"
            }
            .into(),
            revision_id: None,
            write_receipt_id: None,
            recovery_ref: None,
            retryable: Some(false),
            diagnostics: result.err().into_iter().collect(),
        });
    }
    let domain_entry = manifest
        .entries
        .iter()
        .find(|entry| entry.kind == PortableEntryKind::Domain)
        .ok_or_else(|| "便携快照缺少领域数据".to_string())?;
    let domain_bytes = fs::read(
        snapshot_root
            .join(&request.snapshot_id)
            .join(&domain_entry.object_ref),
    )
    .map_err(|_| "无法读取便携领域数据".to_string())?;
    let domain: crate::domain_store::LongTermDomainSnapshotDtoV4 =
        serde_json::from_slice(&domain_bytes).map_err(|_| "便携领域数据格式无效".to_string())?;
    for team in domain
        .teams
        .iter()
        .filter(|team| preview.preview.closure.team_ids.contains(&team.id))
    {
        crate::domain_store::save_team_v4_at(database, team.clone())?;
    }
    for task in domain
        .task_briefs
        .iter()
        .filter(|task| preview.preview.closure.task_brief_ids.contains(&task.id))
    {
        crate::domain_store::save_task_brief_v4_at(database, task.clone())?;
    }
    for payload in manifest.shared_assets.iter().filter(|p| {
        preview
            .preview
            .closure
            .shared_asset_ids
            .contains(&p.asset_id)
    }) {
        let loaded = crate::shared_assets::load_editor_at(
            &shared_assets_root,
            revisions_root,
            &domain,
            crate::shared_assets::SharedAssetIdentityRequest {
                request_id: request.request_id.clone(),
                asset_id: payload.asset_id.clone(),
            },
        );
        let Ok(loaded) = loaded else {
            results.push(PortableRestoreResultEntryDto {
                kind: "shared_asset".into(),
                id: payload.asset_id.clone(),
                status: "restore_failed".into(),
                revision_id: None,
                write_receipt_id: None,
                recovery_ref: None,
                retryable: Some(false),
                diagnostics: vec!["共享资产当前不存在或无法读取基线".into()],
            });
            continue;
        };
        let saved = crate::shared_assets::save_at(
            &shared_assets_root,
            revisions_root,
            &domain,
            crate::shared_assets::SaveSharedAssetRequest {
                request_id: format!("portable-restore-{}", payload.asset_id),
                asset_id: payload.asset_id.clone(),
                expected_baseline: loaded.baseline_ref.clone(),
                base_content: loaded.canonical_content,
                proposed_content: payload.content.clone(),
                package_files: Some(payload.package_files.clone()),
                confirmation_ref: None,
            },
            Vec::new(),
        )?;
        let (revision_id, write_receipt_id, recovery_ref) = match saved {
            crate::shared_assets::SharedAssetMutationResult::Saved {
                revision,
                write_receipt,
                ..
            } => (Some(revision.id.clone()), Some(write_receipt.id), None),
            crate::shared_assets::SharedAssetMutationResult::Unchanged { .. } => (None, None, None),
            crate::shared_assets::SharedAssetMutationResult::RevisionPending {
                recovery_ref,
                ..
            } => (None, None, Some(recovery_ref)),
            crate::shared_assets::SharedAssetMutationResult::RegistrationPending { .. } => {
                (None, None, None)
            }
            crate::shared_assets::SharedAssetMutationResult::BaselineChanged { .. }
            | crate::shared_assets::SharedAssetMutationResult::ConfirmationRequired { .. } => {
                results.push(PortableRestoreResultEntryDto {
                    kind: "shared_asset".into(),
                    id: payload.asset_id.clone(),
                    status: "restore_failed".into(),
                    revision_id: None,
                    write_receipt_id: None,
                    recovery_ref: None,
                    retryable: Some(false),
                    diagnostics: vec!["共享资产恢复需要重新确认或基线已变化".into()],
                });
                continue;
            }
        };
        results.push(PortableRestoreResultEntryDto {
            kind: "shared_asset".into(),
            id: payload.asset_id.clone(),
            status: "restored".into(),
            revision_id,
            write_receipt_id,
            recovery_ref,
            retryable: None,
            diagnostics: vec![],
        });
    }
    for entry in manifest
        .entries
        .iter()
        .filter(|entry| entry.kind == PortableEntryKind::Memory)
        .filter(|entry| restore_entry_selected(entry, &preview.preview.closure))
    {
        let agent_id = entry
            .path
            .split('/')
            .nth(1)
            .and_then(|value| value.strip_prefix("agt_"))
            .ok_or_else(|| "便携恢复 Memory 所属 Agent 无效".to_string())?;
        validate_id(agent_id)?;
        let space_id = format!("memory-agent-{agent_id}");
        let current = match memory_service::load_memory_at(
            database,
            agents_root,
            LoadMemoryRequest {
                request_id: format!("{}-load-{agent_id}", request.request_id),
                space_id: space_id.clone(),
                agent_id: agent_id.into(),
            },
        ) {
            Ok(current) => current,
            Err(message) => {
                results.push(PortableRestoreResultEntryDto {
                    kind: "memory".into(),
                    id: entry.path.clone(),
                    status: "restore_failed".into(),
                    revision_id: None,
                    write_receipt_id: None,
                    recovery_ref: None,
                    retryable: Some(false),
                    diagnostics: vec![message],
                });
                continue;
            }
        };
        let object = snapshot_root
            .join(&request.snapshot_id)
            .join(&entry.object_ref);
        let content = String::from_utf8(
            fs::read(object).map_err(|_| "无法读取便携 Memory 对象".to_string())?,
        )
        .map_err(|_| "便携 Memory 必须是 UTF-8 文本".to_string())?;
        let content_hash = crate::local_service::hash_bytes(content.as_bytes());
        if content_hash != entry.content_hash {
            return Err("便携 Memory 内容 hash 不匹配".into());
        }
        let saved = match memory_service::save_memory_at(
            database,
            agents_root,
            revisions_root,
            SaveMemoryRequest {
                request_id: format!("{}-memory-{agent_id}", request.request_id),
                space_id,
                agent_id: agent_id.into(),
                content,
                content_hash,
                expected_baseline: current.baseline_ref,
            },
        ) {
            Ok(saved) => saved,
            Err(message) => {
                results.push(PortableRestoreResultEntryDto {
                    kind: "memory".into(),
                    id: entry.path.clone(),
                    status: "restore_failed".into(),
                    revision_id: None,
                    write_receipt_id: None,
                    recovery_ref: None,
                    retryable: Some(false),
                    diagnostics: vec![message],
                });
                continue;
            }
        };
        match saved {
            SaveMemoryResult::Saved { .. } | SaveMemoryResult::RevisionPending { .. } => {
                results.push(PortableRestoreResultEntryDto {
                    kind: "memory".into(),
                    id: entry.path.clone(),
                    status: "restored".into(),
                    revision_id: None,
                    write_receipt_id: None,
                    recovery_ref: None,
                    retryable: None,
                    diagnostics: vec![],
                });
            }
            _ => return Err("便携 Memory 安全写入未完成".into()),
        }
    }
    let failures = results
        .iter()
        .filter(|entry| entry.status != "restored")
        .count();
    let status = if failures == 0 {
        "restored"
    } else {
        "partial_failure"
    };
    Ok(PortableRestoreResultDto {
        request_id: request.request_id,
        package_hash: preview.preview.package_hash,
        pre_restore_snapshot_id: pre_restore.snapshot_id,
        status: status.into(),
        entries: results,
        diagnostics: if failures == 0 {
            vec![]
        } else {
            vec!["部分条目恢复失败；可使用 pre-restore 快照恢复".into()]
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph() -> PortableRestoreGraphDto {
        PortableRestoreGraphDto {
            teams: vec![PortableTeamDependencyDto {
                id: "team-1".into(),
                member_agent_ids: vec!["agent-1".into(), "agent-2".into()],
                shared_asset_ids: vec!["asset-team".into()],
            }],
            agents: vec![
                PortableAgentDependencyDto {
                    id: "agent-1".into(),
                    team_id: "team-1".into(),
                    shared_asset_ids: vec!["asset-agent".into()],
                },
                PortableAgentDependencyDto {
                    id: "agent-2".into(),
                    team_id: "team-1".into(),
                    shared_asset_ids: vec![],
                },
            ],
            task_briefs: vec![PortableOwnedDependencyDto {
                id: "task-1".into(),
                owner_id: "team-1".into(),
            }],
            shared_assets: vec![
                PortableOwnedDependencyDto {
                    id: "asset-team".into(),
                    owner_id: "team-1".into(),
                },
                PortableOwnedDependencyDto {
                    id: "asset-agent".into(),
                    owner_id: "team-1".into(),
                },
            ],
            memories: vec![
                PortableOwnedDependencyDto {
                    id: "memory-1".into(),
                    owner_id: "agent-1".into(),
                },
                PortableOwnedDependencyDto {
                    id: "memory-2".into(),
                    owner_id: "agent-2".into(),
                },
            ],
        }
    }

    #[test]
    fn agent_scope_adds_only_required_dependencies() {
        let closure = dependency_closure(
            &graph(),
            &PortableRestoreScopeDto::Agent {
                agent_id: "agent-1".into(),
            },
        )
        .unwrap();
        assert_eq!(closure.team_ids, ["team-1"]);
        assert_eq!(closure.agent_ids, ["agent-1"]);
        assert!(closure.task_brief_ids.is_empty());
        assert_eq!(closure.shared_asset_ids, ["asset-agent"]);
        assert_eq!(closure.memory_ids, ["memory-1"]);
    }

    #[test]
    fn team_scope_closes_members_assets_tasks_and_memories() {
        let closure = dependency_closure(
            &graph(),
            &PortableRestoreScopeDto::Team {
                team_id: "team-1".into(),
            },
        )
        .unwrap();
        assert_eq!(closure.agent_ids, ["agent-1", "agent-2"]);
        assert_eq!(closure.task_brief_ids, ["task-1"]);
        assert_eq!(closure.shared_asset_ids, ["asset-agent", "asset-team"]);
        assert_eq!(closure.memory_ids, ["memory-1", "memory-2"]);
    }

    #[test]
    fn upsert_plan_never_deletes_unselected_current_entities() {
        let entity = |kind: &str, id: &str, hash: &str| PortableRestoreEntityDto {
            kind: kind.into(),
            id: id.into(),
            content_hash: format!("sha256:{hash}"),
        };
        let plan = plan_upsert_and_preserve(
            &[
                entity("team", "same", "1"),
                entity("agent", "changed", "1"),
                entity("task", "local-only", "1"),
            ],
            &[
                entity("team", "same", "1"),
                entity("agent", "changed", "2"),
                entity("asset", "new", "1"),
            ],
        )
        .unwrap();
        assert!(plan.contains(&PortableRestorePlanEntryDto::Update {
            kind: "agent".into(),
            id: "changed".into(),
        }));
        assert!(plan.contains(&PortableRestorePlanEntryDto::Create {
            kind: "asset".into(),
            id: "new".into(),
        }));
        assert!(plan.contains(&PortableRestorePlanEntryDto::Preserve {
            kind: "task".into(),
            id: "local-only".into(),
        }));
    }

    #[test]
    fn preview_record_is_bound_expires_and_is_consumed_once() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("previews");
        let now = DateTime::parse_from_rfc3339("2026-09-10T10:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let scope = PortableRestoreScopeDto::All;
        let record = PortableRestorePreviewRecord {
            preview: PortableRestorePreviewDto {
                request_id: "request-1".into(),
                preview_ref: "preview-1".into(),
                package_hash: "sha256:package".into(),
                scope: scope.clone(),
                expires_at: preview_expiry(now),
                closure: PortableRestoreClosureDto::default(),
                entries: vec![],
                can_restore: true,
                requires_confirmation: true,
                diagnostics: vec![],
            },
            created_at: now.to_rfc3339_opts(SecondsFormat::Secs, true),
        };
        persist_preview_record_at(&root, &record, now).unwrap();
        assert!(load_preview_record_at(&root, "preview-1", "sha256:other", &scope, now).is_err());
        consume_preview_record_at(&root, "preview-1", "sha256:package", &scope, now).unwrap();
        assert!(load_preview_record_at(&root, "preview-1", "sha256:package", &scope, now).is_err());
    }
}
