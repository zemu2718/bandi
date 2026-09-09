use std::{collections::HashSet, fs, path::Path};

use crate::local_service;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const DATABASE_SCHEMA_VERSION: i64 = 17;
const LEGACY_DATABASE_RESET_MESSAGE: &str =
    "LEGACY_DATABASE_RESET_REQUIRED: 检测到旧版开发数据库；请重置 Bandi";
const LONG_TERM_DOMAIN_SCHEMA_VERSION: u64 = 4;
const PERSONAL_TEAM_ID: &str = "team-personal";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TeamDtoV4 {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) mark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) mission: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) boundary: Option<String>,
    pub(crate) member_agent_ids: Vec<String>,
    pub(crate) shared_asset_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TaskBriefDtoV4 {
    pub(crate) id: String,
    pub(crate) team_id: String,
    pub(crate) title: String,
    pub(crate) goal: String,
    pub(crate) context: String,
    pub(crate) constraints: String,
    pub(crate) expected_output: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LongTermDomainSnapshotDtoV4 {
    pub(crate) schema_version: u64,
    pub(crate) teams: Vec<TeamDtoV4>,
    pub(crate) task_briefs: Vec<TaskBriefDtoV4>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoveTeamRequestV4 {
    pub(crate) team_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoveTaskBriefRequestV4 {
    pub(crate) task_brief_id: String,
}

fn validate_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

fn validate_text(value: &str, field: &str, required: bool) -> Result<(), String> {
    let length = value.chars().count();
    if required && value.trim().is_empty() {
        return Err(format!("{field}不能为空"));
    }
    if length > 16_384 {
        return Err(format!("{field}过长"));
    }
    Ok(())
}

fn validate_id(value: &str, field: &str) -> Result<(), String> {
    if validate_identifier(value) {
        Ok(())
    } else {
        Err(format!("{field}无效"))
    }
}

fn validate_ids(values: &[String], field: &str) -> Result<(), String> {
    let mut unique = HashSet::new();
    for value in values {
        validate_id(value, field)?;
        if !unique.insert(value) {
            return Err(format!("{field}包含重复标识"));
        }
    }
    Ok(())
}

fn json<T: Serialize>(value: &T, field: &str) -> Result<String, String> {
    serde_json::to_string(value).map_err(|_| format!("{field}无法序列化"))
}

fn parse_json<T: for<'de> Deserialize<'de>>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            value.len(),
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

pub(crate) fn open_at(path: &Path) -> Result<Connection, String> {
    crate::factory_reset::database_open_guard()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "无法创建本地领域数据目录".to_string())?;
    }
    let connection = Connection::open(path).map_err(|_| "无法打开本地领域数据库".to_string())?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|_| "无法配置本地领域数据库".to_string())?;
    migrate(&connection)?;
    Ok(connection)
}

fn migrate(connection: &Connection) -> Result<(), String> {
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| "无法读取本地领域数据库版本".to_string())?;
    match version {
        0 => create_current_schema(connection),
        DATABASE_SCHEMA_VERSION => Ok(()),
        1..=16 => Err(LEGACY_DATABASE_RESET_MESSAGE.into()),
        _ => Err("本地领域数据库版本高于当前应用支持范围".into()),
    }
}

fn create_current_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "BEGIN IMMEDIATE;
             CREATE TABLE teams (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               mark TEXT,
               color TEXT,
               mission TEXT,
               boundary_text TEXT,
               member_agent_ids_json TEXT NOT NULL,
               shared_asset_ids_json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE UNIQUE INDEX teams_name_unique ON teams(name COLLATE NOCASE);
             CREATE TABLE task_briefs (
               id TEXT PRIMARY KEY,
               team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
               title TEXT NOT NULL,
               goal TEXT NOT NULL,
               context TEXT NOT NULL,
               constraints_text TEXT NOT NULL,
               expected_output TEXT NOT NULL,
               archived_at TEXT,
               updated_at TEXT NOT NULL
             );
             CREATE INDEX task_briefs_team ON task_briefs(team_id);
             CREATE TABLE memory_spaces (
               id TEXT PRIMARY KEY,
               agent_id TEXT NOT NULL UNIQUE,
               state TEXT NOT NULL CHECK(state IN ('active', 'read_only_history')),
               current_revision_id TEXT,
               content_hash TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE memory_revisions (
               id TEXT PRIMARY KEY,
               space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE RESTRICT,
               parent_revision_id TEXT REFERENCES memory_revisions(id) ON DELETE RESTRICT,
               source_content_hash TEXT NOT NULL,
               content_hash TEXT NOT NULL,
               write_receipt_id TEXT NOT NULL UNIQUE,
               written_at TEXT NOT NULL
             );
             CREATE INDEX memory_revisions_space ON memory_revisions(space_id);
             CREATE TABLE memory_write_journal (
               id TEXT PRIMARY KEY,
               space_id TEXT NOT NULL REFERENCES memory_spaces(id) ON DELETE RESTRICT,
               revision_id TEXT NOT NULL UNIQUE,
               previous_content_hash TEXT NOT NULL,
               written_content_hash TEXT NOT NULL,
               status TEXT NOT NULL CHECK(status IN ('pending_write', 'write_failed', 'written_pending_revision', 'completed')),
               created_at TEXT NOT NULL,
               completed_at TEXT
             );
             CREATE TABLE backup_snapshots (
               id TEXT PRIMARY KEY,
               kind TEXT NOT NULL CHECK(kind IN ('manual', 'pre_restore')),
               scope TEXT NOT NULL CHECK(scope = 'files'),
               created_at TEXT NOT NULL,
               entry_count INTEGER NOT NULL CHECK(entry_count > 0),
               manifest_hash TEXT NOT NULL,
               integrity TEXT NOT NULL CHECK(integrity IN ('verified', 'failed'))
             );
             CREATE TABLE backup_snapshot_entries (
               snapshot_id TEXT NOT NULL REFERENCES backup_snapshots(id) ON DELETE RESTRICT,
               asset_id TEXT NOT NULL,
               container_id TEXT NOT NULL,
               asset_kind TEXT NOT NULL,
               locator_json TEXT NOT NULL,
               asset_content_hash TEXT NOT NULL,
               container_content_hash TEXT NOT NULL,
               snapshot_content_hash TEXT NOT NULL,
               size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
               redacted INTEGER NOT NULL CHECK(redacted = 0),
               content_ref TEXT NOT NULL,
               PRIMARY KEY(snapshot_id, asset_id)
             );
             CREATE INDEX backup_entries_asset ON backup_snapshot_entries(asset_id);
             CREATE TABLE backup_restore_operations (
               id TEXT PRIMARY KEY,
               snapshot_id TEXT NOT NULL REFERENCES backup_snapshots(id) ON DELETE RESTRICT,
               pre_restore_snapshot_id TEXT REFERENCES backup_snapshots(id) ON DELETE RESTRICT,
               preview_ref TEXT NOT NULL UNIQUE,
               requested_asset_ids_json TEXT NOT NULL,
               current_baselines_json TEXT NOT NULL,
               status TEXT NOT NULL CHECK(status IN ('previewed', 'restored', 'partial_failure', 'restore_failed')),
               expires_at TEXT NOT NULL,
               created_at TEXT NOT NULL,
               completed_at TEXT,
               result_json TEXT
             );
             CREATE TABLE external_agent_references (
               agent_id TEXT PRIMARY KEY,
               canonical_root TEXT NOT NULL UNIQUE,
               metadata_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE agent_recovery_operations (
               id TEXT PRIMARY KEY,
               request_id TEXT NOT NULL UNIQUE,
               agent_id TEXT NOT NULL,
               operation_kind TEXT NOT NULL CHECK(operation_kind IN ('create', 'identity_update', 'delete')),
               status TEXT NOT NULL CHECK(status IN ('prepared', 'filesystem_committed', 'revision_pending', 'team_pending', 'database_committed', 'blocked', 'completed')),
               expected_manifest_hash TEXT NOT NULL,
               fixed_revision_id TEXT,
               payload_json TEXT NOT NULL,
               created_at TEXT NOT NULL,
               completed_at TEXT
             );
             CREATE INDEX agent_recovery_operations_agent ON agent_recovery_operations(agent_id, created_at);
             CREATE TABLE tool_configuration_plans (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL COLLATE NOCASE UNIQUE,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE custom_tools (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL COLLATE NOCASE UNIQUE,
               created_at TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE tool_configuration_plan_tools (
               plan_id TEXT NOT NULL REFERENCES tool_configuration_plans(id) ON DELETE CASCADE,
               tool_id TEXT NOT NULL,
               position INTEGER NOT NULL CHECK(position >= 0),
               PRIMARY KEY(plan_id, tool_id),
               UNIQUE(plan_id, position)
             );
             CREATE TABLE tool_configuration_state (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               selected_plan_id TEXT NOT NULL REFERENCES tool_configuration_plans(id) ON DELETE RESTRICT,
               revision INTEGER NOT NULL CHECK(revision >= 0)
             );
             INSERT INTO teams (id, name, mark, color, mission, boundary_text, member_agent_ids_json, shared_asset_ids_json, updated_at)
               VALUES ('team-personal', '个人 Team', NULL, NULL, NULL, NULL, '[]', '[]', CURRENT_TIMESTAMP);
             INSERT INTO tool_configuration_plans (id, name, created_at, updated_at)
               VALUES ('default', '默认方案', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
             INSERT INTO tool_configuration_state (singleton, selected_plan_id, revision)
               VALUES (1, 'default', 0);
             PRAGMA user_version = 17;
             COMMIT;",
        )
        .map_err(|error| format!("本地领域数据库初始化失败：{error}"))
}

fn agent_facts_at(
    transaction: &Transaction<'_>,
    agents_root: &Path,
    agent_id: &str,
) -> Result<(String, String), String> {
    let external: Option<String> = transaction
        .query_row(
            "SELECT metadata_json FROM external_agent_references WHERE agent_id = ?1",
            [agent_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "无法读取外部 Agent metadata".to_string())?;
    if let Some(encoded) = external {
        let metadata: Value =
            serde_json::from_str(&encoded).map_err(|_| "外部 Agent metadata 已损坏".to_string())?;
        if metadata.get("id").and_then(Value::as_str) != Some(agent_id) {
            return Err("外部 Agent metadata 稳定标识不一致".into());
        }
        return agent_facts_from_metadata(&metadata);
    }

    let package = agents_root.join(format!("agt_{agent_id}"));
    let metadata = fs::symlink_metadata(&package).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "Agent 不存在".to_string()
        } else {
            "无法检查 AgentPackage".to_string()
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("AgentPackage 必须是受管根内普通目录".into());
    }
    let manifest_path = package.join("agent.yaml");
    let (manifest_agent_id, _, _) = local_service::manifest_facts(&manifest_path)
        .map_err(|diagnostic| format!("无法读取 Agent 事实：{}", diagnostic.message))?;
    if manifest_agent_id != agent_id {
        return Err("AgentPackage 稳定标识不一致".into());
    }
    let manifest: Value = serde_yaml::from_str(
        &fs::read_to_string(manifest_path).map_err(|_| "无法读取 Agent 事实".to_string())?,
    )
    .map_err(|_| "Agent 事实格式无效".to_string())?;
    agent_facts_from_metadata(&manifest)
}

fn agent_facts_from_metadata(metadata: &Value) -> Result<(String, String), String> {
    Ok((
        metadata
            .get("teamId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Agent 缺少 teamId；请重置 Bandi 后重新创建或导入 Agent".to_string())?
            .to_string(),
        metadata
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("inactive")
            .to_string(),
    ))
}

fn team_exists(transaction: &Transaction<'_>, team_id: &str) -> Result<bool, String> {
    transaction
        .query_row("SELECT 1 FROM teams WHERE id = ?1", [team_id], |_| Ok(()))
        .optional()
        .map(|value| value.is_some())
        .map_err(|_| "无法校验 Team 引用".to_string())
}

fn update_agent_team_membership(
    transaction: &Transaction<'_>,
    agent_id: &str,
    team_id: &str,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare("SELECT id, member_agent_ids_json FROM teams")
        .map_err(|_| "无法读取 Team 成员关系".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "无法查询 Team 成员关系".to_string())?;
    let mut teams = Vec::new();
    for row in rows {
        let (current_team_id, encoded) = row.map_err(|_| "Team 成员关系损坏".to_string())?;
        let mut members: Vec<String> =
            parse_json(encoded).map_err(|_| "Team 成员关系损坏".to_string())?;
        members.retain(|id| id != agent_id);
        if current_team_id == team_id {
            members.push(agent_id.to_string());
        }
        teams.push((current_team_id, members));
    }
    drop(statement);
    for (current_team_id, members) in teams {
        transaction
            .execute(
                "UPDATE teams SET member_agent_ids_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![
                    json(&members, "Team 成员")?,
                    Utc::now().to_rfc3339(),
                    current_team_id
                ],
            )
            .map_err(|_| "无法更新 Agent Team 成员关系".to_string())?;
    }
    Ok(())
}

pub(crate) fn reconcile_agent_team_at(
    path: &Path,
    agents_root: &Path,
    operation_id: &str,
    agent_id: &str,
    team_id: &str,
) -> Result<(), String> {
    validate_id(operation_id, "Agent operation 标识")?;
    validate_id(agent_id, "Agent 标识")?;
    validate_id(team_id, "Team 标识")?;
    let mut connection = open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 Agent Team reconcile 事务".to_string())?;
    if !team_exists(&transaction, team_id)? {
        return Err("Team 不存在".into());
    }
    let (agent_team_id, status) = agent_facts_at(&transaction, agents_root, agent_id)?;
    if agent_team_id != team_id {
        return Err("Agent 不属于所选 Team".into());
    }
    if status != "active" {
        return Err("Agent 必须处于 active 状态".into());
    }
    update_agent_team_membership(&transaction, agent_id, team_id)?;
    if transaction
        .execute(
            "UPDATE agent_recovery_operations SET status = 'completed', payload_json = '{}', expected_manifest_hash = '', fixed_revision_id = NULL, completed_at = ?1 WHERE id = ?2 AND status = 'team_pending'",
            params![Utc::now().to_rfc3339(), operation_id],
        )
        .map_err(|_| "无法完成 Agent commit operation".to_string())?
        != 1
    {
        return Err("Agent commit operation 状态不允许完成".into());
    }
    transaction
        .commit()
        .map_err(|_| "无法提交 Agent Team reconcile 事务".to_string())
}

pub(crate) fn managed_agent_deletion_impact_at(
    path: &Path,
    agent_id: &str,
) -> Result<Value, String> {
    validate_id(agent_id, "Agent 标识")?;
    let connection = open_at(path)?;
    let mut relationships = Vec::new();
    let mut team_memberships = 0usize;
    let mut statement = connection
        .prepare("SELECT id, member_agent_ids_json FROM teams")
        .map_err(|_| "无法检查 Team 关系".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "无法查询 Team 关系".to_string())?;
    for row in rows {
        let (id, encoded) = row.map_err(|_| "Team 关系记录损坏".to_string())?;
        let members: Vec<String> =
            parse_json(encoded).map_err(|_| "Team 成员索引损坏".to_string())?;
        if members.iter().any(|value| value == agent_id) {
            team_memberships += 1;
            relationships.push(format!("team_member:{id}"));
        }
    }
    drop(statement);

    let memory_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM memory_spaces WHERE agent_id = ?1",
            [agent_id],
            |row| row.get(0),
        )
        .map_err(|_| "无法检查正式 Memory 引用".to_string())?;
    let unfinished: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM agent_recovery_operations WHERE agent_id = ?1 AND status NOT IN ('completed', 'blocked')",
            [agent_id],
            |row| row.get(0),
        )
        .map_err(|_| "无法检查 Agent recovery operation".to_string())?;
    let mut blockers = Vec::new();
    if memory_count > 0 {
        blockers.push(format!("memory_history:{memory_count}"));
    }
    if unfinished > 0 {
        blockers.push(format!("unfinished_recovery:{unfinished}"));
    }
    Ok(serde_json::json!({
        "organizationRelationships": relationships,
        "memoryReferences": memory_count,
        "cleanup": { "teamMemberships": team_memberships },
        "blockers": blockers,
    }))
}

pub(crate) fn delete_agent_relations_at(
    path: &Path,
    operation_id: &str,
    agent_id: &str,
) -> Result<(), String> {
    validate_id(operation_id, "Agent operation 标识")?;
    validate_id(agent_id, "Agent 标识")?;
    let mut connection = open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 Agent 删除事务".to_string())?;
    let mut statement = transaction
        .prepare("SELECT id, member_agent_ids_json FROM teams")
        .map_err(|_| "无法读取 Team 成员索引".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "无法查询 Team 成员索引".to_string())?;
    let mut teams = Vec::new();
    for row in rows {
        let (id, encoded) = row.map_err(|_| "Team 成员索引损坏".to_string())?;
        let mut members: Vec<String> =
            parse_json(encoded).map_err(|_| "Team 成员索引损坏".to_string())?;
        let before = members.len();
        members.retain(|value| value != agent_id);
        if members.len() != before {
            teams.push((id, members));
        }
    }
    drop(statement);
    for (id, members) in teams {
        transaction
            .execute(
                "UPDATE teams SET member_agent_ids_json = ?1, updated_at = ?2 WHERE id = ?3",
                params![json(&members, "Team 成员")?, Utc::now().to_rfc3339(), id],
            )
            .map_err(|_| "无法清理 Team 成员索引".to_string())?;
    }
    if transaction
        .execute(
            "UPDATE agent_recovery_operations SET status = 'database_committed' WHERE id = ?1 AND status = 'filesystem_committed'",
            [operation_id],
        )
        .map_err(|_| "无法更新 Agent 删除恢复状态".to_string())?
        != 1
    {
        return Err("Agent 删除恢复状态不允许提交数据库".into());
    }
    transaction
        .commit()
        .map_err(|_| "无法提交 Agent 删除事务".to_string())
}

fn validate_team_v4(team: &TeamDtoV4) -> Result<(), String> {
    validate_id(&team.id, "Team 标识")?;
    validate_text(&team.name, "Team 名称", true)?;
    if let Some(value) = team.mark.as_deref() {
        let value = value.trim();
        if !(1..=2).contains(&value.chars().count()) || !value.chars().all(char::is_alphanumeric) {
            return Err("Team 文字标识必须为 1–2 个字母或数字".into());
        }
    }
    if let Some(value) = team.color.as_deref() {
        if !["#20201f", "#2563eb", "#7c3aed", "#0f766e", "#c2410c"]
            .contains(&value.to_ascii_lowercase().as_str())
        {
            return Err("Team 标识颜色不在允许范围内".into());
        }
    }
    if let Some(value) = team.mission.as_deref() {
        validate_text(value, "Team 使命", false)?;
    }
    if let Some(value) = team.boundary.as_deref() {
        validate_text(value, "Team 边界", false)?;
    }
    validate_ids(&team.shared_asset_ids, "Team 共享资产标识")
}

pub(crate) fn validate_client_launch_context_at(
    path: &Path,
    agents_root: &Path,
    team_id: &str,
    agent_id: &str,
    task_id: Option<&str>,
) -> Result<(), String> {
    validate_id(team_id, "Team 标识")?;
    validate_id(agent_id, "Agent 标识")?;
    let mut connection = open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始客户端上下文校验事务".to_string())?;
    let members: Option<String> = transaction
        .query_row(
            "SELECT member_agent_ids_json FROM teams WHERE id = ?1",
            [team_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "无法校验 Team".to_string())?;
    let members: Vec<String> = parse_json(members.ok_or_else(|| "Team 不存在".to_string())?)
        .map_err(|_| "Team 成员索引损坏".to_string())?;
    let (agent_team_id, status) = agent_facts_at(&transaction, agents_root, agent_id)?;
    if agent_team_id != team_id || !members.iter().any(|id| id == agent_id) {
        return Err("Agent 不属于所选 Team".into());
    }
    if status != "active" {
        return Err("Agent 必须处于 active 状态".into());
    }
    if let Some(task_id) = task_id {
        validate_id(task_id, "TaskBrief 标识")?;
        let task_team_id: Option<String> = transaction
            .query_row(
                "SELECT team_id FROM task_briefs WHERE id = ?1 AND archived_at IS NULL",
                [task_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "无法校验 TaskBrief".to_string())?;
        if task_team_id.as_deref() != Some(team_id) {
            return Err("TaskBrief 不存在、已归档或不属于所选 Team".into());
        }
    }
    Ok(())
}

pub(crate) fn save_team_v4_at(path: &Path, team: TeamDtoV4) -> Result<TeamDtoV4, String> {
    validate_team_v4(&team)?;
    let mut connection = open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 Team 保存事务".to_string())?;
    transaction
        .execute(
            "INSERT INTO teams (id, name, mark, color, mission, boundary_text, member_agent_ids_json, shared_asset_ids_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '[]', ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, mark=excluded.mark, color=excluded.color,
               mission=excluded.mission, boundary_text=excluded.boundary_text,
               shared_asset_ids_json=excluded.shared_asset_ids_json, updated_at=excluded.updated_at",
            params![team.id, team.name, team.mark.as_deref().map(str::trim),
                team.color.as_deref().map(str::to_ascii_lowercase), team.mission, team.boundary,
                json(&team.shared_asset_ids, "Team 共享资产")?, Utc::now().to_rfc3339()],
        )
        .map_err(|_| "无法保存 Team".to_string())?;
    let member_agent_ids = transaction
        .query_row(
            "SELECT member_agent_ids_json FROM teams WHERE id = ?1",
            [&team.id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "无法读取 Team 成员索引".to_string())
        .and_then(|encoded| parse_json(encoded).map_err(|_| "Team 成员索引损坏".to_string()))?;
    transaction
        .commit()
        .map_err(|_| "无法提交 Team 保存事务".to_string())?;
    Ok(TeamDtoV4 {
        member_agent_ids,
        ..team
    })
}

pub(crate) fn save_task_brief_v4_at(
    path: &Path,
    task_brief: TaskBriefDtoV4,
) -> Result<TaskBriefDtoV4, String> {
    validate_id(&task_brief.id, "TaskBrief 标识")?;
    validate_id(&task_brief.team_id, "TaskBrief Team 标识")?;
    validate_text(&task_brief.title, "TaskBrief 标题", true)?;
    validate_text(&task_brief.goal, "TaskBrief 目标", true)?;
    validate_text(&task_brief.context, "TaskBrief 背景", false)?;
    validate_text(&task_brief.constraints, "TaskBrief 约束", false)?;
    validate_text(&task_brief.expected_output, "TaskBrief 期望产出", false)?;
    let mut connection = open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始 TaskBrief 保存事务".to_string())?;
    if !team_exists(&transaction, &task_brief.team_id)? {
        return Err("TaskBrief 关联的 Team 不存在".into());
    }
    let existing_team_id: Option<String> = transaction
        .query_row(
            "SELECT team_id FROM task_briefs WHERE id = ?1",
            [&task_brief.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "无法读取当前 TaskBrief".to_string())?;
    if existing_team_id
        .as_deref()
        .is_some_and(|team_id| team_id != task_brief.team_id)
    {
        return Err("普通编辑不能跨 Team 移动 TaskBrief".into());
    }
    transaction
        .execute(
            "INSERT INTO task_briefs (id, team_id, title, goal, context, constraints_text, expected_output, archived_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET title=excluded.title, goal=excluded.goal,
               context=excluded.context, constraints_text=excluded.constraints_text,
               expected_output=excluded.expected_output, archived_at=excluded.archived_at,
               updated_at=excluded.updated_at",
            params![task_brief.id, task_brief.team_id, task_brief.title, task_brief.goal,
                task_brief.context, task_brief.constraints, task_brief.expected_output,
                task_brief.archived_at, Utc::now().to_rfc3339()],
        )
        .map_err(|_| "无法保存 TaskBrief".to_string())?;
    transaction
        .commit()
        .map_err(|_| "无法提交 TaskBrief 保存事务".to_string())?;
    Ok(task_brief)
}

pub(crate) fn remove_team_v4_at(path: &Path, request: RemoveTeamRequestV4) -> Result<(), String> {
    validate_id(&request.team_id, "Team 标识")?;
    if request.team_id == PERSONAL_TEAM_ID {
        return Err("稳定 personal Team 不能删除".into());
    }
    let connection = open_at(path)?;
    if connection
        .execute("DELETE FROM teams WHERE id = ?1", [&request.team_id])
        .map_err(|error| {
            if error.to_string().contains("FOREIGN KEY") {
                "Team 仍被 TaskBrief 引用".to_string()
            } else {
                "无法删除 Team".to_string()
            }
        })?
        == 0
    {
        return Err("Team 不存在".into());
    }
    Ok(())
}

pub(crate) fn remove_task_brief_v4_at(
    path: &Path,
    request: RemoveTaskBriefRequestV4,
) -> Result<(), String> {
    validate_id(&request.task_brief_id, "TaskBrief 标识")?;
    let connection = open_at(path)?;
    if connection
        .execute(
            "DELETE FROM task_briefs WHERE id = ?1",
            [&request.task_brief_id],
        )
        .map_err(|_| "无法删除 TaskBrief".to_string())?
        == 0
    {
        return Err("TaskBrief 不存在".into());
    }
    Ok(())
}

pub(crate) fn load_long_term_domain_snapshot_v4_at(
    path: &Path,
) -> Result<LongTermDomainSnapshotDtoV4, String> {
    let connection = open_at(path)?;
    let mut statement = connection
        .prepare("SELECT id, name, mark, color, mission, boundary_text, member_agent_ids_json, shared_asset_ids_json FROM teams ORDER BY rowid")
        .map_err(|_| "无法读取 Team".to_string())?;
    let teams = statement
        .query_map([], |row| {
            Ok(TeamDtoV4 {
                id: row.get(0)?,
                name: row.get(1)?,
                mark: row.get(2)?,
                color: row.get(3)?,
                mission: row.get(4)?,
                boundary: row.get(5)?,
                member_agent_ids: parse_json(row.get(6)?)?,
                shared_asset_ids: parse_json(row.get(7)?)?,
            })
        })
        .map_err(|_| "无法查询 Team".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Team 记录损坏".to_string())?;
    drop(statement);

    let mut statement = connection
        .prepare("SELECT id, team_id, title, goal, context, constraints_text, expected_output, archived_at FROM task_briefs ORDER BY rowid")
        .map_err(|_| "无法读取 TaskBrief".to_string())?;
    let task_briefs = statement
        .query_map([], |row| {
            Ok(TaskBriefDtoV4 {
                id: row.get(0)?,
                team_id: row.get(1)?,
                title: row.get(2)?,
                goal: row.get(3)?,
                context: row.get(4)?,
                constraints: row.get(5)?,
                expected_output: row.get(6)?,
                archived_at: row.get(7)?,
            })
        })
        .map_err(|_| "无法查询 TaskBrief".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "TaskBrief 记录损坏".to_string())?;

    Ok(LongTermDomainSnapshotDtoV4 {
        schema_version: LONG_TERM_DOMAIN_SCHEMA_VERSION,
        teams,
        task_briefs,
    })
}

pub(crate) fn stable_entity_id(prefix: &str, name: &str) -> String {
    let digest =
        Sha256::digest(format!("{prefix}:{}:{}", name.trim(), Utc::now().to_rfc3339()).as_bytes());
    format!("{prefix}-{:x}", digest)[..prefix.len() + 1 + 24].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn table_exists(connection: &Connection, table: &str) -> bool {
        connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [table],
                |row| row.get(0),
            )
            .unwrap()
    }

    #[test]
    fn new_database_uses_v17_minimal_domain() {
        let root = tempdir().unwrap();
        let database = root.path().join("bandi.db");
        let connection = open_at(&database).unwrap();
        assert_eq!(
            connection
                .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            17
        );
        for table in [
            "departments",
            "roles",
            "service_grants_v2",
            "memory_candidates",
            "memory_review_decisions",
        ] {
            assert!(!table_exists(&connection, table));
        }
        for table in [
            "memory_spaces",
            "memory_revisions",
            "memory_write_journal",
            "backup_snapshots",
            "agent_recovery_operations",
            "tool_configuration_plans",
        ] {
            assert!(table_exists(&connection, table));
        }
        let snapshot = load_long_term_domain_snapshot_v4_at(&database).unwrap();
        assert_eq!(snapshot.schema_version, 4);
        assert_eq!(snapshot.teams[0].id, PERSONAL_TEAM_ID);
    }

    #[test]
    fn every_old_nonzero_database_requires_factory_reset() {
        let root = tempdir().unwrap();
        for version in 1..=16 {
            let database = root.path().join(format!("bandi-{version}.db"));
            let connection = Connection::open(&database).unwrap();
            connection
                .pragma_update(None, "user_version", version)
                .unwrap();
            assert_eq!(
                migrate(&connection).unwrap_err(),
                LEGACY_DATABASE_RESET_MESSAGE
            );
            assert_eq!(
                connection
                    .query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                    .unwrap(),
                version
            );
        }
    }

    #[test]
    fn newer_database_is_rejected() {
        let connection = Connection::open_in_memory().unwrap();
        connection.pragma_update(None, "user_version", 18).unwrap();
        assert_eq!(
            migrate(&connection).unwrap_err(),
            "本地领域数据库版本高于当前应用支持范围"
        );
    }

    #[test]
    fn task_brief_v4_rejects_legacy_shape_and_cannot_move_teams() {
        assert!(serde_json::from_value::<TaskBriefDtoV4>(serde_json::json!({
            "id": "brief-1", "teamId": "team-personal", "title": "目标", "brief": "旧字段"
        }))
        .is_err());

        let root = tempdir().unwrap();
        let database = root.path().join("bandi.db");
        save_task_brief_v4_at(
            &database,
            TaskBriefDtoV4 {
                id: "brief-1".into(),
                team_id: PERSONAL_TEAM_ID.into(),
                title: "目标".into(),
                goal: "完成目标".into(),
                context: String::new(),
                constraints: String::new(),
                expected_output: String::new(),
                archived_at: None,
            },
        )
        .unwrap();
        let connection = open_at(&database).unwrap();
        connection.execute("INSERT INTO teams (id, name, member_agent_ids_json, shared_asset_ids_json, updated_at) VALUES ('team-other', '其他', '[]', '[]', 'now')", []).unwrap();
        drop(connection);
        assert!(save_task_brief_v4_at(
            &database,
            TaskBriefDtoV4 {
                id: "brief-1".into(),
                team_id: "team-other".into(),
                title: "目标".into(),
                goal: "完成目标".into(),
                context: String::new(),
                constraints: String::new(),
                expected_output: String::new(),
                archived_at: None,
            },
        )
        .unwrap_err()
        .contains("不能跨 Team"));
    }
}
