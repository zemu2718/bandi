use std::{fs, io::ErrorKind, path::Path};

use serde::{Deserialize, Serialize};

use crate::config_fs::{ensure_regular_file, restricted_atomic_write};

pub(super) const REMOTE_STATE_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteBackupState {
    pub(crate) version: u32,
    pub(crate) repository: Option<RemoteRepositoryState>,
    pub(crate) last_remote_head: Option<String>,
    pub(crate) include_agent_memory: bool,
    pub(crate) pending_snapshot_id: Option<String>,
    pub(crate) in_flight_snapshot_id: Option<String>,
    pub(crate) failed_snapshot_id: Option<String>,
    pub(crate) last_error: Option<String>,
    pub(crate) remote_conflict: bool,
    pub(crate) automatic: AutomaticBackupState,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RemoteRepositoryState {
    pub(crate) owner: String,
    pub(crate) name: String,
    pub(crate) repository_id: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AutomaticBackupState {
    pub(crate) enabled: bool,
    pub(crate) last_success_at: Option<String>,
    pub(crate) last_snapshot_id: Option<String>,
}

impl Default for RemoteBackupState {
    fn default() -> Self {
        Self {
            version: REMOTE_STATE_VERSION,
            repository: None,
            last_remote_head: None,
            include_agent_memory: false,
            pending_snapshot_id: None,
            in_flight_snapshot_id: None,
            failed_snapshot_id: None,
            last_error: None,
            remote_conflict: false,
            automatic: AutomaticBackupState {
                enabled: false,
                last_success_at: None,
                last_snapshot_id: None,
            },
        }
    }
}

pub(crate) fn load_remote_state(path: &Path) -> Result<RemoteBackupState, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => ensure_regular_file(path, "远程备份状态")?,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(RemoteBackupState::default())
        }
        Err(_) => return Err("无法检查远程备份状态".into()),
    }
    let bytes = fs::read(path).map_err(|_| "无法读取远程备份状态".to_string())?;
    let state: RemoteBackupState =
        serde_json::from_slice(&bytes).map_err(|_| "远程备份状态格式无效".to_string())?;
    validate_state(&state)?;
    Ok(state)
}

pub(crate) fn store_remote_state(path: &Path, state: &RemoteBackupState) -> Result<(), String> {
    validate_state(state)?;
    let bytes =
        serde_json::to_vec_pretty(state).map_err(|_| "无法序列化远程备份状态".to_string())?;
    let require_existing = match fs::symlink_metadata(path) {
        Ok(_) => true,
        Err(error) if error.kind() == ErrorKind::NotFound => false,
        Err(_) => return Err("无法检查远程备份状态".into()),
    };
    restricted_atomic_write(path, &bytes, require_existing, "远程备份状态")
}

fn validate_state(state: &RemoteBackupState) -> Result<(), String> {
    if state.version != REMOTE_STATE_VERSION {
        return Err("不支持的远程备份状态版本".into());
    }
    if let Some(repository) = &state.repository {
        super::github::validate_repository_name(&repository.owner, "仓库所有者")?;
        super::github::validate_repository_name(&repository.name, "仓库名称")?;
        if repository.repository_id == 0 {
            return Err("远程仓库标识无效".into());
        }
    }
    if let Some(head) = &state.last_remote_head {
        super::git_transport::validate_commit_oid(head)?;
    }
    for snapshot_id in [
        state.pending_snapshot_id.as_deref(),
        state.in_flight_snapshot_id.as_deref(),
        state.failed_snapshot_id.as_deref(),
        state.automatic.last_snapshot_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        super::git_transport::validate_snapshot_id(snapshot_id)?;
    }
    if state.in_flight_snapshot_id.is_some() && state.remote_conflict {
        return Err("远程备份状态不能同时处于进行中和冲突".into());
    }
    if state.pending_snapshot_id.is_none() && state.in_flight_snapshot_id.is_some() {
        return Err("远程备份进行中状态缺少待处理快照".into());
    }
    if state.failed_snapshot_id.is_some() && state.last_error.is_none() {
        return Err("远程备份失败状态缺少错误信息".into());
    }
    if state
        .last_error
        .as_ref()
        .is_some_and(|error| error.len() > 1024)
    {
        return Err("远程备份错误信息过长".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_round_trips_without_secret_fields() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("remote-state.json");
        let state = RemoteBackupState {
            repository: Some(RemoteRepositoryState {
                owner: "bandi-user".into(),
                name: "bandi-backup".into(),
                repository_id: 42,
            }),
            ..RemoteBackupState::default()
        };

        store_remote_state(&path, &state).unwrap();
        assert_eq!(load_remote_state(&path).unwrap(), state);
        let stored = fs::read_to_string(path).unwrap();
        assert!(!stored.contains("token"));
    }

    #[test]
    fn state_rejects_unknown_or_future_fields() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("remote-state.json");
        fs::write(
            &path,
            r#"{"version":2,"repository":null,"lastRemoteHead":null,"automatic":{"enabled":false,"includeAgentMemory":false,"lastSuccessAt":null,"lastSnapshotId":null},"token":"secret"}"#,
        )
        .unwrap();
        assert!(load_remote_state(&path).is_err());
    }

    #[test]
    fn state_rejects_invalid_progress_combinations_and_preserves_existing_on_bad_write() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("remote-state.json");
        let valid = RemoteBackupState::default();
        store_remote_state(&path, &valid).unwrap();
        let mut invalid = valid.clone();
        invalid.in_flight_snapshot_id = Some("snap-1".into());
        assert!(store_remote_state(&path, &invalid).is_err());
        assert_eq!(load_remote_state(&path).unwrap(), valid);
    }
}
