use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    config_fs::{ensure_regular_directory, ensure_regular_file, restricted_atomic_write},
    domain_store::{self, LongTermDomainSnapshotDtoV4},
    local_service::{
        self, diagnostic, AssetLocatorDto, BaselineRefDto, ConfigRevisionDto, ConfigSideDto,
        DiagnosticDto, RootKind, WriteReceiptDto,
    },
};

const MAX_CONTENT_BYTES: usize = 256 * 1024;
const IMPORT_TTL: Duration = Duration::from_secs(10 * 60);
const RECOVERY_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const SHARED_ASSET_KINDS: &[&str] = &["rule", "skill", "mcp", "sop"];
const LEGACY_SHARED_ASSET_KINDS: &[&str] = &["hook", "command", "output_profile"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum SharedAssetSourceDto {
    Authored,
    Imported {
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "importedHash")]
        imported_hash: String,
        #[serde(rename = "importedAt")]
        imported_at: String,
    },
    Legacy,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SharedAssetNodeDto {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) team_id: String,
    pub(crate) locator: AssetLocatorDto,
    pub(crate) content_hash: String,
    pub(crate) container_content_hash: String,
    pub(crate) writable: bool,
    pub(crate) source: SharedAssetSourceDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_revision_id: Option<String>,
    pub(crate) parse_status: String,
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedAssetManifestV1 {
    schema_version: u64,
    id: String,
    kind: String,
    team_id: String,
    content_file: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SharedAssetManifestV2 {
    schema_version: u64,
    id: String,
    name: String,
    kind: String,
    team_id: String,
    content_file: String,
    source: SharedAssetSourceDto,
}

struct ManifestFacts {
    id: String,
    name: String,
    kind: String,
    team_id: String,
    content_file: String,
    source: SharedAssetSourceDto,
}

#[derive(Debug)]
pub(crate) struct SharedAssetIndex {
    pub(crate) nodes: Vec<SharedAssetNodeDto>,
    pub(crate) root_available: bool,
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateSharedAssetRequest {
    pub(crate) request_id: String,
    pub(crate) team_id: String,
    pub(crate) asset_id: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SelectSharedAssetImportRequest {
    pub(crate) request_id: String,
    pub(crate) team_id: String,
    pub(crate) kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedAssetImportPreviewDto {
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) file_name: String,
    pub(crate) kind: String,
    pub(crate) size: usize,
    pub(crate) source_hash: String,
    pub(crate) suggested_name: String,
    pub(crate) suggested_id: String,
    pub(crate) expires_at: String,
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitSharedAssetImportRequest {
    pub(crate) request_id: String,
    pub(crate) preview_ref: String,
    pub(crate) expected_source_hash: String,
    pub(crate) team_id: String,
    pub(crate) asset_id: String,
    pub(crate) name: String,
    pub(crate) confirmed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SharedAssetIdentityRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedAssetEditorDto {
    pub(crate) request_id: String,
    pub(crate) asset: SharedAssetNodeDto,
    pub(crate) canonical_content: String,
    pub(crate) baseline_ref: BaselineRefDto,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_revision_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveSharedAssetRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
    pub(crate) expected_baseline: BaselineRefDto,
    pub(crate) base_content: String,
    pub(crate) proposed_content: String,
    #[serde(default)]
    pub(crate) confirmation_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecoverSharedAssetRevisionRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
    pub(crate) recovery_ref: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum SharedAssetMutationResult {
    Saved {
        #[serde(rename = "requestId")]
        request_id: String,
        asset: SharedAssetNodeDto,
        revision: Box<ConfigRevisionDto>,
        #[serde(rename = "writeReceipt")]
        write_receipt: WriteReceiptDto,
    },
    Unchanged {
        #[serde(rename = "requestId")]
        request_id: String,
        asset: SharedAssetNodeDto,
    },
    BaselineChanged {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "assetId")]
        asset_id: String,
        locator: AssetLocatorDto,
        base: ConfigSideDto,
        current: ConfigSideDto,
        proposed: ConfigSideDto,
        diagnostics: Vec<DiagnosticDto>,
    },
    ConfirmationRequired {
        #[serde(rename = "requestId")]
        request_id: String,
        challenge: local_service::ConfirmationChallengeDto,
        #[serde(rename = "affectedAgentIds")]
        affected_agent_ids: Vec<String>,
        diagnostics: Vec<DiagnosticDto>,
    },
    RegistrationPending {
        #[serde(rename = "requestId")]
        request_id: String,
        asset: SharedAssetNodeDto,
        #[serde(rename = "fileState")]
        file_state: String,
        diagnostics: Vec<DiagnosticDto>,
    },
    RevisionPending {
        #[serde(rename = "requestId")]
        request_id: String,
        asset: SharedAssetNodeDto,
        #[serde(rename = "fileState")]
        file_state: String,
        #[serde(rename = "recoveryRef")]
        recovery_ref: String,
        diagnostics: Vec<DiagnosticDto>,
    },
}

#[derive(Clone)]
struct ImportRecord {
    path: PathBuf,
    team_id: String,
    kind: String,
    file_name: String,
    source_hash: String,
    expires_at: SystemTime,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevisionRecoveryRecord {
    id: String,
    asset_id: String,
    asset_content_hash: String,
    container_content_hash: String,
    expires_at: String,
    revision: ConfigRevisionDto,
    write_receipt: WriteReceiptDto,
}

fn imports() -> &'static Mutex<HashMap<String, ImportRecord>> {
    static IMPORTS: OnceLock<Mutex<HashMap<String, ImportRecord>>> = OnceLock::new();
    IMPORTS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn hash(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn container_hash(manifest: &[u8], content: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(manifest);
    digest.update([0]);
    digest.update(content);
    format!("sha256:{:x}", digest.finalize())
}

fn content_file(kind: &str) -> Option<&'static str> {
    match kind {
        "skill" => Some("SKILL.md"),
        "rule" => Some("RULE.md"),
        "mcp" => Some("MCP.yaml"),
        "sop" => Some("SOP.md"),
        _ => None,
    }
}

fn validate_text(value: &str, label: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.contains('\0') || value.chars().count() > max {
        Err(format!("SHARED_ASSET_VALIDATION_FAILED: {label}无效"))
    } else {
        Ok(())
    }
}

fn contains_sensitive_key(value: &serde_yaml::Value) -> bool {
    match value {
        serde_yaml::Value::Mapping(map) => map.iter().any(|(key, value)| {
            let sensitive = key.as_str().is_some_and(|key| {
                let key = key.to_ascii_lowercase();
                [
                    "token",
                    "cookie",
                    "password",
                    "secret",
                    "credential",
                    "privatekey",
                    "private_key",
                    "apikey",
                    "api_key",
                    "accesskey",
                    "access_key",
                    "authorization",
                    "auth",
                    "bearer",
                    "clientkey",
                    "client_key",
                ]
                .iter()
                .any(|part| key.contains(part))
            });
            sensitive || contains_sensitive_key(value)
        }),
        serde_yaml::Value::Sequence(items) => items.iter().any(contains_sensitive_key),
        _ => false,
    }
}

fn validate_content(kind: &str, content: &str) -> Result<String, String> {
    validate_text(content, "资产正文", MAX_CONTENT_BYTES)?;
    if content.len() > MAX_CONTENT_BYTES {
        return Err("SHARED_ASSET_TOO_LARGE: 资产正文超过 256 KiB".into());
    }
    if kind == "mcp" {
        let value: serde_yaml::Value = serde_yaml::from_str(content).map_err(|_| {
            "SHARED_ASSET_MCP_INVALID: MCP 声明必须是 YAML 或 JSON 对象".to_string()
        })?;
        if !value.is_mapping() {
            return Err("SHARED_ASSET_MCP_INVALID: MCP 声明必须是对象".into());
        }
        if contains_sensitive_key(&value) {
            return Err("SHARED_ASSET_SECRET_REJECTED: MCP 声明不得包含凭据或秘密值".into());
        }
        return serde_yaml::to_string(&value)
            .map_err(|_| "SHARED_ASSET_MCP_INVALID: 无法规范化 MCP 声明".into());
    }
    Ok(content.to_string())
}

fn parse_manifest(bytes: &[u8]) -> Result<ManifestFacts, ()> {
    if let Ok(manifest) = serde_yaml::from_slice::<SharedAssetManifestV2>(bytes) {
        if manifest.schema_version != 2 {
            return Err(());
        }
        return Ok(ManifestFacts {
            id: manifest.id,
            name: manifest.name,
            kind: manifest.kind,
            team_id: manifest.team_id,
            content_file: manifest.content_file,
            source: manifest.source,
        });
    }
    let manifest = serde_yaml::from_slice::<SharedAssetManifestV1>(bytes).map_err(|_| ())?;
    if manifest.schema_version != 1 {
        return Err(());
    }
    Ok(ManifestFacts {
        name: manifest.id.clone(),
        id: manifest.id,
        kind: manifest.kind,
        team_id: manifest.team_id,
        content_file: manifest.content_file,
        source: SharedAssetSourceDto::Legacy,
    })
}

fn owner_is_registered(snapshot: &LongTermDomainSnapshotDtoV4, manifest: &ManifestFacts) -> bool {
    snapshot.teams.iter().any(|team| {
        team.id == manifest.team_id && team.shared_asset_ids.iter().any(|id| id == &manifest.id)
    })
}

fn safe_content_path(package: &Path, relative: &str) -> Result<PathBuf, Box<DiagnosticDto>> {
    let path = Path::new(relative);
    if path.is_absolute() || path.components().count() != 1 || relative == "asset.yaml" {
        return Err(Box::new(diagnostic(
            "shared_asset_content_path_invalid",
            "error",
            "共享资产 contentFile 必须是资产目录内的单个相对文件名",
            Some("contentFile".into()),
            Some("移除绝对路径、子目录和路径穿越"),
        )));
    }
    let target = package.join(path);
    ensure_regular_file(&target, "共享资产正文").map_err(|_| {
        Box::new(diagnostic(
            "shared_asset_content_rejected",
            "error",
            "共享资产正文必须是资产目录内的普通文件",
            Some(relative.into()),
            Some("恢复正文文件并移除符号链接"),
        ))
    })?;
    Ok(target)
}

fn invalid_node(
    id: String,
    kind: String,
    team_id: String,
    relative_path: String,
    issue: DiagnosticDto,
) -> SharedAssetNodeDto {
    SharedAssetNodeDto {
        name: id.clone(),
        id,
        kind,
        team_id,
        locator: AssetLocatorDto {
            root_kind: RootKind::Bandi,
            display_path: relative_path.clone(),
            relative_path: Some(relative_path),
        },
        content_hash: hash(&[]),
        container_content_hash: hash(&[]),
        writable: false,
        source: SharedAssetSourceDto::Legacy,
        current_revision_id: None,
        parse_status: "invalid".into(),
        diagnostics: vec![issue],
    }
}

fn discover_package(
    root: &Path,
    package: &Path,
    directory_id: &str,
    snapshot: &LongTermDomainSnapshotDtoV4,
) -> SharedAssetNodeDto {
    let relative_manifest = format!("{directory_id}/asset.yaml");
    let manifest_path = package.join("asset.yaml");
    if ensure_regular_file(&manifest_path, "共享资产 manifest").is_err() {
        return invalid_node(
            directory_id.into(),
            "unknown".into(),
            "unknown".into(),
            relative_manifest,
            diagnostic(
                "shared_asset_manifest_rejected",
                "error",
                "共享资产 manifest 必须是普通文件",
                Some("asset.yaml".into()),
                Some("恢复 canonical asset.yaml"),
            ),
        );
    }
    let manifest_bytes = match fs::read(&manifest_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return invalid_node(
                directory_id.into(),
                "unknown".into(),
                "unknown".into(),
                relative_manifest,
                diagnostic(
                    "shared_asset_manifest_invalid",
                    "error",
                    "共享资产 manifest 不符合冻结 schema",
                    Some("asset.yaml".into()),
                    Some("修正 YAML 字段、类型和未知字段"),
                ),
            )
        }
    };
    let manifest = match parse_manifest(&manifest_bytes) {
        Ok(value) => value,
        Err(_) => {
            return invalid_node(
                directory_id.into(),
                "unknown".into(),
                "unknown".into(),
                relative_manifest,
                diagnostic(
                    "shared_asset_manifest_invalid",
                    "error",
                    "共享资产 manifest 不符合冻结 schema",
                    Some("asset.yaml".into()),
                    Some("修正 YAML 字段、类型和未知字段"),
                ),
            )
        }
    };
    let kind_valid = SHARED_ASSET_KINDS.contains(&manifest.kind.as_str())
        || LEGACY_SHARED_ASSET_KINDS.contains(&manifest.kind.as_str());
    let content_file_valid = content_file(&manifest.kind).map_or(
        LEGACY_SHARED_ASSET_KINDS.contains(&manifest.kind.as_str()),
        |expected| manifest.content_file == expected,
    );
    if manifest.id != directory_id
        || !valid_id(&manifest.id)
        || !valid_id(&manifest.team_id)
        || !kind_valid
        || !content_file_valid
        || manifest.name.trim().is_empty()
    {
        return invalid_node(
            manifest.id,
            manifest.kind,
            manifest.team_id,
            relative_manifest,
            diagnostic(
                "shared_asset_identity_invalid",
                "error",
                "共享资产稳定身份、类型或目录身份无效",
                Some("asset.yaml".into()),
                Some("保持目录名、id、kind 与 Team 符合共享资产 schema"),
            ),
        );
    }
    if !owner_is_registered(snapshot, &manifest) {
        return invalid_node(
            manifest.id,
            manifest.kind,
            manifest.team_id,
            relative_manifest,
            diagnostic(
                "shared_asset_owner_invalid",
                "error",
                "共享资产未与对应 Team 显式关联",
                Some("teamId".into()),
                Some("修复该资产的 Team 登记"),
            ),
        );
    }
    let content_path = match safe_content_path(package, &manifest.content_file) {
        Ok(path) => path,
        Err(issue) => {
            return invalid_node(
                manifest.id,
                manifest.kind,
                manifest.team_id,
                relative_manifest,
                *issue,
            )
        }
    };
    let bytes = match fs::read(&content_path) {
        Ok(bytes) => bytes,
        Err(_) => {
            return invalid_node(
                manifest.id,
                manifest.kind,
                manifest.team_id,
                relative_manifest,
                diagnostic(
                    "shared_asset_content_unreadable",
                    "error",
                    "无法读取共享资产正文",
                    Some(manifest.content_file),
                    Some("检查正文文件权限"),
                ),
            )
        }
    };
    let relative_content = content_path
        .strip_prefix(root)
        .unwrap_or(&content_path)
        .to_string_lossy()
        .into_owned();
    let writable =
        !fs::metadata(&content_path).is_ok_and(|metadata| metadata.permissions().readonly());
    SharedAssetNodeDto {
        id: manifest.id,
        name: manifest.name,
        kind: manifest.kind,
        team_id: manifest.team_id,
        locator: AssetLocatorDto {
            root_kind: RootKind::Bandi,
            display_path: relative_content.clone(),
            relative_path: Some(relative_content),
        },
        content_hash: hash(&bytes),
        container_content_hash: container_hash(&manifest_bytes, &bytes),
        writable,
        source: manifest.source,
        current_revision_id: None,
        parse_status: "parsed".into(),
        diagnostics: Vec::new(),
    }
}

pub(crate) fn discover(root: &Path, snapshot: &LongTermDomainSnapshotDtoV4) -> SharedAssetIndex {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return SharedAssetIndex {
                nodes: Vec::new(),
                root_available: false,
                diagnostics: vec![diagnostic(
                    "shared_asset_root_not_initialized",
                    "info",
                    "Bandi 共享资产根尚未初始化",
                    None,
                    Some("创建首个共享资产后刷新索引"),
                )],
            }
        }
        Err(_) => {
            return SharedAssetIndex {
                nodes: Vec::new(),
                root_available: false,
                diagnostics: vec![diagnostic(
                    "shared_asset_root_unreadable",
                    "error",
                    "无法读取 Bandi 共享资产根",
                    None,
                    Some("检查应用数据目录权限"),
                )],
            }
        }
    };
    let mut nodes = Vec::new();
    let mut diagnostics = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries.flatten() {
        let directory_id = entry.file_name().to_string_lossy().into_owned();
        if directory_id.starts_with(".bandi-staging-") {
            continue;
        }
        let metadata = match fs::symlink_metadata(entry.path()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if !valid_id(&directory_id) || metadata.file_type().is_symlink() || !metadata.is_dir() {
            diagnostics.push(diagnostic(
                "shared_asset_directory_rejected",
                "error",
                "共享资产必须位于稳定 ID 命名的普通目录",
                Some(directory_id),
                Some("移除非法目录或符号链接"),
            ));
            continue;
        }
        let node = discover_package(root, &entry.path(), &directory_id, snapshot);
        if !seen.insert(node.id.clone()) {
            diagnostics.push(diagnostic(
                "shared_asset_id_conflict",
                "error",
                "发现重复共享资产稳定 ID",
                Some(node.id),
                Some("修复冲突 manifest"),
            ));
            continue;
        }
        nodes.push(node);
    }
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    SharedAssetIndex {
        nodes,
        root_available: true,
        diagnostics,
    }
}

fn validate_request(team_id: &str, asset_id: &str, name: &str, kind: &str) -> Result<(), String> {
    if !valid_id(team_id) || !valid_id(asset_id) || !SHARED_ASSET_KINDS.contains(&kind) {
        return Err("SHARED_ASSET_VALIDATION_FAILED: Team、资产标识或类型无效".into());
    }
    validate_text(name, "资产名称", 120)
}

fn build_manifest(
    request: &CreateSharedAssetRequest,
    source: SharedAssetSourceDto,
) -> Result<Vec<u8>, String> {
    serde_yaml::to_string(&SharedAssetManifestV2 {
        schema_version: 2,
        id: request.asset_id.clone(),
        name: request.name.trim().to_string(),
        kind: request.kind.clone(),
        team_id: request.team_id.clone(),
        content_file: content_file(&request.kind)
            .ok_or_else(|| "SHARED_ASSET_KIND_UNSUPPORTED".to_string())?
            .into(),
        source,
    })
    .map(String::into_bytes)
    .map_err(|_| "SHARED_ASSET_MANIFEST_FAILED: 无法生成 manifest".into())
}

mod editor;
mod import;
#[cfg(test)]
mod tests;

pub(crate) use editor::{
    create_at, load_editor_at, recover_revision_at, repair_registration_at, save_at,
};
pub(crate) use import::{commit_import_at, preview_import_at};
