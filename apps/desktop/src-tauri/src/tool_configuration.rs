use std::{collections::HashSet, path::Path};

use chrono::Utc;
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

const BUILT_IN_TOOL_IDS: [&str; 9] = [
    "claude-code",
    "claude-desktop",
    "codex",
    "gemini-cli",
    "grok-build",
    "opencode",
    "openclaw",
    "hermes",
    "pi",
];

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ToolPlanDto {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) tool_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CustomToolDto {
    pub(crate) id: String,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolConfigurationSnapshotDto {
    pub(crate) revision: u64,
    pub(crate) selected_plan_id: String,
    pub(crate) built_in_tool_ids: Vec<String>,
    pub(crate) plans: Vec<ToolPlanDto>,
    pub(crate) custom_tools: Vec<CustomToolDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveToolPlanRequest {
    pub(crate) plan: ToolPlanDto,
    pub(crate) expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateToolPlanRequest {
    pub(crate) plan: ToolPlanDto,
    pub(crate) expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CopyToolPlanRequest {
    pub(crate) source_plan_id: String,
    pub(crate) plan_id: String,
    pub(crate) name: String,
    pub(crate) expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanMutationRequest {
    pub(crate) plan_id: String,
    pub(crate) expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveCustomToolRequest {
    pub(crate) tool: CustomToolDto,
    pub(crate) expected_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteCustomToolRequest {
    pub(crate) tool_id: String,
    pub(crate) expected_revision: u64,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn validate_id(value: &str, field: &str) -> Result<(), String> {
    valid_id(value)
        .then_some(())
        .ok_or_else(|| format!("{field}无效"))
}

fn validate_name(value: &str, field: &str) -> Result<(), String> {
    let length = value.chars().count();
    if value.trim().is_empty() || length > 128 || value.contains('\0') {
        Err(format!("{field}无效"))
    } else {
        Ok(())
    }
}

fn validate_revision(transaction: &Transaction<'_>, expected: u64) -> Result<(), String> {
    let current: i64 = transaction
        .query_row(
            "SELECT revision FROM tool_configuration_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "无法读取工具方案版本".to_string())?;
    if u64::try_from(current).ok() != Some(expected) {
        return Err("工具方案已发生变化，请刷新后重试".into());
    }
    Ok(())
}

fn increment_revision(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute(
            "UPDATE tool_configuration_state SET revision = revision + 1 WHERE singleton = 1",
            [],
        )
        .map_err(|_| "无法更新工具方案版本".to_string())?;
    Ok(())
}

fn validate_tool_ids(transaction: &Transaction<'_>, tool_ids: &[String]) -> Result<(), String> {
    if tool_ids.len() > 256 {
        return Err("方案工具数量过多".into());
    }
    let mut seen = HashSet::new();
    for tool_id in tool_ids {
        validate_id(tool_id, "工具标识")?;
        if !seen.insert(tool_id) {
            return Err("方案包含重复工具".into());
        }
        if BUILT_IN_TOOL_IDS.contains(&tool_id.as_str()) {
            continue;
        }
        let exists = transaction
            .query_row(
                "SELECT 1 FROM custom_tools WHERE id = ?1",
                [tool_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| "无法校验自定义工具引用".to_string())?
            .is_some();
        if !exists {
            return Err("方案引用了不存在的工具".into());
        }
    }
    Ok(())
}

fn replace_plan_tools(
    transaction: &Transaction<'_>,
    plan_id: &str,
    tool_ids: &[String],
) -> Result<(), String> {
    transaction
        .execute(
            "DELETE FROM tool_configuration_plan_tools WHERE plan_id = ?1",
            [plan_id],
        )
        .map_err(|_| "无法替换方案工具".to_string())?;
    for (position, tool_id) in tool_ids.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO tool_configuration_plan_tools (plan_id, tool_id, position) VALUES (?1, ?2, ?3)",
                params![plan_id, tool_id, position as i64],
            )
            .map_err(|_| "无法保存方案工具".to_string())?;
    }
    Ok(())
}

fn map_unique_error(error: rusqlite::Error, subject: &str) -> String {
    if error.to_string().contains("UNIQUE") {
        format!("{subject}标识或名称重复")
    } else {
        format!("无法保存{subject}")
    }
}

pub(crate) fn load_snapshot_at(path: &Path) -> Result<ToolConfigurationSnapshotDto, String> {
    let connection = crate::domain_store::open_at(path)?;
    let (revision, selected_plan_id): (i64, String) = connection
        .query_row(
            "SELECT revision, selected_plan_id FROM tool_configuration_state WHERE singleton = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "无法读取工具方案状态".to_string())?;
    let mut statement = connection
        .prepare("SELECT id, name FROM tool_configuration_plans ORDER BY rowid")
        .map_err(|_| "无法读取工具方案".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "无法查询工具方案".to_string())?;
    let mut plans = Vec::new();
    for row in rows {
        let (id, name) = row.map_err(|_| "工具方案记录损坏".to_string())?;
        let mut tools = connection
            .prepare("SELECT tool_id FROM tool_configuration_plan_tools WHERE plan_id = ?1 ORDER BY position")
            .map_err(|_| "无法读取方案工具".to_string())?;
        let tool_ids = tools
            .query_map([&id], |row| row.get(0))
            .map_err(|_| "无法查询方案工具".to_string())?
            .collect::<Result<Vec<String>, _>>()
            .map_err(|_| "方案工具记录损坏".to_string())?;
        plans.push(ToolPlanDto { id, name, tool_ids });
    }
    let mut statement = connection
        .prepare("SELECT id, name FROM custom_tools ORDER BY rowid")
        .map_err(|_| "无法读取自定义工具".to_string())?;
    let custom_tools = statement
        .query_map([], |row| {
            Ok(CustomToolDto {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|_| "无法查询自定义工具".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "自定义工具记录损坏".to_string())?;
    Ok(ToolConfigurationSnapshotDto {
        revision: u64::try_from(revision).map_err(|_| "工具方案版本损坏".to_string())?,
        selected_plan_id,
        built_in_tool_ids: BUILT_IN_TOOL_IDS.iter().map(|id| (*id).into()).collect(),
        plans,
        custom_tools,
    })
}

pub(crate) fn save_plan_at(
    path: &Path,
    request: SaveToolPlanRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.plan.id, "方案标识")?;
    validate_name(&request.plan.name, "方案名称")?;
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始方案保存事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    validate_tool_ids(&transaction, &request.plan.tool_ids)?;
    let changed = transaction
        .execute(
            "UPDATE tool_configuration_plans SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                request.plan.name.trim(),
                Utc::now().to_rfc3339(),
                request.plan.id
            ],
        )
        .map_err(|error| map_unique_error(error, "方案"))?;
    if changed == 0 {
        return Err("工具方案不存在".into());
    }
    replace_plan_tools(&transaction, &request.plan.id, &request.plan.tool_ids)?;
    increment_revision(&transaction)?;
    transaction
        .commit()
        .map_err(|_| "无法提交方案保存事务".to_string())?;
    load_snapshot_at(path)
}

pub(crate) fn create_plan_at(
    path: &Path,
    request: CreateToolPlanRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.plan.id, "方案标识")?;
    validate_name(&request.plan.name, "方案名称")?;
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始方案创建事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    validate_tool_ids(&transaction, &request.plan.tool_ids)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "INSERT INTO tool_configuration_plans (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![request.plan.id, request.plan.name.trim(), now],
        )
        .map_err(|error| map_unique_error(error, "方案"))?;
    replace_plan_tools(&transaction, &request.plan.id, &request.plan.tool_ids)?;
    increment_revision(&transaction)?;
    transaction
        .commit()
        .map_err(|_| "无法提交方案创建事务".to_string())?;
    load_snapshot_at(path)
}

pub(crate) fn copy_plan_at(
    path: &Path,
    request: CopyToolPlanRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.source_plan_id, "来源方案标识")?;
    validate_id(&request.plan_id, "方案标识")?;
    validate_name(&request.name, "方案名称")?;
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始方案复制事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    let source_exists = transaction
        .query_row(
            "SELECT 1 FROM tool_configuration_plans WHERE id = ?1",
            [&request.source_plan_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|_| "无法读取来源方案".to_string())?
        .is_some();
    if !source_exists {
        return Err("来源工具方案不存在".into());
    }
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        "INSERT INTO tool_configuration_plans (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![request.plan_id, request.name.trim(), now],
    ).map_err(|error| map_unique_error(error, "方案"))?;
    transaction.execute(
        "INSERT INTO tool_configuration_plan_tools (plan_id, tool_id, position) SELECT ?1, tool_id, position FROM tool_configuration_plan_tools WHERE plan_id = ?2",
        params![request.plan_id, request.source_plan_id],
    ).map_err(|_| "无法复制方案工具".to_string())?;
    increment_revision(&transaction)?;
    transaction
        .commit()
        .map_err(|_| "无法提交方案复制事务".to_string())?;
    load_snapshot_at(path)
}

pub(crate) fn delete_plan_at(
    path: &Path,
    request: PlanMutationRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.plan_id, "方案标识")?;
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始方案删除事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    let count: i64 = transaction
        .query_row("SELECT COUNT(*) FROM tool_configuration_plans", [], |row| {
            row.get(0)
        })
        .map_err(|_| "无法统计工具方案".to_string())?;
    if count <= 1 {
        return Err("必须至少保留一个工具方案".into());
    }
    let selected: String = transaction
        .query_row(
            "SELECT selected_plan_id FROM tool_configuration_state WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|_| "无法读取当前工具方案".to_string())?;
    if selected == request.plan_id {
        let replacement: String = transaction
            .query_row(
                "SELECT id FROM tool_configuration_plans WHERE id <> ?1 ORDER BY rowid LIMIT 1",
                [&request.plan_id],
                |row| row.get(0),
            )
            .map_err(|_| "无法确定替代工具方案".to_string())?;
        transaction
            .execute(
                "UPDATE tool_configuration_state SET selected_plan_id = ?1 WHERE singleton = 1",
                [replacement],
            )
            .map_err(|_| "无法切换替代工具方案".to_string())?;
    }
    if transaction
        .execute(
            "DELETE FROM tool_configuration_plans WHERE id = ?1",
            [&request.plan_id],
        )
        .map_err(|_| "无法删除工具方案".to_string())?
        == 0
    {
        return Err("工具方案不存在".into());
    }
    increment_revision(&transaction)?;
    transaction
        .commit()
        .map_err(|_| "无法提交方案删除事务".to_string())?;
    load_snapshot_at(path)
}

pub(crate) fn select_plan_at(
    path: &Path,
    request: PlanMutationRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.plan_id, "方案标识")?;
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始方案选择事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    let changed = transaction.execute(
        "UPDATE tool_configuration_state SET selected_plan_id = ?1, revision = revision + 1 WHERE singleton = 1 AND EXISTS (SELECT 1 FROM tool_configuration_plans WHERE id = ?1)",
        [&request.plan_id],
    ).map_err(|_| "无法选择工具方案".to_string())?;
    if changed == 0 {
        return Err("工具方案不存在".into());
    }
    transaction
        .commit()
        .map_err(|_| "无法提交方案选择事务".to_string())?;
    load_snapshot_at(path)
}

pub(crate) fn save_custom_tool_at(
    path: &Path,
    request: SaveCustomToolRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.tool.id, "自定义工具标识")?;
    validate_name(&request.tool.name, "自定义工具名称")?;
    if BUILT_IN_TOOL_IDS.contains(&request.tool.id.as_str()) {
        return Err("自定义工具标识不能占用内置工具标识".into());
    }
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始自定义工具保存事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    let now = Utc::now().to_rfc3339();
    transaction.execute(
        "INSERT INTO custom_tools (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
        params![request.tool.id, request.tool.name.trim(), now],
    ).map_err(|error| map_unique_error(error, "自定义工具"))?;
    increment_revision(&transaction)?;
    transaction
        .commit()
        .map_err(|_| "无法提交自定义工具保存事务".to_string())?;
    load_snapshot_at(path)
}

pub(crate) fn delete_custom_tool_at(
    path: &Path,
    request: DeleteCustomToolRequest,
) -> Result<ToolConfigurationSnapshotDto, String> {
    validate_id(&request.tool_id, "自定义工具标识")?;
    let mut connection = crate::domain_store::open_at(path)?;
    let transaction = connection
        .transaction()
        .map_err(|_| "无法开始自定义工具删除事务".to_string())?;
    validate_revision(&transaction, request.expected_revision)?;
    let referenced: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM tool_configuration_plan_tools WHERE tool_id = ?1",
            [&request.tool_id],
            |row| row.get(0),
        )
        .map_err(|_| "无法检查自定义工具引用".to_string())?;
    if referenced > 0 {
        return Err("自定义工具仍被方案引用，不能删除".into());
    }
    if transaction
        .execute("DELETE FROM custom_tools WHERE id = ?1", [&request.tool_id])
        .map_err(|_| "无法删除自定义工具".to_string())?
        == 0
    {
        return Err("自定义工具不存在".into());
    }
    increment_revision(&transaction)?;
    transaction
        .commit()
        .map_err(|_| "无法提交自定义工具删除事务".to_string())?;
    load_snapshot_at(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn plan(id: &str, name: &str, tool_ids: &[&str]) -> ToolPlanDto {
        ToolPlanDto {
            id: id.into(),
            name: name.into(),
            tool_ids: tool_ids.iter().map(|id| (*id).into()).collect(),
        }
    }

    #[test]
    fn fresh_database_has_one_empty_default_plan_and_nine_builtin_tools() {
        let root = tempdir().unwrap();
        let snapshot = load_snapshot_at(&root.path().join("bandi.db")).unwrap();
        assert_eq!(snapshot.revision, 0);
        assert_eq!(snapshot.selected_plan_id, "default");
        assert_eq!(snapshot.plans, [plan("default", "默认方案", &[])]);
        assert_eq!(snapshot.built_in_tool_ids.len(), 9);
    }

    #[test]
    fn create_copy_save_and_stale_revision_are_transactional() {
        let root = tempdir().unwrap();
        let path = root.path().join("bandi.db");
        let created = create_plan_at(
            &path,
            CreateToolPlanRequest {
                plan: plan("work", "工作", &["claude-code", "codex"]),
                expected_revision: 0,
            },
        )
        .unwrap();
        let copied = copy_plan_at(
            &path,
            CopyToolPlanRequest {
                source_plan_id: "work".into(),
                plan_id: "copy".into(),
                name: "副本".into(),
                expected_revision: created.revision,
            },
        )
        .unwrap();
        assert_eq!(
            copied
                .plans
                .iter()
                .find(|item| item.id == "copy")
                .unwrap()
                .tool_ids,
            ["claude-code", "codex"]
        );
        let error = save_plan_at(
            &path,
            SaveToolPlanRequest {
                plan: plan("work", "过期编辑", &[]),
                expected_revision: created.revision,
            },
        )
        .unwrap_err();
        assert_eq!(error, "工具方案已发生变化，请刷新后重试");
        assert_eq!(
            load_snapshot_at(&path)
                .unwrap()
                .plans
                .iter()
                .find(|item| item.id == "work")
                .unwrap()
                .name,
            "工作"
        );
    }

    #[test]
    fn deleting_selected_plan_picks_replacement_and_last_plan_is_protected() {
        let root = tempdir().unwrap();
        let path = root.path().join("bandi.db");
        let snapshot = create_plan_at(
            &path,
            CreateToolPlanRequest {
                plan: plan("other", "其他", &[]),
                expected_revision: 0,
            },
        )
        .unwrap();
        let selected = select_plan_at(
            &path,
            PlanMutationRequest {
                plan_id: "other".into(),
                expected_revision: snapshot.revision,
            },
        )
        .unwrap();
        let deleted = delete_plan_at(
            &path,
            PlanMutationRequest {
                plan_id: "other".into(),
                expected_revision: selected.revision,
            },
        )
        .unwrap();
        assert_eq!(deleted.selected_plan_id, "default");
        assert_eq!(
            delete_plan_at(
                &path,
                PlanMutationRequest {
                    plan_id: "default".into(),
                    expected_revision: deleted.revision
                }
            )
            .unwrap_err(),
            "必须至少保留一个工具方案"
        );
    }

    #[test]
    fn custom_tool_cannot_use_builtin_id_or_be_deleted_while_referenced() {
        let root = tempdir().unwrap();
        let path = root.path().join("bandi.db");
        assert_eq!(
            save_custom_tool_at(
                &path,
                SaveCustomToolRequest {
                    tool: CustomToolDto {
                        id: "codex".into(),
                        name: "冲突".into()
                    },
                    expected_revision: 0
                }
            )
            .unwrap_err(),
            "自定义工具标识不能占用内置工具标识"
        );
        let saved = save_custom_tool_at(
            &path,
            SaveCustomToolRequest {
                tool: CustomToolDto {
                    id: "custom-one".into(),
                    name: "自定义".into(),
                },
                expected_revision: 0,
            },
        )
        .unwrap();
        let plan = save_plan_at(
            &path,
            SaveToolPlanRequest {
                plan: plan("default", "默认方案", &["custom-one"]),
                expected_revision: saved.revision,
            },
        )
        .unwrap();
        assert_eq!(
            delete_custom_tool_at(
                &path,
                DeleteCustomToolRequest {
                    tool_id: "custom-one".into(),
                    expected_revision: plan.revision
                }
            )
            .unwrap_err(),
            "自定义工具仍被方案引用，不能删除"
        );
    }

    #[test]
    fn invalid_or_unknown_tool_references_are_rejected_without_revision_change() {
        let root = tempdir().unwrap();
        let path = root.path().join("bandi.db");
        let error = save_plan_at(
            &path,
            SaveToolPlanRequest {
                plan: plan("default", "默认方案", &["unknown"]),
                expected_revision: 0,
            },
        )
        .unwrap_err();
        assert_eq!(error, "方案引用了不存在的工具");
        assert_eq!(load_snapshot_at(&path).unwrap().revision, 0);
    }
}
