use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::{domain_store, local_service};

#[derive(Debug, Clone)]
pub struct LocalServicePaths {
    pub database: PathBuf,
    pub managed_agents: PathBuf,
    pub shared_assets: PathBuf,
}

impl LocalServicePaths {
    pub fn from_roots(home: &Path, app_data: &Path) -> Self {
        Self {
            database: app_data.join("bandi.db"),
            shared_assets: app_data.join("shared-assets"),
            managed_agents: home.join(".bandi/agents"),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckItem {
    pub name: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub status: String,
    pub checks: Vec<CheckItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub status: String,
    pub teams: usize,
    pub task_briefs: usize,
    pub managed_assets: usize,
    pub shared_assets: usize,
    pub asset_references: usize,
    pub errors: usize,
    pub warnings: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliDiagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remediation: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCheckReport {
    pub status: String,
    pub checked_assets: usize,
    pub errors: usize,
    pub warnings: usize,
    pub diagnostics: Vec<CliDiagnostic>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TeamFact {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<String>,
    pub member_agent_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentFact {
    pub id: String,
    pub name: String,
    pub status: String,
    pub team_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_id: Option<String>,
    #[serde(default)]
    pub responsibilities: Vec<String>,
    #[serde(default)]
    pub deliverables: Vec<String>,
    #[serde(default)]
    pub decision_boundaries: Vec<String>,
    #[serde(default)]
    pub escalation_conditions: Vec<String>,
    #[serde(default)]
    pub prohibitions: Vec<String>,
    #[serde(default)]
    pub completion_definition: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBriefFact {
    pub id: String,
    pub team_id: String,
    pub title: String,
    pub goal: String,
    pub context: String,
    pub constraints: String,
    pub expected_output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextFact {
    pub team: TeamFact,
    pub agent: AgentFact,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_brief: Option<TaskBriefFact>,
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

fn require_id(value: &str, label: &str) -> Result<(), String> {
    valid_id(value)
        .then_some(())
        .ok_or_else(|| format!("{label}无效"))
}

fn path_check(name: &str, path: &Path, expected_directory: bool) -> CheckItem {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => CheckItem {
            name: name.into(),
            status: "error".into(),
            message: "目标不能是符号链接".into(),
        },
        Ok(metadata) if metadata.is_dir() == expected_directory => CheckItem {
            name: name.into(),
            status: "ok".into(),
            message: "可访问".into(),
        },
        Ok(_) => CheckItem {
            name: name.into(),
            status: "error".into(),
            message: if expected_directory {
                "目标不是目录"
            } else {
                "目标不是普通文件"
            }
            .into(),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => CheckItem {
            name: name.into(),
            status: "not_initialized".into(),
            message: "尚未初始化".into(),
        },
        Err(_) => CheckItem {
            name: name.into(),
            status: "error".into(),
            message: "无法读取".into(),
        },
    }
}

pub fn doctor(paths: &LocalServicePaths) -> DoctorReport {
    let mut checks = vec![
        path_check("domainDatabase", &paths.database, false),
        path_check("managedAgents", &paths.managed_agents, true),
        path_check("sharedAssets", &paths.shared_assets, true),
    ];
    if paths.database.is_file() {
        checks.push(match organization_snapshot(paths) {
            Ok(_) => CheckItem {
                name: "databaseSchema".into(),
                status: "ok".into(),
                message: "SQLite/WAL schema 可读取".into(),
            },
            Err(message) => CheckItem {
                name: "databaseSchema".into(),
                status: "error".into(),
                message,
            },
        });
    }
    let status = if checks.iter().any(|item| item.status == "error") {
        "degraded"
    } else if checks.iter().all(|item| item.status == "ok") {
        "healthy"
    } else {
        "not_initialized"
    };
    DoctorReport {
        status: status.into(),
        checks,
    }
}

fn empty_snapshot() -> domain_store::LongTermDomainSnapshotDtoV4 {
    domain_store::LongTermDomainSnapshotDtoV4 {
        schema_version: 4,
        teams: Vec::new(),
        task_briefs: Vec::new(),
    }
}

fn organization_snapshot(
    paths: &LocalServicePaths,
) -> Result<domain_store::LongTermDomainSnapshotDtoV4, String> {
    if !paths.database.is_file() {
        return Ok(empty_snapshot());
    }
    let connection = Connection::open_with_flags(
        &paths.database,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "无法以只读方式打开本地领域数据库".to_string())?;
    let mut statement = connection
        .prepare("SELECT id, name, mark, color, mission, boundary_text, member_agent_ids_json, shared_asset_ids_json FROM teams ORDER BY rowid")
        .map_err(|_| "无法读取 Team".to_string())?;
    let teams = statement
        .query_map([], |row| {
            Ok(domain_store::TeamDtoV4 {
                id: row.get(0)?,
                name: row.get(1)?,
                mark: row.get(2)?,
                color: row.get(3)?,
                mission: row.get(4)?,
                boundary: row.get(5)?,
                member_agent_ids: serde_json::from_str(&row.get::<_, String>(6)?).map_err(
                    |error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            6,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    },
                )?,
                shared_asset_ids: serde_json::from_str(&row.get::<_, String>(7)?).map_err(
                    |error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            7,
                            rusqlite::types::Type::Text,
                            Box::new(error),
                        )
                    },
                )?,
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
            Ok(domain_store::TaskBriefDtoV4 {
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
    Ok(domain_store::LongTermDomainSnapshotDtoV4 {
        schema_version: 4,
        teams,
        task_briefs,
    })
}

fn discovery(
    paths: &LocalServicePaths,
    snapshot: &domain_store::LongTermDomainSnapshotDtoV4,
) -> local_service::DiscoveryResult {
    local_service::discover_with_shared_at(
        &paths.managed_agents,
        &paths.shared_assets,
        snapshot,
        true,
        local_service::DiscoveryRequest {
            request_id: "bandi-cli-config-check".into(),
            include_claude_user_root: false,
        },
    )
}

fn team_fact(team: &domain_store::TeamDtoV4) -> TeamFact {
    TeamFact {
        id: team.id.clone(),
        name: team.name.clone(),
        mission: team.mission.clone(),
        boundary: team.boundary.clone(),
        member_agent_ids: team.member_agent_ids.clone(),
    }
}

fn task_brief_fact(task: &domain_store::TaskBriefDtoV4) -> TaskBriefFact {
    TaskBriefFact {
        id: task.id.clone(),
        team_id: task.team_id.clone(),
        title: task.title.clone(),
        goal: task.goal.clone(),
        context: task.context.clone(),
        constraints: task.constraints.clone(),
        expected_output: task.expected_output.clone(),
        archived_at: task.archived_at.clone(),
    }
}

fn read_agent(paths: &LocalServicePaths, agent_id: &str) -> Result<AgentFact, String> {
    require_id(agent_id, "Agent 标识")?;
    let package = paths.managed_agents.join(format!("agt_{agent_id}"));
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
    let (manifest_id, _, schema_version) = local_service::manifest_facts(&manifest_path)
        .map_err(|issue| format!("无法读取 Agent 事实：{}", issue.message))?;
    if manifest_id != agent_id {
        return Err("AgentPackage 稳定标识不一致".into());
    }
    if schema_version != 1 {
        return Err("AgentPackage schemaVersion 不受支持".into());
    }
    let manifest: AgentFact = serde_yaml::from_str(
        &fs::read_to_string(manifest_path).map_err(|_| "无法读取 Agent 事实".to_string())?,
    )
    .map_err(|_| "Agent 身份字段无效".to_string())?;
    if manifest.id != agent_id || !valid_id(&manifest.team_id) {
        return Err("Agent 身份稳定标识无效或不一致".into());
    }
    if manifest.function_id.as_deref().is_some_and(|function_id| {
        ![
            "product",
            "design",
            "engineering",
            "testing",
            "research",
            "operations",
            "general",
            "other",
        ]
        .contains(&function_id)
    }) {
        return Err("Agent 职能标识不受支持".into());
    }
    Ok(manifest)
}

pub fn list_teams(paths: &LocalServicePaths) -> Result<Vec<TeamFact>, String> {
    Ok(organization_snapshot(paths)?
        .teams
        .iter()
        .map(team_fact)
        .collect())
}

pub fn list_agents(paths: &LocalServicePaths, team_id: &str) -> Result<Vec<AgentFact>, String> {
    require_id(team_id, "Team 标识")?;
    let snapshot = organization_snapshot(paths)?;
    let team = snapshot
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or_else(|| "Team 不存在".to_string())?;
    team.member_agent_ids
        .iter()
        .map(|agent_id| {
            let agent = read_agent(paths, agent_id)?;
            if agent.team_id != team_id {
                return Err(format!("Agent {agent_id} 不属于所选 Team"));
            }
            Ok(agent)
        })
        .collect()
}

pub fn show_agent(paths: &LocalServicePaths, agent_id: &str) -> Result<AgentFact, String> {
    read_agent(paths, agent_id)
}

pub fn list_task_briefs(
    paths: &LocalServicePaths,
    team_id: &str,
) -> Result<Vec<TaskBriefFact>, String> {
    require_id(team_id, "Team 标识")?;
    let snapshot = organization_snapshot(paths)?;
    if !snapshot.teams.iter().any(|team| team.id == team_id) {
        return Err("Team 不存在".into());
    }
    Ok(snapshot
        .task_briefs
        .iter()
        .filter(|task| task.team_id == team_id)
        .map(task_brief_fact)
        .collect())
}

pub fn show_task_brief(
    paths: &LocalServicePaths,
    task_brief_id: &str,
) -> Result<TaskBriefFact, String> {
    require_id(task_brief_id, "TaskBrief 标识")?;
    organization_snapshot(paths)?
        .task_briefs
        .iter()
        .find(|task| task.id == task_brief_id)
        .map(task_brief_fact)
        .ok_or_else(|| "TaskBrief 不存在".to_string())
}

pub fn show_context(
    paths: &LocalServicePaths,
    team_id: &str,
    agent_id: &str,
    task_brief_id: Option<&str>,
) -> Result<ContextFact, String> {
    require_id(team_id, "Team 标识")?;
    let snapshot = organization_snapshot(paths)?;
    let team = snapshot
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or_else(|| "Team 不存在".to_string())?;
    let agent = read_agent(paths, agent_id)?;
    if agent.team_id != team_id || !team.member_agent_ids.iter().any(|id| id == agent_id) {
        return Err("Agent 不属于所选 Team".into());
    }
    if agent.status != "active" {
        return Err("Agent 必须处于 active 状态".into());
    }
    let task_brief = task_brief_id
        .map(|id| {
            require_id(id, "TaskBrief 标识")?;
            snapshot
                .task_briefs
                .iter()
                .find(|task| task.id == id && task.team_id == team_id && task.archived_at.is_none())
                .map(task_brief_fact)
                .ok_or_else(|| "TaskBrief 不存在、已归档或不属于所选 Team".to_string())
        })
        .transpose()?;
    Ok(ContextFact {
        team: team_fact(team),
        agent,
        task_brief,
    })
}

pub fn status(paths: &LocalServicePaths) -> Result<StatusReport, String> {
    let snapshot = organization_snapshot(paths)?;
    let discovered = discovery(paths, &snapshot);
    let errors = discovered
        .diagnostics
        .iter()
        .filter(|item| item.severity == "error")
        .count();
    let warnings = discovered
        .diagnostics
        .iter()
        .filter(|item| item.severity == "warning")
        .count();
    Ok(StatusReport {
        status: if errors == 0 { "ready" } else { "degraded" }.into(),
        teams: snapshot.teams.len(),
        task_briefs: snapshot.task_briefs.len(),
        managed_assets: discovered.assets.len(),
        shared_assets: discovered.shared_assets.len(),
        asset_references: discovered.references.len(),
        errors,
        warnings,
    })
}

pub fn check_config(paths: &LocalServicePaths) -> Result<ConfigCheckReport, String> {
    let snapshot = organization_snapshot(paths)?;
    let discovered = discovery(paths, &snapshot);
    let errors = discovered
        .diagnostics
        .iter()
        .filter(|item| item.severity == "error")
        .count();
    let warnings = discovered
        .diagnostics
        .iter()
        .filter(|item| item.severity == "warning")
        .count();
    Ok(ConfigCheckReport {
        status: if errors == 0 { "valid" } else { "invalid" }.into(),
        checked_assets: discovered.assets.len() + discovered.shared_assets.len(),
        errors,
        warnings,
        diagnostics: discovered
            .diagnostics
            .into_iter()
            .map(|item| CliDiagnostic {
                code: item.code,
                severity: item.severity,
                message: item.message,
                path: item.path.filter(|path| !Path::new(path).is_absolute()),
                remediation: item.remediation,
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn paths_use_explicit_platform_roots() {
        let home = Path::new("C:/Users/Bandi");
        let app_data = Path::new("D:/Profiles/Bandi/Roaming/com.bandi.desktop");
        let paths = LocalServicePaths::from_roots(home, app_data);
        assert_eq!(paths.database, app_data.join("bandi.db"));
        assert_eq!(paths.shared_assets, app_data.join("shared-assets"));
        assert_eq!(paths.managed_agents, home.join(".bandi/agents"));
    }

    #[test]
    fn doctor_does_not_create_missing_storage() {
        let root = tempdir().unwrap();
        let paths = LocalServicePaths {
            database: root.path().join("missing/bandi.db"),
            managed_agents: root.path().join("missing/agents"),
            shared_assets: root.path().join("missing/shared-assets"),
        };
        let report = doctor(&paths);
        assert_eq!(report.status, "not_initialized");
        assert!(!paths.database.exists());
    }

    #[test]
    fn status_and_check_use_shared_discovery_without_persisting_projection() {
        let root = tempdir().unwrap();
        let paths = LocalServicePaths {
            database: root.path().join("bandi.db"),
            managed_agents: root.path().join("agents"),
            shared_assets: root.path().join("shared-assets"),
        };
        fs::create_dir_all(&paths.managed_agents).unwrap();
        let before = fs::read_dir(root.path()).unwrap().count();
        let status = status(&paths).unwrap();
        let check = check_config(&paths).unwrap();
        assert_eq!(status.managed_assets, 0);
        assert_eq!(status.shared_assets, 0);
        assert_eq!(status.asset_references, 0);
        assert_eq!(check.checked_assets, 0);
        assert!(!paths.database.exists());
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), before);
    }

    #[test]
    fn status_and_check_include_registered_shared_assets() {
        let root = tempdir().unwrap();
        let paths = LocalServicePaths {
            database: root.path().join("bandi.db"),
            managed_agents: root.path().join("agents"),
            shared_assets: root.path().join("shared-assets"),
        };
        let package = paths.shared_assets.join("skill-review");
        fs::create_dir_all(&package).unwrap();
        fs::write(
            package.join("asset.yaml"),
            "schemaVersion: 1\nid: skill-review\nkind: skill\nteamId: xinghe\ncontentFile: SKILL.md\n",
        )
        .unwrap();
        fs::write(package.join("SKILL.md"), "# Review\n").unwrap();
        domain_store::save_team_v4_at(
            &paths.database,
            domain_store::TeamDtoV4 {
                id: "xinghe".into(),
                name: "星河".into(),
                mark: None,
                color: None,
                mission: Some("管理共享配置资产".into()),
                boundary: Some("只允许 Team 内显式引用".into()),
                member_agent_ids: Vec::new(),
                shared_asset_ids: vec!["skill-review".into()],
            },
        )
        .unwrap();

        let status = status(&paths).unwrap();
        let check = check_config(&paths).unwrap();

        assert_eq!(status.shared_assets, 1);
        assert_eq!(status.asset_references, 0);
        assert_eq!(check.checked_assets, 1);
        assert_eq!(check.status, "valid");
    }

    #[test]
    fn readonly_queries_return_stable_facts_without_paths_or_writes() {
        let root = tempdir().unwrap();
        let paths = LocalServicePaths {
            database: root.path().join("bandi.db"),
            managed_agents: root.path().join("agents"),
            shared_assets: root.path().join("shared-assets"),
        };
        let package = paths.managed_agents.join("agt_alpha");
        fs::create_dir_all(&package).unwrap();
        fs::write(
            package.join("agent.yaml"),
            "schemaVersion: 1\nid: alpha\nname: Alpha\nteamId: team-personal\nstatus: active\nmission: 审核配置\nresponsibilities: []\ndeliverables: []\ndecisionBoundaries: []\nescalationConditions: []\nprohibitions: []\ncompletionDefinition: []\nsecret: do-not-return\n",
        )
        .unwrap();
        domain_store::save_team_v4_at(
            &paths.database,
            domain_store::TeamDtoV4 {
                id: "team-personal".into(),
                name: "个人".into(),
                mark: None,
                color: None,
                mission: Some("个人配置".into()),
                boundary: None,
                member_agent_ids: vec!["alpha".into()],
                shared_asset_ids: vec![],
            },
        )
        .unwrap();
        let connection = domain_store::open_at(&paths.database).unwrap();
        connection
            .execute(
                "UPDATE teams SET member_agent_ids_json = '[\"alpha\"]' WHERE id = 'team-personal'",
                [],
            )
            .unwrap();
        drop(connection);
        domain_store::save_task_brief_v4_at(
            &paths.database,
            domain_store::TaskBriefDtoV4 {
                id: "brief-1".into(),
                team_id: "team-personal".into(),
                title: "检查配置".into(),
                goal: "确认事实".into(),
                context: "只读".into(),
                constraints: "无写入".into(),
                expected_output: "JSON".into(),
                archived_at: None,
            },
        )
        .unwrap();
        let before = fs::read(package.join("agent.yaml")).unwrap();

        assert_eq!(list_teams(&paths).unwrap()[0].id, "team-personal");
        assert_eq!(list_agents(&paths, "team-personal").unwrap()[0].id, "alpha");
        assert_eq!(show_agent(&paths, "alpha").unwrap().name, "Alpha");
        assert_eq!(list_task_briefs(&paths, "team-personal").unwrap().len(), 1);
        assert_eq!(show_task_brief(&paths, "brief-1").unwrap().goal, "确认事实");
        let context = show_context(&paths, "team-personal", "alpha", Some("brief-1")).unwrap();
        let json = serde_json::to_string(&context).unwrap();
        assert!(json.contains("team-personal"));
        assert!(!json.contains(root.path().to_string_lossy().as_ref()));
        assert!(!json.contains("do-not-return"));
        assert_eq!(fs::read(package.join("agent.yaml")).unwrap(), before);
        assert!(show_agent(&paths, "../alpha").is_err());
        assert!(show_context(&paths, "team-personal", "alpha", Some("../brief")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn doctor_rejects_symlinked_roots() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let actual = root.path().join("actual");
        fs::create_dir(&actual).unwrap();
        let link = root.path().join("agents");
        symlink(&actual, &link).unwrap();
        let paths = LocalServicePaths {
            database: root.path().join("bandi.db"),
            managed_agents: link,
            shared_assets: root.path().join("shared-assets"),
        };
        let report = doctor(&paths);
        assert_eq!(report.status, "degraded");
        assert!(report
            .checks
            .iter()
            .any(|item| item.name == "managedAgents" && item.status == "error"));
    }
}
