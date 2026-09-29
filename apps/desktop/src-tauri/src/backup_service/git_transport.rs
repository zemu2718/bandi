use std::{fs, io::ErrorKind, path::Path};

use git2::{
    build::CheckoutBuilder, Cred, FetchOptions, Oid, PushOptions, RemoteCallbacks, Repository,
};
use serde::Serialize;

pub(crate) const REMOTE_BRANCH: &str = "bandi-backup-v1";
pub(crate) const REMOTE_NAME: &str = "origin";
const MAX_REMOTE_FILES: usize = 4_096;
const MAX_REMOTE_BYTES: u64 = 256 * 1024 * 1024;

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RemoteHeadDecision {
    Initialize,
    FastForward {
        remote_head: String,
    },
    UpToDate,
    Push {
        expected_remote_head: Option<String>,
    },
    Conflict {
        expected: String,
        actual: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemotePushResultDto {
    pub(crate) branch: String,
    pub(crate) commit_id: String,
    pub(crate) previous_remote_head: Option<String>,
}

pub(crate) fn list_remote_history(
    workspace: &Path,
) -> Result<std::collections::HashMap<String, String>, String> {
    let repository =
        Repository::open(workspace).map_err(|_| "远程备份 Git 工作区不存在".to_string())?;
    let branch = repository
        .find_branch(REMOTE_BRANCH, git2::BranchType::Local)
        .map_err(|_| "远程备份分支不存在".to_string())?;
    let commit = branch
        .get()
        .peel_to_commit()
        .map_err(|_| "无法读取远程备份提交历史".to_string())?;
    let mut walk = repository
        .revwalk()
        .map_err(|_| "无法读取远程备份提交历史".to_string())?;
    walk.push(commit.id())
        .map_err(|_| "无法读取远程备份提交历史".to_string())?;
    let mut result = std::collections::HashMap::new();
    for oid in walk {
        let oid = oid.map_err(|_| "无法读取远程备份提交历史".to_string())?;
        let commit = repository
            .find_commit(oid)
            .map_err(|_| "无法读取远程备份提交".to_string())?;
        let Some(snapshot_id) = commit
            .message()
            .and_then(|message| message.strip_prefix("Backup "))
        else {
            continue;
        };
        let snapshot_id = snapshot_id.trim();
        validate_snapshot_id(snapshot_id)?;
        super::portable::read_portable_snapshot_at(&workspace.join("snapshots"), snapshot_id)?;
        result.insert(snapshot_id.to_string(), oid.to_string());
    }
    Ok(result)
}

pub(crate) fn push_portable_snapshot(
    workspace: &Path,
    portable_snapshot: &Path,
    snapshot_id: &str,
    owner: &str,
    repository_name: &str,
    expected_remote_head: Option<&str>,
) -> Result<RemotePushResultDto, String> {
    super::github::validate_repository_name(owner, "仓库所有者")?;
    super::github::validate_repository_name(repository_name, "仓库名称")?;
    validate_snapshot_id(snapshot_id)?;
    if let Some(expected) = expected_remote_head {
        validate_commit_oid(expected)?;
    }
    ensure_regular_directory(portable_snapshot, "Portable 快照目录")?;
    ensure_workspace(workspace)?;

    let repository = open_or_initialize(workspace)?;
    configure_origin(&repository, owner, repository_name)?;
    let actual_remote_head = fetch_remote_head(&repository)?;
    if actual_remote_head.as_deref() != expected_remote_head {
        return Err("远程备份已被其他设备更新，已停止推送".into());
    }

    checkout_remote_baseline(&repository, actual_remote_head.as_deref())?;
    let relative_snapshot = Path::new("snapshots").join(snapshot_id);
    let destination = workspace.join(&relative_snapshot);
    if destination.exists() {
        return Err("远程备份工作区已存在同名快照".into());
    }
    copy_snapshot_directory(portable_snapshot, &destination)?;
    let commit = commit_snapshot(
        &repository,
        &relative_snapshot,
        snapshot_id,
        actual_remote_head.as_deref(),
    )?;
    if let Some(remote_head) = actual_remote_head.as_deref() {
        let ancestor =
            Oid::from_str(remote_head).map_err(|_| "远程 commit 标识无效".to_string())?;
        if !repository
            .graph_descendant_of(commit, ancestor)
            .map_err(|_| "无法验证远程备份提交关系".to_string())?
        {
            return Err("远程备份提交不是 fast-forward，已停止推送".into());
        }
    }
    push_branch(&repository)?;
    Ok(RemotePushResultDto {
        branch: REMOTE_BRANCH.into(),
        commit_id: commit.to_string(),
        previous_remote_head: actual_remote_head,
    })
}

#[cfg(test)]
pub(crate) fn decide_remote_head(
    recorded_remote_head: Option<&str>,
    actual_remote_head: Option<&str>,
    local_head: Option<&str>,
) -> Result<RemoteHeadDecision, String> {
    for oid in [recorded_remote_head, actual_remote_head, local_head]
        .into_iter()
        .flatten()
    {
        validate_commit_oid(oid)?;
    }
    if let Some(expected) = recorded_remote_head {
        if actual_remote_head != Some(expected) {
            return Ok(RemoteHeadDecision::Conflict {
                expected: expected.into(),
                actual: actual_remote_head.unwrap_or("<none>").into(),
            });
        }
    }
    match (actual_remote_head, local_head) {
        (None, None) => Ok(RemoteHeadDecision::Initialize),
        (Some(remote), None) => Ok(RemoteHeadDecision::FastForward {
            remote_head: remote.into(),
        }),
        (Some(remote), Some(local)) if remote == local => Ok(RemoteHeadDecision::UpToDate),
        (remote, Some(_)) => Ok(RemoteHeadDecision::Push {
            expected_remote_head: remote.map(str::to_owned),
        }),
    }
}

fn open_or_initialize(workspace: &Path) -> Result<Repository, String> {
    match Repository::open(workspace) {
        Ok(repository) => Ok(repository),
        Err(_) => {
            let mut options = git2::RepositoryInitOptions::new();
            options.initial_head(REMOTE_BRANCH);
            Repository::init_opts(workspace, &options)
                .map_err(|_| "无法初始化远程备份 Git 工作区".into())
        }
    }
}

fn configure_origin(repository: &Repository, owner: &str, name: &str) -> Result<(), String> {
    let expected = format!("https://github.com/{owner}/{name}.git");
    match repository.find_remote(REMOTE_NAME) {
        Ok(remote) if remote.url() == Some(expected.as_str()) => Ok(()),
        Ok(_) => Err("远程备份工作区 origin 与已连接仓库不一致".into()),
        Err(error) if error.code() == git2::ErrorCode::NotFound => repository
            .remote(REMOTE_NAME, &expected)
            .map(|_| ())
            .map_err(|_| "无法设置远程备份 origin".into()),
        Err(_) => Err("无法读取远程备份 origin".into()),
    }
}

fn fetch_remote_head(repository: &Repository) -> Result<Option<String>, String> {
    let callbacks = credential_callbacks();
    let mut options = FetchOptions::new();
    options.remote_callbacks(callbacks);
    let refspec = format!(
        "+refs/heads/{0}:refs/remotes/{1}/{0}",
        REMOTE_BRANCH, REMOTE_NAME
    );
    let mut remote = repository
        .find_remote(REMOTE_NAME)
        .map_err(|_| "无法读取远程备份 origin".to_string())?;
    match remote.fetch(&[&refspec], Some(&mut options), None) {
        Ok(()) => {}
        Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(_) => return Err("无法 fetch 远程备份分支".into()),
    }
    let reference = format!("refs/remotes/{REMOTE_NAME}/{REMOTE_BRANCH}");
    match repository.refname_to_id(&reference) {
        Ok(oid) => Ok(Some(oid.to_string())),
        Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(_) => Err("无法读取远程备份 head".into()),
    }
}

fn checkout_remote_baseline(
    repository: &Repository,
    remote_head: Option<&str>,
) -> Result<(), String> {
    let Some(remote_head) = remote_head else {
        return Ok(());
    };
    let oid = Oid::from_str(remote_head).map_err(|_| "远程 commit 标识无效".to_string())?;
    let commit = repository
        .find_commit(oid)
        .map_err(|_| "无法读取远程备份基线提交".to_string())?;
    repository
        .branch(REMOTE_BRANCH, &commit, true)
        .map_err(|_| "无法更新远程备份本地分支".to_string())?;
    repository
        .set_head(&format!("refs/heads/{REMOTE_BRANCH}"))
        .map_err(|_| "无法切换远程备份本地分支".to_string())?;
    let mut checkout = CheckoutBuilder::new();
    checkout.force().remove_untracked(true);
    repository
        .checkout_head(Some(&mut checkout))
        .map_err(|_| "无法同步远程备份工作区基线".into())
}

fn commit_snapshot(
    repository: &Repository,
    relative_snapshot: &Path,
    snapshot_id: &str,
    remote_head: Option<&str>,
) -> Result<Oid, String> {
    let mut index = repository
        .index()
        .map_err(|_| "无法读取远程备份 Git index".to_string())?;
    index
        .add_all([relative_snapshot], git2::IndexAddOption::DEFAULT, None)
        .map_err(|_| "无法暂存 Portable 快照".to_string())?;
    index
        .write()
        .map_err(|_| "无法写入远程备份 Git index".to_string())?;
    let tree_id = index
        .write_tree()
        .map_err(|_| "无法生成远程备份 Git tree".to_string())?;
    let tree = repository
        .find_tree(tree_id)
        .map_err(|_| "无法读取远程备份 Git tree".to_string())?;
    let signature = git2::Signature::now("Bandi", "backup@bandi.local")
        .map_err(|_| "无法创建远程备份提交签名".to_string())?;
    let parent = remote_head
        .map(|value| {
            Oid::from_str(value)
                .map_err(|_| "远程 commit 标识无效".to_string())
                .and_then(|oid| {
                    repository
                        .find_commit(oid)
                        .map_err(|_| "无法读取远程备份父提交".to_string())
                })
        })
        .transpose()?;
    let parents: Vec<_> = parent.iter().collect();
    let reference = format!("refs/heads/{REMOTE_BRANCH}");
    repository
        .commit(
            Some(&reference),
            &signature,
            &signature,
            &format!("Backup {snapshot_id}"),
            &tree,
            &parents,
        )
        .map_err(|_| "无法提交 Portable 快照".into())
}

fn push_branch(repository: &Repository) -> Result<(), String> {
    let callbacks = credential_callbacks();
    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{REMOTE_BRANCH}:refs/heads/{REMOTE_BRANCH}");
    repository
        .find_remote(REMOTE_NAME)
        .map_err(|_| "无法读取远程备份 origin".to_string())?
        .push(&[&refspec], Some(&mut options))
        .map_err(|_| "远程备份 push 被拒绝；远程可能已发生变化".into())
}

fn credential_callbacks() -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|_, _, _| {
        let token = super::github::load_access_token()
            .map_err(|message| git2::Error::from_str(&message))?;
        Cred::userpass_plaintext("x-access-token", &token)
    });
    callbacks
}

fn ensure_workspace(workspace: &Path) -> Result<(), String> {
    match fs::symlink_metadata(workspace) {
        Ok(_) => ensure_regular_directory(workspace, "远程备份工作区"),
        Err(error) if error.kind() == ErrorKind::NotFound => fs::create_dir_all(workspace)
            .map_err(|_| "无法创建远程备份工作区".to_string())
            .and_then(|_| ensure_regular_directory(workspace, "远程备份工作区")),
        Err(_) => Err("无法检查远程备份工作区".into()),
    }
}

fn copy_snapshot_directory(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|_| "无法创建远程快照目录".to_string())?;
    let mut counts = (0usize, 0u64);
    copy_entries(source, target, &mut counts).inspect_err(|_| {
        let _ = fs::remove_dir_all(target);
    })
}

fn copy_entries(source: &Path, target: &Path, counts: &mut (usize, u64)) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|_| "无法读取 Portable 快照".to_string())? {
        let entry = entry.map_err(|_| "无法读取 Portable 快照条目".to_string())?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| "无法检查 Portable 快照条目".to_string())?;
        let destination = target.join(entry.file_name());
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::create_dir(&destination).map_err(|_| "无法创建远程快照子目录".to_string())?;
            copy_entries(&entry.path(), &destination, counts)?;
        } else if metadata.is_file() && !metadata.file_type().is_symlink() {
            counts.0 += 1;
            counts.1 = counts.1.saturating_add(metadata.len());
            if counts.0 > MAX_REMOTE_FILES || counts.1 > MAX_REMOTE_BYTES {
                return Err("Portable 快照超出远程备份限制".into());
            }
            fs::copy(entry.path(), destination)
                .map_err(|_| "无法复制 Portable 快照条目".to_string())?;
        } else {
            return Err("Portable 快照包含链接或特殊文件".into());
        }
    }
    Ok(())
}

fn ensure_regular_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("无法检查{label}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{label}必须是普通目录"));
    }
    Ok(())
}

pub(super) fn validate_snapshot_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Portable 快照标识无效".into());
    }
    Ok(())
}

pub(super) fn validate_commit_oid(value: &str) -> Result<(), String> {
    if (value.len() != 40 && value.len() != 64)
        || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("Git commit 标识无效".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    #[test]
    fn remote_head_change_is_conflict() {
        assert_eq!(
            decide_remote_head(Some(A), Some(B), Some(A)).unwrap(),
            RemoteHeadDecision::Conflict {
                expected: A.into(),
                actual: B.into(),
            }
        );
    }

    #[test]
    fn snapshot_copy_rejects_symlink_and_removes_partial_target() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir(&source).unwrap();
        #[cfg(unix)]
        {
            let target = root.path().join("target");
            std::os::unix::fs::symlink(root.path(), source.join("link")).unwrap();
            fs::write(source.join("kept-before-link"), b"data").unwrap();
            assert!(copy_snapshot_directory(&source, &target).is_err());
            assert!(!target.exists(), "失败复制不得留下可提交的半成品");
        }
    }

    #[test]
    fn bare_repository_accepts_isolated_snapshot_commit() {
        let root = tempfile::tempdir().unwrap();
        let bare = Repository::init_bare(root.path().join("remote")).unwrap();
        let workspace_path = root.path().join("workspace");
        let workspace = Repository::init(&workspace_path).unwrap();
        workspace
            .remote(REMOTE_NAME, bare.path().to_str().unwrap())
            .unwrap();
        let snapshot = workspace_path.join("snapshots/s1");
        fs::create_dir_all(&snapshot).unwrap();
        fs::write(snapshot.join("manifest.json"), b"manifest").unwrap();
        let commit = commit_snapshot(&workspace, Path::new("snapshots/s1"), "s1", None).unwrap();
        let mut remote = workspace.find_remote(REMOTE_NAME).unwrap();
        remote
            .push(
                &[&format!(
                    "refs/heads/{REMOTE_BRANCH}:refs/heads/{REMOTE_BRANCH}"
                )],
                None,
            )
            .unwrap();
        assert_eq!(
            bare.refname_to_id(&format!("refs/heads/{REMOTE_BRANCH}"))
                .unwrap(),
            commit
        );
    }
}
