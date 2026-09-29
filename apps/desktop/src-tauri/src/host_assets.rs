use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::{
    ai_adapters::BuiltInClientId,
    asset_package::{self, PackageFile, PackageSnapshot, SKILL_ENTRYPOINT_LIMIT, SKILL_LIMITS},
    local_service::{self, DiagnosticDto},
    shared_assets::{self, SharedAssetSourceDto},
};

const PREVIEW_TTL: Duration = Duration::from_secs(10 * 60);
const SCAN_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_SCAN_RECORDS: usize = 64;
const MAX_PREVIEW_RECORDS: usize = 128;
const MAX_SCAN_PACKAGES: usize = 512;
const MAX_SCAN_FILES: usize = 2_048;
const MAX_SCAN_BYTES: u64 = 200 * 1024 * 1024;
const MAX_SCAN_DIAGNOSTICS: usize = 100;
const HOST_INSTANCE_VERSION: &str = "v1";

#[derive(Clone, Copy)]
enum RootShape {
    Instructions(&'static str),
    Skills(&'static str),
}

#[derive(Clone, Copy)]
struct Root {
    id: &'static str,
    shape: RootShape,
}

#[derive(Clone, Copy)]
struct ToolAssets {
    tool_id: BuiltInClientId,
    roots: &'static [Root],
    support: &'static str,
}

const CLAUDE: &[Root] = &[
    Root {
        id: "claude-user-instructions-v1",
        shape: RootShape::Instructions(".claude/CLAUDE.md"),
    },
    Root {
        id: "claude-user-skills-v1",
        shape: RootShape::Skills(".claude/skills"),
    },
];
const CODEX: &[Root] = &[
    Root {
        id: "codex-user-instructions-v1",
        shape: RootShape::Instructions(".codex/AGENTS.md"),
    },
    Root {
        id: "codex-user-skills-v1",
        shape: RootShape::Skills(".codex/skills"),
    },
];
const GEMINI: &[Root] = &[
    Root {
        id: "gemini-user-instructions-v1",
        shape: RootShape::Instructions(".gemini/GEMINI.md"),
    },
    Root {
        id: "gemini-user-skills-v1",
        shape: RootShape::Skills(".gemini/skills"),
    },
];
const GROK: &[Root] = &[Root {
    id: "grok-user-skills-v1",
    shape: RootShape::Skills(".grok/skills"),
}];
const OPENCODE: &[Root] = &[Root {
    id: "opencode-user-skills-v1",
    shape: RootShape::Skills(".config/opencode/skills"),
}];
const OPENCLAW: &[Root] = &[Root {
    id: "openclaw-user-skills-v1",
    shape: RootShape::Skills(".openclaw/skills"),
}];
const HERMES: &[Root] = &[Root {
    id: "hermes-user-skills-v1",
    shape: RootShape::Skills(".hermes/skills"),
}];
const PI: &[Root] = &[Root {
    id: "pi-user-skills-v1",
    shape: RootShape::Skills(".pi/agent/skills"),
}];
const NONE: &[Root] = &[];

const TOOLS: [ToolAssets; 9] = [
    ToolAssets {
        tool_id: BuiltInClientId::ClaudeCode,
        roots: CLAUDE,
        support: "supported",
    },
    ToolAssets {
        tool_id: BuiltInClientId::ClaudeDesktop,
        roots: NONE,
        support: "unsupported",
    },
    ToolAssets {
        tool_id: BuiltInClientId::Codex,
        roots: CODEX,
        support: "degraded",
    },
    ToolAssets {
        tool_id: BuiltInClientId::GeminiCli,
        roots: GEMINI,
        support: "degraded",
    },
    ToolAssets {
        tool_id: BuiltInClientId::GrokBuild,
        roots: GROK,
        support: "degraded",
    },
    ToolAssets {
        tool_id: BuiltInClientId::Opencode,
        roots: OPENCODE,
        support: "degraded",
    },
    ToolAssets {
        tool_id: BuiltInClientId::Openclaw,
        roots: OPENCLAW,
        support: "degraded",
    },
    ToolAssets {
        tool_id: BuiltInClientId::Hermes,
        roots: HERMES,
        support: "degraded",
    },
    ToolAssets {
        tool_id: BuiltInClientId::Pi,
        roots: PI,
        support: "degraded",
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapabilitiesDto {
    can_scan: bool,
    can_read_entrypoint: bool,
    can_import_to_bandi: bool,
    can_install_from_bandi: bool,
    can_update_from_bandi: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogEntryDto {
    tool_id: BuiltInClientId,
    support_level: &'static str,
    capabilities: CapabilitiesDto,
    reason_code: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogDto {
    tools: Vec<CatalogEntryDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PackageDescriptorDto {
    container_kind: &'static str,
    entrypoint: String,
    package_fingerprint: String,
    entrypoint_hash: String,
    file_count: usize,
    total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummaryDto {
    host_instance_id: String,
    tool_id: BuiltInClientId,
    root_id: String,
    package_key: String,
    name: String,
    kind: &'static str,
    relative_location: String,
    package: PackageDescriptorDto,
    parse_status: &'static str,
    diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolScanDto {
    #[serde(flatten)]
    catalog: CatalogEntryDto,
    check_state: &'static str,
    asset_count: usize,
    diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanResultDto {
    request_id: String,
    scan_generation: String,
    tools: Vec<ToolScanDto>,
    assets: Vec<SummaryDto>,
    diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ScanRequest {
    request_id: String,
    tool_ids: Vec<BuiltInClientId>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DetailRequest {
    request_id: String,
    host_instance_id: String,
    scan_generation: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileDto {
    relative_path: String,
    size: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetailDto {
    #[serde(flatten)]
    summary: SummaryDto,
    entrypoint_content: String,
    files: Vec<FileDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreviewRequest {
    request_id: String,
    host_instance_id: String,
    scan_generation: String,
    action: String,
    team_id: String,
    asset_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewDto {
    request_id: String,
    host_instance_id: String,
    scan_generation: String,
    action: &'static str,
    team_id: String,
    asset_id: String,
    preview_ref: String,
    expires_at: String,
    confirmation_text: String,
    source_fingerprint: String,
    diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CommitRequest {
    request_id: String,
    action: String,
    preview_ref: String,
    source_fingerprint: String,
    confirmed: bool,
}

#[derive(Clone)]
struct Found {
    summary: SummaryDto,
    snapshot: PackageSnapshot,
}

#[derive(Clone)]
struct PreviewRecord {
    tool_id: BuiltInClientId,
    root_id: String,
    package_key: String,
    source_fingerprint: String,
    name: String,
    team_id: String,
    asset_id: String,
    expires_at: SystemTime,
}

#[derive(Clone)]
struct ScanTargetRecord {
    tool_id: BuiltInClientId,
    root_id: String,
    package_key: String,
    fingerprint: String,
}

#[derive(Clone)]
struct ScanRecord {
    targets: HashMap<String, ScanTargetRecord>,
    expires_at: SystemTime,
}

#[derive(Default)]
struct ScanBudget {
    packages: usize,
    files: usize,
    bytes: u64,
    diagnostics: usize,
    exhausted: bool,
}

impl ScanBudget {
    fn include(&mut self, snapshot: &PackageSnapshot) -> Result<(), String> {
        self.packages += 1;
        self.files = self.files.saturating_add(snapshot.files.len());
        self.bytes = self.bytes.saturating_add(snapshot.total_bytes);
        if self.packages > MAX_SCAN_PACKAGES
            || self.files > MAX_SCAN_FILES
            || self.bytes > MAX_SCAN_BYTES
        {
            self.exhausted = true;
            return Err("HOST_ASSET_SCAN_LIMIT_EXCEEDED: 本次扫描累计内容超过限制".into());
        }
        Ok(())
    }

    fn diagnostic(&mut self) -> bool {
        self.diagnostics += 1;
        self.diagnostics <= MAX_SCAN_DIAGNOSTICS
    }
}

fn previews() -> &'static Mutex<HashMap<String, PreviewRecord>> {
    static VALUE: OnceLock<Mutex<HashMap<String, PreviewRecord>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn scans() -> &'static Mutex<HashMap<String, ScanRecord>> {
    static VALUE: OnceLock<Mutex<HashMap<String, ScanRecord>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_scans(records: &mut HashMap<String, ScanRecord>, now: SystemTime) {
    records.retain(|_, record| record.expires_at > now);
    while records.len() >= MAX_SCAN_RECORDS {
        let Some(oldest) = records
            .iter()
            .min_by_key(|(_, record)| record.expires_at)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        records.remove(&oldest);
    }
}

fn prune_previews(records: &mut HashMap<String, PreviewRecord>, now: SystemTime) {
    records.retain(|_, record| record.expires_at > now);
    while records.len() >= MAX_PREVIEW_RECORDS {
        let Some(oldest) = records
            .iter()
            .min_by_key(|(_, record)| record.expires_at)
            .map(|(id, _)| id.clone())
        else {
            break;
        };
        records.remove(&oldest);
    }
}

fn entry(tool: ToolAssets) -> CatalogEntryDto {
    let enabled = !tool.roots.is_empty();
    CatalogEntryDto {
        tool_id: tool.tool_id,
        support_level: tool.support,
        capabilities: CapabilitiesDto {
            can_scan: enabled,
            can_read_entrypoint: enabled,
            can_import_to_bandi: enabled,
            can_install_from_bandi: false,
            can_update_from_bandi: false,
        },
        reason_code: if enabled {
            "fixed_roots_read_only"
        } else {
            "no_safe_asset_root"
        },
    }
}

pub(crate) fn catalog() -> CatalogDto {
    CatalogDto {
        tools: TOOLS.into_iter().map(entry).collect(),
    }
}

fn joined(home: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .fold(home.to_path_buf(), |path, part| path.join(part))
}

fn normalized_package_key(key: &str) -> Result<String, String> {
    asset_package::validate_relative_path(key, SKILL_LIMITS)?;
    Ok(key.to_lowercase())
}

fn found(
    tool: BuiltInClientId,
    root: Root,
    key: String,
    location: String,
    snapshot: PackageSnapshot,
) -> Result<Found, String> {
    let normalized_key = normalized_package_key(&key)?;
    let entrypoint = match root.shape {
        RootShape::Instructions(_) => key.clone(),
        RootShape::Skills(_) => "SKILL.md".into(),
    };
    let file = snapshot
        .files
        .iter()
        .find(|file| file.path == entrypoint || file.path == "SKILL.md")
        .ok_or_else(|| "HOST_ASSET_INVALID: 缺少固定入口文件".to_string())?;
    let kind = if matches!(root.shape, RootShape::Instructions(_)) {
        "instructions"
    } else {
        "skill"
    };
    Ok(Found {
        summary: SummaryDto {
            host_instance_id: local_service::stable_id(
                "host-asset",
                &format!(
                    "{HOST_INSTANCE_VERSION}:{tool:?}:{}:{normalized_key}",
                    root.id
                ),
            ),
            tool_id: tool,
            root_id: root.id.into(),
            package_key: key.clone(),
            name: key,
            kind,
            relative_location: location,
            package: PackageDescriptorDto {
                container_kind: if kind == "skill" { "directory" } else { "file" },
                entrypoint,
                package_fingerprint: snapshot.fingerprint.clone(),
                entrypoint_hash: local_service::hash_bytes(&file.bytes),
                file_count: snapshot.files.len(),
                total_bytes: snapshot.total_bytes,
            },
            parse_status: "parsed",
            diagnostics: Vec::new(),
        },
        snapshot,
    })
}

struct ToolItems {
    found: Vec<Found>,
    diagnostics: Vec<DiagnosticDto>,
}

fn push_scan_diagnostic(
    diagnostics: &mut Vec<DiagnosticDto>,
    budget: &mut ScanBudget,
    error: &str,
) {
    if budget.diagnostic() {
        diagnostics.push(scan_failure(error));
    }
}

fn scan_instructions(
    home: &Path,
    tool: ToolAssets,
    root: Root,
    relative: &str,
    budget: &mut ScanBudget,
) -> Result<Option<Found>, String> {
    let path = joined(home, relative);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("HOST_ASSET_SCAN_FAILED: 无法检查固定资产位置".into()),
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("HOST_ASSET_SCAN_REJECTED: 固定资产位置不是普通文件".into())
        }
        Ok(metadata) if metadata.len() > SKILL_ENTRYPOINT_LIMIT => {
            return Err("ASSET_PACKAGE_ENTRYPOINT_TOO_LARGE: Instructions 超过 256 KiB".into())
        }
        Ok(_) => {}
    }
    let content = fs::read_to_string(path)
        .map_err(|_| "HOST_ASSET_SCAN_FAILED: 无法读取固定资产".to_string())?;
    let name = Path::new(relative)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("instructions")
        .to_string();
    let snapshot =
        asset_package::from_files(vec![PackageFile::text(name.clone(), content)], SKILL_LIMITS)?;
    budget.include(&snapshot)?;
    found(tool.tool_id, root, name.clone(), name, snapshot).map(Some)
}

fn scan_skills(
    home: &Path,
    tool: ToolAssets,
    root: Root,
    relative: &str,
    budget: &mut ScanBudget,
    result: &mut ToolItems,
) -> Result<(), String> {
    let path = joined(home, relative);
    let metadata = match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("HOST_ASSET_SCAN_FAILED: 无法检查固定 Skill 位置".into()),
        Ok(metadata) => metadata,
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("HOST_ASSET_SCAN_REJECTED: 固定 Skill 位置必须是普通目录".into());
    }
    let entries = fs::read_dir(path)
        .map_err(|_| "HOST_ASSET_SCAN_FAILED: 无法读取固定 Skill 位置".to_string())?;
    let mut package_keys = Vec::new();
    for item in entries {
        if budget.exhausted {
            break;
        }
        let item = item.map_err(|_| "HOST_ASSET_SCAN_FAILED: 无法枚举 Skill".to_string())?;
        let Some(key) = item.file_name().to_str().map(str::to_string) else {
            push_scan_diagnostic(
                &mut result.diagnostics,
                budget,
                "HOST_ASSET_SCAN_REJECTED: Skill 名称必须是 UTF-8",
            );
            continue;
        };
        if key.starts_with('.') {
            continue;
        }
        let normalized_key = match normalized_package_key(&key) {
            Ok(value) => value,
            Err(error) => {
                push_scan_diagnostic(&mut result.diagnostics, budget, &error);
                continue;
            }
        };
        if package_keys.contains(&normalized_key) {
            push_scan_diagnostic(
                &mut result.diagnostics,
                budget,
                "HOST_ASSET_SCAN_REJECTED: Skill 名称存在大小写折叠冲突",
            );
            continue;
        }
        package_keys.push(normalized_key);
        let snapshot = match asset_package::read_directory(&item.path(), SKILL_LIMITS) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                push_scan_diagnostic(&mut result.diagnostics, budget, &error);
                continue;
            }
        };
        if let Err(error) = budget.include(&snapshot) {
            push_scan_diagnostic(&mut result.diagnostics, budget, &error);
            break;
        }
        match found(
            tool.tool_id,
            root,
            key.clone(),
            format!("{relative}/{key}"),
            snapshot,
        ) {
            Ok(item) => result.found.push(item),
            Err(error) => push_scan_diagnostic(&mut result.diagnostics, budget, &error),
        }
    }
    Ok(())
}

fn scan_tool(home: &Path, tool: ToolAssets, budget: &mut ScanBudget) -> Result<ToolItems, String> {
    let mut result = ToolItems {
        found: Vec::new(),
        diagnostics: Vec::new(),
    };
    for root in tool.roots {
        if budget.exhausted {
            break;
        }
        match root.shape {
            RootShape::Instructions(relative) => {
                if let Some(item) = scan_instructions(home, tool, *root, relative, budget)? {
                    result.found.push(item);
                }
            }
            RootShape::Skills(relative) => {
                scan_skills(home, tool, *root, relative, budget, &mut result)?;
            }
        }
    }
    Ok(result)
}

fn scan_failure(error: &str) -> DiagnosticDto {
    let code = error.split(':').next().unwrap_or("HOST_ASSET_SCAN_FAILED");
    local_service::diagnostic(
        code,
        "error",
        "该工具的固定资产位置扫描失败",
        None,
        Some("检查固定目录中的链接、特殊文件、敏感内容或大小限制"),
    )
}

fn scan_selected(
    home: &Path,
    tool_ids: &[BuiltInClientId],
) -> Result<(String, Vec<Found>, Vec<ToolScanDto>), String> {
    let mut selected = Vec::new();
    for tool_id in tool_ids {
        if selected.contains(tool_id) {
            return Err("HOST_ASSET_REQUEST_INVALID: toolIds 不能为空或重复".into());
        }
        selected.push(*tool_id);
    }
    if selected.is_empty() {
        return Err("HOST_ASSET_REQUEST_INVALID: toolIds 不能为空或重复".into());
    }
    if selected
        .iter()
        .any(|id| !TOOLS.iter().any(|tool| tool.tool_id == *id))
    {
        return Err("HOST_ASSET_REQUEST_INVALID: 包含未知工具".into());
    }
    let mut all = Vec::new();
    let mut tools = Vec::new();
    let mut budget = ScanBudget::default();
    for tool in TOOLS
        .into_iter()
        .filter(|tool| selected.contains(&tool.tool_id))
    {
        match scan_tool(home, tool, &mut budget) {
            Ok(items) => {
                let check_state = if budget.exhausted || !items.diagnostics.is_empty() {
                    "partial"
                } else {
                    "ready"
                };
                tools.push(ToolScanDto {
                    catalog: entry(tool),
                    check_state,
                    asset_count: items.found.len(),
                    diagnostics: items.diagnostics,
                });
                all.extend(items.found);
            }
            Err(error) => {
                let diagnostic = scan_failure(&error);
                tools.push(ToolScanDto {
                    catalog: entry(tool),
                    check_state: "failed",
                    asset_count: 0,
                    diagnostics: vec![diagnostic],
                });
            }
        }
        if budget.exhausted {
            break;
        }
    }
    all.sort_by(|a, b| a.summary.host_instance_id.cmp(&b.summary.host_instance_id));
    let mut generation_parts = TOOLS
        .iter()
        .filter(|tool| selected.contains(&tool.tool_id))
        .flat_map(|tool| {
            let state = tools
                .iter()
                .find(|scan| scan.catalog.tool_id == tool.tool_id)
                .map_or("failed", |scan| scan.check_state);
            if tool.roots.is_empty() {
                vec![format!("tool:{:?}:root:none:{state}", tool.tool_id)]
            } else {
                tool.roots
                    .iter()
                    .map(|root| format!("tool:{:?}:root:{}:{state}", tool.tool_id, root.id))
                    .collect()
            }
        })
        .collect::<Vec<_>>();
    generation_parts.sort();
    generation_parts.extend(all.iter().map(|item| {
        format!(
            "asset:{:?}:{}:{}:{}",
            item.summary.tool_id,
            item.summary.root_id,
            item.summary.package_key.to_lowercase(),
            item.summary.package.package_fingerprint
        )
    }));
    let generation = local_service::stable_id("host-scan", &generation_parts.join("\n"));
    Ok((generation, all, tools))
}

pub(crate) fn scan(home: &Path, request: ScanRequest) -> Result<ScanResultDto, String> {
    crate::ai_tool_host::validate_request_id(&request.request_id)?;
    let (generation, found, tools) = scan_selected(home, &request.tool_ids)?;
    let targets = found
        .iter()
        .map(|item| {
            (
                item.summary.host_instance_id.clone(),
                ScanTargetRecord {
                    tool_id: item.summary.tool_id,
                    root_id: item.summary.root_id.clone(),
                    package_key: item.summary.package_key.clone(),
                    fingerprint: item.snapshot.fingerprint.clone(),
                },
            )
        })
        .collect();
    let now = SystemTime::now();
    let mut records = scans()
        .lock()
        .map_err(|_| "HOST_ASSET_SCAN_UNAVAILABLE".to_string())?;
    prune_scans(&mut records, now);
    records.insert(
        generation.clone(),
        ScanRecord {
            targets,
            expires_at: now + SCAN_TTL,
        },
    );
    Ok(ScanResultDto {
        request_id: request.request_id,
        scan_generation: generation,
        tools,
        assets: found.into_iter().map(|item| item.summary).collect(),
        diagnostics: Vec::new(),
    })
}

fn locate_target(home: &Path, target: &ScanTargetRecord) -> Result<Found, String> {
    let tool = TOOLS
        .into_iter()
        .find(|tool| tool.tool_id == target.tool_id)
        .ok_or_else(|| "HOST_ASSET_SCAN_EXPIRED: 工具不在固定 catalog".to_string())?;
    let root = tool
        .roots
        .iter()
        .find(|root| root.id == target.root_id)
        .copied()
        .ok_or_else(|| "HOST_ASSET_SCAN_EXPIRED: root 不在固定 catalog".to_string())?;
    let mut budget = ScanBudget::default();
    let current = match root.shape {
        RootShape::Instructions(relative) => {
            scan_instructions(home, tool, root, relative, &mut budget)?
        }
        RootShape::Skills(relative) => {
            let mut items = ToolItems {
                found: Vec::new(),
                diagnostics: Vec::new(),
            };
            scan_skills(home, tool, root, relative, &mut budget, &mut items)?;
            items.found.into_iter().find(|item| {
                item.summary
                    .package_key
                    .eq_ignore_ascii_case(&target.package_key)
            })
        }
    }
    .ok_or_else(|| "HOST_ASSET_NOT_FOUND: 固定资产实例不存在".to_string())?;
    if current.snapshot.fingerprint != target.fingerprint {
        return Err("HOST_ASSET_BASELINE_CHANGED: 目标资产已变化".into());
    }
    Ok(current)
}

fn locate(home: &Path, request: &DetailRequest) -> Result<Found, String> {
    crate::ai_tool_host::validate_request_id(&request.request_id)?;
    let now = SystemTime::now();
    let target = {
        let mut records = scans()
            .lock()
            .map_err(|_| "HOST_ASSET_SCAN_UNAVAILABLE".to_string())?;
        prune_scans(&mut records, now);
        records
            .get(&request.scan_generation)
            .and_then(|record| record.targets.get(&request.host_instance_id))
            .cloned()
            .ok_or_else(|| "HOST_ASSET_SCAN_EXPIRED: 扫描引用不存在".to_string())?
    };
    locate_target(home, &target)
}

pub(crate) fn detail(home: &Path, request: DetailRequest) -> Result<DetailDto, String> {
    let found = locate(home, &request)?;
    let entrypoint = found.summary.package.entrypoint.clone();
    let entrypoint_content = found
        .snapshot
        .files
        .iter()
        .find(|file| file.path == entrypoint || file.path == "SKILL.md")
        .ok_or_else(|| "HOST_ASSET_INVALID: 入口文件缺失".to_string())?
        .utf8()?
        .to_string();
    let files = found
        .snapshot
        .files
        .iter()
        .map(|file| FileDto {
            relative_path: file.path.clone(),
            size: file.bytes.len(),
        })
        .collect();
    Ok(DetailDto {
        summary: found.summary,
        entrypoint_content,
        files,
    })
}

pub(crate) fn preview(home: &Path, request: PreviewRequest) -> Result<PreviewDto, String> {
    if request.action != "import" {
        return Err("HOST_ASSET_ACTION_UNSUPPORTED: 当前仅支持导入 Bandi".into());
    }
    let asset_id = request.asset_id.clone();
    let found = locate(
        home,
        &DetailRequest {
            request_id: request.request_id.clone(),
            host_instance_id: request.host_instance_id.clone(),
            scan_generation: request.scan_generation.clone(),
        },
    )?;
    if found.summary.kind != "skill" {
        return Err("HOST_ASSET_ACTION_UNSUPPORTED: 当前仅支持导入 Skill 包".into());
    }
    let expires_at = SystemTime::now() + PREVIEW_TTL;
    let preview_ref = local_service::stable_id(
        "host-preview",
        &format!(
            "{}:{}:{}",
            request.request_id,
            found.snapshot.fingerprint,
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ),
    );
    let mut records = previews()
        .lock()
        .map_err(|_| "HOST_ASSET_PREVIEW_UNAVAILABLE".to_string())?;
    prune_previews(&mut records, SystemTime::now());
    records.insert(
        preview_ref.clone(),
        PreviewRecord {
            tool_id: found.summary.tool_id,
            root_id: found.summary.root_id.clone(),
            package_key: found.summary.package_key.clone(),
            source_fingerprint: found.snapshot.fingerprint.clone(),
            name: found.summary.name.clone(),
            team_id: request.team_id.clone(),
            asset_id: asset_id.clone(),
            expires_at,
        },
    );
    Ok(PreviewDto {
        request_id: request.request_id,
        host_instance_id: request.host_instance_id,
        scan_generation: request.scan_generation,
        action: "import",
        team_id: request.team_id,
        asset_id: asset_id.clone(),
        preview_ref,
        expires_at: chrono::DateTime::<Utc>::from(expires_at).to_rfc3339(),
        confirmation_text: format!("导入 Skill {asset_id}"),
        source_fingerprint: found.snapshot.fingerprint,
        diagnostics: Vec::new(),
    })
}

fn rescan_preview_source(home: &Path, record: &PreviewRecord) -> Result<Found, String> {
    let tool = TOOLS
        .into_iter()
        .find(|tool| tool.tool_id == record.tool_id)
        .ok_or_else(|| "HOST_ASSET_PREVIEW_INVALID: 工具不在固定 catalog".to_string())?;
    if !tool.roots.iter().any(|root| root.id == record.root_id) {
        return Err("HOST_ASSET_PREVIEW_INVALID: root 不在固定 catalog".into());
    }
    let mut budget = ScanBudget::default();
    scan_tool(home, tool, &mut budget)?
        .found
        .into_iter()
        .find(|found| {
            found.summary.root_id == record.root_id
                && found
                    .summary
                    .package_key
                    .eq_ignore_ascii_case(&record.package_key)
        })
        .ok_or_else(|| "HOST_ASSET_SOURCE_CHANGED: 固定来源已不存在".to_string())
}

pub(crate) fn commit_import(
    home: &Path,
    database: &Path,
    root: &Path,
    revisions: &Path,
    request: CommitRequest,
) -> Result<shared_assets::SharedAssetMutationResult, String> {
    if request.action != "import" || !request.confirmed {
        return Err("HOST_ASSET_CONFIRMATION_REQUIRED: 导入未确认".into());
    }
    crate::ai_tool_host::validate_request_id(&request.request_id)?;
    let record = {
        let mut records = previews()
            .lock()
            .map_err(|_| "HOST_ASSET_PREVIEW_UNAVAILABLE".to_string())?;
        prune_previews(&mut records, SystemTime::now());
        records
            .remove(&request.preview_ref)
            .ok_or_else(|| "HOST_ASSET_PREVIEW_EXPIRED: 预览不存在或已使用".to_string())?
    };
    if SystemTime::now() > record.expires_at
        || request.source_fingerprint != record.source_fingerprint
    {
        return Err("HOST_ASSET_PREVIEW_EXPIRED: 预览已过期或不匹配".into());
    }
    let current = rescan_preview_source(home, &record)?;
    if current.snapshot.fingerprint != record.source_fingerprint {
        return Err("HOST_ASSET_SOURCE_CHANGED: 来源在预览后发生变化".into());
    }
    let content = current
        .snapshot
        .files
        .iter()
        .find(|file| file.path == "SKILL.md")
        .ok_or_else(|| "HOST_ASSET_INVALID: SKILL.md 缺失".to_string())?
        .utf8()?
        .to_string();
    shared_assets::create_at(
        database,
        root,
        revisions,
        shared_assets::CreateSharedAssetRequest {
            request_id: request.request_id,
            team_id: record.team_id,
            asset_id: record.asset_id,
            name: record.name.clone(),
            kind: "skill".into(),
            content,
        },
        SharedAssetSourceDto::Imported {
            file_name: record.name,
            imported_hash: current.snapshot.fingerprint.clone(),
            imported_at: Utc::now().to_rfc3339(),
        },
        Some(&current.snapshot),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_never_exposes_unimplemented_writes() {
        let catalog = catalog();
        assert_eq!(catalog.tools.len(), 9);
        assert!(catalog
            .tools
            .iter()
            .all(|tool| !tool.capabilities.can_install_from_bandi
                && !tool.capabilities.can_update_from_bandi));
    }

    #[test]
    fn scan_is_fixed_and_rejects_symlinked_packages() {
        let home = tempfile::tempdir().unwrap();
        fs::create_dir_all(home.path().join(".claude/skills/review")).unwrap();
        fs::write(
            home.path().join(".claude/skills/review/SKILL.md"),
            "# Review",
        )
        .unwrap();
        let result = scan(
            home.path(),
            ScanRequest {
                request_id: "scan-1".into(),
                tool_ids: vec![BuiltInClientId::ClaudeCode],
            },
        )
        .unwrap();
        assert_eq!(result.assets.len(), 1);
        assert_eq!(result.assets[0].relative_location, ".claude/skills/review");
    }

    #[test]
    fn oversized_instructions_are_rejected_before_reading() {
        let home = tempfile::tempdir().unwrap();
        let instructions = home.path().join(".claude/CLAUDE.md");
        fs::create_dir_all(instructions.parent().unwrap()).unwrap();
        let file = fs::File::create(&instructions).unwrap();
        file.set_len(SKILL_ENTRYPOINT_LIMIT + 1).unwrap();

        let error = match scan_tool(home.path(), TOOLS[0], &mut ScanBudget::default()) {
            Ok(_) => panic!("oversized instructions were accepted"),
            Err(error) => error,
        };
        assert!(error.contains("ENTRYPOINT_TOO_LARGE"));
        assert!(!error.contains(home.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn identity_is_stable_generation_changes_and_failures_are_isolated() {
        let home = tempfile::tempdir().unwrap();
        let skill = home.path().join(".claude/skills/review");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# Before").unwrap();
        fs::create_dir_all(home.path().join(".codex/skills/broken")).unwrap();
        fs::write(
            home.path().join(".codex/skills/broken/not-a-directory"),
            "x",
        )
        .unwrap();

        let first = scan_selected(
            home.path(),
            &[BuiltInClientId::ClaudeCode, BuiltInClientId::Codex],
        )
        .unwrap();
        assert_eq!(first.1.len(), 1);
        assert_eq!(first.2[1].check_state, "partial");
        assert_eq!(first.2[1].diagnostics.len(), 1);
        let stable_id = first.1[0].summary.host_instance_id.clone();
        fs::write(skill.join("SKILL.md"), "# After").unwrap();
        let second = scan_selected(
            home.path(),
            &[BuiltInClientId::ClaudeCode, BuiltInClientId::Codex],
        )
        .unwrap();
        assert_eq!(stable_id, second.1[0].summary.host_instance_id);
        assert_ne!(first.0, second.0);
        assert_ne!(
            scan_selected(home.path(), &[BuiltInClientId::ClaudeCode])
                .unwrap()
                .0,
            scan_selected(home.path(), &[BuiltInClientId::GeminiCli])
                .unwrap()
                .0
        );
    }

    #[test]
    fn target_detail_survives_sibling_change() {
        let home = tempfile::tempdir().unwrap();
        let first = home.path().join(".claude/skills/first");
        let sibling = home.path().join(".claude/skills/sibling");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&sibling).unwrap();
        fs::write(first.join("SKILL.md"), "# First").unwrap();
        fs::write(sibling.join("SKILL.md"), "# Sibling").unwrap();
        let scanned = scan(
            home.path(),
            ScanRequest {
                request_id: "scan-target".into(),
                tool_ids: vec![BuiltInClientId::ClaudeCode],
            },
        )
        .unwrap();
        let target = scanned
            .assets
            .iter()
            .find(|asset| asset.package_key == "first")
            .unwrap();
        fs::write(sibling.join("SKILL.md"), "# Changed sibling").unwrap();
        let loaded = detail(
            home.path(),
            DetailRequest {
                request_id: "detail-target".into(),
                host_instance_id: target.host_instance_id.clone(),
                scan_generation: scanned.scan_generation,
            },
        )
        .unwrap();
        assert_eq!(loaded.entrypoint_content, "# First");
    }

    #[test]
    fn stale_preview_source_is_rejected() {
        let home = tempfile::tempdir().unwrap();
        let skill = home.path().join(".claude/skills/review");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# Before").unwrap();
        let found = scan_tool(home.path(), TOOLS[0], &mut ScanBudget::default())
            .unwrap()
            .found
            .remove(0);
        let record = PreviewRecord {
            tool_id: BuiltInClientId::ClaudeCode,
            root_id: found.summary.root_id,
            package_key: found.summary.package_key,
            source_fingerprint: found.snapshot.fingerprint,
            name: found.summary.name,
            team_id: "team".into(),
            asset_id: "asset".into(),
            expires_at: SystemTime::now() + PREVIEW_TTL,
        };
        fs::write(skill.join("SKILL.md"), "# After").unwrap();
        let current = rescan_preview_source(home.path(), &record).unwrap();
        assert_ne!(current.snapshot.fingerprint, record.source_fingerprint);
    }

    #[test]
    fn import_lifecycle_preserves_package_and_rejects_changed_source() {
        let home = tempfile::tempdir().unwrap();
        let skill = home.path().join(".claude/skills/review");
        fs::create_dir_all(skill.join("references")).unwrap();
        fs::create_dir_all(skill.join("assets")).unwrap();
        fs::write(skill.join("SKILL.md"), "# Review\n").unwrap();
        fs::write(skill.join("references/check.md"), "Checklist\n").unwrap();
        fs::write(skill.join("assets/data.bin"), [0, 159, 146, 150]).unwrap();

        let scanned = scan(
            home.path(),
            ScanRequest {
                request_id: "scan-lifecycle".into(),
                tool_ids: vec![BuiltInClientId::ClaudeCode],
            },
        )
        .unwrap();
        assert_eq!(scanned.assets.len(), 1);
        let host_instance_id = scanned.assets[0].host_instance_id.clone();
        let detail = detail(
            home.path(),
            DetailRequest {
                request_id: "detail-lifecycle".into(),
                host_instance_id: host_instance_id.clone(),
                scan_generation: scanned.scan_generation.clone(),
            },
        )
        .unwrap();
        assert_eq!(detail.entrypoint_content, "# Review\n");
        assert_eq!(detail.files.len(), 3);

        let prepared = preview(
            home.path(),
            PreviewRequest {
                request_id: "preview-lifecycle".into(),
                host_instance_id: host_instance_id.clone(),
                scan_generation: scanned.scan_generation.clone(),
                action: "import".into(),
                team_id: "team-personal".into(),
                asset_id: "skill-host-review".into(),
            },
        )
        .unwrap();
        let storage = tempfile::tempdir().unwrap();
        let database = storage.path().join("bandi.db");
        let root = storage.path().join("shared-assets");
        let revisions = storage.path().join("revisions");
        let result = commit_import(
            home.path(),
            &database,
            &root,
            &revisions,
            CommitRequest {
                request_id: "commit-lifecycle".into(),
                action: "import".into(),
                preview_ref: prepared.preview_ref,
                source_fingerprint: prepared.source_fingerprint,
                confirmed: true,
            },
        )
        .unwrap();
        assert!(matches!(
            result,
            shared_assets::SharedAssetMutationResult::Saved { .. }
        ));
        assert_eq!(
            fs::read(root.join("skill-host-review/assets/data.bin")).unwrap(),
            vec![0, 159, 146, 150]
        );
        let manifest = fs::read_to_string(root.join("skill-host-review/asset.yaml")).unwrap();
        assert!(manifest.contains("kind: imported"));
        assert!(manifest.contains("importedHash:"));

        let changed = preview(
            home.path(),
            PreviewRequest {
                request_id: "preview-changed".into(),
                host_instance_id,
                scan_generation: scanned.scan_generation,
                action: "import".into(),
                team_id: "team-personal".into(),
                asset_id: "skill-host-changed".into(),
            },
        )
        .unwrap();
        fs::write(skill.join("SKILL.md"), "# Changed\n").unwrap();
        let error = commit_import(
            home.path(),
            &database,
            &root,
            &revisions,
            CommitRequest {
                request_id: "commit-changed".into(),
                action: "import".into(),
                preview_ref: changed.preview_ref,
                source_fingerprint: changed.source_fingerprint,
                confirmed: true,
            },
        )
        .unwrap_err();
        assert!(error.contains("SOURCE_CHANGED"));
        assert!(!root.join("skill-host-changed").exists());
    }

    #[test]
    fn requests_reject_arbitrary_paths() {
        assert!(serde_json::from_value::<ScanRequest>(
            serde_json::json!({"requestId":"r","toolIds":["claude-code"],"path":"/tmp"})
        )
        .is_err());
        assert!(serde_json::from_value::<DetailRequest>(serde_json::json!({"requestId":"r","hostInstanceId":"h","scanGeneration":"g","path":"/tmp"})).is_err());
    }
}
