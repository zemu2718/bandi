use std::{collections::HashSet, fs, io::ErrorKind, path::Path};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    asset_package::{self, PackageLimits},
    config_fs::{ensure_regular_directory, ensure_regular_file, restricted_atomic_write},
    domain_store, local_service, memory_target,
};

use super::storage::validate_id;

const SCHEMA_VERSION: u64 = 1;
const PROFILE_VERSION: &str = "portable-backup-v1";
const MANIFEST_FILE: &str = "manifest.json";
const OBJECTS_DIR: &str = "objects";
const MAX_ENTRIES: usize = 10_000;
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const ROOT_FILE_LIMIT: u64 = 10 * 1024 * 1024;
const AGENT_TREE_LIMITS: PackageLimits = PackageLimits {
    max_files: 128,
    max_file_bytes: ROOT_FILE_LIMIT,
    max_total_bytes: 25 * 1024 * 1024,
    max_depth: 4,
};
const PORTABLE_PATH_LIMITS: PackageLimits = PackageLimits {
    max_files: MAX_ENTRIES,
    max_file_bytes: ROOT_FILE_LIMIT,
    max_total_bytes: MAX_TOTAL_BYTES,
    max_depth: 16,
};
const ROOT_AGENT_FILES: &[&str] = &[
    ".bandi-agent.json",
    "agent.yaml",
    "avatar.png",
    "instructions.md",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatePortableSnapshotRequest {
    pub(crate) request_id: String,
    #[serde(default)]
    pub(crate) include_memory: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PortableEntryKind {
    Domain,
    AgentFile,
    SharedAssetFile,
    Memory,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableSnapshotEntryDto {
    pub(crate) kind: PortableEntryKind,
    pub(crate) owner_id: String,
    pub(crate) path: String,
    pub(crate) object_ref: String,
    pub(crate) size_bytes: u64,
    pub(crate) content_hash: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableAgentPackageFile {
    pub(crate) path: String,
    pub(crate) content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableAgentPackagePayload {
    pub(crate) agent_id: String,
    pub(crate) agent: serde_json::Value,
    pub(crate) manifest: String,
    pub(crate) files: Vec<PortableAgentPackageFile>,
    pub(crate) avatar_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableSharedAssetPayload {
    pub(crate) asset_id: String,
    pub(crate) manifest: String,
    pub(crate) kind: String,
    pub(crate) content: String,
    pub(crate) package_files: Vec<asset_package::PackageFile>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableSnapshotManifestV1 {
    pub(crate) schema_version: u64,
    pub(crate) profile_version: String,
    pub(crate) snapshot_id: String,
    pub(crate) created_at: String,
    pub(crate) include_memory: bool,
    pub(crate) entry_count: u64,
    pub(crate) total_bytes: u64,
    pub(crate) manifest_hash: String,
    pub(crate) entries: Vec<PortableSnapshotEntryDto>,
    pub(crate) agent_packages: Vec<PortableAgentPackagePayload>,
    pub(crate) shared_assets: Vec<PortableSharedAssetPayload>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableSnapshotSummaryDto {
    pub(crate) snapshot_id: String,
    pub(crate) created_at: String,
    pub(crate) include_memory: bool,
    pub(crate) entry_count: u64,
    pub(crate) total_bytes: u64,
    pub(crate) manifest_hash: String,
}

struct CollectedEntry {
    kind: PortableEntryKind,
    owner_id: String,
    path: String,
    bytes: Vec<u8>,
}

pub(crate) fn create_portable_snapshot_at(
    database: &Path,
    agents_root: &Path,
    shared_assets_root: &Path,
    portable_root: &Path,
    request: CreatePortableSnapshotRequest,
) -> Result<PortableSnapshotManifestV1, String> {
    if !validate_id(&request.request_id) {
        return Err("PORTABLE_SNAPSHOT_REQUEST_INVALID: requestId 无效".into());
    }
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let mut collected = collect_domain(database)?;
    let mut agent_packages = Vec::new();
    let mut shared_assets = Vec::new();
    collect_agents(
        agents_root,
        request.include_memory,
        &mut collected,
        &mut agent_packages,
    )?;
    collect_packages(
        shared_assets_root,
        "shared-assets",
        PortableEntryKind::SharedAssetFile,
        &mut collected,
        &mut shared_assets,
    )?;
    collected.sort_by(|left, right| left.path.cmp(&right.path));
    validate_collected(&collected)?;

    let seed = collected
        .iter()
        .map(|entry| format!("{}:{}", entry.path, local_service::hash_bytes(&entry.bytes)))
        .collect::<Vec<_>>()
        .join(":");
    let snapshot_id = local_service::stable_id(
        "portable-snapshot",
        &format!("{}:{created_at}:{seed}", request.request_id),
    );
    store_snapshot(
        portable_root,
        snapshot_id,
        created_at,
        request.include_memory,
        collected,
        agent_packages,
        shared_assets,
    )
}

fn collect_domain(database: &Path) -> Result<Vec<CollectedEntry>, String> {
    let domain = domain_store::load_long_term_domain_snapshot_v4_at(database)?;
    let bytes = serde_json::to_vec(&domain)
        .map_err(|_| "PORTABLE_SNAPSHOT_DOMAIN_INVALID: 无法序列化长期领域数据".to_string())?;
    Ok(vec![CollectedEntry {
        kind: PortableEntryKind::Domain,
        owner_id: "domain-v4".into(),
        path: "domain/domain-v4.json".into(),
        bytes,
    }])
}

fn collect_agents(
    root: &Path,
    include_memory: bool,
    output: &mut Vec<CollectedEntry>,
    payloads: &mut Vec<PortableAgentPackagePayload>,
) -> Result<(), String> {
    let entries = read_root_directories(root, "Agent")?;
    for (directory, package) in entries {
        let agent_id = directory
            .strip_prefix("agt_")
            .filter(|id| validate_id(id))
            .ok_or_else(|| {
                "PORTABLE_SNAPSHOT_AGENT_INVALID: AgentPackage 目录身份无效".to_string()
            })?;
        let (manifest_id, _, _) = local_service::manifest_facts(&package.join("agent.yaml"))
            .map_err(|_| {
                "PORTABLE_SNAPSHOT_AGENT_INVALID: AgentPackage manifest 无效".to_string()
            })?;
        if manifest_id != agent_id {
            return Err("PORTABLE_SNAPSHOT_AGENT_INVALID: AgentPackage 稳定身份不一致".into());
        }
        for relative in ROOT_AGENT_FILES {
            collect_optional_file(
                &package.join(relative),
                PortableEntryKind::AgentFile,
                agent_id,
                format!("agents/{directory}/{relative}"),
                output,
            )?;
        }
        collect_safe_tree(
            &package.join("config"),
            format!("agents/{directory}/config"),
            PortableEntryKind::AgentFile,
            agent_id,
            AGENT_TREE_LIMITS,
            output,
        )?;
        if include_memory {
            let target = memory_target::resolve_requested(
                root,
                &format!("memory-agent-{agent_id}"),
                agent_id,
            )?;
            let (content, exists) = memory_target::read(&target)?;
            if exists {
                output.push(CollectedEntry {
                    kind: PortableEntryKind::Memory,
                    owner_id: agent_id.into(),
                    path: format!("agents/{directory}/memory/long-term.md"),
                    bytes: content.into_bytes(),
                });
            }
        }
    }
    for (directory, package) in read_root_directories(root, "Agent")? {
        let agent_id = directory
            .strip_prefix("agt_")
            .filter(|id| validate_id(id))
            .ok_or_else(|| "PORTABLE_SNAPSHOT_AGENT_INVALID".to_string())?;
        let agent: serde_json::Value = serde_json::from_slice(
            &fs::read(package.join(".bandi-agent.json"))
                .map_err(|_| "PORTABLE_SNAPSHOT_AGENT_INVALID".to_string())?,
        )
        .map_err(|_| "PORTABLE_SNAPSHOT_AGENT_INVALID".to_string())?;
        let manifest = fs::read_to_string(package.join("agent.yaml"))
            .map_err(|_| "PORTABLE_SNAPSHOT_AGENT_INVALID".to_string())?;
        let files = output
            .iter()
            .filter(|e| e.kind == PortableEntryKind::AgentFile && e.owner_id == agent_id)
            .map(|e| {
                Ok(PortableAgentPackageFile {
                    path: e.path.splitn(3, '/').nth(2).unwrap_or("").into(),
                    content: String::from_utf8(e.bytes.clone()).map_err(|_| {
                        "PORTABLE_SNAPSHOT_AGENT_INVALID: AgentPackage 文件必须是 UTF-8".to_string()
                    })?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        payloads.push(PortableAgentPackagePayload {
            agent_id: agent_id.into(),
            agent,
            manifest,
            files,
            avatar_bytes: fs::read(package.join("avatar.png")).ok(),
        });
    }
    Ok(())
}

fn collect_packages(
    root: &Path,
    prefix: &str,
    kind: PortableEntryKind,
    output: &mut Vec<CollectedEntry>,
    payloads: &mut Vec<PortableSharedAssetPayload>,
) -> Result<(), String> {
    for (owner_id, package) in read_root_directories(root, "共享资产")? {
        if !validate_id(&owner_id) {
            return Err("PORTABLE_SNAPSHOT_SHARED_ASSET_INVALID: 共享资产目录身份无效".into());
        }
        collect_optional_file(
            &package.join("asset.yaml"),
            kind.clone(),
            &owner_id,
            format!("{prefix}/{owner_id}/asset.yaml"),
            output,
        )?;
        let snapshot = asset_package::read_managed_directory(
            &package,
            asset_package::SKILL_LIMITS,
            "asset.yaml",
        )?;
        for file in snapshot.files {
            output.push(CollectedEntry {
                kind: kind.clone(),
                owner_id: owner_id.clone(),
                path: format!("{prefix}/{owner_id}/{}", file.path),
                bytes: file.bytes,
            });
        }
        let manifest = fs::read_to_string(package.join("asset.yaml"))
            .map_err(|_| "PORTABLE_SNAPSHOT_SHARED_ASSET_INVALID".to_string())?;
        let value: serde_yaml::Value = serde_yaml::from_str(&manifest)
            .map_err(|_| "PORTABLE_SNAPSHOT_SHARED_ASSET_INVALID".to_string())?;
        let payload_kind = value
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let content_file = value
            .get("contentFile")
            .and_then(|v| v.as_str())
            .unwrap_or("CONTENT.md");
        let content = fs::read_to_string(package.join(content_file))
            .map_err(|_| "PORTABLE_SNAPSHOT_SHARED_ASSET_INVALID".to_string())?;
        let package_files = asset_package::read_managed_directory(
            &package,
            asset_package::SKILL_LIMITS,
            "asset.yaml",
        )?
        .files;
        payloads.push(PortableSharedAssetPayload {
            asset_id: owner_id.clone(),
            manifest,
            kind: payload_kind,
            content,
            package_files,
        });
    }
    Ok(())
}

fn read_root_directories(
    root: &Path,
    label: &str,
) -> Result<Vec<(String, std::path::PathBuf)>, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => {
            return Err(format!(
                "PORTABLE_SNAPSHOT_SOURCE_UNREADABLE: 无法读取{label}根目录"
            ))
        }
    };
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry
            .map_err(|_| format!("PORTABLE_SNAPSHOT_SOURCE_UNREADABLE: 无法枚举{label}根目录"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "PORTABLE_SNAPSHOT_PATH_INVALID: 文件名必须是 UTF-8".to_string())?;
        if name.starts_with(".bandi-staging-") {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| "PORTABLE_SNAPSHOT_SOURCE_UNREADABLE: 无法检查受管目录".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("PORTABLE_SNAPSHOT_SOURCE_REJECTED: 受管根仅允许普通目录".into());
        }
        result.push((name, entry.path()));
    }
    result.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(result)
}

fn collect_safe_tree(
    root: &Path,
    prefix: String,
    kind: PortableEntryKind,
    owner_id: &str,
    limits: PackageLimits,
    output: &mut Vec<CollectedEntry>,
) -> Result<(), String> {
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("PORTABLE_SNAPSHOT_SOURCE_UNREADABLE: 无法检查受管目录".into()),
        Ok(_) => {}
    }
    let snapshot = asset_package::read_directory(root, limits)?;
    for file in snapshot.files {
        output.push(CollectedEntry {
            kind: kind.clone(),
            owner_id: owner_id.into(),
            path: format!("{prefix}/{}", file.path),
            bytes: file.bytes,
        });
    }
    Ok(())
}

fn collect_optional_file(
    path: &Path,
    kind: PortableEntryKind,
    owner_id: &str,
    portable_path: String,
    output: &mut Vec<CollectedEntry>,
) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("PORTABLE_SNAPSHOT_SOURCE_UNREADABLE: 无法检查受管文件".into()),
        Ok(metadata) if metadata.len() <= ROOT_FILE_LIMIT => {}
        Ok(_) => return Err("PORTABLE_SNAPSHOT_FILE_TOO_LARGE: 受管文件超过限制".into()),
    }
    ensure_regular_file(path, "便携快照来源文件")?;
    output.push(CollectedEntry {
        kind,
        owner_id: owner_id.into(),
        path: portable_path,
        bytes: fs::read(path)
            .map_err(|_| "PORTABLE_SNAPSHOT_SOURCE_UNREADABLE: 无法读取受管文件".to_string())?,
    });
    Ok(())
}

fn validate_collected(entries: &[CollectedEntry]) -> Result<(), String> {
    if entries.is_empty() || entries.len() > MAX_ENTRIES {
        return Err("PORTABLE_SNAPSHOT_ENTRY_COUNT_INVALID: 快照条目数量无效".into());
    }
    let mut paths = HashSet::new();
    let mut total = 0_u64;
    for entry in entries {
        asset_package::validate_relative_path(&entry.path, PORTABLE_PATH_LIMITS)?;
        if !validate_id(&entry.owner_id) || !paths.insert(entry.path.to_lowercase()) {
            return Err("PORTABLE_SNAPSHOT_MANIFEST_INVALID: ownerId 无效或路径重复".into());
        }
        total = total
            .checked_add(entry.bytes.len() as u64)
            .ok_or_else(|| "PORTABLE_SNAPSHOT_TOO_LARGE: 快照大小溢出".to_string())?;
        if total > MAX_TOTAL_BYTES {
            return Err("PORTABLE_SNAPSHOT_TOO_LARGE: 快照超过总大小限制".into());
        }
    }
    Ok(())
}

fn store_snapshot(
    root: &Path,
    snapshot_id: String,
    created_at: String,
    include_memory: bool,
    collected: Vec<CollectedEntry>,
    agent_packages: Vec<PortableAgentPackagePayload>,
    shared_assets: Vec<PortableSharedAssetPayload>,
) -> Result<PortableSnapshotManifestV1, String> {
    fs::create_dir_all(root)
        .map_err(|_| "PORTABLE_SNAPSHOT_STORAGE_FAILED: 无法创建存储目录".to_string())?;
    ensure_regular_directory(root, "便携快照存储目录")?;
    let staging = root.join(format!(".bandi-staging-{snapshot_id}"));
    let target = root.join(&snapshot_id);
    if staging.exists() || target.exists() {
        return Err("PORTABLE_SNAPSHOT_ALREADY_EXISTS: 快照已存在".into());
    }
    fs::create_dir(&staging)
        .map_err(|_| "PORTABLE_SNAPSHOT_STORAGE_FAILED: 无法创建暂存目录".to_string())?;
    let result = (|| {
        fs::create_dir(staging.join(OBJECTS_DIR))
            .map_err(|_| "PORTABLE_SNAPSHOT_STORAGE_FAILED: 无法创建对象目录".to_string())?;
        let mut entries = Vec::with_capacity(collected.len());
        let mut total_bytes = 0_u64;
        for item in collected {
            let content_hash = local_service::hash_bytes(&item.bytes);
            let digest = content_hash.trim_start_matches("sha256:");
            let object_ref = format!("{OBJECTS_DIR}/{digest}.blob");
            let object_path = staging.join(&object_ref);
            if object_path.exists() {
                if fs::read(&object_path).ok().as_deref() != Some(item.bytes.as_slice()) {
                    return Err("PORTABLE_SNAPSHOT_HASH_COLLISION: 内容寻址对象冲突".into());
                }
            } else {
                restricted_atomic_write(&object_path, &item.bytes, false, "便携快照对象")?;
            }
            total_bytes += item.bytes.len() as u64;
            entries.push(PortableSnapshotEntryDto {
                kind: item.kind,
                owner_id: item.owner_id,
                path: item.path,
                object_ref,
                size_bytes: item.bytes.len() as u64,
                content_hash,
            });
        }
        let mut manifest = PortableSnapshotManifestV1 {
            schema_version: SCHEMA_VERSION,
            profile_version: PROFILE_VERSION.into(),
            snapshot_id: snapshot_id.clone(),
            created_at,
            include_memory,
            entry_count: entries.len() as u64,
            total_bytes,
            manifest_hash: String::new(),
            entries,
            agent_packages,
            shared_assets,
        };
        manifest.manifest_hash = calculate_manifest_hash(&manifest)?;
        let bytes = serde_json::to_vec_pretty(&manifest)
            .map_err(|_| "PORTABLE_SNAPSHOT_MANIFEST_INVALID: 无法序列化 manifest".to_string())?;
        restricted_atomic_write(
            &staging.join(MANIFEST_FILE),
            &bytes,
            false,
            "便携快照 manifest",
        )?;
        fs::rename(&staging, &target)
            .map_err(|_| "PORTABLE_SNAPSHOT_STORAGE_FAILED: 无法原子提交快照".to_string())?;
        read_portable_snapshot_at(root, &snapshot_id)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn calculate_manifest_hash(manifest: &PortableSnapshotManifestV1) -> Result<String, String> {
    let mut canonical = manifest.clone();
    canonical.manifest_hash.clear();
    serde_json::to_vec(&canonical)
        .map(|bytes| local_service::hash_bytes(&bytes))
        .map_err(|_| "PORTABLE_SNAPSHOT_MANIFEST_INVALID: 无法计算 manifest hash".into())
}

pub(crate) fn read_portable_snapshot_at(
    root: &Path,
    snapshot_id: &str,
) -> Result<PortableSnapshotManifestV1, String> {
    if !validate_id(snapshot_id) {
        return Err("PORTABLE_SNAPSHOT_ID_INVALID: snapshotId 无效".into());
    }
    ensure_regular_directory(root, "便携快照存储目录")?;
    let directory = root.join(snapshot_id);
    ensure_regular_directory(&directory, "便携快照目录")?;
    let manifest_path = directory.join(MANIFEST_FILE);
    ensure_regular_file(&manifest_path, "便携快照 manifest")?;
    let bytes = fs::read(&manifest_path)
        .map_err(|_| "PORTABLE_SNAPSHOT_MANIFEST_UNREADABLE: 无法读取 manifest".to_string())?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("PORTABLE_SNAPSHOT_MANIFEST_INVALID: manifest 超过大小限制".into());
    }
    let manifest: PortableSnapshotManifestV1 = serde_json::from_slice(&bytes)
        .map_err(|_| "PORTABLE_SNAPSHOT_MANIFEST_INVALID: manifest 格式无效".to_string())?;
    validate_manifest(&directory, snapshot_id, &manifest)?;
    Ok(manifest)
}

fn validate_manifest(
    directory: &Path,
    snapshot_id: &str,
    manifest: &PortableSnapshotManifestV1,
) -> Result<(), String> {
    if manifest.schema_version != SCHEMA_VERSION
        || manifest.profile_version != PROFILE_VERSION
        || manifest.snapshot_id != snapshot_id
        || manifest.entry_count as usize != manifest.entries.len()
        || calculate_manifest_hash(manifest)? != manifest.manifest_hash
        || manifest.entries.is_empty()
        || manifest.entries.len() > MAX_ENTRIES
    {
        return Err("PORTABLE_SNAPSHOT_MANIFEST_INVALID: manifest 版本、身份或摘要无效".into());
    }
    let mut paths = HashSet::new();
    let mut objects = HashSet::new();
    let mut total = 0_u64;
    let mut previous = None;
    for entry in &manifest.entries {
        asset_package::validate_relative_path(&entry.path, PORTABLE_PATH_LIMITS)?;
        if !validate_id(&entry.owner_id)
            || !paths.insert(entry.path.to_lowercase())
            || previous.is_some_and(|path: &str| path >= entry.path.as_str())
            || (!manifest.include_memory && entry.kind == PortableEntryKind::Memory)
        {
            return Err(
                "PORTABLE_SNAPSHOT_MANIFEST_INVALID: 条目身份、顺序、路径或 Memory 策略无效".into(),
            );
        }
        previous = Some(&entry.path);
        let digest = entry
            .content_hash
            .strip_prefix("sha256:")
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or_else(|| "PORTABLE_SNAPSHOT_MANIFEST_INVALID: 内容 hash 无效".to_string())?;
        if entry.object_ref != format!("{OBJECTS_DIR}/{digest}.blob") {
            return Err("PORTABLE_SNAPSHOT_MANIFEST_INVALID: 对象引用无效".into());
        }
        let object = directory.join(&entry.object_ref);
        ensure_regular_file(&object, "便携快照对象")?;
        let bytes = fs::read(&object)
            .map_err(|_| "PORTABLE_SNAPSHOT_OBJECT_UNREADABLE: 无法读取对象".to_string())?;
        if bytes.len() as u64 != entry.size_bytes
            || local_service::hash_bytes(&bytes) != entry.content_hash
        {
            return Err("PORTABLE_SNAPSHOT_INTEGRITY_FAILED: 对象大小或 hash 不匹配".into());
        }
        objects.insert(entry.object_ref.clone());
        total = total
            .checked_add(entry.size_bytes)
            .ok_or_else(|| "PORTABLE_SNAPSHOT_TOO_LARGE: 快照大小溢出".to_string())?;
    }
    if total != manifest.total_bytes || total > MAX_TOTAL_BYTES {
        return Err("PORTABLE_SNAPSHOT_INTEGRITY_FAILED: 快照总大小不匹配".into());
    }
    let object_count = fs::read_dir(directory.join(OBJECTS_DIR))
        .map_err(|_| "PORTABLE_SNAPSHOT_OBJECT_UNREADABLE: 无法枚举对象".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "PORTABLE_SNAPSHOT_OBJECT_UNREADABLE: 无法枚举对象".to_string())?
        .len();
    if object_count != objects.len() {
        return Err("PORTABLE_SNAPSHOT_INTEGRITY_FAILED: 对象集合不匹配".into());
    }
    Ok(())
}

pub(crate) fn list_portable_snapshots_at(
    root: &Path,
) -> Result<Vec<PortableSnapshotSummaryDto>, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("PORTABLE_SNAPSHOT_STORAGE_FAILED: 无法读取快照目录".into()),
    };
    let mut snapshots = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|_| "PORTABLE_SNAPSHOT_STORAGE_FAILED: 无法枚举快照目录".to_string())?;
        let id = entry
            .file_name()
            .into_string()
            .map_err(|_| "PORTABLE_SNAPSHOT_ID_INVALID: snapshotId 必须是 UTF-8".to_string())?;
        if id.starts_with(".bandi-staging-") {
            continue;
        }
        let manifest = read_portable_snapshot_at(root, &id)?;
        snapshots.push(PortableSnapshotSummaryDto {
            snapshot_id: manifest.snapshot_id,
            created_at: manifest.created_at,
            include_memory: manifest.include_memory,
            entry_count: manifest.entry_count,
            total_bytes: manifest.total_bytes,
            manifest_hash: manifest.manifest_hash,
        });
    }
    snapshots.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then(right.snapshot_id.cmp(&left.snapshot_id))
    });
    Ok(snapshots)
}

#[cfg(test)]
#[path = "portable_tests.rs"]
mod tests;
