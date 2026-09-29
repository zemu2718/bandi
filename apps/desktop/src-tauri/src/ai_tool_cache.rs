use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{Condvar, Mutex, OnceLock},
    time::Duration,
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    ai_tool_host::{self, AiToolHostStatusDto},
    config_fs, factory_reset,
};

const CACHE_FILE_NAME: &str = "ai-tool-host-cache.json";
const CACHE_SCHEMA_VERSION: u32 = 1;
const CACHE_MAX_BYTES: u64 = 256 * 1024;
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListAiToolHostStatusesRequest {
    pub(crate) force_refresh: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiToolHostSnapshotDto {
    pub(crate) statuses: Vec<AiToolHostStatusDto>,
    pub(crate) checked_at: String,
    pub(crate) stale: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CacheDocument {
    schema_version: u32,
    app_version: String,
    checked_at: String,
    statuses: Vec<AiToolHostStatusDto>,
}

#[derive(Default)]
struct CacheState {
    path: Option<PathBuf>,
    snapshot: Option<CacheDocument>,
    refreshing: bool,
    generation: u64,
    last_result: Option<(u64, Result<CacheDocument, String>)>,
}

fn coordinator() -> &'static (Mutex<CacheState>, Condvar) {
    static COORDINATOR: OnceLock<(Mutex<CacheState>, Condvar)> = OnceLock::new();
    COORDINATOR.get_or_init(|| (Mutex::new(CacheState::default()), Condvar::new()))
}

fn cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CACHE_FILE_NAME)
}

fn valid_statuses(statuses: &[AiToolHostStatusDto]) -> bool {
    if statuses.len() != ai_tool_host::catalog_tool_ids().len() {
        return false;
    }
    ai_tool_host::catalog_tool_ids().iter().all(|id| {
        statuses
            .iter()
            .filter(|status| status.tool_id == *id)
            .count()
            == 1
    }) && statuses.iter().all(|status| {
        status.config_location_label.len() <= 256
            && status.reason_code.len() <= 128
            && status.version_reason_code.len() <= 128
            && status
                .current_version
                .as_ref()
                .is_none_or(|value| value.len() <= 128)
            && status
                .latest_version
                .as_ref()
                .is_none_or(|value| value.len() <= 128)
    })
}

fn checked_at(document: &CacheDocument) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&document.checked_at)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

fn valid_document(document: &CacheDocument, now: DateTime<Utc>) -> bool {
    document.schema_version == CACHE_SCHEMA_VERSION
        && document.app_version == APP_VERSION
        && checked_at(document).is_some_and(|value| value <= now)
        && valid_statuses(&document.statuses)
}

fn read_cache(path: &Path, now: DateTime<Utc>) -> Option<CacheDocument> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return None,
        Err(_) => return None,
    };
    if metadata.len() > CACHE_MAX_BYTES
        || config_fs::ensure_regular_file(path, "AI 工具状态缓存").is_err()
    {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.len() as u64 > CACHE_MAX_BYTES {
        return None;
    }
    let document = serde_json::from_slice::<CacheDocument>(&bytes).ok()?;
    valid_document(&document, now).then_some(document)
}

fn is_fresh(document: &CacheDocument, now: DateTime<Utc>) -> bool {
    checked_at(document)
        .and_then(|value| now.signed_duration_since(value).to_std().ok())
        .is_some_and(|age| age < CACHE_TTL)
}

fn response(document: CacheDocument, stale: bool) -> AiToolHostSnapshotDto {
    AiToolHostSnapshotDto {
        statuses: document.statuses,
        checked_at: document.checked_at,
        stale,
    }
}

fn persist(path: &Path, document: &CacheDocument) -> Result<(), String> {
    let bytes = serde_json::to_vec(document)
        .map_err(|_| "AI_TOOL_HOST_CACHE_WRITE_FAILED: 无法编码工具状态缓存".to_string())?;
    if bytes.len() as u64 > CACHE_MAX_BYTES {
        return Err("AI_TOOL_HOST_CACHE_WRITE_FAILED: 工具状态缓存超出限制".into());
    }
    let _mutation = factory_reset::mutation_guard()?;
    config_fs::restricted_atomic_write(path, &bytes, path.exists(), "AI 工具状态缓存")
        .map_err(|_| "AI_TOOL_HOST_CACHE_WRITE_FAILED: 无法保存工具状态缓存".to_string())
}

pub(crate) fn list_or_refresh(
    app_data_dir: &Path,
    force_refresh: bool,
    scan: impl FnOnce() -> Vec<AiToolHostStatusDto>,
) -> Result<AiToolHostSnapshotDto, String> {
    let now = Utc::now();
    let path = cache_path(app_data_dir);
    let (lock, ready) = coordinator();
    let mut state = lock
        .lock()
        .map_err(|_| "AI_TOOL_HOST_FAILED: 工具检查状态不可用".to_string())?;

    if state.path.as_deref() != Some(path.as_path()) {
        if state.refreshing {
            return Err("AI_TOOL_HOST_BUSY: 另一项工具检查正在进行".into());
        }
        *state = CacheState {
            path: Some(path.clone()),
            snapshot: read_cache(&path, now),
            ..CacheState::default()
        };
    }

    if !force_refresh {
        if let Some(document) = state.snapshot.clone() {
            return Ok(response(document.clone(), !is_fresh(&document, now)));
        }
    }

    if state.refreshing {
        let generation = state.generation;
        while state.refreshing && state.generation == generation {
            state = ready
                .wait(state)
                .map_err(|_| "AI_TOOL_HOST_FAILED: 工具检查状态不可用".to_string())?;
        }
        return state
            .last_result
            .as_ref()
            .filter(|(completed, _)| *completed > generation)
            .map(|(_, result)| result.clone().map(|document| response(document, false)))
            .unwrap_or_else(|| Err("AI_TOOL_HOST_FAILED: 工具检查未完成".into()));
    }

    state.refreshing = true;
    drop(state);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let statuses = scan();
        if !valid_statuses(&statuses) {
            return Err("AI_TOOL_HOST_REFRESH_FAILED: 工具检查结果不完整".into());
        }
        let document = CacheDocument {
            schema_version: CACHE_SCHEMA_VERSION,
            app_version: APP_VERSION.into(),
            checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            statuses,
        };
        persist(&path, &document)?;
        Ok(document)
    }))
    .unwrap_or_else(|_| Err("AI_TOOL_HOST_REFRESH_FAILED: 工具检查异常结束".into()));

    let mut state = lock
        .lock()
        .map_err(|_| "AI_TOOL_HOST_FAILED: 工具检查状态不可用".to_string())?;
    state.refreshing = false;
    state.generation = state.generation.wrapping_add(1);
    if let Ok(document) = &result {
        state.snapshot = Some(document.clone());
    }
    state.last_result = Some((state.generation, result.clone()));
    ready.notify_all();
    result.map(|document| response(document, false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_tool_host;
    use std::sync::{Arc, Barrier, MutexGuard};

    fn test_guard() -> MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap()
    }

    fn statuses() -> Vec<AiToolHostStatusDto> {
        ai_tool_host::list_at(tempfile::tempdir().unwrap().path())
    }

    #[test]
    fn reuses_fresh_disk_cache_and_marks_expired_cache_stale() {
        let _guard = test_guard();
        let root = tempfile::tempdir().unwrap();
        let path = cache_path(root.path());
        let current = CacheDocument {
            schema_version: CACHE_SCHEMA_VERSION,
            app_version: APP_VERSION.into(),
            checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            statuses: statuses(),
        };
        persist(&path, &current).unwrap();
        let loaded = read_cache(&path, Utc::now()).unwrap();
        assert!(is_fresh(&loaded, Utc::now()));

        let expired = CacheDocument {
            checked_at: (Utc::now() - chrono::Duration::hours(24))
                .to_rfc3339_opts(SecondsFormat::Millis, true),
            ..current
        };
        assert!(!is_fresh(&expired, Utc::now()));
        assert!(response(expired, true).stale);
    }

    #[test]
    fn rejects_invalid_tool_sets_and_unknown_request_fields() {
        let mut invalid = statuses();
        invalid.pop();
        assert!(!valid_statuses(&invalid));
        assert!(serde_json::from_value::<ListAiToolHostStatusesRequest>(
            serde_json::json!({"forceRefresh":false,"path":"/tmp"})
        )
        .is_err());
    }

    #[test]
    fn rejects_incompatible_future_and_unsafe_cache_files() {
        let _guard = test_guard();
        let root = tempfile::tempdir().unwrap();
        let path = cache_path(root.path());
        let current = CacheDocument {
            schema_version: CACHE_SCHEMA_VERSION,
            app_version: APP_VERSION.into(),
            checked_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            statuses: statuses(),
        };
        let write = |document: &CacheDocument| {
            fs::write(&path, serde_json::to_vec(document).unwrap()).unwrap();
        };

        write(&CacheDocument {
            schema_version: CACHE_SCHEMA_VERSION + 1,
            ..current.clone()
        });
        assert!(read_cache(&path, Utc::now()).is_none());
        write(&CacheDocument {
            app_version: "other-version".into(),
            ..current.clone()
        });
        assert!(read_cache(&path, Utc::now()).is_none());
        write(&CacheDocument {
            checked_at: (Utc::now() + chrono::Duration::minutes(1))
                .to_rfc3339_opts(SecondsFormat::Millis, true),
            ..current.clone()
        });
        assert!(read_cache(&path, Utc::now()).is_none());

        fs::write(&path, vec![0; CACHE_MAX_BYTES as usize + 1]).unwrap();
        assert!(read_cache(&path, Utc::now()).is_none());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::remove_file(&path).unwrap();
            let target = root.path().join("target.json");
            fs::write(&target, serde_json::to_vec(&current).unwrap()).unwrap();
            symlink(target, &path).unwrap();
            assert!(read_cache(&path, Utc::now()).is_none());
        }
    }

    #[test]
    fn failed_refresh_keeps_previous_snapshot_and_allows_retry() {
        let _guard = test_guard();
        let root = tempfile::tempdir().unwrap();
        let original = list_or_refresh(root.path(), true, statuses).unwrap();

        let failure = std::panic::catch_unwind(|| {
            list_or_refresh(root.path(), true, || panic!("scan failed"))
        });
        assert!(failure.is_ok());
        assert!(failure.unwrap().is_err());

        let cached = list_or_refresh(root.path(), false, || panic!("must not scan")).unwrap();
        assert_eq!(cached.checked_at, original.checked_at);
        let retried = list_or_refresh(root.path(), true, statuses).unwrap();
        assert!(!retried.stale);
    }

    #[test]
    fn concurrent_refreshes_share_one_scan() {
        let _guard = test_guard();
        let root = tempfile::tempdir().unwrap();
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(2));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let path = root.path().to_path_buf();
            let calls = calls.clone();
            let barrier = barrier.clone();
            handles.push(std::thread::spawn(move || {
                barrier.wait();
                list_or_refresh(&path, true, || {
                    calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(30));
                    statuses()
                })
                .unwrap()
            }));
        }
        for handle in handles {
            assert!(!handle.join().unwrap().stale);
        }
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
}
