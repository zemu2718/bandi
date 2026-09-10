use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, MutexGuard, OnceLock},
    thread,
    time::{Duration as StdDuration, Instant},
};

use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::{ai_adapters::BuiltInClientId, local_service};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InstallSource {
    Npm,
    Homebrew,
    Native,
    AppBundle,
    Unknown,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VersionState {
    NotApplicable,
    Unknown,
    UpToDate,
    UpdateAvailable,
    AheadOrPrerelease,
    ConflictingInstalls,
}

#[derive(Debug, Clone)]
pub(crate) struct VersionFacts {
    pub(crate) current_version: Option<String>,
    pub(crate) latest_version: Option<String>,
    pub(crate) install_source: InstallSource,
    pub(crate) version_state: VersionState,
    pub(crate) can_upgrade: bool,
    pub(crate) version_reason_code: &'static str,
    pub(crate) installation_count: usize,
    pub(crate) detection_failed: bool,
}

#[cfg_attr(test, allow(dead_code))]
#[derive(Clone, Copy)]
struct VersionTarget {
    tool_id: BuiltInClientId,
    executable: Option<&'static str>,
    app_bundle: Option<&'static str>,
    npm_package: Option<&'static str>,
    brew_package: Option<&'static str>,
    github_repo: Option<&'static str>,
    native_upgrade_args: Option<&'static [&'static str]>,
}

const TARGETS: [VersionTarget; 9] = [
    VersionTarget {
        tool_id: BuiltInClientId::ClaudeCode,
        executable: Some("claude"),
        app_bundle: None,
        npm_package: Some("@anthropic-ai/claude-code"),
        brew_package: Some("claude-code"),
        github_repo: Some("anthropics/claude-code"),
        native_upgrade_args: Some(&["update"]),
    },
    VersionTarget {
        tool_id: BuiltInClientId::ClaudeDesktop,
        executable: None,
        app_bundle: Some("Claude.app"),
        npm_package: None,
        brew_package: None,
        github_repo: None,
        native_upgrade_args: None,
    },
    VersionTarget {
        tool_id: BuiltInClientId::Codex,
        executable: Some("codex"),
        app_bundle: None,
        npm_package: Some("@openai/codex"),
        brew_package: Some("codex"),
        github_repo: Some("openai/codex"),
        native_upgrade_args: None,
    },
    VersionTarget {
        tool_id: BuiltInClientId::GeminiCli,
        executable: Some("gemini"),
        app_bundle: None,
        npm_package: Some("@google/gemini-cli"),
        brew_package: Some("gemini-cli"),
        github_repo: Some("google-gemini/gemini-cli"),
        native_upgrade_args: None,
    },
    VersionTarget {
        tool_id: BuiltInClientId::GrokBuild,
        executable: Some("grok"),
        app_bundle: None,
        npm_package: None,
        brew_package: None,
        github_repo: None,
        native_upgrade_args: None,
    },
    VersionTarget {
        tool_id: BuiltInClientId::Opencode,
        executable: Some("opencode"),
        app_bundle: None,
        npm_package: Some("opencode-ai"),
        brew_package: Some("opencode"),
        github_repo: Some("anomalyco/opencode"),
        native_upgrade_args: Some(&["upgrade"]),
    },
    VersionTarget {
        tool_id: BuiltInClientId::Openclaw,
        executable: Some("openclaw"),
        app_bundle: None,
        npm_package: Some("openclaw"),
        brew_package: Some("openclaw"),
        github_repo: Some("openclaw/openclaw"),
        native_upgrade_args: Some(&["update"]),
    },
    VersionTarget {
        tool_id: BuiltInClientId::Hermes,
        executable: Some("hermes"),
        app_bundle: None,
        npm_package: None,
        brew_package: None,
        github_repo: Some("NousResearch/hermes-agent"),
        native_upgrade_args: None,
    },
    VersionTarget {
        tool_id: BuiltInClientId::Pi,
        executable: Some("pi"),
        app_bundle: None,
        npm_package: Some("@mariozechner/pi-coding-agent"),
        brew_package: None,
        github_repo: Some("badlogic/pi-mono"),
        native_upgrade_args: None,
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct Installation {
    path: PathBuf,
    canonical_path: PathBuf,
    source: InstallSource,
    version: Option<String>,
}

#[derive(Debug, Clone)]
struct PreviewRecord {
    request_id: String,
    tool_id: BuiltInClientId,
    preview_ref: String,
    installation: Installation,
    latest_version: String,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpgradeRequest {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitUpgradeRequest {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) confirmation: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpgradePreviewDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) current_version: String,
    pub(crate) latest_version: String,
    pub(crate) install_source: InstallSource,
    pub(crate) confirmation_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpgradeResultDto {
    pub(crate) tool_id: BuiltInClientId,
    pub(crate) request_id: String,
    pub(crate) outcome: &'static str,
    pub(crate) previous_version: Option<String>,
    pub(crate) current_version: Option<String>,
}

fn target(tool_id: BuiltInClientId) -> &'static VersionTarget {
    TARGETS
        .iter()
        .find(|item| item.tool_id == tool_id)
        .expect("固定九工具版本 catalog 必须完整")
}

fn manager_dirs(home: &Path) -> Vec<PathBuf> {
    [
        ".local/bin",
        ".volta/bin",
        ".fnm/current/bin",
        ".nvm/current/bin",
        ".bun/bin",
        ".opencode/bin",
        "Library/pnpm",
    ]
    .into_iter()
    .map(|relative| home.join(relative))
    .chain([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
    ])
    .collect()
}

fn restricted_path_dirs(home: &Path, path: Option<OsString>) -> Vec<PathBuf> {
    let allowed = manager_dirs(home);
    let mut result = path
        .as_deref()
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .filter(|item| allowed.contains(item))
        .collect::<Vec<_>>();
    result.extend(allowed);
    result.extend(version_manager_bins(home, ".nvm/versions/node", "bin"));
    result.extend(version_manager_bins(
        home,
        ".local/share/fnm/node-versions",
        "installation/bin",
    ));
    result.sort();
    result.dedup();
    result
}

fn version_manager_bins(home: &Path, relative_root: &str, bin_path: &str) -> Vec<PathBuf> {
    let Ok(versions) = fs::read_dir(home.join(relative_root)) else {
        return Vec::new();
    };
    versions
        .flatten()
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_dir())
                .map(|_| entry.path().join(bin_path))
        })
        .filter(|path| path.is_dir())
        .collect()
}

fn source_for(path: &Path, canonical: &Path) -> InstallSource {
    let value = format!("{}:{}", path.display(), canonical.display());
    if value.contains("/Cellar/") || value.contains("/Caskroom/") {
        InstallSource::Homebrew
    } else if value.contains("node_modules")
        || value.contains("/.nvm/")
        || value.contains("/.volta/")
        || value.contains("/.fnm/")
        || value.contains("/Library/pnpm/")
    {
        InstallSource::Npm
    } else {
        InstallSource::Native
    }
}

fn executable_installations(
    home: &Path,
    path: Option<OsString>,
    executable: &str,
    run_version: &mut impl FnMut(&Path) -> Result<String, String>,
) -> (Vec<Installation>, bool) {
    let mut failed = false;
    let mut seen = HashSet::new();
    let mut installations = Vec::new();
    for candidate in restricted_path_dirs(home, path)
        .into_iter()
        .map(|dir| dir.join(executable))
    {
        match fs::canonicalize(&candidate) {
            Ok(canonical) if canonical.is_file() && seen.insert(canonical.clone()) => {
                let version = run_version(&canonical)
                    .ok()
                    .and_then(|value| extract_version(&value));
                installations.push(Installation {
                    source: source_for(&candidate, &canonical),
                    path: candidate,
                    canonical_path: canonical,
                    version,
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => failed = true,
        }
    }
    (installations, failed)
}

fn app_installations(home: &Path, app_name: &str) -> (Vec<Installation>, bool) {
    let mut failed = false;
    let mut result = Vec::new();
    for path in [
        PathBuf::from("/Applications").join(app_name),
        home.join("Applications").join(app_name),
    ] {
        match fs::canonicalize(&path) {
            Ok(canonical) if canonical.is_dir() => {
                let plist = canonical.join("Contents/Info.plist");
                let version = Command::new("/usr/bin/defaults")
                    .arg("read")
                    .arg(plist)
                    .arg("CFBundleShortVersionString")
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
                    .and_then(|output| String::from_utf8(output.stdout).ok())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty());
                result.push(Installation {
                    path,
                    canonical_path: canonical,
                    source: InstallSource::AppBundle,
                    version,
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => failed = true,
        }
    }
    (result, failed)
}

fn run_version(path: &Path) -> Result<String, String> {
    let output = Command::new(path)
        .arg("--version")
        .output()
        .map_err(|_| "VERSION_COMMAND_FAILED".to_string())?;
    if !output.status.success() || output.stdout.len() + output.stderr.len() > 4096 {
        return Err("VERSION_COMMAND_FAILED".into());
    }
    String::from_utf8(if output.stdout.is_empty() {
        output.stderr
    } else {
        output.stdout
    })
    .map_err(|_| "VERSION_OUTPUT_INVALID".into())
}

#[cfg_attr(test, allow(dead_code))]
fn latest_version(item: &VersionTarget, source: InstallSource) -> Option<String> {
    let url = match source {
        InstallSource::Npm => format!("https://registry.npmjs.org/{}/latest", item.npm_package?),
        InstallSource::Homebrew => format!(
            "https://formulae.brew.sh/api/formula/{}.json",
            item.brew_package?
        ),
        InstallSource::Native => format!(
            "https://api.github.com/repos/{}/releases/latest",
            item.github_repo?
        ),
        _ => return None,
    };
    let output = Command::new("/usr/bin/curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--max-time",
            "4",
            "--max-filesize",
            "65536",
            "--header",
            "Accept: application/json",
            &url,
        ])
        .output()
        .ok()?;
    if !output.status.success() || output.stdout.len() > 65_536 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;
    let raw = match source {
        InstallSource::Npm => value.get("version")?.as_str()?,
        InstallSource::Homebrew => value.pointer("/versions/stable")?.as_str()?,
        InstallSource::Native => value.get("tag_name")?.as_str()?,
        _ => return None,
    };
    extract_version(raw)
}

fn supports_upgrade(item: &VersionTarget, source: InstallSource) -> bool {
    match source {
        InstallSource::Npm => item.npm_package.is_some(),
        InstallSource::Homebrew => item.brew_package.is_some(),
        InstallSource::Native => item.native_upgrade_args.is_some(),
        _ => false,
    }
}

fn facts_from(
    item: &VersionTarget,
    installations: &[Installation],
    detection_failed: bool,
    latest: Option<String>,
) -> VersionFacts {
    if installations.is_empty() {
        return VersionFacts {
            current_version: None,
            latest_version: None,
            install_source: if item.executable.is_none() {
                InstallSource::NotApplicable
            } else {
                InstallSource::Unknown
            },
            version_state: if item.executable.is_none() {
                VersionState::NotApplicable
            } else {
                VersionState::Unknown
            },
            can_upgrade: false,
            version_reason_code: if detection_failed {
                "installation_detection_failed"
            } else {
                "version_not_available"
            },
            installation_count: 0,
            detection_failed,
        };
    }
    if installations.len() > 1 {
        return VersionFacts {
            current_version: None,
            latest_version: latest,
            install_source: InstallSource::Unknown,
            version_state: VersionState::ConflictingInstalls,
            can_upgrade: false,
            version_reason_code: "conflicting_installs",
            installation_count: installations.len(),
            detection_failed,
        };
    }
    let installation = &installations[0];
    let state = match (&installation.version, &latest) {
        (Some(current), Some(latest)) => match compare_versions(current, latest) {
            Some(std::cmp::Ordering::Less) => VersionState::UpdateAvailable,
            Some(std::cmp::Ordering::Equal) => VersionState::UpToDate,
            Some(std::cmp::Ordering::Greater) => VersionState::AheadOrPrerelease,
            None => VersionState::Unknown,
        },
        _ => VersionState::Unknown,
    };
    let can_upgrade =
        state == VersionState::UpdateAvailable && supports_upgrade(item, installation.source);
    VersionFacts {
        current_version: installation.version.clone(),
        latest_version: latest,
        install_source: installation.source,
        version_state: state,
        can_upgrade,
        version_reason_code: match state {
            VersionState::UpdateAvailable if can_upgrade => "update_available",
            VersionState::UpdateAvailable => "upgrade_source_unsupported",
            VersionState::UpToDate => "up_to_date",
            VersionState::AheadOrPrerelease => "ahead_or_prerelease",
            _ => "version_unknown",
        },
        installation_count: 1,
        detection_failed,
    }
}

pub(crate) fn unsupported() -> VersionFacts {
    VersionFacts {
        current_version: None,
        latest_version: None,
        install_source: InstallSource::NotApplicable,
        version_state: VersionState::NotApplicable,
        can_upgrade: false,
        version_reason_code: "unsupported_platform",
        installation_count: 0,
        detection_failed: false,
    }
}

#[cfg(not(test))]
pub(crate) fn inspect(tool_id: BuiltInClientId, home: &Path) -> VersionFacts {
    inspect_with(
        tool_id,
        home,
        std::env::var_os("PATH"),
        &mut run_version,
        &mut |item, source| latest_version(item, source),
    )
}

#[cfg(test)]
pub(crate) fn inspect(tool_id: BuiltInClientId, home: &Path) -> VersionFacts {
    inspect_with(
        tool_id,
        home,
        None,
        &mut |_| Err("VERSION_COMMAND_DISABLED_IN_TEST".into()),
        &mut |_, _| None,
    )
}

fn inspect_with(
    tool_id: BuiltInClientId,
    home: &Path,
    path: Option<OsString>,
    run: &mut impl FnMut(&Path) -> Result<String, String>,
    latest: &mut impl FnMut(&VersionTarget, InstallSource) -> Option<String>,
) -> VersionFacts {
    let item = target(tool_id);
    let (installations, failed) = if let Some(executable) = item.executable {
        executable_installations(home, path, executable, run)
    } else if let Some(app) = item.app_bundle {
        app_installations(home, app)
    } else {
        (Vec::new(), false)
    };
    let remote = installations
        .first()
        .and_then(|installation| latest(item, installation.source));
    facts_from(item, &installations, failed, remote)
}

fn extract_version(value: &str) -> Option<String> {
    value.split_whitespace().find_map(|token| {
        let clean = token
            .trim_matches(|character: char| {
                !character.is_ascii_alphanumeric()
                    && character != '.'
                    && character != '-'
                    && character != '+'
            })
            .trim_start_matches('v');
        (clean.chars().next()?.is_ascii_digit() && clean.contains('.')).then(|| clean.to_string())
    })
}

fn compare_versions(left: &str, right: &str) -> Option<std::cmp::Ordering> {
    fn parts(value: &str) -> Option<(Vec<u64>, bool)> {
        let core = value.trim_start_matches('v').split('+').next()?.to_string();
        let prerelease = core.contains('-');
        let numbers = core
            .split('-')
            .next()?
            .split('.')
            .map(str::parse)
            .collect::<Result<Vec<u64>, _>>()
            .ok()?;
        (!numbers.is_empty()).then_some((numbers, prerelease))
    }
    let (mut left, left_pre) = parts(left)?;
    let (mut right, right_pre) = parts(right)?;
    let width = left.len().max(right.len());
    left.resize(width, 0);
    right.resize(width, 0);
    Some(left.cmp(&right).then_with(|| right_pre.cmp(&left_pre)))
}

fn previews() -> &'static Mutex<HashMap<String, PreviewRecord>> {
    static PREVIEWS: OnceLock<Mutex<HashMap<String, PreviewRecord>>> = OnceLock::new();
    PREVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn upgrade_lock() -> Result<MutexGuard<'static, ()>, String> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| "AI_TOOL_UPGRADE_BUSY: 另一项工具升级正在进行".into())
}

pub(crate) fn preview(
    tool_id: BuiltInClientId,
    request_id: String,
    home: &Path,
) -> Result<UpgradePreviewDto, String> {
    crate::ai_tool_host::validate_request_id(&request_id)?;
    if !cfg!(target_os = "macos") {
        return Err("AI_TOOL_HOST_UNSUPPORTED_PLATFORM: 当前平台暂不支持".into());
    }
    let facts = inspect(tool_id, home);
    if !facts.can_upgrade {
        return Err("AI_TOOL_UPGRADE_UNAVAILABLE: 当前安装无法安全升级".into());
    }
    let item = target(tool_id);
    let (installations, _) = executable_installations(
        home,
        std::env::var_os("PATH"),
        item.executable
            .ok_or_else(|| "AI_TOOL_UPGRADE_UNAVAILABLE: 当前工具不支持升级".to_string())?,
        &mut run_version,
    );
    let installation = installations
        .into_iter()
        .next()
        .ok_or_else(|| "AI_TOOL_UPGRADE_TARGET_CHANGED: 安装目标已变化".to_string())?;
    let current = installation
        .version
        .clone()
        .ok_or_else(|| "AI_TOOL_UPGRADE_VERSION_UNKNOWN: 无法确认当前版本".to_string())?;
    let latest = facts
        .latest_version
        .ok_or_else(|| "AI_TOOL_UPGRADE_VERSION_UNKNOWN: 无法确认最新版本".to_string())?;
    let seed = format!(
        "{request_id}:{tool_id:?}:{}:{current}:{latest}:{}",
        installation.canonical_path.display(),
        Utc::now().timestamp_nanos_opt().unwrap_or_default()
    );
    let preview_ref = local_service::stable_id("ai-tool-upgrade", &seed);
    let confirmation_text = format!("确认将工具从 {current} 升级到 {latest}");
    previews()
        .lock()
        .map_err(|_| "AI_TOOL_UPGRADE_BUSY: 升级预览存储不可用".to_string())?
        .insert(
            preview_ref.clone(),
            PreviewRecord {
                request_id: request_id.clone(),
                tool_id,
                preview_ref: preview_ref.clone(),
                installation: installation.clone(),
                latest_version: latest.clone(),
                expires_at: Utc::now() + Duration::minutes(15),
            },
        );
    Ok(UpgradePreviewDto {
        tool_id,
        request_id,
        preview_ref,
        current_version: current,
        latest_version: latest,
        install_source: installation.source,
        confirmation_text,
    })
}

fn run_upgrade(item: &VersionTarget, installation: &Installation) -> Result<(), &'static str> {
    let (program, args): (PathBuf, Vec<String>) = match installation.source {
        InstallSource::Npm => {
            let npm = installation
                .path
                .parent()
                .ok_or("unsupported_installation")?
                .join("npm");
            let npm = fs::canonicalize(npm).map_err(|_| "unsupported_installation")?;
            (
                npm,
                vec![
                    "install".into(),
                    "-g".into(),
                    format!(
                        "{}@latest",
                        item.npm_package.ok_or("unsupported_installation")?
                    ),
                ],
            )
        }
        InstallSource::Homebrew => {
            let brew = if installation.path.starts_with("/opt/homebrew") {
                "/opt/homebrew/bin/brew"
            } else {
                "/usr/local/bin/brew"
            };
            (
                fs::canonicalize(brew).map_err(|_| "unsupported_installation")?,
                vec![
                    "upgrade".into(),
                    item.brew_package.ok_or("unsupported_installation")?.into(),
                ],
            )
        }
        InstallSource::Native => (
            installation.canonical_path.clone(),
            item.native_upgrade_args
                .ok_or("unsupported_installation")?
                .iter()
                .map(|value| (*value).into())
                .collect(),
        ),
        _ => return Err("unsupported_installation"),
    };
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "process_failed")?;
    let deadline = Instant::now() + StdDuration::from_secs(300);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success().then_some(()).ok_or("process_failed"),
            Ok(None) if Instant::now() < deadline => thread::sleep(StdDuration::from_millis(100)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timed_out");
            }
            Err(_) => return Err("process_failed"),
        }
    }
}

pub(crate) fn commit(
    tool_id: BuiltInClientId,
    request_id: String,
    preview_ref: String,
    confirmation: bool,
    home: &Path,
) -> Result<UpgradeResultDto, String> {
    crate::ai_tool_host::validate_request_id(&request_id)?;
    crate::ai_tool_host::validate_request_id(&preview_ref)?;
    if !confirmation {
        return Err("AI_TOOL_UPGRADE_CONFIRMATION_REQUIRED: 必须明确确认单项升级".into());
    }
    let _guard = upgrade_lock()?;
    let record = previews()
        .lock()
        .map_err(|_| "AI_TOOL_UPGRADE_BUSY: 升级预览存储不可用".to_string())?
        .get(&preview_ref)
        .cloned()
        .ok_or_else(|| "AI_TOOL_UPGRADE_PREVIEW_INVALID: previewRef 无效".to_string())?;
    if record.tool_id != tool_id
        || record.request_id != request_id
        || record.preview_ref != preview_ref
        || record.expires_at < Utc::now()
    {
        return Err("AI_TOOL_UPGRADE_PREVIEW_MISMATCH: 预览已过期或与请求不匹配".into());
    }
    let item = target(tool_id);
    let (current, _) = executable_installations(
        home,
        std::env::var_os("PATH"),
        item.executable
            .ok_or_else(|| "AI_TOOL_UPGRADE_TARGET_CHANGED: 安装目标已变化".to_string())?,
        &mut run_version,
    );
    if current.len() != 1 || current[0] != record.installation {
        let detected_version = current.first().and_then(|value| value.version.clone());
        let already_current = current.len() == 1
            && current[0].canonical_path == record.installation.canonical_path
            && current[0].source == record.installation.source
            && detected_version.as_deref().is_some_and(|version| {
                compare_versions(version, &record.latest_version) != Some(std::cmp::Ordering::Less)
            });
        return Ok(UpgradeResultDto {
            tool_id,
            request_id,
            outcome: if already_current {
                "already_current"
            } else {
                "target_changed"
            },
            previous_version: record.installation.version,
            current_version: detected_version,
        });
    }
    if let Err(outcome) = run_upgrade(item, &record.installation) {
        return Ok(UpgradeResultDto {
            tool_id,
            request_id,
            outcome,
            previous_version: record.installation.version,
            current_version: None,
        });
    }
    let (verified, _) = executable_installations(
        home,
        std::env::var_os("PATH"),
        item.executable.unwrap_or_default(),
        &mut run_version,
    );
    let version = verified
        .into_iter()
        .find(|value| value.canonical_path == record.installation.canonical_path)
        .and_then(|value| value.version);
    let outcome = match version.as_deref() {
        None => "postcheck_failed",
        Some(version)
            if compare_versions(
                version,
                record.installation.version.as_deref().unwrap_or_default(),
            ) != Some(std::cmp::Ordering::Greater) =>
        {
            "version_unchanged"
        }
        Some(version)
            if compare_versions(version, &record.latest_version)
                == Some(std::cmp::Ordering::Less) =>
        {
            "postcheck_failed"
        }
        Some(_) => "updated",
    };
    previews()
        .lock()
        .map_err(|_| "AI_TOOL_UPGRADE_BUSY: 升级预览存储不可用".to_string())?
        .remove(&preview_ref);
    Ok(UpgradeResultDto {
        tool_id,
        request_id,
        outcome,
        previous_version: record.installation.version,
        current_version: version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn includes_only_fixed_native_and_version_manager_bins() {
        let home = tempfile::tempdir().unwrap();
        let nvm_bin = home.path().join(".nvm/versions/node/v20.19.3/bin");
        let fnm_bin = home
            .path()
            .join(".local/share/fnm/node-versions/v22.1.0/installation/bin");
        let opencode_bin = home.path().join(".opencode/bin");
        let unrelated_bin = home.path().join("custom/bin");
        for path in [&nvm_bin, &fnm_bin, &opencode_bin, &unrelated_bin] {
            fs::create_dir_all(path).unwrap();
        }

        let dirs = restricted_path_dirs(
            home.path(),
            Some(std::env::join_paths([&unrelated_bin]).unwrap()),
        );

        assert!(dirs.contains(&nvm_bin));
        assert!(dirs.contains(&fnm_bin));
        assert!(dirs.contains(&opencode_bin));
        assert!(!dirs.contains(&unrelated_bin));
    }

    #[test]
    fn discovers_gemini_under_nvm_and_opencode_native_bin() {
        let home = tempfile::tempdir().unwrap();
        let gemini = home.path().join(".nvm/versions/node/v20.19.3/bin/gemini");
        let opencode = home.path().join(".opencode/bin/opencode");
        fs::create_dir_all(gemini.parent().unwrap()).unwrap();
        fs::create_dir_all(opencode.parent().unwrap()).unwrap();
        fs::write(&gemini, "isolated gemini").unwrap();
        fs::write(&opencode, "isolated opencode").unwrap();

        let (gemini_installations, _) =
            executable_installations(home.path(), None, "gemini", &mut |_| Ok("0.24.4".into()));
        let (opencode_installations, _) =
            executable_installations(home.path(), None, "opencode", &mut |_| Ok("1.1.34".into()));

        assert_eq!(gemini_installations.len(), 1);
        assert_eq!(gemini_installations[0].version.as_deref(), Some("0.24.4"));
        assert_eq!(gemini_installations[0].source, InstallSource::Npm);
        assert_eq!(opencode_installations.len(), 1);
        assert_eq!(opencode_installations[0].version.as_deref(), Some("1.1.34"));
        assert_eq!(opencode_installations[0].source, InstallSource::Native);
    }

    #[test]
    fn detects_canonical_symlink_and_compares_versions() {
        let home = tempfile::tempdir().unwrap();
        let bin = home.path().join(".volta/bin");
        let package = home.path().join("lib/node_modules/tool/bin/tool.js");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(package.parent().unwrap()).unwrap();
        fs::write(&package, "isolated test program").unwrap();
        symlink(&package, bin.join("codex")).unwrap();
        let canonical = fs::canonicalize(&package).unwrap();
        let (installations, _) = executable_installations(
            home.path(),
            Some(bin.into_os_string()),
            "codex",
            &mut |_| Ok("codex 1.2.3".into()),
        );
        let isolated = installations
            .into_iter()
            .find(|item| item.canonical_path == canonical)
            .unwrap();
        assert_eq!(isolated.source, InstallSource::Npm);
        let facts = facts_from(
            target(BuiltInClientId::Codex),
            &[isolated],
            false,
            Some("1.3.0".into()),
        );
        assert_eq!(facts.version_state, VersionState::UpdateAvailable);
        assert!(facts.can_upgrade);
    }

    #[test]
    fn conflicting_installations_disable_upgrade() {
        let first = Installation {
            path: "/usr/local/bin/codex".into(),
            canonical_path: "/usr/local/lib/node_modules/codex".into(),
            source: InstallSource::Npm,
            version: Some("1.0.0".into()),
        };
        let second = Installation {
            path: "/opt/homebrew/bin/codex".into(),
            canonical_path: "/opt/homebrew/Cellar/codex/2/bin/codex".into(),
            source: InstallSource::Homebrew,
            version: Some("2.0.0".into()),
        };
        let facts = facts_from(
            target(BuiltInClientId::Codex),
            &[first, second],
            false,
            Some("2.0.0".into()),
        );
        assert_eq!(facts.version_state, VersionState::ConflictingInstalls);
        assert!(!facts.can_upgrade);
    }

    #[test]
    fn semantic_comparison_handles_prerelease_and_padding() {
        assert_eq!(
            compare_versions("1.2", "1.2.0"),
            Some(std::cmp::Ordering::Equal)
        );
        assert_eq!(
            compare_versions("1.2.0-beta.1", "1.2.0"),
            Some(std::cmp::Ordering::Less)
        );
        assert_eq!(
            compare_versions("2.0.0", "1.9.9"),
            Some(std::cmp::Ordering::Greater)
        );
    }
}
