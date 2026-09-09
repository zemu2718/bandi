use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(not(test))]
use std::sync::atomic::AtomicBool;

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CONFIRMATION_TEXT: &str = "重置 Bandi";
const PREVIEW_TTL: Duration = Duration::from_secs(5 * 60);
const MARKER_NAME: &str = ".factory-reset-committed.json";
const APP_TARGETS: &[(&str, &str, TargetKind)] = &[
    ("database", "bandi.db", TargetKind::File),
    ("databaseWal", "bandi.db-wal", TargetKind::File),
    ("databaseShm", "bandi.db-shm", TargetKind::File),
    ("sharedAssets", "shared-assets", TargetKind::Directory),
    ("backups", "backups", TargetKind::Directory),
    ("revisions", "revisions", TargetKind::Directory),
    ("formalMemory", "memory", TargetKind::Directory),
    ("uiAssets", "ui-assets", TargetKind::Directory),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum TargetKind {
    File,
    Directory,
}

#[derive(Clone)]
struct Target {
    id: &'static str,
    path: PathBuf,
    kind: TargetKind,
}

#[derive(Clone)]
struct PreviewRecord {
    request_id: String,
    expires_at: SystemTime,
    app_data_dir: PathBuf,
    managed_agents_root: PathBuf,
    fingerprints: Vec<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommittedMarker {
    suffix: String,
    target_ids: Vec<String>,
}

fn previews() -> &'static Mutex<HashMap<String, PreviewRecord>> {
    static PREVIEWS: OnceLock<Mutex<HashMap<String, PreviewRecord>>> = OnceLock::new();
    PREVIEWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn mutation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(not(test))]
static RESET_COMMITTED: AtomicBool = AtomicBool::new(false);

#[cfg(not(test))]
fn is_reset_committed() -> bool {
    RESET_COMMITTED.load(Ordering::Acquire)
}

#[cfg(not(test))]
fn set_reset_committed(value: bool) {
    RESET_COMMITTED.store(value, Ordering::Release);
}

#[cfg(test)]
thread_local! {
    static TEST_COMMITTED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn is_reset_committed() -> bool {
    TEST_COMMITTED.get()
}

#[cfg(test)]
fn set_reset_committed(value: bool) {
    TEST_COMMITTED.set(value);
}

pub(crate) fn database_open_guard() -> Result<(), String> {
    if is_reset_committed() {
        Err("FACTORY_RESET_RESTART_REQUIRED: 重置已提交，请重新打开 Bandi".into())
    } else {
        Ok(())
    }
}

/// 本地数据写 command 与 Factory Reset commit 共用，避免重置期间重新创建数据。
pub(crate) fn mutation_guard() -> Result<MutexGuard<'static, ()>, String> {
    let guard = mutation_lock()
        .try_lock()
        .map_err(|_| "FACTORY_RESET_BUSY: 另一项本地数据变更正在进行".to_string())?;
    database_open_guard()?;
    Ok(guard)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreviewFactoryResetRequest {
    pub(crate) request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitFactoryResetRequest {
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) confirmation_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryResetTargetDto {
    id: String,
    kind: String,
    state: String,
    fingerprint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryResetPreviewDto {
    request_id: String,
    preview_ref: String,
    expires_at: String,
    confirmation_text: &'static str,
    targets: Vec<FactoryResetTargetDto>,
    can_commit: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FactoryResetResultDto {
    request_id: String,
    preview_ref: String,
    reset_at: String,
    quarantined_target_ids: Vec<String>,
    absent_target_ids: Vec<String>,
    requires_restart: bool,
}

pub(crate) fn preview_at(
    app_data_dir: &Path,
    home_dir: &Path,
    request: PreviewFactoryResetRequest,
) -> Result<FactoryResetPreviewDto, String> {
    validate_id(&request.request_id)?;
    let managed_agents_root = home_dir.join(".bandi").join("agents");
    validate_roots(app_data_dir, &managed_agents_root)?;
    let targets = targets(app_data_dir, &managed_agents_root);
    let target_dtos = targets
        .iter()
        .map(inspect_target)
        .collect::<Result<Vec<_>, _>>()?;
    let fingerprints = target_dtos
        .iter()
        .map(|target| target.fingerprint.clone())
        .collect();
    let expires_at = SystemTime::now() + PREVIEW_TTL;
    let preview_ref = new_preview_ref(app_data_dir, &managed_agents_root, expires_at);
    let record = PreviewRecord {
        request_id: request.request_id.clone(),
        expires_at,
        app_data_dir: app_data_dir.into(),
        managed_agents_root,
        fingerprints,
    };
    let mut records = previews()
        .lock()
        .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 重置预览状态不可用".to_string())?;
    let now = SystemTime::now();
    records.retain(|_, record| record.expires_at > now);
    records.insert(preview_ref.clone(), record);
    Ok(FactoryResetPreviewDto {
        request_id: request.request_id,
        preview_ref,
        expires_at: system_time_rfc3339(expires_at)?,
        confirmation_text: CONFIRMATION_TEXT,
        targets: target_dtos,
        can_commit: true,
    })
}

pub(crate) fn commit_at(
    app_data_dir: &Path,
    home_dir: &Path,
    request: CommitFactoryResetRequest,
) -> Result<FactoryResetResultDto, String> {
    validate_id(&request.request_id)?;
    if request.confirmation_text != CONFIRMATION_TEXT {
        return Err("FACTORY_RESET_CONFIRMATION_REQUIRED: 确认文字不匹配".into());
    }
    let _guard = mutation_guard()?;
    let managed_agents_root = home_dir.join(".bandi").join("agents");
    let record = take_preview(&request.preview_ref)?;
    if record.request_id != request.request_id
        || record.expires_at <= SystemTime::now()
        || record.app_data_dir != app_data_dir
        || record.managed_agents_root != managed_agents_root
    {
        return Err("FACTORY_RESET_PREVIEW_INVALID: 重置预览已过期或不匹配".into());
    }
    validate_roots(app_data_dir, &managed_agents_root)?;
    let targets = targets(app_data_dir, &managed_agents_root);
    let current = targets
        .iter()
        .map(inspect_target)
        .collect::<Result<Vec<_>, _>>()?;
    if current
        .iter()
        .map(|target| &target.fingerprint)
        .ne(record.fingerprints.iter())
    {
        return Err("FACTORY_RESET_TARGET_CHANGED: 重置目标在预览后发生变化，请重新预览".into());
    }
    commit_targets(
        app_data_dir,
        &request.request_id,
        &request.preview_ref,
        &targets,
        |from, to| fs::rename(from, to),
    )
}

pub(crate) fn restart_guard_at(app_data_dir: &Path, home_dir: &Path) -> Result<(), String> {
    if !is_reset_committed() {
        return Err("FACTORY_RESET_RESTART_NOT_ALLOWED: 当前进程未提交重置".into());
    }
    let (marker, known) = read_committed_marker(
        app_data_dir,
        home_dir,
        "FACTORY_RESET_RESTART_MARKER_INVALID",
    )?
    .ok_or_else(|| "FACTORY_RESET_RESTART_MARKER_INVALID: 已提交标记不存在".to_string())?;
    for id in &marker.target_ids {
        let target = known
            .iter()
            .find(|target| target.id == id)
            .expect("已提交标记的目标已验证");
        inspect_quarantine(
            &quarantine_path(target, &marker.suffix)?,
            target.kind,
            "FACTORY_RESET_RESTART_MARKER_INVALID",
            false,
        )?;
    }
    Ok(())
}

pub(crate) fn cleanup_committed_at(app_data_dir: &Path, home_dir: &Path) -> Result<(), String> {
    let Some((marker, known)) =
        read_committed_marker(app_data_dir, home_dir, "FACTORY_RESET_CLEANUP_REJECTED")?
    else {
        return Ok(());
    };
    for id in &marker.target_ids {
        let target = known
            .iter()
            .find(|target| target.id == id)
            .expect("已提交标记的目标已验证");
        remove_quarantine(&quarantine_path(target, &marker.suffix)?, target.kind)?;
    }
    fs::remove_file(app_data_dir.join(MARKER_NAME))
        .map_err(|_| "FACTORY_RESET_CLEANUP_FAILED: 无法移除已提交标记".to_string())?;
    set_reset_committed(false);
    Ok(())
}

fn read_committed_marker(
    app_data_dir: &Path,
    home_dir: &Path,
    error_code: &str,
) -> Result<Option<(CommittedMarker, Vec<Target>)>, String> {
    let marker_path = app_data_dir.join(MARKER_NAME);
    let metadata = match fs::symlink_metadata(&marker_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(format!("{error_code}: 无法检查已提交标记")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{error_code}: 已提交标记必须是普通文件"));
    }
    let bytes = fs::read(&marker_path).map_err(|_| format!("{error_code}: 无法读取已提交标记"))?;
    let marker: CommittedMarker =
        serde_json::from_slice(&bytes).map_err(|_| format!("{error_code}: 已提交标记已损坏"))?;
    if !valid_suffix(&marker.suffix) {
        return Err(format!("{error_code}: 已提交标记引用无效"));
    }
    let managed = home_dir.join(".bandi").join("agents");
    let known = targets(app_data_dir, &managed);
    let mut unique = HashSet::new();
    for id in &marker.target_ids {
        let target = known
            .iter()
            .find(|target| target.id == id)
            .ok_or_else(|| format!("{error_code}: 已提交标记包含未知目标"))?;
        if !unique.insert(id) {
            return Err(format!("{error_code}: 已提交标记包含重复目标"));
        }
        inspect_quarantine(
            &quarantine_path(target, &marker.suffix)?,
            target.kind,
            error_code,
            true,
        )?;
    }
    Ok(Some((marker, known)))
}

fn take_preview(preview_ref: &str) -> Result<PreviewRecord, String> {
    if preview_ref.len() > 128 || !preview_ref.starts_with("factory-reset-") {
        return Err("FACTORY_RESET_PREVIEW_INVALID: 重置预览引用无效".into());
    }
    previews()
        .lock()
        .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 重置预览状态不可用".to_string())?
        .remove(preview_ref)
        .ok_or_else(|| "FACTORY_RESET_PREVIEW_INVALID: 重置预览不存在或已使用".to_string())
}

fn validate_id(value: &str) -> Result<(), String> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        Ok(())
    } else {
        Err("FACTORY_RESET_REQUEST_INVALID: requestId 无效".into())
    }
}

fn targets(app: &Path, managed: &Path) -> Vec<Target> {
    let mut result = APP_TARGETS
        .iter()
        .map(|(id, name, kind)| Target {
            id,
            path: app.join(name),
            kind: *kind,
        })
        .collect::<Vec<_>>();
    result.push(Target {
        id: "managedAgents",
        path: managed.into(),
        kind: TargetKind::Directory,
    });
    result
}

fn validate_roots(app: &Path, managed: &Path) -> Result<(), String> {
    ensure_plain_directory_if_present(app, "应用数据根目录")?;
    ensure_plain_directory_if_present(
        managed
            .parent()
            .ok_or_else(|| "FACTORY_RESET_PATH_REJECTED: 受管 Agent 根目录无效".to_string())?,
        "Bandi 用户目录",
    )
}

fn ensure_plain_directory_if_present(path: &Path, label: &str) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(format!(
            "FACTORY_RESET_PATH_REJECTED: {label}必须是普通目录"
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(format!("FACTORY_RESET_INSPECTION_FAILED: 无法检查{label}")),
    }
}

fn inspect_target(target: &Target) -> Result<FactoryResetTargetDto, String> {
    let metadata = match fs::symlink_metadata(&target.path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(FactoryResetTargetDto {
                id: target.id.into(),
                kind: kind_name(target.kind).into(),
                state: "absent".into(),
                fingerprint: "absent".into(),
            })
        }
        Err(_) => {
            return Err(format!(
                "FACTORY_RESET_INSPECTION_FAILED: 无法检查 {}",
                target.id
            ))
        }
        Ok(metadata) => metadata,
    };
    let valid = !metadata.file_type().is_symlink()
        && match target.kind {
            TargetKind::File => metadata.is_file(),
            TargetKind::Directory => metadata.is_dir(),
        };
    if !valid {
        return Err(format!(
            "FACTORY_RESET_PATH_REJECTED: {} 的文件类型不符合固定目标定义",
            target.id
        ));
    }
    Ok(FactoryResetTargetDto {
        id: target.id.into(),
        kind: kind_name(target.kind).into(),
        state: "present".into(),
        fingerprint: fingerprint(&target.path)?,
    })
}

fn fingerprint(path: &Path) -> Result<String, String> {
    fn visit(root: &Path, path: &Path, hash: &mut Sha256) -> Result<(), String> {
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| "FACTORY_RESET_INSPECTION_FAILED: 无法读取目标元数据")?;
        hash.update(
            path.strip_prefix(root)
                .unwrap_or(Path::new(""))
                .as_os_str()
                .as_encoded_bytes(),
        );
        hash.update([
            metadata.file_type().is_symlink() as u8,
            metadata.is_file() as u8,
            metadata.is_dir() as u8,
        ]);
        hash.update(metadata.len().to_le_bytes());
        hash.update(
            metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |value| value.as_nanos())
                .to_le_bytes(),
        );
        if metadata.is_dir() {
            let mut entries = fs::read_dir(path)
                .map_err(|_| "FACTORY_RESET_INSPECTION_FAILED: 无法枚举目标目录")?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| "FACTORY_RESET_INSPECTION_FAILED: 无法枚举目标目录")?;
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                visit(root, &entry.path(), hash)?;
            }
        }
        Ok(())
    }
    let mut hash = Sha256::new();
    visit(path, path, &mut hash)?;
    Ok(format!("sha256:{:x}", hash.finalize()))
}

fn commit_targets<F>(
    app: &Path,
    request_id: &str,
    preview_ref: &str,
    targets: &[Target],
    mut rename: F,
) -> Result<FactoryResetResultDto, String>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let suffix = preview_ref
        .strip_prefix("factory-reset-")
        .filter(|value| valid_suffix(value))
        .ok_or_else(|| "FACTORY_RESET_PREVIEW_INVALID: 重置预览引用无效".to_string())?;
    let mut moved: Vec<(Target, PathBuf)> = Vec::new();
    let mut absent = Vec::new();
    for target in targets {
        if !target.path.exists() {
            absent.push(target.id.to_string());
            continue;
        }
        let quarantine = quarantine_path(target, suffix)?;
        if quarantine.exists() || rename(&target.path, &quarantine).is_err() {
            let rollback_ok = rollback(&mut moved, &mut rename);
            return Err(if rollback_ok {
                "FACTORY_RESET_COMMIT_FAILED: 重置提交失败，已回滚".into()
            } else {
                "FACTORY_RESET_ROLLBACK_FAILED: 重置提交失败且未能完整回滚".into()
            });
        }
        moved.push((target.clone(), quarantine));
    }
    let target_ids = moved
        .iter()
        .map(|(target, _)| target.id.to_string())
        .collect::<Vec<_>>();
    let marker = CommittedMarker {
        suffix: suffix.into(),
        target_ids: target_ids.clone(),
    };
    if write_marker(&app.join(MARKER_NAME), &marker).is_err() {
        let rollback_ok = rollback(&mut moved, &mut rename);
        return Err(if rollback_ok {
            "FACTORY_RESET_MARKER_FAILED: 无法记录提交状态，已回滚".into()
        } else {
            "FACTORY_RESET_ROLLBACK_FAILED: 无法记录提交状态且未能完整回滚".into()
        });
    }
    set_reset_committed(true);
    Ok(FactoryResetResultDto {
        request_id: request_id.into(),
        preview_ref: preview_ref.into(),
        reset_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        quarantined_target_ids: target_ids,
        absent_target_ids: absent,
        requires_restart: true,
    })
}

fn write_marker(path: &Path, marker: &CommittedMarker) -> Result<(), String> {
    let bytes = serde_json::to_vec(marker).map_err(|_| "无法序列化已提交标记")?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    use std::io::Write;
    let mut file = options.open(path).map_err(|_| "无法创建已提交标记")?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法持久化已提交标记".into())
}

fn quarantine_path(target: &Target, suffix: &str) -> Result<PathBuf, String> {
    Ok(target
        .path
        .parent()
        .ok_or_else(|| "FACTORY_RESET_PATH_REJECTED: 固定目标缺少父目录".to_string())?
        .join(format!(".bandi-reset-{suffix}-{}", target.id)))
}

fn inspect_quarantine(
    path: &Path,
    kind: TargetKind,
    error_code: &str,
    allow_absent: bool,
) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if allow_absent && error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(format!("{error_code}: 隔离目标缺失或无法检查")),
    };
    let valid = !metadata.file_type().is_symlink()
        && match kind {
            TargetKind::File => metadata.is_file(),
            TargetKind::Directory => metadata.is_dir(),
        };
    if valid {
        Ok(())
    } else {
        Err(format!("{error_code}: 隔离目标类型无效"))
    }
}

fn remove_quarantine(path: &Path, kind: TargetKind) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("FACTORY_RESET_CLEANUP_FAILED: 无法检查隔离目标".into()),
        Ok(_) => inspect_quarantine(path, kind, "FACTORY_RESET_CLEANUP_REJECTED", false)?,
    }
    match kind {
        TargetKind::File => fs::remove_file(path),
        TargetKind::Directory => fs::remove_dir_all(path),
    }
    .map_err(|_| "FACTORY_RESET_CLEANUP_FAILED: 无法清理隔离目标".into())
}

fn rollback<F>(moved: &mut Vec<(Target, PathBuf)>, rename: &mut F) -> bool
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let mut complete = true;
    while let Some((target, quarantine)) = moved.pop() {
        if rename(&quarantine, &target.path).is_err() {
            complete = false;
        }
    }
    complete
}

fn kind_name(kind: TargetKind) -> &'static str {
    match kind {
        TargetKind::File => "file",
        TargetKind::Directory => "directory",
    }
}
fn valid_suffix(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn new_preview_ref(app: &Path, managed: &Path, expires_at: SystemTime) -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hash = Sha256::new();
    hash.update(app.as_os_str().as_encoded_bytes());
    hash.update(managed.as_os_str().as_encoded_bytes());
    hash.update(system_time_millis(expires_at).to_le_bytes());
    hash.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    format!("factory-reset-{:x}", hash.finalize())
}
fn system_time_millis(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
fn system_time_rfc3339(time: SystemTime) -> Result<String, String> {
    let seconds = i64::try_from(system_time_millis(time) / 1000)
        .map_err(|_| "FACTORY_RESET_UNAVAILABLE: 无法生成预览过期时间".to_string())?;
    DateTime::<Utc>::from_timestamp(seconds, 0)
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Secs, true))
        .ok_or_else(|| "FACTORY_RESET_UNAVAILABLE: 无法生成预览过期时间".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;

    fn preview(app: &Path, home: &Path, id: &str) -> FactoryResetPreviewDto {
        preview_at(
            app,
            home,
            PreviewFactoryResetRequest {
                request_id: id.into(),
            },
        )
        .unwrap()
    }

    #[test]
    fn reset_quarantines_only_fixed_targets_then_startup_cleans_marker_entries() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("app");
        let home = root.path().join("home");
        fs::create_dir_all(app.join("memory/projects/project-one/departments")).unwrap();
        fs::create_dir_all(home.join(".bandi/agents/agt_one")).unwrap();
        fs::write(app.join("bandi.db"), b"db").unwrap();
        fs::write(
            app.join("memory/projects/project-one/public.md"),
            b"project memory",
        )
        .unwrap();
        fs::write(
            app.join("memory/projects/project-one/departments/department-one.md"),
            b"department memory",
        )
        .unwrap();
        let project_directory = root.path().join("customer-project");
        let external = root.path().join("external-agent");
        let host = home.join(".claude/settings.json");
        fs::create_dir_all(&project_directory).unwrap();
        fs::write(project_directory.join("keep.txt"), b"external project data").unwrap();
        fs::create_dir_all(&external).unwrap();
        fs::create_dir_all(host.parent().unwrap()).unwrap();
        fs::write(&host, b"{}").unwrap();
        let result = commit_at(
            &app,
            &home,
            CommitFactoryResetRequest {
                request_id: "reset-1".into(),
                preview_ref: preview(&app, &home, "reset-1").preview_ref,
                confirmation_text: CONFIRMATION_TEXT.into(),
            },
        )
        .unwrap();
        assert!(result.requires_restart && app.join(MARKER_NAME).is_file());
        assert!(!app.join("bandi.db").exists());
        assert!(!app.join("memory").exists());
        assert!(result
            .quarantined_target_ids
            .contains(&"formalMemory".into()));
        assert!(mutation_guard().unwrap_err().contains("RESTART_REQUIRED"));
        assert!(restart_guard_at(&app, &home).is_ok());
        let database_error = crate::domain_store::open_at(&app.join("bandi.db")).unwrap_err();
        assert!(database_error.starts_with("FACTORY_RESET_RESTART_REQUIRED:"));
        cleanup_committed_at(&app, &home).unwrap();

        assert!(!app.join("bandi.db").exists());
        assert!(!app.join("bandi.db-wal").exists());
        assert!(!app.join("bandi.db-shm").exists());
        assert_eq!(
            fs::read(project_directory.join("keep.txt")).unwrap(),
            b"external project data"
        );
        assert!(project_directory.exists() && external.exists() && host.exists());
        assert!(!app.join(MARKER_NAME).exists());
        assert!(mutation_guard().is_ok());
        assert!(restart_guard_at(&app, &home)
            .unwrap_err()
            .starts_with("FACTORY_RESET_RESTART_NOT_ALLOWED:"));

        let marker_path = app.join(MARKER_NAME);
        assert!(read_committed_marker(&app, &home, "MARKER_INVALID")
            .unwrap()
            .is_none());
        fs::write(&marker_path, b"not-json").unwrap();
        assert!(matches!(
            read_committed_marker(&app, &home, "MARKER_INVALID"),
            Err(error) if error.contains("MARKER_INVALID")
        ));
        for marker in [
            CommittedMarker {
                suffix: "invalid".into(),
                target_ids: vec!["database".into()],
            },
            CommittedMarker {
                suffix: "a".repeat(64),
                target_ids: vec!["unknown".into()],
            },
            CommittedMarker {
                suffix: "a".repeat(64),
                target_ids: vec!["database".into(), "database".into()],
            },
        ] {
            fs::write(&marker_path, serde_json::to_vec(&marker).unwrap()).unwrap();
            assert!(matches!(
                read_committed_marker(&app, &home, "MARKER_INVALID"),
                Err(error) if error.contains("MARKER_INVALID")
            ));
        }
    }

    #[test]
    fn commit_rejects_target_changed_after_preview() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("app");
        let home = root.path().join("home");
        fs::create_dir_all(&app).unwrap();
        fs::write(app.join("bandi.db"), b"old").unwrap();
        let preview = preview(&app, &home, "reset-2");
        fs::write(app.join("bandi.db"), b"changed").unwrap();
        assert!(commit_at(
            &app,
            &home,
            CommitFactoryResetRequest {
                request_id: "reset-2".into(),
                preview_ref: preview.preview_ref,
                confirmation_text: CONFIRMATION_TEXT.into()
            }
        )
        .unwrap_err()
        .contains("TARGET_CHANGED"));
        assert_eq!(fs::read(app.join("bandi.db")).unwrap(), b"changed");
    }

    #[test]
    fn preview_rejects_symlink_target() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("app");
        let home = root.path().join("home");
        fs::create_dir_all(&app).unwrap();
        fs::create_dir_all(home.join(".bandi")).unwrap();
        let outside = root.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, app.join("backups")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, app.join("backups")).unwrap();
        assert!(preview_at(
            &app,
            &home,
            PreviewFactoryResetRequest {
                request_id: "reset-3".into()
            }
        )
        .unwrap_err()
        .contains("PATH_REJECTED"));
        assert!(outside.exists());
    }

    #[test]
    fn rename_failure_rolls_back_in_reverse_order() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("app");
        fs::create_dir_all(&app).unwrap();
        fs::write(app.join("bandi.db"), b"db").unwrap();
        fs::write(app.join("bandi.db-wal"), b"wal").unwrap();
        let targets = vec![
            Target {
                id: "database",
                path: app.join("bandi.db"),
                kind: TargetKind::File,
            },
            Target {
                id: "databaseWal",
                path: app.join("bandi.db-wal"),
                kind: TargetKind::File,
            },
        ];
        let mut calls = 0;
        let error = commit_targets(
            &app,
            "reset-4",
            &format!("factory-reset-{}", "a".repeat(64)),
            &targets,
            |from, to| {
                calls += 1;
                if calls == 2 {
                    Err(io::Error::other("injected"))
                } else {
                    fs::rename(from, to)
                }
            },
        )
        .unwrap_err();
        assert!(error.contains("已回滚"));
        assert_eq!(fs::read(app.join("bandi.db")).unwrap(), b"db");
        assert_eq!(fs::read(app.join("bandi.db-wal")).unwrap(), b"wal");
    }

    #[test]
    fn commit_requires_matching_request_and_exact_confirmation() {
        let root = tempfile::tempdir().unwrap();
        let app = root.path().join("app");
        let home = root.path().join("home");
        fs::create_dir_all(&app).unwrap();
        let first = preview(&app, &home, "reset-5");
        assert!(commit_at(
            &app,
            &home,
            CommitFactoryResetRequest {
                request_id: "reset-5".into(),
                preview_ref: first.preview_ref,
                confirmation_text: "确认".into()
            }
        )
        .unwrap_err()
        .contains("CONFIRMATION_REQUIRED"));
        let second = preview(&app, &home, "reset-6");
        assert!(commit_at(
            &app,
            &home,
            CommitFactoryResetRequest {
                request_id: "other".into(),
                preview_ref: second.preview_ref,
                confirmation_text: CONFIRMATION_TEXT.into()
            }
        )
        .unwrap_err()
        .contains("PREVIEW_INVALID"));
    }
}
