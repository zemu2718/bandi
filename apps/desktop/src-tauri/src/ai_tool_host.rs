use std::path::{Path, PathBuf};

#[cfg(not(test))]
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::{
    ai_adapters::BuiltInClientId,
    ai_tool_versions::{self, InstallSource, VersionState},
};

#[derive(Clone, Copy)]
struct ToolHostTarget {
    tool_id: BuiltInClientId,
    install_url: &'static str,
    config_relative_path: &'static str,
    mac_candidates: &'static [Candidate],
}

#[derive(Clone, Copy)]
enum Candidate {
    HomeFile(&'static str),
    AbsoluteFile(&'static str),
    HomeDirectory(&'static str),
    AbsoluteDirectory(&'static str),
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AiToolAvailability {
    Installed,
    NotFound,
    UnsupportedPlatform,
    DetectionFailed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ContextMode {
    InitialPrompt,
    ManualContext,
    Unavailable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiToolHostStatusDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) availability: AiToolAvailability,
    pub(crate) context_mode: ContextMode,
    pub(crate) config_location_label: &'static str,
    pub(crate) can_reveal_config: bool,
    pub(crate) can_open_official_install_page: bool,
    pub(crate) reason_code: &'static str,
    pub(crate) current_version: Option<String>,
    pub(crate) latest_version: Option<String>,
    pub(crate) install_source: InstallSource,
    pub(crate) version_state: VersionState,
    pub(crate) can_upgrade: bool,
    pub(crate) version_reason_code: &'static str,
    pub(crate) installation_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AiToolHostRequest {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) request_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiToolHostActionResultDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) request_id: String,
    pub(crate) outcome: &'static str,
}

const TARGETS: [ToolHostTarget; 9] = [
    ToolHostTarget {
        tool_id: BuiltInClientId::ClaudeCode,
        install_url: "https://docs.anthropic.com/en/docs/claude-code/overview",
        config_relative_path: ".claude",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/claude"),
            Candidate::HomeFile(".claude/local/claude"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/claude"),
            Candidate::AbsoluteFile("/usr/local/bin/claude"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::ClaudeDesktop,
        install_url: "https://claude.ai/download",
        config_relative_path: "Library/Application Support/Claude",
        mac_candidates: &[
            Candidate::AbsoluteDirectory("/Applications/Claude.app"),
            Candidate::HomeDirectory("Applications/Claude.app"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::Codex,
        install_url: "https://chatgpt.com/download",
        config_relative_path: ".codex",
        mac_candidates: &[
            Candidate::AbsoluteDirectory("/Applications/ChatGPT.app"),
            Candidate::HomeDirectory("Applications/ChatGPT.app"),
            Candidate::HomeFile(".local/bin/codex"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/codex"),
            Candidate::AbsoluteFile("/usr/local/bin/codex"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::GeminiCli,
        install_url: "https://github.com/google-gemini/gemini-cli",
        config_relative_path: ".gemini",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/gemini"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/gemini"),
            Candidate::AbsoluteFile("/usr/local/bin/gemini"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::GrokBuild,
        install_url: "https://grok.com/code",
        config_relative_path: ".grok",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/grok"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/grok"),
            Candidate::AbsoluteFile("/usr/local/bin/grok"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::Opencode,
        install_url: "https://opencode.ai/docs/",
        config_relative_path: ".config/opencode",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/opencode"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/opencode"),
            Candidate::AbsoluteFile("/usr/local/bin/opencode"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::Openclaw,
        install_url: "https://docs.openclaw.ai/",
        config_relative_path: ".openclaw",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/openclaw"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/openclaw"),
            Candidate::AbsoluteFile("/usr/local/bin/openclaw"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::Hermes,
        install_url: "https://hermes-agent.nousresearch.com/",
        config_relative_path: ".hermes",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/hermes"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/hermes"),
            Candidate::AbsoluteFile("/usr/local/bin/hermes"),
        ],
    },
    ToolHostTarget {
        tool_id: BuiltInClientId::Pi,
        install_url: "https://github.com/badlogic/pi-mono",
        config_relative_path: ".pi/agent",
        mac_candidates: &[
            Candidate::HomeFile(".local/bin/pi"),
            Candidate::AbsoluteFile("/opt/homebrew/bin/pi"),
            Candidate::AbsoluteFile("/usr/local/bin/pi"),
        ],
    },
];

pub(crate) fn validate_request_id(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    valid
        .then_some(())
        .ok_or_else(|| "AI_TOOL_HOST_INVALID_REQUEST: requestId 无效".into())
}

fn target(tool_id: BuiltInClientId) -> &'static ToolHostTarget {
    TARGETS
        .iter()
        .find(|target| target.tool_id == tool_id)
        .expect("固定九工具 catalog 必须完整")
}

fn config_path(home: &Path, target: &ToolHostTarget) -> PathBuf {
    target
        .config_relative_path
        .split('/')
        .fold(home.to_path_buf(), |path, part| path.join(part))
}

fn candidate_path(home: &Path, candidate: Candidate) -> PathBuf {
    match candidate {
        Candidate::HomeFile(relative) | Candidate::HomeDirectory(relative) => relative
            .split('/')
            .filter(|part| !part.is_empty())
            .fold(home.to_path_buf(), |path, part| path.join(part)),
        Candidate::AbsoluteFile(path) | Candidate::AbsoluteDirectory(path) => PathBuf::from(path),
    }
}

fn detect_candidate(path: &Path, candidate: Candidate) -> Result<bool, ()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Ok(false),
        Ok(metadata) => Ok(match candidate {
            Candidate::HomeFile(_) | Candidate::AbsoluteFile(_) => metadata.is_file(),
            Candidate::HomeDirectory(_) | Candidate::AbsoluteDirectory(_) => metadata.is_dir(),
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(()),
    }
}

fn existing_directory_without_following(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => !metadata.file_type().is_symlink() && metadata.is_dir(),
        Err(_) => false,
    }
}

pub(crate) fn list_at(home: &Path) -> Vec<AiToolHostStatusDto> {
    TARGETS
        .iter()
        .map(|target| {
            let versions = if cfg!(target_os = "macos") {
                ai_tool_versions::inspect(target.tool_id, home)
            } else {
                ai_tool_versions::unsupported()
            };
            let availability = if cfg!(target_os = "macos") {
                let detected = target
                    .mac_candidates
                    .iter()
                    .map(|candidate| {
                        detect_candidate(&candidate_path(home, *candidate), *candidate)
                    })
                    .collect::<Result<Vec<_>, _>>();
                match detected {
                    Ok(values)
                        if values.iter().any(|exists| *exists)
                            || versions.installation_count > 0 =>
                    {
                        AiToolAvailability::Installed
                    }
                    Ok(_) if versions.detection_failed => AiToolAvailability::DetectionFailed,
                    Ok(_) => AiToolAvailability::NotFound,
                    Err(()) => AiToolAvailability::DetectionFailed,
                }
            } else {
                AiToolAvailability::UnsupportedPlatform
            };
            let context_mode = match target.tool_id {
                BuiltInClientId::ClaudeDesktop
                | BuiltInClientId::GrokBuild
                | BuiltInClientId::Opencode
                | BuiltInClientId::Openclaw => ContextMode::ManualContext,
                _ if availability == AiToolAvailability::UnsupportedPlatform => {
                    ContextMode::Unavailable
                }
                _ => ContextMode::InitialPrompt,
            };
            AiToolHostStatusDto {
                tool_id: target.tool_id,
                availability,
                context_mode,
                config_location_label: target.config_relative_path,
                can_reveal_config: cfg!(target_os = "macos")
                    && existing_directory_without_following(&config_path(home, target)),
                can_open_official_install_page: cfg!(target_os = "macos"),
                reason_code: match availability {
                    AiToolAvailability::Installed => "installed",
                    AiToolAvailability::NotFound => "not_found",
                    AiToolAvailability::UnsupportedPlatform => "unsupported_platform",
                    AiToolAvailability::DetectionFailed => "detection_failed",
                },
                current_version: versions.current_version,
                latest_version: versions.latest_version,
                install_source: versions.install_source,
                version_state: versions.version_state,
                can_upgrade: versions.can_upgrade,
                version_reason_code: versions.version_reason_code,
                installation_count: versions.installation_count,
            }
        })
        .collect()
}

#[cfg(not(test))]
fn run_open(args: &[&str]) -> Result<(), String> {
    Command::new("/usr/bin/open")
        .args(args)
        .status()
        .map_err(|_| "AI_TOOL_HOST_OPEN_FAILED: 无法提交系统打开请求".to_string())?
        .success()
        .then_some(())
        .ok_or_else(|| "AI_TOOL_HOST_OPEN_FAILED: 系统拒绝打开请求".into())
}

#[cfg(test)]
fn run_open(_args: &[&str]) -> Result<(), String> {
    Ok(())
}

pub(crate) fn open_install_page(
    request: AiToolHostRequest,
) -> Result<AiToolHostActionResultDto, String> {
    validate_request_id(&request.request_id)?;
    if !cfg!(target_os = "macos") {
        return Err("AI_TOOL_HOST_UNSUPPORTED_PLATFORM: 当前平台暂不支持".into());
    }
    let item = target(request.tool_id);
    run_open(&[item.install_url])?;
    Ok(AiToolHostActionResultDto {
        tool_id: request.tool_id,
        request_id: request.request_id,
        outcome: "open_requested",
    })
}

pub(crate) fn reveal_config(
    home: &Path,
    request: AiToolHostRequest,
) -> Result<AiToolHostActionResultDto, String> {
    validate_request_id(&request.request_id)?;
    if !cfg!(target_os = "macos") {
        return Err("AI_TOOL_HOST_UNSUPPORTED_PLATFORM: 当前平台暂不支持".into());
    }
    let item = target(request.tool_id);
    let path = config_path(home, item);
    if !existing_directory_without_following(&path) {
        return Err("AI_TOOL_CONFIG_NOT_FOUND: 固定配置位置尚不存在".into());
    }
    let value = path
        .to_str()
        .ok_or_else(|| "AI_TOOL_CONFIG_UNAVAILABLE: 固定配置位置不可用".to_string())?;
    run_open(&[value])?;
    Ok(AiToolHostActionResultDto {
        tool_id: request.tool_id,
        request_id: request.request_id,
        outcome: "revealed",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_nine_unique_tools_and_never_returns_absolute_locations() {
        let home = tempfile::tempdir().unwrap();
        let statuses = list_at(home.path());
        assert_eq!(statuses.len(), 9);
        assert!(statuses
            .iter()
            .all(|item| !item.config_location_label.starts_with('/')));
        let mut ids = statuses.iter().map(|item| item.tool_id).collect::<Vec<_>>();
        ids.dedup();
        assert_eq!(ids.len(), 9);
    }

    #[test]
    fn detection_requires_expected_candidate_type() {
        let home = tempfile::tempdir().unwrap();
        let cli_path = home.path().join("cli");
        std::fs::create_dir(&cli_path).unwrap();
        assert!(!detect_candidate(&cli_path, Candidate::HomeFile("cli")).unwrap());
        assert!(detect_candidate(&cli_path, Candidate::HomeDirectory("cli")).unwrap());

        let app_path = home.path().join("Tool.app");
        std::fs::write(&app_path, b"not an app bundle").unwrap();
        assert!(!detect_candidate(&app_path, Candidate::HomeDirectory("Tool.app")).unwrap());
    }

    #[test]
    fn reveal_uses_only_existing_catalog_location() {
        let home = tempfile::tempdir().unwrap();
        let request = AiToolHostRequest {
            tool_id: BuiltInClientId::Codex,
            request_id: "req-1".into(),
        };
        assert!(reveal_config(home.path(), request)
            .unwrap_err()
            .contains("NOT_FOUND"));
        std::fs::create_dir(home.path().join(".codex")).unwrap();
        let result = reveal_config(
            home.path(),
            AiToolHostRequest {
                tool_id: BuiltInClientId::Codex,
                request_id: "req-2".into(),
            },
        )
        .unwrap();
        assert_eq!(result.outcome, "revealed");
    }

    #[test]
    fn request_rejects_extra_fields_and_invalid_request_id() {
        assert!(serde_json::from_value::<AiToolHostRequest>(
            serde_json::json!({"toolId":"codex","requestId":"req-1","path":"/tmp"})
        )
        .is_err());
        assert!(open_install_page(AiToolHostRequest {
            tool_id: BuiltInClientId::Codex,
            request_id: "../bad".into()
        })
        .is_err());
    }
}
