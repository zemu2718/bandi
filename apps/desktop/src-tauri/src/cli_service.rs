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
        checks.push(
            match domain_store::load_long_term_domain_snapshot_v4_at(&paths.database) {
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
            },
        );
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
    if paths.database.is_file() {
        domain_store::load_long_term_domain_snapshot_v4_at(&paths.database)
    } else {
        Ok(empty_snapshot())
    }
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
                path: item.path,
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
