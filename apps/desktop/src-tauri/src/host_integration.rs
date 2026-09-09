use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

#[cfg(not(test))]
use std::process::Command;

use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    ai_adapters::BuiltInClientId,
    config_fs::{ensure_regular_directory, ensure_regular_file, restricted_atomic_write},
    host_integration_targets::{Target, TargetFile, TARGETS},
    local_service::{hash_bytes, stable_id},
};
const PREVIEW_TTL_MINUTES: i64 = 10;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HostIntegrationStatus {
    NotChecked,
    Degraded,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InstallationState {
    NotInstalled,
    Installed,
    UpdateAvailable,
    ForeignCollision,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostIntegrationDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) target_id: String,
    pub(crate) status: HostIntegrationStatus,
    pub(crate) installation_state: InstallationState,
    pub(crate) can_install: bool,
    pub(crate) can_uninstall: bool,
    pub(crate) can_reveal: bool,
    pub(crate) reason: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostIntegrationRequest {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) target_id: String,
    pub(crate) request_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostIntegrationCommitRequest {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) target_id: String,
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) confirmation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostIntegrationPreviewDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) target_id: String,
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) action: String,
    pub(crate) status: HostIntegrationStatus,
    pub(crate) installation_state: InstallationState,
    pub(crate) can_commit: bool,
    pub(crate) requires_confirmation: bool,
    pub(crate) reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HostIntegrationResultDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) target_id: String,
    pub(crate) request_id: String,
    pub(crate) status: HostIntegrationStatus,
    pub(crate) installation_state: InstallationState,
    pub(crate) changed: bool,
    pub(crate) reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevealHostDirectoryResultDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) target_id: String,
    pub(crate) request_id: String,
    pub(crate) status: HostIntegrationStatus,
    pub(crate) revealed: bool,
    pub(crate) reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPreview {
    preview: HostIntegrationPreviewDto,
    baseline_hash: Option<String>,
    expires_at: String,
}

fn validate_request_id(value: &str) -> Result<(), String> {
    if !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        Ok(())
    } else {
        Err("INVALID_REQUEST_ID: 请求标识无效".into())
    }
}

fn target(tool_id: BuiltInClientId, target_id: &str) -> Result<Target, String> {
    TARGETS
        .iter()
        .copied()
        .find(|item| item.tool_id == tool_id && item.target_id == target_id)
        .ok_or_else(|| "HOST_TARGET_INVALID: 工具与固定目标不匹配".into())
}

fn target_path(home: &Path, file: TargetFile) -> PathBuf {
    file.relative_path
        .split('/')
        .fold(home.to_path_buf(), |path, part| path.join(part))
}

fn reveal_directory(home: &Path, target: Target) -> Result<PathBuf, String> {
    let relative =
        if cfg!(target_os = "windows") && target.tool_id == BuiltInClientId::ClaudeDesktop {
            "AppData/Roaming/Claude"
        } else {
            target.reveal_relative_path
        };
    let directory = relative
        .split('/')
        .fold(home.to_path_buf(), |path, part| path.join(part));
    ensure_regular_directory(home, "用户主目录")?;
    ensure_regular_directory(&directory, "宿主配置目录")?;
    Ok(directory)
}

#[cfg(not(test))]
fn open_directory(directory: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    command
        .arg(directory)
        .status()
        .map_err(|_| "HOST_REVEAL_FAILED: 无法调用系统文件管理器".to_string())?
        .success()
        .then_some(())
        .ok_or_else(|| "HOST_REVEAL_FAILED: 系统文件管理器未能打开固定目录".to_string())
}

#[cfg(test)]
fn open_directory(_directory: &Path) -> Result<(), String> {
    Ok(())
}

fn inspect(home: &Path, target: Target) -> Result<(InstallationState, Option<String>), String> {
    if target.files.is_empty() {
        return Ok((InstallationState::Unsupported, None));
    }
    let mut hashes = Vec::with_capacity(target.files.len());
    let mut installed = 0;
    let mut outdated = false;
    for file in target.files {
        let path = target_path(home, *file);
        let bytes = match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == ErrorKind::NotFound => continue,
            Err(_) => return Err("HOST_TARGET_CHECK_FAILED: 无法检查宿主目标".into()),
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Ok((InstallationState::ForeignCollision, None));
            }
            Ok(_) => fs::read(&path)
                .map_err(|_| "HOST_TARGET_READ_FAILED: 无法读取宿主目标".to_string())?,
        };
        if !bytes.starts_with(file.owner_prefix.as_bytes()) {
            return Ok((
                InstallationState::ForeignCollision,
                Some(hash_bytes(&bytes)),
            ));
        }
        outdated |= bytes != file.content.as_bytes();
        installed += 1;
        hashes.push(hash_bytes(&bytes));
    }
    let state = if installed == 0 {
        InstallationState::NotInstalled
    } else if installed != target.files.len() || outdated {
        InstallationState::UpdateAvailable
    } else {
        InstallationState::Installed
    };
    let baseline_hash = (!hashes.is_empty()).then(|| hash_bytes(hashes.join(":").as_bytes()));
    Ok((state, baseline_hash))
}

pub(crate) fn list_at(home: &Path) -> Vec<HostIntegrationDto> {
    TARGETS
        .iter()
        .copied()
        .map(|item| {
            let installation_state = inspect(home, item)
                .map(|value| value.0)
                .unwrap_or(InstallationState::Unknown);
            let writable = !item.files.is_empty()
                && !matches!(
                    installation_state,
                    InstallationState::Installed | InstallationState::ForeignCollision
                );
            HostIntegrationDto {
                tool_id: item.tool_id,
                target_id: item.target_id.into(),
                status: if !item.files.is_empty() {
                    HostIntegrationStatus::NotChecked
                } else {
                    HostIntegrationStatus::Degraded
                },
                installation_state,
                can_install: writable,
                can_uninstall: matches!(
                    installation_state,
                    InstallationState::Installed | InstallationState::UpdateAvailable
                ),
                can_reveal: reveal_directory(home, item).is_ok(),
                reason: match installation_state {
                    InstallationState::Unsupported => "该工具需在官方界面安装扩展".into(),
                    InstallationState::ForeignCollision => {
                        "预设安装位置已有其他文件，Bandi 不会覆盖".into()
                    }
                    InstallationState::Unknown => "无法检查预设安装位置".into(),
                    _ => "只检查 Bandi 集成文件；工具是否已识别该集成尚未验证".into(),
                },
            }
        })
        .collect()
}

fn preview_path(app_data: &Path, preview_ref: &str) -> PathBuf {
    app_data
        .join("host-integration-previews")
        .join(format!("{preview_ref}.json"))
}

fn write_preview(app_data: &Path, stored: &StoredPreview) -> Result<(), String> {
    let bytes = serde_json::to_vec(stored)
        .map_err(|_| "HOST_PREVIEW_WRITE_FAILED: 无法编码预览".to_string())?;
    restricted_atomic_write(
        &preview_path(app_data, &stored.preview.preview_ref),
        &bytes,
        false,
        "宿主集成预览",
    )
    .map_err(|message| format!("HOST_PREVIEW_WRITE_FAILED: {message}"))
}

fn create_preview(
    app_data: &Path,
    home: &Path,
    request: HostIntegrationRequest,
    action: &str,
) -> Result<HostIntegrationPreviewDto, String> {
    validate_request_id(&request.request_id)?;
    let item = target(request.tool_id, &request.target_id)?;
    let (installation_state, baseline_hash) = inspect(home, item)?;
    let can_commit = match action {
        "install" => {
            !item.files.is_empty()
                && installation_state != InstallationState::ForeignCollision
                && installation_state != InstallationState::Installed
        }
        "uninstall" => matches!(
            installation_state,
            InstallationState::Installed | InstallationState::UpdateAvailable
        ),
        _ => false,
    };
    let seed = format!(
        "{}:{}:{}:{}",
        request.request_id,
        request.target_id,
        action,
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let preview_ref = stable_id("host-preview", &seed);
    let preview = HostIntegrationPreviewDto {
        tool_id: request.tool_id,
        target_id: request.target_id,
        request_id: request.request_id,
        preview_ref,
        action: action.into(),
        status: if !item.files.is_empty() {
            HostIntegrationStatus::NotChecked
        } else {
            HostIntegrationStatus::Degraded
        },
        installation_state,
        can_commit,
        requires_confirmation: true,
        reason: if can_commit {
            "目标状态已复核，确认后可提交".into()
        } else {
            "当前目标状态不允许提交".into()
        },
    };
    write_preview(
        app_data,
        &StoredPreview {
            preview: preview.clone(),
            baseline_hash,
            expires_at: (Utc::now() + Duration::minutes(PREVIEW_TTL_MINUTES)).to_rfc3339(),
        },
    )?;
    Ok(preview)
}

pub(crate) fn preview_install_at(
    app_data: &Path,
    home: &Path,
    request: HostIntegrationRequest,
) -> Result<HostIntegrationPreviewDto, String> {
    create_preview(app_data, home, request, "install")
}

pub(crate) fn preview_uninstall_at(
    app_data: &Path,
    home: &Path,
    request: HostIntegrationRequest,
) -> Result<HostIntegrationPreviewDto, String> {
    create_preview(app_data, home, request, "uninstall")
}

fn load_preview(
    app_data: &Path,
    request: &HostIntegrationCommitRequest,
    action: &str,
) -> Result<(StoredPreview, Target), String> {
    validate_request_id(&request.request_id)?;
    validate_request_id(&request.preview_ref)?;
    if !request.confirmation {
        return Err("CONFIRMATION_REQUIRED: 必须明确确认 Bandi 集成文件变更".into());
    }
    let path = preview_path(app_data, &request.preview_ref);
    ensure_regular_file(&path, "宿主集成预览")?;
    let stored: StoredPreview = serde_json::from_slice(
        &fs::read(&path).map_err(|_| "HOST_PREVIEW_READ_FAILED: 无法读取预览".to_string())?,
    )
    .map_err(|_| "HOST_PREVIEW_INVALID: 预览无效".to_string())?;
    if stored.preview.tool_id != request.tool_id
        || stored.preview.target_id != request.target_id
        || stored.preview.request_id != request.request_id
        || stored.preview.preview_ref != request.preview_ref
        || stored.preview.action != action
        || !stored.preview.can_commit
        || chrono::DateTime::parse_from_rfc3339(&stored.expires_at)
            .map_err(|_| "HOST_PREVIEW_INVALID: 预览期限无效".to_string())?
            < Utc::now()
    {
        return Err("HOST_PREVIEW_MISMATCH: 预览已过期或与请求不匹配".into());
    }
    Ok((stored, target(request.tool_id, &request.target_id)?))
}

fn ensure_safe_parent(home: &Path, path: &Path) -> Result<(), String> {
    ensure_regular_directory(home, "用户主目录")?;
    let parent = path
        .parent()
        .ok_or_else(|| "HOST_TARGET_INVALID: 目标目录无效".to_string())?;
    let relative = parent
        .strip_prefix(home)
        .map_err(|_| "HOST_TARGET_INVALID: 目标不在固定用户目录".to_string())?;
    let mut current = home.to_path_buf();
    for part in relative.components() {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("HOST_TARGET_UNSAFE: 目标目录链包含非普通目录".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|_| "HOST_TARGET_CREATE_FAILED: 无法创建固定目标目录".to_string())?;
                ensure_regular_directory(&current, "宿主目标目录")?;
            }
            Err(_) => return Err("HOST_TARGET_CHECK_FAILED: 无法检查目标目录".into()),
        }
    }
    Ok(())
}

fn baseline_matches(home: &Path, item: Target, expected: &Option<String>) -> Result<bool, String> {
    let (_, current) = inspect(home, item)?;
    Ok(&current == expected)
}

pub(crate) fn commit_install_at(
    app_data: &Path,
    home: &Path,
    request: HostIntegrationCommitRequest,
) -> Result<HostIntegrationResultDto, String> {
    let (stored, item) = load_preview(app_data, &request, "install")?;
    if !baseline_matches(home, item, &stored.baseline_hash)? {
        return Err("HOST_TARGET_CHANGED: 预设安装位置在确认前发生变化".into());
    }
    if item.files.is_empty() {
        return Err("HOST_INTEGRATION_DEGRADED: 该工具不支持文件安装".into());
    }
    for file in item.files {
        let path = target_path(home, *file);
        ensure_safe_parent(home, &path)?;
        let existed = path.exists();
        restricted_atomic_write(&path, file.content.as_bytes(), existed, "宿主集成")?;
        ensure_regular_file(&path, "宿主集成")?;
        if fs::read(&path).map_err(|_| "HOST_WRITE_VERIFY_FAILED: 无法重读宿主集成".to_string())?
            != file.content.as_bytes()
        {
            return Err("HOST_WRITE_VERIFY_FAILED: 宿主集成写后校验失败".into());
        }
    }
    let _ = fs::remove_file(preview_path(app_data, &request.preview_ref));
    Ok(HostIntegrationResultDto {
        tool_id: request.tool_id,
        target_id: request.target_id,
        request_id: request.request_id,
        status: HostIntegrationStatus::NotChecked,
        installation_state: InstallationState::Installed,
        changed: true,
        reason: "Bandi 集成文件已写入并确认内容一致".into(),
    })
}

pub(crate) fn commit_uninstall_at(
    app_data: &Path,
    home: &Path,
    request: HostIntegrationCommitRequest,
) -> Result<HostIntegrationResultDto, String> {
    let (stored, item) = load_preview(app_data, &request, "uninstall")?;
    if !baseline_matches(home, item, &stored.baseline_hash)? {
        return Err("HOST_TARGET_CHANGED: 预设安装位置在确认前发生变化".into());
    }
    let mut moved = Vec::with_capacity(item.files.len());
    for file in item.files {
        let path = target_path(home, *file);
        ensure_regular_file(&path, "宿主集成")?;
        let bytes =
            fs::read(&path).map_err(|_| "HOST_UNINSTALL_FAILED: 无法复核待卸载文件".to_string())?;
        if !bytes.starts_with(file.owner_prefix.as_bytes()) {
            return Err("HOST_OWNERSHIP_MISMATCH: 该文件不是由 Bandi 安装，无法删除".into());
        }
        let tombstone = path.with_file_name(format!(".bandi-remove.{}", request.preview_ref));
        if tombstone.exists() {
            return Err("HOST_UNINSTALL_FAILED: 卸载隔离目标已存在".into());
        }
        if fs::rename(&path, &tombstone).is_err() {
            for (original, isolated) in moved.iter().rev() {
                let _ = fs::rename(isolated, original);
            }
            return Err("HOST_UNINSTALL_FAILED: 无法隔离待卸载文件".into());
        }
        moved.push((path, tombstone));
    }
    for (_, tombstone) in &moved {
        fs::remove_file(tombstone)
            .map_err(|_| "HOST_UNINSTALL_FAILED: 无法删除 Bandi 宿主文件".to_string())?;
    }
    let _ = fs::remove_file(preview_path(app_data, &request.preview_ref));
    Ok(HostIntegrationResultDto {
        tool_id: request.tool_id,
        target_id: request.target_id,
        request_id: request.request_id,
        status: HostIntegrationStatus::NotChecked,
        installation_state: InstallationState::NotInstalled,
        changed: true,
        reason: "已确认并删除由 Bandi 安装的集成文件".into(),
    })
}

pub(crate) fn reveal_at(
    home: &Path,
    request: HostIntegrationRequest,
) -> Result<RevealHostDirectoryResultDto, String> {
    validate_request_id(&request.request_id)?;
    let item = target(request.tool_id, &request.target_id)?;
    let directory = reveal_directory(home, item)?;
    open_directory(&directory)?;
    Ok(RevealHostDirectoryResultDto {
        tool_id: request.tool_id,
        target_id: request.target_id,
        request_id: request.request_id,
        status: HostIntegrationStatus::NotChecked,
        revealed: true,
        reason: "已在系统文件管理器中显示预设安装位置；Bandi 未读取文件夹内容".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(tool_id: BuiltInClientId, target_id: &str) -> HostIntegrationRequest {
        HostIntegrationRequest {
            tool_id,
            target_id: target_id.into(),
            request_id: "req-1".into(),
        }
    }

    #[test]
    fn installs_and_uninstalls_owned_file_with_preview() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let app_data = root.path().join("app-data");
        fs::create_dir(&home).unwrap();
        fs::create_dir(&app_data).unwrap();
        let preview = preview_install_at(
            &app_data,
            &home,
            request(BuiltInClientId::ClaudeCode, "claude-code-user-skill-v1"),
        )
        .unwrap();
        commit_install_at(
            &app_data,
            &home,
            HostIntegrationCommitRequest {
                tool_id: BuiltInClientId::ClaudeCode,
                target_id: "claude-code-user-skill-v1".into(),
                request_id: "req-1".into(),
                preview_ref: preview.preview_ref,
                confirmation: true,
            },
        )
        .unwrap();
        let preview = preview_uninstall_at(
            &app_data,
            &home,
            request(BuiltInClientId::ClaudeCode, "claude-code-user-skill-v1"),
        )
        .unwrap();
        commit_uninstall_at(
            &app_data,
            &home,
            HostIntegrationCommitRequest {
                tool_id: BuiltInClientId::ClaudeCode,
                target_id: "claude-code-user-skill-v1".into(),
                request_id: "req-1".into(),
                preview_ref: preview.preview_ref,
                confirmation: true,
            },
        )
        .unwrap();
        assert!(!home.join(".claude/skills/bandi/SKILL.md").exists());
    }

    #[test]
    fn refuses_foreign_collision_and_changed_baseline() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let app_data = root.path().join("app-data");
        let path = home.join(".agents/skills/bandi-config/SKILL.md");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::create_dir(&app_data).unwrap();
        fs::write(&path, "foreign").unwrap();
        let preview = preview_install_at(
            &app_data,
            &home,
            request(BuiltInClientId::Codex, "agents-user-skill-v1"),
        )
        .unwrap();
        assert!(!preview.can_commit);
        fs::remove_file(&path).unwrap();
        let preview = preview_install_at(
            &app_data,
            &home,
            request(BuiltInClientId::Codex, "agents-user-skill-v1"),
        )
        .unwrap();
        fs::write(&path, "late foreign").unwrap();
        let error = commit_install_at(
            &app_data,
            &home,
            HostIntegrationCommitRequest {
                tool_id: BuiltInClientId::Codex,
                target_id: "agents-user-skill-v1".into(),
                request_id: "req-1".into(),
                preview_ref: preview.preview_ref,
                confirmation: true,
            },
        )
        .unwrap_err();
        assert!(error.contains("HOST_TARGET_CHANGED"));
    }

    #[test]
    fn rejects_unknown_fields_and_mismatched_target() {
        let request = serde_json::json!({
            "toolId": "codex",
            "targetId": "agents-user-skill-v1",
            "requestId": "req-1",
            "path": "/tmp/foreign"
        });
        assert!(serde_json::from_value::<HostIntegrationRequest>(request).is_err());
        assert!(target(BuiltInClientId::Pi, "claude-code-user-skill-v1").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_parent_and_reveal() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let app_data = root.path().join("app-data");
        let outside = root.path().join("outside");
        fs::create_dir(&home).unwrap();
        fs::create_dir(&app_data).unwrap();
        fs::create_dir(&outside).unwrap();
        symlink(&outside, home.join(".claude")).unwrap();
        let preview = preview_install_at(
            &app_data,
            &home,
            request(BuiltInClientId::ClaudeCode, "claude-code-user-skill-v1"),
        )
        .unwrap();
        let error = commit_install_at(
            &app_data,
            &home,
            HostIntegrationCommitRequest {
                tool_id: BuiltInClientId::ClaudeCode,
                target_id: "claude-code-user-skill-v1".into(),
                request_id: "req-1".into(),
                preview_ref: preview.preview_ref,
                confirmation: true,
            },
        )
        .unwrap_err();
        assert!(error.contains("HOST_TARGET_UNSAFE"));
        assert!(reveal_at(
            &home,
            request(BuiltInClientId::ClaudeCode, "claude-code-user-skill-v1")
        )
        .is_err());
    }

    #[test]
    fn reveals_only_an_existing_fixed_directory() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        fs::create_dir_all(home.join(".codex")).unwrap();
        let result = reveal_at(
            &home,
            request(BuiltInClientId::Codex, "agents-user-skill-v1"),
        )
        .unwrap();
        assert!(result.revealed);
        assert_eq!(result.status, HostIntegrationStatus::NotChecked);
        assert!(reveal_at(&home, request(BuiltInClientId::Pi, "pi-user-skill-v1")).is_err());
    }

    #[test]
    fn shared_fixtures_round_trip() {
        let fixtures = [
            include_str!("../../../../packages/contracts/fixtures/host-integration.valid.json"),
            include_str!(
                "../../../../packages/contracts/fixtures/host-integration-install.valid.json"
            ),
            include_str!(
                "../../../../packages/contracts/fixtures/host-integration-uninstall.valid.json"
            ),
            include_str!(
                "../../../../packages/contracts/fixtures/host-integration-reveal.valid.json"
            ),
        ];
        assert!(fixtures
            .iter()
            .all(|fixture| serde_json::from_str::<serde_json::Value>(fixture).is_ok()));
        let list: Vec<HostIntegrationDto> = serde_json::from_str(fixtures[0]).unwrap();
        let install: HostIntegrationPreviewDto = serde_json::from_str(fixtures[1]).unwrap();
        let uninstall: HostIntegrationResultDto = serde_json::from_str(fixtures[2]).unwrap();
        let reveal: RevealHostDirectoryResultDto = serde_json::from_str(fixtures[3]).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(install.action, "install");
        assert!(uninstall.changed);
        assert!(reveal.revealed);
    }
}
