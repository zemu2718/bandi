use std::{
    collections::HashSet,
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};

use crate::{
    config_fs::restricted_atomic_write,
    domain_store::LongTermDomainSnapshotDtoV4,
    shared_assets::{self, SharedAssetNodeDto},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const PROFILE_VERSION: &str = "agent-package-v1";
const CURRENT_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiagnosticDto {
    pub(crate) code: String,
    pub(crate) severity: String,
    pub(crate) message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) remediation: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RootKind {
    Managed,
    Bandi,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AssetLocatorDto {
    pub(crate) root_kind: RootKind,
    pub(crate) display_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) relative_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceContainerDto {
    pub(crate) id: String,
    pub(crate) locator: AssetLocatorDto,
    pub(crate) format: String,
    pub(crate) content_hash: String,
    pub(crate) writable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) read_only_reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceAssetSummaryDto {
    pub(crate) id: String,
    pub(crate) container_id: String,
    pub(crate) agent_id: String,
    pub(crate) team_id: String,
    pub(crate) kind: String,
    pub(crate) official_scope: String,
    pub(crate) asset_content_hash: String,
    pub(crate) container_content_hash: String,
    pub(crate) writable: bool,
    pub(crate) parse_status: String,
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BaselineRefDto {
    pub(crate) id: String,
    pub(crate) asset_id: String,
    pub(crate) container_id: String,
    pub(crate) asset_content_hash: String,
    pub(crate) container_content_hash: String,
    #[serde(default = "default_true", skip_serializing_if = "is_true")]
    pub(crate) target_exists: bool,
}

fn default_true() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiscoveryRequest {
    pub(crate) request_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DiscoveryResult {
    pub(crate) request_id: String,
    pub(crate) profile_version: String,
    pub(crate) containers: Vec<SourceContainerDto>,
    pub(crate) assets: Vec<SourceAssetSummaryDto>,
    pub(crate) shared_assets: Vec<SharedAssetNodeDto>,
    pub(crate) references: Vec<AssetReferenceDto>,
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AssetReferenceDto {
    pub(crate) source_asset_id: String,
    pub(crate) source_container_id: String,
    pub(crate) referrer_kind: String,
    pub(crate) referrer_id: String,
    pub(crate) target_asset_id: String,
    pub(crate) target_kind: String,
    pub(crate) state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_locator: Option<AssetLocatorDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) target_team_id: Option<String>,
    pub(crate) source_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadEditorRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadEditorResult {
    pub(crate) request_id: String,
    pub(crate) asset: SourceAssetSummaryDto,
    pub(crate) canonical_content: String,
    pub(crate) redacted: bool,
    pub(crate) baseline_ref: BaselineRefDto,
    pub(crate) diagnostics: Vec<DiagnosticDto>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum ConfigChangeDto {
    Instructions { value: String },
    Context { value: String },
    Rules { value: String },
    Skills { value: String },
    Mcp { value: String },
    Permissions { value: String },
    Sop { value: String },
    Hooks { value: String },
    Commands { value: String },
}

impl ConfigChangeDto {
    fn kind(&self) -> &'static str {
        match self {
            Self::Instructions { .. } => "instructions",
            Self::Context { .. } => "context",
            Self::Rules { .. } => "rules",
            Self::Skills { .. } => "skills",
            Self::Mcp { .. } => "mcp",
            Self::Permissions { .. } => "permissions",
            Self::Sop { .. } => "sop",
            Self::Hooks { .. } => "hooks",
            Self::Commands { .. } => "commands",
        }
    }

    fn value(self) -> String {
        match self {
            Self::Instructions { value }
            | Self::Context { value }
            | Self::Rules { value }
            | Self::Skills { value }
            | Self::Mcp { value }
            | Self::Permissions { value }
            | Self::Sop { value }
            | Self::Hooks { value }
            | Self::Commands { value } => value,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContextPolicyDocument {
    schema_version: u64,
    context_policy: ContextPolicyDto,
    #[serde(default = "default_context_window_tokens")]
    context_window_tokens: u64,
    output_profile_id: String,
    output_parameter_bindings: Vec<ParameterBindingDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ContextPolicyDto {
    enabled: bool,
    trigger_ratio: f64,
    target_ratio: f64,
    protect_recent_turns: u64,
    protect_opening_turns: u64,
}

const fn default_context_window_tokens() -> u64 {
    200_000
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RulesDocument {
    schema_version: u64,
    rules: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SkillsDocument {
    schema_version: u64,
    skills: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct McpDocument {
    schema_version: u64,
    mcp: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SopDocument {
    schema_version: u64,
    sop: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HookReferencesDocument {
    schema_version: u64,
    hooks: Vec<ComponentReferenceDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CommandReferencesDocument {
    schema_version: u64,
    commands: Vec<ComponentReferenceDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ComponentReferenceDto {
    asset_id: String,
    parameter_bindings: Vec<ParameterBindingDto>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PermissionsDocument {
    schema_version: u64,
    permissions: PermissionsDto,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PermissionsDto {
    files: String,
    commands: String,
    network: String,
    delegation: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum ParameterBindingDto {
    String {
        #[serde(rename = "parameterId")]
        parameter_id: String,
        value: String,
    },
    Number {
        #[serde(rename = "parameterId")]
        parameter_id: String,
        value: f64,
    },
    Boolean {
        #[serde(rename = "parameterId")]
        parameter_id: String,
        value: bool,
    },
    StringList {
        #[serde(rename = "parameterId")]
        parameter_id: String,
        value: Vec<String>,
    },
    Enum {
        #[serde(rename = "parameterId")]
        parameter_id: String,
        value: String,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveConfigOwnerDto {
    pub(crate) agent_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveConfigRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
    pub(crate) expected_owner: SaveConfigOwnerDto,
    pub(crate) change: ConfigChangeDto,
    pub(crate) expected_baseline: BaselineRefDto,
    pub(crate) base_content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) confirmation_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfirmationChallengeDto {
    pub(crate) id: String,
    pub(crate) asset_id: String,
    pub(crate) proposed_content_hash: String,
    pub(crate) expires_at: String,
    pub(crate) reason: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfirmationRecord {
    id: String,
    asset_id: String,
    proposed_content_hash: String,
    baseline_asset_hash: String,
    expires_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WriteReceiptDto {
    pub(crate) id: String,
    pub(crate) container_id: String,
    pub(crate) previous_container_hash: String,
    pub(crate) written_container_hash: String,
    pub(crate) verified_at: String,
    pub(crate) atomic_replace: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfigRevisionDto {
    pub(crate) id: String,
    pub(crate) asset_id: String,
    pub(crate) container_id: String,
    pub(crate) locator: AssetLocatorDto,
    pub(crate) asset_content_hash: String,
    pub(crate) container_content_hash: String,
    pub(crate) source_asset_baseline_hash: String,
    pub(crate) source_container_baseline_hash: String,
    pub(crate) redacted: bool,
    pub(crate) write_receipt_id: String,
    pub(crate) saved_at: String,
    pub(crate) summary: String,
    pub(crate) confirmation_refs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) restored_from_revision_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoreConfigRevisionRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
    pub(crate) revision_id: String,
    pub(crate) expected_baseline: BaselineRefDto,
    pub(crate) base_content: String,
    pub(crate) confirmed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) confirmation_ref: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecoverConfigRevisionRequest {
    pub(crate) request_id: String,
    pub(crate) asset_id: String,
    pub(crate) recovery_ref: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum SaveConfigResult {
    Saved {
        #[serde(rename = "requestId")]
        request_id: String,
        asset: SourceAssetSummaryDto,
        revision: Box<ConfigRevisionDto>,
        #[serde(rename = "writeReceipt")]
        write_receipt: WriteReceiptDto,
    },
    Unchanged {
        #[serde(rename = "requestId")]
        request_id: String,
        asset: SourceAssetSummaryDto,
    },
    BaselineChanged {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "assetId")]
        asset_id: String,
        #[serde(rename = "containerId")]
        container_id: String,
        locator: AssetLocatorDto,
        base: ConfigSideDto,
        current: ConfigSideDto,
        proposed: ConfigSideDto,
        diagnostics: Vec<DiagnosticDto>,
    },
    ConfirmationRequired {
        #[serde(rename = "requestId")]
        request_id: String,
        challenge: ConfirmationChallengeDto,
        #[serde(
            rename = "affectedAgentIds",
            default,
            skip_serializing_if = "Vec::is_empty"
        )]
        affected_agent_ids: Vec<String>,
        diagnostics: Vec<DiagnosticDto>,
    },
    ValidationFailed {
        #[serde(rename = "requestId")]
        request_id: String,
        diagnostics: Vec<DiagnosticDto>,
    },
    SaveFailed {
        #[serde(rename = "requestId")]
        request_id: String,
        diagnostics: Vec<DiagnosticDto>,
        retryable: bool,
        #[serde(rename = "fileState")]
        file_state: String,
        #[serde(rename = "recoveryRef", skip_serializing_if = "Option::is_none")]
        recovery_ref: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfigSideDto {
    pub(crate) content: String,
    pub(crate) asset_content_hash: String,
    pub(crate) container_content_hash: String,
    pub(crate) redacted: bool,
}

struct DiscoveredAsset {
    summary: SourceAssetSummaryDto,
    container: SourceContainerDto,
    content: String,
    target: PathBuf,
    target_exists: bool,
}

pub(crate) fn diagnostic(
    code: &str,
    severity: &str,
    message: &str,
    path: Option<String>,
    remediation: Option<&str>,
) -> DiagnosticDto {
    DiagnosticDto {
        code: code.into(),
        severity: severity.into(),
        message: message.into(),
        source: None,
        field: None,
        path,
        remediation: remediation.map(str::to_owned),
    }
}

fn diagnostic_for_source(
    source: &str,
    code: &str,
    severity: &str,
    message: &str,
    path: Option<String>,
    remediation: Option<&str>,
) -> DiagnosticDto {
    DiagnosticDto {
        source: Some(source.into()),
        ..diagnostic(code, severity, message, path, remediation)
    }
}

pub(crate) fn hash_bytes(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

pub(crate) fn stable_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{:x}", Sha256::digest(value.as_bytes()))
}

fn validate_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
}

const REJECTED_AGENT_FIELDS: &[&str] = &[
    "roleId",
    "primaryDepartmentId",
    "managerAgentId",
    "orchestrationPolicy",
    "serviceGrants",
    "department",
];

fn contains_rejected_agent_field(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    REJECTED_AGENT_FIELDS
        .iter()
        .any(|field| object.contains_key(*field))
}

pub(crate) fn manifest_facts(path: &Path) -> Result<(String, String, u64), Box<DiagnosticDto>> {
    let content = fs::read_to_string(path).map_err(|_| {
        Box::new(diagnostic(
            "manifest_unreadable",
            "error",
            "无法读取 agent.yaml",
            Some("agent.yaml".into()),
            Some("检查文件权限和 AgentPackage 完整性"),
        ))
    })?;
    let manifest: serde_yaml::Value = serde_yaml::from_str(&content).map_err(|_| {
        Box::new(diagnostic(
            "manifest_invalid",
            "error",
            "agent.yaml 不是有效 YAML",
            Some("agent.yaml".into()),
            Some("修正 manifest 后重新发现"),
        ))
    })?;
    let manifest_object = manifest.as_mapping().ok_or_else(|| {
        Box::new(diagnostic(
            "manifest_invalid",
            "error",
            "agent.yaml 必须是对象",
            Some("agent.yaml".into()),
            Some("修正 manifest 后重新发现"),
        ))
    })?;
    if REJECTED_AGENT_FIELDS
        .iter()
        .any(|field| manifest_object.contains_key(serde_yaml::Value::String((*field).into())))
    {
        return Err(Box::new(diagnostic(
            "manifest_legacy_field_rejected",
            "error",
            "agent.yaml 含已移除的旧组织或编排字段",
            Some("agent.yaml".into()),
            Some("删除旧字段后重新发现；不会静默迁移"),
        )));
    }
    let id = manifest
        .get("id")
        .and_then(serde_yaml::Value::as_str)
        .filter(|id| validate_identifier(id))
        .ok_or_else(|| {
            Box::new(diagnostic(
                "manifest_id_invalid",
                "error",
                "agent.yaml 缺少有效稳定 id",
                Some("agent.yaml".into()),
                Some("补充与目录身份一致的稳定 id"),
            ))
        })?;
    let team_id = manifest
        .get("teamId")
        .and_then(serde_yaml::Value::as_str)
        .filter(|team_id| validate_identifier(team_id))
        .ok_or_else(|| {
            Box::new(diagnostic(
                "manifest_team_id_invalid",
                "error",
                "agent.yaml 缺少有效的 Team 稳定标识",
                Some("agent.yaml".into()),
                Some("补充有效的 teamId 后重新发现"),
            ))
        })?;
    let version = manifest
        .get("schemaVersion")
        .and_then(serde_yaml::Value::as_u64)
        .ok_or_else(|| {
            Box::new(diagnostic(
                "package_unverified",
                "warning",
                "AgentPackage 缺少可验证的 schemaVersion",
                Some("agent.yaml".into()),
                Some("使用受支持的 AgentPackage v1 manifest"),
            ))
        })?;
    Ok((id.into(), team_id.into(), version))
}

fn validate_context_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: ContextPolicyDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "context_invalid",
            "error",
            "config/context.yaml 不符合冻结的 ContextPolicy schema",
            Some("config/context.yaml".into()),
            Some("修正 YAML 字段、类型和未知字段后重试"),
        ))
    })?;
    let policy = document.context_policy;
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || !policy.trigger_ratio.is_finite()
        || !(0.5..=0.95).contains(&policy.trigger_ratio)
        || !policy.target_ratio.is_finite()
        || !(0.2..=0.8).contains(&policy.target_ratio)
        || policy.target_ratio > policy.trigger_ratio - 0.1
        || policy.protect_recent_turns > 20
        || policy.protect_opening_turns > 10
        || !(1_000..=2_000_000).contains(&document.context_window_tokens)
        || document.output_profile_id.len() > 160
        || (!document.output_profile_id.is_empty()
            && !validate_identifier(&document.output_profile_id))
        || document.output_parameter_bindings.len() > 100
    {
        return Err(Box::new(diagnostic(
            "context_policy_invalid",
            "error",
            "上下文窗口、策略比例、轮次、版本或 OutputProfile 引用无效",
            Some("config/context.yaml".into()),
            Some("按页面允许范围修正 ContextPolicy 与 OutputProfile 引用"),
        )));
    }
    let mut ids = HashSet::new();
    for binding in document.output_parameter_bindings {
        let (parameter_id, valid_value) = match binding {
            ParameterBindingDto::String {
                parameter_id,
                value,
            }
            | ParameterBindingDto::Enum {
                parameter_id,
                value,
            } => {
                let valid = value.len() <= 16 * 1024 && !value.contains('\0');
                (parameter_id, valid)
            }
            ParameterBindingDto::Number {
                parameter_id,
                value,
            } => (parameter_id, value.is_finite()),
            ParameterBindingDto::Boolean {
                parameter_id,
                value,
            } => {
                let _ = value;
                (parameter_id, true)
            }
            ParameterBindingDto::StringList {
                parameter_id,
                value,
            } => {
                let valid = value.len() <= 100
                    && value
                        .iter()
                        .all(|item| item.len() <= 16 * 1024 && !item.contains('\0'));
                (parameter_id, valid)
            }
        };
        if !validate_identifier(&parameter_id) || !ids.insert(parameter_id) || !valid_value {
            return Err(Box::new(diagnostic(
                "output_parameter_binding_invalid",
                "error",
                "OutputProfile 参数绑定包含重复、非法标识或无效值",
                Some("config/context.yaml".into()),
                Some("修正参数绑定后重试"),
            )));
        }
    }
    let _ = policy.enabled;
    Ok(())
}

fn validate_rules_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: RulesDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "rules_invalid",
            "error",
            "config/rules.yaml 不符合冻结的 Rule 引用 schema",
            Some("config/rules.yaml".into()),
            Some("修正 YAML 字段、类型和未知字段后重试"),
        ))
    })?;
    let mut ids = HashSet::new();
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || document.rules.len() > 500
        || document
            .rules
            .iter()
            .any(|id| !validate_identifier(id) || !ids.insert(id.clone()))
    {
        return Err(Box::new(diagnostic(
            "rules_invalid",
            "error",
            "Rule 引用版本、数量、稳定标识或唯一性无效",
            Some("config/rules.yaml".into()),
            Some("只保留不重复的稳定 Rule 资产标识"),
        )));
    }
    Ok(())
}

fn validate_skills_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: SkillsDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "skills_invalid",
            "error",
            "config/skills.yaml 不符合冻结的 Skill 引用 schema",
            Some("config/skills.yaml".into()),
            Some("修正 YAML 字段、类型和未知字段后重试"),
        ))
    })?;
    let mut ids = HashSet::new();
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || document.skills.len() > 500
        || document
            .skills
            .iter()
            .any(|id| !validate_identifier(id) || !ids.insert(id.clone()))
    {
        return Err(Box::new(diagnostic(
            "skills_invalid",
            "error",
            "Skill 引用版本、数量、稳定标识或唯一性无效",
            Some("config/skills.yaml".into()),
            Some("只保留不重复的稳定 Skill 资产标识"),
        )));
    }
    Ok(())
}

fn validate_mcp_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: McpDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "mcp_invalid",
            "error",
            "config/mcp.yaml 不符合冻结的 MCP 引用 schema",
            Some("config/mcp.yaml".into()),
            Some("修正 YAML 字段、类型和未知字段后重试"),
        ))
    })?;
    let mut ids = HashSet::new();
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || document.mcp.len() > 500
        || document
            .mcp
            .iter()
            .any(|id| !validate_identifier(id) || !ids.insert(id.clone()))
    {
        return Err(Box::new(diagnostic(
            "mcp_invalid",
            "error",
            "MCP 引用版本、数量、稳定标识或唯一性无效",
            Some("config/mcp.yaml".into()),
            Some("只保留不重复的稳定 MCP 资产标识"),
        )));
    }
    Ok(())
}

fn validate_sop_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: SopDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "sop_invalid",
            "error",
            "config/sop.yaml 不符合冻结的 SOP 引用 schema",
            Some("config/sop.yaml".into()),
            Some("修正 YAML 字段、类型和未知字段后重试"),
        ))
    })?;
    let mut ids = HashSet::new();
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || document.sop.len() > 500
        || document
            .sop
            .iter()
            .any(|id| !validate_identifier(id) || !ids.insert(id.clone()))
    {
        return Err(Box::new(diagnostic(
            "sop_invalid",
            "error",
            "SOP 引用版本、数量、稳定标识或唯一性无效",
            Some("config/sop.yaml".into()),
            Some("只保留不重复的稳定 SOP 资产标识"),
        )));
    }
    Ok(())
}

fn validate_parameter_binding(binding: &ParameterBindingDto) -> bool {
    let (parameter_id, valid_value) = match binding {
        ParameterBindingDto::String {
            parameter_id,
            value,
        }
        | ParameterBindingDto::Enum {
            parameter_id,
            value,
        } => (parameter_id, value.len() <= 4096 && !value.contains('\0')),
        ParameterBindingDto::Number {
            parameter_id,
            value,
        } => (parameter_id, value.is_finite()),
        ParameterBindingDto::Boolean {
            parameter_id,
            value,
        } => {
            let _ = value;
            (parameter_id, true)
        }
        ParameterBindingDto::StringList {
            parameter_id,
            value,
        } => (
            parameter_id,
            value.len() <= 100
                && value
                    .iter()
                    .all(|item| item.len() <= 4096 && !item.contains('\0')),
        ),
    };
    validate_identifier(parameter_id) && valid_value
}

fn validate_hooks_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: HookReferencesDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "hooks_invalid",
            "error",
            "config/hooks.yaml 不符合冻结的 Hook 引用 schema",
            Some("config/hooks.yaml".into()),
            Some("只使用稳定 Hook 资产 ID 和受支持的非敏感参数绑定"),
        ))
    })?;
    let mut asset_ids = HashSet::new();
    let invalid = document.hooks.len() > 500
        || document.hooks.iter().any(|reference| {
            let mut parameter_ids = HashSet::new();
            !validate_identifier(&reference.asset_id)
                || !asset_ids.insert(reference.asset_id.clone())
                || reference.parameter_bindings.len() > 100
                || reference.parameter_bindings.iter().any(|binding| {
                    let parameter_id = match binding {
                        ParameterBindingDto::String { parameter_id, .. }
                        | ParameterBindingDto::Number { parameter_id, .. }
                        | ParameterBindingDto::Boolean { parameter_id, .. }
                        | ParameterBindingDto::StringList { parameter_id, .. }
                        | ParameterBindingDto::Enum { parameter_id, .. } => parameter_id,
                    };
                    !validate_parameter_binding(binding)
                        || !parameter_ids.insert(parameter_id.clone())
                })
        });
    if document.schema_version != CURRENT_SCHEMA_VERSION || invalid {
        return Err(Box::new(diagnostic(
            "hooks_invalid",
            "error",
            "Hook 引用版本、稳定标识、唯一性、数量或参数值无效",
            Some("config/hooks.yaml".into()),
            Some("引用最多 500 项；每项最多 100 个不重复的非敏感参数绑定"),
        )));
    }
    Ok(())
}

fn validate_component_references(references: &[ComponentReferenceDto]) -> bool {
    let mut asset_ids = HashSet::new();
    references.len() <= 500
        && !references.iter().any(|reference| {
            let mut parameter_ids = HashSet::new();
            !validate_identifier(&reference.asset_id)
                || !asset_ids.insert(reference.asset_id.clone())
                || reference.parameter_bindings.len() > 100
                || reference.parameter_bindings.iter().any(|binding| {
                    let parameter_id = match binding {
                        ParameterBindingDto::String { parameter_id, .. }
                        | ParameterBindingDto::Number { parameter_id, .. }
                        | ParameterBindingDto::Boolean { parameter_id, .. }
                        | ParameterBindingDto::StringList { parameter_id, .. }
                        | ParameterBindingDto::Enum { parameter_id, .. } => parameter_id,
                    };
                    !validate_parameter_binding(binding)
                        || !parameter_ids.insert(parameter_id.clone())
                })
        })
}

fn validate_commands_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    let document: CommandReferencesDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "commands_invalid",
            "error",
            "config/commands.yaml 不符合冻结的 Command 引用 schema",
            Some("config/commands.yaml".into()),
            Some("只使用稳定 Command 资产 ID 和受支持的非敏感参数绑定"),
        ))
    })?;
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || !validate_component_references(&document.commands)
    {
        return Err(Box::new(diagnostic(
            "commands_invalid",
            "error",
            "Command 引用版本、稳定标识、唯一性、数量或参数值无效",
            Some("config/commands.yaml".into()),
            Some("引用最多 500 项；每项最多 100 个不重复的非敏感参数绑定"),
        )));
    }
    Ok(())
}

fn parse_permissions_document(content: &str) -> Result<PermissionsDocument, Box<DiagnosticDto>> {
    let document: PermissionsDocument = serde_yaml::from_str(content).map_err(|_| {
        Box::new(diagnostic(
            "permissions_invalid",
            "error",
            "config/permissions.yaml 不符合冻结的长期权限 schema",
            Some("config/permissions.yaml".into()),
            Some("修正 YAML 字段、类型和未知字段后重试"),
        ))
    })?;
    let values = [
        &document.permissions.files,
        &document.permissions.commands,
        &document.permissions.network,
        &document.permissions.delegation,
    ];
    if document.schema_version != CURRENT_SCHEMA_VERSION
        || values
            .iter()
            .any(|value| value.is_empty() || value.len() > 256 || value.contains('\0'))
    {
        return Err(Box::new(diagnostic(
            "permissions_invalid",
            "error",
            "长期权限版本或边界值无效",
            Some("config/permissions.yaml".into()),
            Some("每项使用 1 到 256 字节的非空权限边界说明"),
        )));
    }
    Ok(document)
}

fn validate_permissions_document(content: &str) -> Result<(), Box<DiagnosticDto>> {
    parse_permissions_document(content).map(|_| ())
}

fn validate_yaml_asset(kind: &str, content: &str) -> Result<(), Box<DiagnosticDto>> {
    match kind {
        "context" => validate_context_document(content),
        "rules" => validate_rules_document(content),
        "skills" => validate_skills_document(content),
        "mcp" => validate_mcp_document(content),
        "permissions" => validate_permissions_document(content),
        "sop" => validate_sop_document(content),
        "hooks" => validate_hooks_document(content),
        "commands" => validate_commands_document(content),
        _ => serde_yaml::from_str::<serde_yaml::Value>(content)
            .map(|_| ())
            .map_err(|_| {
                Box::new(diagnostic(
                    &format!("{kind}_invalid"),
                    "error",
                    "配置文件不是有效 YAML",
                    None,
                    Some("修正 YAML 后重试"),
                ))
            }),
    }
}

fn optional_managed_yaml_content(kind: &str) -> Option<&'static str> {
    match kind {
        "rules" => Some("schemaVersion: 1\nrules:\n  []\n"),
        "skills" => Some("schemaVersion: 1\nskills:\n  []\n"),
        "mcp" => Some("schemaVersion: 1\nmcp:\n  []\n"),
        "sop" => Some("schemaVersion: 1\nsop:\n  []\n"),
        "hooks" => Some("schemaVersion: 1\nhooks: []\n"),
        "commands" => Some("schemaVersion: 1\ncommands: []\n"),
        _ => None,
    }
}

fn discover_missing_managed_yaml_asset(
    discovered: &mut Vec<DiscoveredAsset>,
    package_path: &Path,
    agent_id: &str,
    team_id: &str,
    relative_path: &str,
    kind: &str,
    content: &str,
    current: bool,
    compatibility_reason: Option<&str>,
) {
    let target = package_path.join(relative_path);
    let hash = hash_bytes(content.as_bytes());
    let container_id = stable_id("container", &format!("managed:{agent_id}:{relative_path}"));
    let asset_id = stable_id("asset", &format!("managed:{agent_id}:{kind}"));
    let writable = current;
    let locator = AssetLocatorDto {
        root_kind: RootKind::Managed,
        display_path: target.to_string_lossy().into_owned(),
        relative_path: Some(format!("agt_{agent_id}/{relative_path}")),
    };
    discovered.push(DiscoveredAsset {
        container: SourceContainerDto {
            id: container_id.clone(),
            locator,
            format: "yaml".into(),
            content_hash: hash.clone(),
            writable,
            read_only_reason: compatibility_reason.map(str::to_owned),
        },
        summary: SourceAssetSummaryDto {
            id: asset_id,
            container_id,
            agent_id: agent_id.into(),
            team_id: team_id.into(),
            kind: kind.into(),
            official_scope: "managed".into(),
            asset_content_hash: hash.clone(),
            container_content_hash: hash,
            writable,
            parse_status: if current { "parsed" } else { "unsupported" }.into(),
            diagnostics: vec![diagnostic_for_source(
                &format!("agt_{agent_id}"),
                &format!("{kind}_not_materialized"),
                "info",
                &format!("AgentPackage 尚未创建 {relative_path}"),
                Some(relative_path.into()),
                Some("首次保存时安全创建该配置文件"),
            )],
        },
        content: content.into(),
        target,
        target_exists: false,
    });
}

#[allow(clippy::too_many_arguments)]
fn discover_managed_yaml_asset(
    discovered: &mut Vec<DiscoveredAsset>,
    diagnostics: &mut Vec<DiagnosticDto>,
    package_path: &Path,
    agent_id: &str,
    team_id: &str,
    relative_path: &str,
    kind: &str,
    current: bool,
    compatibility_reason: Option<&str>,
) {
    let target = package_path.join(relative_path);
    let metadata = match fs::symlink_metadata(&target) {
        Ok(value) => value,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            if let Some(content) = optional_managed_yaml_content(kind) {
                discover_missing_managed_yaml_asset(
                    discovered,
                    package_path,
                    agent_id,
                    team_id,
                    relative_path,
                    kind,
                    content,
                    current,
                    compatibility_reason,
                );
            } else {
                diagnostics.push(diagnostic_for_source(
                    &format!("agt_{agent_id}"),
                    &format!("{kind}_missing"),
                    "error",
                    &format!("AgentPackage 缺少 {relative_path}"),
                    Some(relative_path.into()),
                    Some("恢复该 canonical 配置文件后重新读取"),
                ));
            }
            return;
        }
        Err(_) => {
            diagnostics.push(diagnostic(
                &format!("{kind}_unreadable"),
                "error",
                &format!("无法检查 {relative_path}"),
                Some(relative_path.into()),
                Some("检查文件权限"),
            ));
            return;
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        diagnostics.push(diagnostic(
            &format!("{kind}_target_rejected"),
            "error",
            &format!("{relative_path} 必须是 package 内普通文件"),
            Some(relative_path.into()),
            Some("移除符号链接或非文件目标"),
        ));
        return;
    }
    let content = match fs::read_to_string(&target) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(diagnostic(
                &format!("{kind}_unreadable"),
                "error",
                &format!("无法读取 {relative_path}"),
                Some(relative_path.into()),
                Some("确认文件为 UTF-8 且可读"),
            ));
            return;
        }
    };
    let validation = validate_yaml_asset(kind, &content);
    let parsed = validation.is_ok();
    let hash = hash_bytes(content.as_bytes());
    let container_id = stable_id("container", &format!("managed:{agent_id}:{relative_path}"));
    let asset_identity = format!("managed:{agent_id}:{kind}");
    let asset_id = stable_id("asset", &asset_identity);
    let writable = current && parsed && !metadata.permissions().readonly();
    let mut asset_diagnostics = compatibility_reason
        .map(|message| {
            vec![diagnostic(
                "package_schema_unsupported",
                "warning",
                message,
                Some("agent.yaml".into()),
                Some("使用兼容版本的 Bandi 处理该 package"),
            )]
        })
        .unwrap_or_default();
    if let Err(issue) = validation {
        asset_diagnostics.push(*issue);
    }
    let locator = AssetLocatorDto {
        root_kind: RootKind::Managed,
        display_path: target.to_string_lossy().into_owned(),
        relative_path: Some(format!("agt_{agent_id}/{relative_path}")),
    };
    let summary = SourceAssetSummaryDto {
        id: asset_id,
        container_id: container_id.clone(),
        agent_id: agent_id.into(),
        team_id: team_id.into(),
        kind: kind.into(),
        official_scope: "managed".into(),
        asset_content_hash: hash.clone(),
        container_content_hash: hash.clone(),
        writable,
        parse_status: if !current {
            "unsupported"
        } else if parsed {
            "parsed"
        } else {
            "invalid"
        }
        .into(),
        diagnostics: asset_diagnostics,
    };
    discovered.push(DiscoveredAsset {
        container: SourceContainerDto {
            id: container_id,
            locator,
            format: "yaml".into(),
            content_hash: hash,
            writable,
            read_only_reason: compatibility_reason.map(str::to_owned),
        },
        summary,
        content,
        target,
        target_exists: true,
    });
}

fn canonical_package_text(package_path: &Path, relative_path: &str) -> Result<String, String> {
    let target = package_path.join(relative_path);
    let metadata = fs::symlink_metadata(&target).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            format!("AGENT_CANONICAL_MISSING: AgentPackage 缺少 {relative_path}")
        } else {
            format!("AGENT_CANONICAL_UNREADABLE: 无法检查 {relative_path}")
        }
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!(
            "AGENT_CANONICAL_REJECTED: {relative_path} 必须是 package 内普通文件"
        ));
    }
    fs::read_to_string(target)
        .map_err(|_| format!("AGENT_CANONICAL_UNREADABLE: 无法读取 {relative_path}"))
}

fn canonical_yaml_object(
    package_path: &Path,
    relative_path: &str,
    kind: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let content = canonical_package_text(package_path, relative_path)?;
    validate_yaml_asset(kind, &content).map_err(|issue| {
        format!(
            "AGENT_CANONICAL_INVALID: {} ({relative_path})",
            issue.message
        )
    })?;
    let value: serde_json::Value = serde_yaml::from_str(&content)
        .map_err(|_| format!("AGENT_CANONICAL_INVALID: 无法解析 {relative_path}"))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("AGENT_CANONICAL_INVALID: {relative_path} 必须是对象"))
}

fn optional_canonical_yaml_object(
    package_path: &Path,
    relative_path: &str,
    kind: &str,
) -> Result<Option<serde_json::Map<String, serde_json::Value>>, String> {
    match fs::symlink_metadata(package_path.join(relative_path)) {
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(format!(
            "AGENT_CANONICAL_UNREADABLE: 无法检查 {relative_path}"
        )),
        Ok(_) => canonical_yaml_object(package_path, relative_path, kind).map(Some),
    }
}

fn replace_projection_field(
    agent: &mut serde_json::Map<String, serde_json::Value>,
    document: &serde_json::Map<String, serde_json::Value>,
    source: &str,
    target: &str,
    relative_path: &str,
) -> Result<(), String> {
    let value = document
        .get(source)
        .cloned()
        .ok_or_else(|| format!("AGENT_CANONICAL_INVALID: {relative_path} 缺少 {source}"))?;
    agent.insert(target.into(), value);
    Ok(())
}

fn managed_agent_file(path: &str, file_type: &str) -> serde_json::Value {
    let scope = serde_json::json!({ "kind": "agent-root" });
    serde_json::json!({
        "path": path,
        "type": file_type,
        "status": "已从受管目录读取",
        "scope": scope,
    })
}

pub(crate) fn project_managed_agent_at(
    package_path: &Path,
    agent_id: &str,
) -> Result<serde_json::Value, String> {
    if !validate_identifier(agent_id) {
        return Err("AGENT_CANONICAL_INVALID: Agent 目录标识无效".into());
    }
    let index_path = package_path.join(".bandi-agent.json");
    let index = fs::read(&index_path).map_err(|error| {
        if error.kind() == ErrorKind::NotFound {
            "AGENT_INDEX_MISSING: 缺少 Agent 非配置身份索引，无法完整重建 FullAgent".to_string()
        } else {
            "AGENT_INDEX_UNREADABLE: 无法读取 Agent 非配置身份索引".to_string()
        }
    })?;
    let mut agent: serde_json::Value = serde_json::from_slice(&index)
        .map_err(|_| "AGENT_INDEX_INVALID: Agent 非配置身份索引已损坏".to_string())?;
    let agent = agent
        .as_object_mut()
        .ok_or_else(|| "AGENT_INDEX_INVALID: Agent 非配置身份索引必须是对象".to_string())?;
    if contains_rejected_agent_field(agent) {
        return Err("AGENT_INDEX_INVALID: Agent 非配置身份索引含已移除的旧组织或编排字段".into());
    }
    if agent.get("id").and_then(serde_json::Value::as_str) != Some(agent_id) {
        return Err("AGENT_INDEX_INVALID: Agent 非配置身份索引与目录身份不一致".into());
    }

    let manifest_path = package_path.join("agent.yaml");
    let (manifest_id, manifest_team_id, schema_version) = manifest_facts(&manifest_path)
        .map_err(|issue| format!("AGENT_CANONICAL_INVALID: {}", issue.message))?;
    if manifest_id != agent_id || schema_version != CURRENT_SCHEMA_VERSION {
        return Err("AGENT_CANONICAL_INVALID: agent.yaml 身份不一致或版本不受支持".into());
    }
    let manifest: serde_json::Value =
        serde_yaml::from_str(&canonical_package_text(package_path, "agent.yaml")?)
            .map_err(|_| "AGENT_CANONICAL_INVALID: agent.yaml 不是有效 YAML".to_string())?;
    let manifest = manifest
        .as_object()
        .ok_or_else(|| "AGENT_CANONICAL_INVALID: agent.yaml 必须是对象".to_string())?;
    if manifest.get("functionId").is_some_and(|value| {
        !matches!(
            value.as_str(),
            Some(
                "product"
                    | "design"
                    | "engineering"
                    | "testing"
                    | "research"
                    | "operations"
                    | "general"
                    | "other"
            )
        )
    }) {
        return Err("AGENT_CANONICAL_INVALID: agent.yaml 职能标识不受支持".into());
    }
    const IDENTITY_FIELDS: &[&str] = &[
        "id",
        "name",
        "status",
        "teamId",
        "avatarPath",
        "mission",
        "functionId",
        "responsibilities",
        "deliverables",
        "decisionBoundaries",
        "escalationConditions",
        "prohibitions",
        "completionDefinition",
    ];
    for field in IDENTITY_FIELDS {
        if let Some(value) = manifest.get(*field) {
            agent.insert((*field).into(), value.clone());
        } else {
            agent.remove(*field);
        }
    }
    agent.insert("teamId".into(), manifest_team_id.into());
    agent.insert(
        "packageSchema".into(),
        serde_json::json!({ "schemaVersion": schema_version, "compatibility": "current" }),
    );
    agent.insert(
        "instructions".into(),
        serde_json::Value::String(canonical_package_text(package_path, "instructions.md")?),
    );
    let mut files = vec![
        managed_agent_file("agent.yaml", "稳定身份与职责"),
        managed_agent_file("instructions.md", "主 Instructions"),
    ];

    for (path, kind, source, target, file_type) in [
        (
            "config/rules.yaml",
            "rules",
            "rules",
            "ruleRefs",
            "Rule 配置与引用",
        ),
        (
            "config/skills.yaml",
            "skills",
            "skills",
            "skillRefs",
            "Skill 配置与引用",
        ),
        ("config/mcp.yaml", "mcp", "mcp", "mcpRefs", "MCP 配置与引用"),
        ("config/sop.yaml", "sop", "sop", "sopRefs", "SOP 配置与引用"),
        (
            "config/hooks.yaml",
            "hooks",
            "hooks",
            "hookRefs",
            "Hook 配置与引用",
        ),
        (
            "config/commands.yaml",
            "commands",
            "commands",
            "commandRefs",
            "Command 配置与引用",
        ),
    ] {
        if let Some(document) = optional_canonical_yaml_object(package_path, path, kind)? {
            replace_projection_field(agent, &document, source, target, path)?;
            files.push(managed_agent_file(path, file_type));
        } else {
            agent.insert(target.into(), serde_json::Value::Array(Vec::new()));
        }
    }
    for (path, kind, source, target, file_type) in [(
        "config/permissions.yaml",
        "permissions",
        "permissions",
        "permissions",
        "长期权限边界",
    )] {
        let document = canonical_yaml_object(package_path, path, kind)?;
        replace_projection_field(agent, &document, source, target, path)?;
        files.push(managed_agent_file(path, file_type));
    }
    let context = canonical_yaml_object(package_path, "config/context.yaml", "context")?;
    files.push(managed_agent_file(
        "config/context.yaml",
        "上下文与输出格式",
    ));
    for field in [
        "contextPolicy",
        "contextWindowTokens",
        "outputProfileId",
        "outputParameterBindings",
    ] {
        replace_projection_field(agent, &context, field, field, "config/context.yaml")?;
    }

    files.sort_by(|left, right| {
        left.get("path")
            .and_then(serde_json::Value::as_str)
            .cmp(&right.get("path").and_then(serde_json::Value::as_str))
    });
    agent.insert("files".into(), serde_json::Value::Array(files));
    agent.remove("projects");
    agent.remove("projectBindings");
    Ok(serde_json::Value::Object(agent.clone()))
}

fn discover_managed_assets(managed_root: &Path) -> (Vec<DiscoveredAsset>, Vec<DiagnosticDto>) {
    let entries = match fs::read_dir(managed_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return (Vec::new(), Vec::new()),
        Err(_) => {
            return (
                Vec::new(),
                vec![diagnostic(
                    "managed_root_unreadable",
                    "error",
                    "无法读取受管 Agent 根目录",
                    None,
                    Some("检查 ~/.bandi/agents 权限"),
                )],
            )
        }
    };
    let mut discovered = Vec::new();
    let mut diagnostics = Vec::new();
    let mut ids = HashSet::new();
    for entry in entries.flatten() {
        let package_path = entry.path();
        let package_metadata = match fs::symlink_metadata(&package_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if package_metadata.file_type().is_symlink() || !package_metadata.is_dir() {
            if entry.file_name().to_string_lossy().starts_with("agt_") {
                diagnostics.push(diagnostic(
                    "package_symlink_rejected",
                    "error",
                    "受管 AgentPackage 不能是符号链接",
                    None,
                    Some("将 package 移回受管根内的普通目录"),
                ));
            }
            continue;
        }
        let (agent_id, team_id, schema_version) =
            match manifest_facts(&package_path.join("agent.yaml")) {
                Ok(value) => value,
                Err(error) => {
                    diagnostics.push(*error);
                    continue;
                }
            };
        let expected_directory = format!("agt_{agent_id}");
        if entry.file_name().to_string_lossy() != expected_directory {
            diagnostics.push(diagnostic(
                "stable_id_directory_mismatch",
                "error",
                "Agent 稳定 id 与受管目录身份不一致",
                Some("agent.yaml".into()),
                Some("将 package 放回与稳定 id 对应的目录"),
            ));
            continue;
        }
        if !ids.insert(agent_id.clone()) {
            diagnostics.push(diagnostic(
                "stable_id_conflict",
                "error",
                "发现重复的 Agent 稳定 id",
                Some("agent.yaml".into()),
                Some("为冲突 package 修复稳定 id"),
            ));
            continue;
        }
        let current = schema_version == CURRENT_SCHEMA_VERSION;
        let compatibility_reason = if schema_version < CURRENT_SCHEMA_VERSION {
            Some("legacy AgentPackage 只读")
        } else if schema_version > CURRENT_SCHEMA_VERSION {
            Some("future AgentPackage 只读")
        } else {
            None
        };
        let instructions_path = package_path.join("instructions.md");
        let metadata = match fs::symlink_metadata(&instructions_path) {
            Ok(value) => value,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                diagnostics.push(diagnostic_for_source(
                    &format!("agt_{agent_id}"),
                    "instructions_missing",
                    "warning",
                    "AgentPackage 缺少 instructions.md",
                    Some("instructions.md".into()),
                    Some("补充 canonical Instructions 文件"),
                ));
                continue;
            }
            Err(_) => {
                diagnostics.push(diagnostic(
                    "instructions_unreadable",
                    "error",
                    "无法检查 instructions.md",
                    Some("instructions.md".into()),
                    Some("检查文件权限"),
                ));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            diagnostics.push(diagnostic(
                "instructions_target_rejected",
                "error",
                "instructions.md 必须是 package 内普通文件",
                Some("instructions.md".into()),
                Some("移除符号链接或非文件目标"),
            ));
            continue;
        }
        let content = match fs::read_to_string(&instructions_path) {
            Ok(value) => value,
            Err(_) => {
                diagnostics.push(diagnostic(
                    "instructions_unreadable",
                    "error",
                    "无法读取 instructions.md",
                    Some("instructions.md".into()),
                    Some("确认文件为 UTF-8 且可读"),
                ));
                continue;
            }
        };
        let hash = hash_bytes(content.as_bytes());
        let container_id = stable_id("container", &format!("managed:{agent_id}:instructions.md"));
        let asset_id = stable_id("asset", &format!("managed:{agent_id}:instructions"));
        let asset_diagnostics = compatibility_reason
            .map(|message| {
                vec![diagnostic(
                    "package_schema_unsupported",
                    "warning",
                    message,
                    Some("agent.yaml".into()),
                    Some("使用兼容版本的 Bandi 处理该 package"),
                )]
            })
            .unwrap_or_default();
        let locator = AssetLocatorDto {
            root_kind: RootKind::Managed,
            display_path: instructions_path.to_string_lossy().into_owned(),
            relative_path: Some(format!("agt_{agent_id}/instructions.md")),
        };
        let summary = SourceAssetSummaryDto {
            id: asset_id,
            container_id: container_id.clone(),
            agent_id: agent_id.clone(),
            team_id: team_id.clone(),
            kind: "instructions".into(),
            official_scope: "managed".into(),
            asset_content_hash: hash.clone(),
            container_content_hash: hash.clone(),
            writable: current && !metadata.permissions().readonly(),
            parse_status: if current {
                "parsed".into()
            } else {
                "unsupported".into()
            },
            diagnostics: asset_diagnostics,
        };
        let container = SourceContainerDto {
            id: container_id,
            locator,
            format: "markdown".into(),
            content_hash: hash,
            writable: summary.writable,
            read_only_reason: compatibility_reason.map(str::to_owned),
        };
        discovered.push(DiscoveredAsset {
            summary,
            container,
            content,
            target: instructions_path,
            target_exists: true,
        });
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/context.yaml",
            "context",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/rules.yaml",
            "rules",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/skills.yaml",
            "skills",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/mcp.yaml",
            "mcp",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/permissions.yaml",
            "permissions",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/sop.yaml",
            "sop",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/hooks.yaml",
            "hooks",
            current,
            compatibility_reason,
        );
        discover_managed_yaml_asset(
            &mut discovered,
            &mut diagnostics,
            &package_path,
            &agent_id,
            &team_id,
            "config/commands.yaml",
            "commands",
            current,
            compatibility_reason,
        );
    }
    (discovered, diagnostics)
}

fn referenced_assets(asset: &DiscoveredAsset) -> Vec<(String, &'static str)> {
    let plain = |ids: Vec<String>, kind| ids.into_iter().map(|id| (id, kind)).collect();
    match asset.summary.kind.as_str() {
        "context" => serde_yaml::from_str::<ContextPolicyDocument>(&asset.content)
            .ok()
            .filter(|document| !document.output_profile_id.is_empty())
            .map(|document| vec![(document.output_profile_id, "output_profile")])
            .unwrap_or_default(),
        "rules" => serde_yaml::from_str::<RulesDocument>(&asset.content)
            .map(|document| plain(document.rules, "rule"))
            .unwrap_or_default(),
        "skills" => serde_yaml::from_str::<SkillsDocument>(&asset.content)
            .map(|document| plain(document.skills, "skill"))
            .unwrap_or_default(),
        "mcp" => serde_yaml::from_str::<McpDocument>(&asset.content)
            .map(|document| plain(document.mcp, "mcp"))
            .unwrap_or_default(),
        "sop" => serde_yaml::from_str::<SopDocument>(&asset.content)
            .map(|document| plain(document.sop, "sop"))
            .unwrap_or_default(),
        "hooks" => serde_yaml::from_str::<HookReferencesDocument>(&asset.content)
            .map(|document| {
                plain(
                    document
                        .hooks
                        .into_iter()
                        .map(|item| item.asset_id)
                        .collect(),
                    "hook",
                )
            })
            .unwrap_or_default(),
        "commands" => serde_yaml::from_str::<CommandReferencesDocument>(&asset.content)
            .map(|document| {
                plain(
                    document
                        .commands
                        .into_iter()
                        .map(|item| item.asset_id)
                        .collect(),
                    "command",
                )
            })
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn reference_state(
    target: Option<&SharedAssetNodeDto>,
    target_kind: &str,
    referrer_team: Option<&str>,
    root_available: bool,
) -> &'static str {
    match target {
        Some(target) if target.parse_status != "parsed" => "target_invalid",
        Some(target) if target.kind != target_kind => "type_mismatch",
        Some(_) if referrer_team.is_none() => "unresolved",
        Some(target) if referrer_team != Some(target.team_id.as_str()) => "out_of_scope",
        Some(_) => "resolved",
        None if root_available => "dangling",
        None => "unresolved",
    }
}

fn reference_diagnostic(state: &str, target_asset_id: &str) -> Option<DiagnosticDto> {
    let (code, message, remediation) = match state {
        "dangling" => (
            "asset_reference_dangling",
            format!("显式引用的共享资产 {target_asset_id} 不存在"),
            "恢复目标本体或移除该显式引用",
        ),
        "type_mismatch" => (
            "asset_reference_type_mismatch",
            format!("显式引用的共享资产 {target_asset_id} 类型不匹配"),
            "改用目标真实类型或替换引用",
        ),
        "out_of_scope" => (
            "asset_reference_out_of_scope",
            format!("显式引用的共享资产 {target_asset_id} 超出 Agent 所属 Team 范围"),
            "移除跨 Team 引用或单独授权",
        ),
        "target_invalid" => (
            "asset_reference_target_invalid",
            format!("显式引用的共享资产 {target_asset_id} 本体无效"),
            "修复目标 manifest、归属或正文后刷新索引",
        ),
        "unresolved" => (
            "asset_reference_unresolved",
            format!("显式引用的共享资产 {target_asset_id} 尚无法确认本体"),
            "初始化共享资产根后刷新索引",
        ),
        _ => return None,
    };
    Some(diagnostic(
        code,
        "warning",
        &message,
        Some("targetAssetId".into()),
        Some(remediation),
    ))
}

fn reference_graph(
    assets: &[DiscoveredAsset],
    targets: &[SharedAssetNodeDto],
    root_available: bool,
) -> (Vec<AssetReferenceDto>, Vec<DiagnosticDto>) {
    let target_index = targets
        .iter()
        .map(|target| (target.id.as_str(), target))
        .collect::<std::collections::HashMap<_, _>>();
    let mut references = Vec::new();
    let mut diagnostics = Vec::new();
    for asset in assets
        .iter()
        .filter(|asset| asset.summary.parse_status == "parsed")
    {
        let source_path = asset
            .container
            .locator
            .relative_path
            .clone()
            .unwrap_or_else(|| asset.container.locator.display_path.clone());
        let referrer_id = asset.summary.agent_id.clone();
        let referrer_team = Some(asset.summary.team_id.as_str());
        for (target_asset_id, target_kind) in referenced_assets(asset) {
            let target = target_index.get(target_asset_id.as_str()).copied();
            let state = reference_state(target, target_kind, referrer_team, root_available);
            references.push(AssetReferenceDto {
                source_asset_id: asset.summary.id.clone(),
                source_container_id: asset.summary.container_id.clone(),
                referrer_kind: "agent".into(),
                referrer_id: referrer_id.clone(),
                target_asset_id: target_asset_id.clone(),
                target_kind: target_kind.into(),
                state: state.into(),
                target_locator: target.map(|target| target.locator.clone()),
                target_team_id: target.map(|target| target.team_id.clone()),
                source_path: source_path.clone(),
            });
            if let Some(issue) = reference_diagnostic(state, &target_asset_id) {
                diagnostics.push(issue);
            }
        }
    }
    references.sort_by(|left, right| {
        (&left.target_asset_id, &left.source_asset_id)
            .cmp(&(&right.target_asset_id, &right.source_asset_id))
    });
    (references, diagnostics)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn discover_at(managed_root: &Path, request: DiscoveryRequest) -> DiscoveryResult {
    discover_with_shared_at(
        managed_root,
        Path::new(""),
        &LongTermDomainSnapshotDtoV4 {
            schema_version: 4,
            teams: Vec::new(),
            task_briefs: Vec::new(),
        },
        false,
        request,
    )
}

pub(crate) fn discover_with_shared_at(
    managed_root: &Path,
    shared_root: &Path,
    snapshot: &LongTermDomainSnapshotDtoV4,
    discover_shared: bool,
    request: DiscoveryRequest,
) -> DiscoveryResult {
    let mut diagnostics = Vec::new();
    let (assets, mut asset_diagnostics) = discover_managed_assets(managed_root);
    diagnostics.append(&mut asset_diagnostics);
    let shared_index = if discover_shared {
        shared_assets::discover(shared_root, snapshot)
    } else {
        shared_assets::SharedAssetIndex {
            nodes: Vec::new(),
            root_available: false,
            diagnostics: Vec::new(),
        }
    };
    diagnostics.extend(shared_index.diagnostics);
    let (references, mut reference_diagnostics) =
        reference_graph(&assets, &shared_index.nodes, shared_index.root_available);
    diagnostics.append(&mut reference_diagnostics);
    DiscoveryResult {
        request_id: request.request_id,
        profile_version: PROFILE_VERSION.into(),
        containers: assets.iter().map(|item| item.container.clone()).collect(),
        assets: assets.into_iter().map(|item| item.summary).collect(),
        shared_assets: shared_index.nodes,
        references,
        diagnostics,
    }
}

pub(crate) fn current_side(content: String) -> ConfigSideDto {
    let hash = hash_bytes(content.as_bytes());
    ConfigSideDto {
        content,
        asset_content_hash: hash.clone(),
        container_content_hash: hash,
        redacted: false,
    }
}

pub(crate) fn append_revision(
    revisions_root: &Path,
    revision: &ConfigRevisionDto,
    content: &str,
) -> Result<(), String> {
    fs::create_dir_all(revisions_root).map_err(|_| "无法创建 ConfigRevision 目录".to_string())?;
    let record_path = revisions_root.join(format!("{}.json", revision.id));
    let content_path = revisions_root.join(format!("{}.content", revision.id));
    let bytes =
        serde_json::to_vec(revision).map_err(|_| "ConfigRevision 无法序列化".to_string())?;
    let mut content_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&content_path)
        .map_err(|_| "ConfigRevision 已存在或无法创建".to_string())?;
    if content_file
        .write_all(content.as_bytes())
        .and_then(|_| content_file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&content_path);
        return Err("ConfigRevision 正文无法完整写入".into());
    }
    let record_result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&record_path)
        .and_then(|mut file| file.write_all(&bytes).and_then(|_| file.sync_all()));
    if record_result.is_err() {
        let _ = fs::remove_file(content_path);
        return Err("ConfigRevision 记录已存在或无法创建".into());
    }
    Ok(())
}

pub(crate) fn list_revisions_at(
    revisions_root: &Path,
    asset_id: &str,
) -> Result<Vec<ConfigRevisionDto>, String> {
    if asset_id.is_empty() || asset_id.len() > 160 {
        return Err("ConfigRevision 资产标识无效".into());
    }
    let entries = match fs::read_dir(revisions_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("无法读取 ConfigRevision 目录".into()),
    };
    let mut revisions = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
            _ => continue,
        };
        if metadata.len() > 1024 * 1024 {
            continue;
        }
        let revision: ConfigRevisionDto = match fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        {
            Some(revision) => revision,
            None => continue,
        };
        if revision.asset_id == asset_id {
            revisions.push(revision);
        }
    }
    revisions.sort_by(|left, right| right.saved_at.cmp(&left.saved_at));
    Ok(revisions)
}

pub(crate) fn remove_managed_agent_revisions_at(
    revisions_root: &Path,
    agent_id: &str,
) -> Result<usize, String> {
    if !validate_identifier(agent_id) {
        return Err("Agent 标识无效".into());
    }
    let entries = match fs::read_dir(revisions_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(0),
        Err(_) => return Err("无法读取 ConfigRevision 目录".into()),
    };
    let prefix = format!("agt_{agent_id}/");
    let mut revision_ids = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let metadata =
            fs::symlink_metadata(&path).map_err(|_| "无法检查 ConfigRevision 记录".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 1024 * 1024
        {
            return Err("ConfigRevision 记录不安全，拒绝清理".into());
        }
        let revision: ConfigRevisionDto = serde_json::from_slice(
            &fs::read(&path).map_err(|_| "无法读取 ConfigRevision".to_string())?,
        )
        .map_err(|_| "ConfigRevision 记录无效，拒绝清理".to_string())?;
        if revision.locator.root_kind == RootKind::Managed
            && revision
                .locator
                .relative_path
                .as_deref()
                .is_some_and(|value| value.starts_with(&prefix))
        {
            revision_ids.push(revision.id);
        }
    }
    for revision_id in &revision_ids {
        for extension in ["json", "content"] {
            let path = revisions_root.join(format!("{revision_id}.{extension}"));
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(_) => return Err("无法检查 ConfigRevision 内容".into()),
            };
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("ConfigRevision 内容不安全，拒绝清理".into());
            }
        }
    }
    for revision_id in &revision_ids {
        for (extension, error_message) in [
            ("content", "无法删除 ConfigRevision 内容"),
            ("json", "无法删除 ConfigRevision 索引"),
        ] {
            let path = revisions_root.join(format!("{revision_id}.{extension}"));
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != ErrorKind::NotFound {
                    return Err(error_message.into());
                }
            }
        }
    }
    Ok(revision_ids.len())
}

pub(crate) fn read_revision_content_at(
    revisions_root: &Path,
    revision_id: &str,
) -> Result<String, String> {
    if !validate_identifier(revision_id) {
        return Err("ConfigRevision 标识无效".into());
    }
    let record_path = revisions_root.join(format!("{revision_id}.json"));
    let content_path = revisions_root.join(format!("{revision_id}.content"));
    for path in [&record_path, &content_path] {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| "ConfigRevision 不存在或不完整".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("ConfigRevision 记录必须是普通文件".into());
        }
    }
    let revision: ConfigRevisionDto = serde_json::from_slice(
        &fs::read(record_path).map_err(|_| "无法读取 ConfigRevision".to_string())?,
    )
    .map_err(|_| "ConfigRevision 记录无效".to_string())?;
    if revision.id != revision_id {
        return Err("ConfigRevision 身份不一致".into());
    }
    let content = fs::read_to_string(content_path)
        .map_err(|_| "无法读取 ConfigRevision 历史内容".to_string())?;
    if hash_bytes(content.as_bytes()) != revision.asset_content_hash {
        return Err("ConfigRevision 历史内容校验失败".into());
    }
    Ok(content)
}

pub(crate) fn save_config_registered_at(
    database: &Path,
    managed_root: &Path,
    revisions_root: &Path,
    request: SaveConfigRequest,
) -> SaveConfigResult {
    save_config_with_revision_source(managed_root, revisions_root, Some(database), request, None)
}

fn confirmation_root(revisions_root: &Path) -> PathBuf {
    revisions_root.join("confirmations")
}

fn permission_rank(value: &str) -> Option<u8> {
    match value {
        "未授予" => Some(0),
        "只读当前工作区" => Some(1),
        "仅当前工作区" => Some(2),
        "任意目录" => Some(3),
        _ => None,
    }
}

fn permissions_expand(current: &PermissionsDocument, proposed: &PermissionsDocument) -> bool {
    permission_rank(&proposed.permissions.files)
        .zip(permission_rank(&current.permissions.files))
        .is_some_and(|(next, previous)| next > previous)
        || proposed.permissions.commands != current.permissions.commands
        || proposed.permissions.network != current.permissions.network
        || proposed.permissions.delegation != current.permissions.delegation
}

pub(crate) fn issue_confirmation(
    revisions_root: &Path,
    asset_id: &str,
    proposed_content_hash: &str,
    baseline_asset_hash: &str,
    reason: &str,
) -> Result<ConfirmationChallengeDto, String> {
    let expires = chrono::Utc::now() + chrono::Duration::minutes(10);
    let expires_at = expires.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let id = stable_id(
        "confirmation",
        &format!("{asset_id}:{proposed_content_hash}:{baseline_asset_hash}:{expires_at}"),
    );
    let record = ConfirmationRecord {
        id: id.clone(),
        asset_id: asset_id.into(),
        proposed_content_hash: proposed_content_hash.into(),
        baseline_asset_hash: baseline_asset_hash.into(),
        expires_at: expires_at.clone(),
    };
    let bytes = serde_json::to_vec(&record).map_err(|_| "无法序列化权限确认 challenge")?;
    restricted_atomic_write(
        &confirmation_root(revisions_root).join(format!("{id}.json")),
        &bytes,
        false,
        "权限确认 challenge",
    )?;
    Ok(ConfirmationChallengeDto {
        id,
        asset_id: asset_id.into(),
        proposed_content_hash: proposed_content_hash.into(),
        expires_at,
        reason: reason.into(),
    })
}

pub(crate) fn consume_confirmation(
    revisions_root: &Path,
    confirmation_ref: &str,
    asset_id: &str,
    proposed_content_hash: &str,
    baseline_asset_hash: &str,
) -> Result<(), String> {
    if !validate_identifier(confirmation_ref) {
        return Err("权限确认引用无效".into());
    }
    let target = confirmation_root(revisions_root).join(format!("{confirmation_ref}.json"));
    let bytes = fs::read(&target).map_err(|_| "权限确认 challenge 不存在或已使用")?;
    let record: ConfirmationRecord =
        serde_json::from_slice(&bytes).map_err(|_| "权限确认 challenge 已损坏")?;
    let expires_at = chrono::DateTime::parse_from_rfc3339(&record.expires_at)
        .map_err(|_| "权限确认 challenge 过期时间无效")?;
    if record.id != confirmation_ref
        || record.asset_id != asset_id
        || record.proposed_content_hash != proposed_content_hash
        || record.baseline_asset_hash != baseline_asset_hash
        || expires_at < chrono::Utc::now()
    {
        return Err("权限确认 challenge 已过期或与本次变更不匹配".into());
    }
    fs::remove_file(target).map_err(|_| "无法消费权限确认 challenge".to_string())
}

pub(crate) fn owner_from_locator(
    locator: &AssetLocatorDto,
    change_kind: &str,
) -> Option<SaveConfigOwnerDto> {
    let relative_path = locator.relative_path.as_deref()?;
    let (package, package_relative_path) = relative_path.split_once('/')?;
    let agent_id = package.strip_prefix("agt_")?;
    if !validate_identifier(agent_id) {
        return None;
    }
    let _ = (package_relative_path, change_kind);
    Some(SaveConfigOwnerDto {
        agent_id: agent_id.to_string(),
    })
}

fn owner_matches_locator(
    owner: &SaveConfigOwnerDto,
    locator: &AssetLocatorDto,
    change_kind: &str,
) -> bool {
    let Some(relative_path) = locator.relative_path.as_deref() else {
        return false;
    };
    let expected_package_prefix = format!("agt_{}/", owner.agent_id);
    if !relative_path.starts_with(&expected_package_prefix) {
        return false;
    }
    let _ = change_kind;
    relative_path.starts_with(&expected_package_prefix)
}

fn save_config_with_revision_source(
    managed_root: &Path,
    revisions_root: &Path,
    _database: Option<&Path>,
    request: SaveConfigRequest,
    restored_from_revision_id: Option<String>,
) -> SaveConfigResult {
    let request_id = request.request_id.clone();
    if !validate_identifier(&request.request_id)
        || request.asset_id.len() > 160
        || !validate_identifier(&request.expected_owner.agent_id)
        || request.base_content.len() > 1024 * 1024
        || request
            .confirmation_ref
            .as_deref()
            .is_some_and(|value| !validate_identifier(value))
    {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "save_request_invalid",
                "error",
                "配置保存请求无效",
                None,
                Some("刷新编辑器后重试"),
            )],
        };
    }
    let change_kind = request.change.kind();
    let value = request.change.value();
    let (relative_path, label, summary) = match change_kind {
        "instructions" => ("instructions.md", "Instructions", "保存 Instructions"),
        "context" => (
            "config/context.yaml",
            "上下文策略",
            "保存上下文策略与输出格式",
        ),
        "rules" => ("config/rules.yaml", "Rule 引用", "保存 Rule 引用"),
        "skills" => ("config/skills.yaml", "Skill 引用", "保存 Skill 引用"),
        "mcp" => ("config/mcp.yaml", "MCP 引用", "保存 MCP 引用"),
        "permissions" => (
            "config/permissions.yaml",
            "长期权限边界",
            "保存长期权限边界",
        ),
        "sop" => ("config/sop.yaml", "SOP 引用", "保存 SOP 引用"),
        "hooks" => ("config/hooks.yaml", "Hook 引用", "保存 Hook 引用"),
        "commands" => ("config/commands.yaml", "Command 引用", "保存 Command 引用"),
        _ => unreachable!("ConfigChangeDto 已穷尽"),
    };
    if value.len() > 1024 * 1024 || value.contains('\0') {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                &format!("{change_kind}_invalid"),
                "error",
                &format!("{label} 包含空字符或超过 1 MiB"),
                Some(relative_path.into()),
                Some("修正内容后重试"),
            )],
        };
    }
    if let Err(issue) = match change_kind {
        "context" => validate_context_document(&value),
        "rules" => validate_rules_document(&value),
        "skills" => validate_skills_document(&value),
        "mcp" => validate_mcp_document(&value),
        "permissions" => validate_permissions_document(&value),
        "sop" => validate_sop_document(&value),
        "hooks" => validate_hooks_document(&value),
        "commands" => validate_commands_document(&value),
        _ => Ok(()),
    } {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![*issue],
        };
    }
    let (assets, _) = discover_managed_assets(managed_root);
    let Some(item) = assets
        .into_iter()
        .find(|item| item.summary.id == request.asset_id)
    else {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "asset_not_found",
                "error",
                "配置资产不存在或身份已变化",
                None,
                Some("重新发现并加载编辑器"),
            )],
        };
    };
    if !owner_matches_locator(
        &request.expected_owner,
        &item.container.locator,
        change_kind,
    ) {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "asset_owner_mismatch",
                "error",
                "目标配置资产不属于请求声明的 Agent",
                Some("expectedOwner".into()),
                Some("重新发现并从目标 Agent 配置页加载资产"),
            )],
        };
    }
    if item.summary.kind != change_kind {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "asset_kind_mismatch",
                "error",
                "保存分支与目标配置资产类型不一致",
                Some(relative_path.into()),
                Some("重新发现并加载对应配置编辑器"),
            )],
        };
    }
    if !item.summary.writable || item.summary.parse_status != "parsed" {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "asset_read_only",
                "error",
                &format!("该 {label} 资产当前只读"),
                Some(relative_path.into()),
                Some("使用 current v1 可写受管 AgentPackage"),
            )],
        };
    }
    let baseline = request.expected_baseline;
    let base_hash = hash_bytes(request.base_content.as_bytes());
    if baseline.asset_content_hash != base_hash || baseline.container_content_hash != base_hash {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "baseline_content_mismatch",
                "error",
                "编辑器原始内容与服务签发基线不一致",
                Some(relative_path.into()),
                Some("重新加载编辑器后重试"),
            )],
        };
    }
    let target_exists_now = fs::symlink_metadata(&item.target).is_ok();
    let target_state_changed =
        baseline.target_exists != item.target_exists || baseline.target_exists != target_exists_now;
    if baseline.asset_id != item.summary.id
        || baseline.container_id != item.summary.container_id
        || baseline.asset_content_hash != item.summary.asset_content_hash
        || baseline.container_content_hash != item.summary.container_content_hash
        || target_state_changed
    {
        return SaveConfigResult::BaselineChanged {
            request_id,
            asset_id: item.summary.id,
            container_id: item.summary.container_id,
            locator: item.container.locator,
            base: current_side(request.base_content),
            current: current_side(item.content),
            proposed: current_side(value),
            diagnostics: vec![diagnostic(
                "baseline_changed",
                "warning",
                &format!("{label} 已在编辑期间发生变化"),
                Some(relative_path.into()),
                Some("比较当前内容后重新应用编辑"),
            )],
        };
    }
    if item.content == value {
        return SaveConfigResult::Unchanged {
            request_id,
            asset: item.summary,
        };
    }
    let mut confirmation_refs = Vec::new();
    if change_kind == "permissions" {
        let current_permissions = match parse_permissions_document(&item.content) {
            Ok(document) => document,
            Err(issue) => {
                return SaveConfigResult::ValidationFailed {
                    request_id,
                    diagnostics: vec![*issue],
                }
            }
        };
        let proposed_permissions = match parse_permissions_document(&value) {
            Ok(document) => document,
            Err(issue) => {
                return SaveConfigResult::ValidationFailed {
                    request_id,
                    diagnostics: vec![*issue],
                }
            }
        };
        let expands = permissions_expand(&current_permissions, &proposed_permissions);
        match (expands, request.confirmation_ref.as_deref()) {
            (true, None) => {
                let proposed_hash = hash_bytes(value.as_bytes());
                let challenge = match issue_confirmation(
                    revisions_root,
                    &item.summary.id,
                    &proposed_hash,
                    &baseline.asset_content_hash,
                    "扩大 Agent 长期权限边界",
                ) {
                    Ok(challenge) => challenge,
                    Err(message) => {
                        return SaveConfigResult::SaveFailed {
                            request_id,
                            diagnostics: vec![diagnostic(
                                "confirmation_issue_failed",
                                "error",
                                &message,
                                Some(relative_path.into()),
                                Some("修复本地确认存储后重试"),
                            )],
                            retryable: true,
                            file_state: "unchanged".into(),
                            recovery_ref: None,
                        }
                    }
                };
                return SaveConfigResult::ConfirmationRequired {
                    request_id,
                    challenge,
                    affected_agent_ids: Vec::new(),
                    diagnostics: vec![diagnostic(
                        "permission_expansion_confirmation_required",
                        "warning",
                        "扩大 Agent 长期权限必须独立确认",
                        Some(relative_path.into()),
                        Some("核对影响范围后确认本次 challenge"),
                    )],
                };
            }
            (true, Some(confirmation_ref)) => {
                let proposed_hash = hash_bytes(value.as_bytes());
                if let Err(message) = consume_confirmation(
                    revisions_root,
                    confirmation_ref,
                    &item.summary.id,
                    &proposed_hash,
                    &baseline.asset_content_hash,
                ) {
                    return SaveConfigResult::ValidationFailed {
                        request_id,
                        diagnostics: vec![diagnostic(
                            "permission_confirmation_invalid",
                            "error",
                            &message,
                            Some(relative_path.into()),
                            Some("重新发起保存并获取新的确认 challenge"),
                        )],
                    };
                }
                confirmation_refs.push(confirmation_ref.into());
            }
            (false, Some(_)) => {
                return SaveConfigResult::ValidationFailed {
                    request_id,
                    diagnostics: vec![diagnostic(
                        "permission_confirmation_unexpected",
                        "error",
                        "收紧或不变的长期权限不能携带确认引用",
                        Some(relative_path.into()),
                        Some("移除 confirmationRef 后重试"),
                    )],
                }
            }
            (false, None) => {}
        }
    } else if request.confirmation_ref.is_some() {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "confirmation_not_supported",
                "error",
                "该配置分支不接受确认引用",
                Some(relative_path.into()),
                Some("移除 confirmationRef 后重试"),
            )],
        };
    }
    let previous_hash = item.summary.container_content_hash.clone();
    if !baseline.target_exists && optional_managed_yaml_content(change_kind).is_none() {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "asset_creation_not_allowed",
                "error",
                "该配置资产不允许从缺失状态创建",
                Some(relative_path.into()),
                Some("恢复必需配置文件后重新发现"),
            )],
        };
    }
    if let Err(message) = restricted_atomic_write(
        &item.target,
        value.as_bytes(),
        baseline.target_exists,
        label,
    ) {
        return SaveConfigResult::SaveFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "save_failed",
                "error",
                &message,
                Some(relative_path.into()),
                Some("检查目录权限后重试"),
            )],
            retryable: true,
            file_state: "unchanged".into(),
            recovery_ref: None,
        };
    }
    let verified = match fs::read_to_string(&item.target) {
        Ok(content) if content == value => content,
        _ => {
            return SaveConfigResult::SaveFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "write_not_verified",
                    "error",
                    &format!("{label} 写后重读验证失败"),
                    Some(relative_path.into()),
                    Some("重新发现文件状态"),
                )],
                retryable: false,
                file_state: "write_not_verified".into(),
                recovery_ref: None,
            }
        }
    };
    let written_hash = hash_bytes(verified.as_bytes());
    let saved_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    let receipt_id = stable_id(
        "receipt",
        &format!(
            "{}:{previous_hash}:{written_hash}:{saved_at}",
            item.summary.id
        ),
    );
    let revision_id = stable_id(
        "revision",
        &format!(
            "{}:{previous_hash}:{written_hash}:{saved_at}",
            item.summary.id
        ),
    );
    let receipt = WriteReceiptDto {
        id: receipt_id.clone(),
        container_id: item.summary.container_id.clone(),
        previous_container_hash: previous_hash.clone(),
        written_container_hash: written_hash.clone(),
        verified_at: saved_at.clone(),
        atomic_replace: true,
    };
    let revision = ConfigRevisionDto {
        id: revision_id,
        asset_id: item.summary.id.clone(),
        container_id: item.summary.container_id.clone(),
        locator: item.container.locator.clone(),
        asset_content_hash: written_hash.clone(),
        container_content_hash: written_hash.clone(),
        source_asset_baseline_hash: baseline.asset_content_hash,
        source_container_baseline_hash: baseline.container_content_hash,
        redacted: false,
        write_receipt_id: receipt_id,
        saved_at,
        summary: restored_from_revision_id
            .as_ref()
            .map_or_else(|| summary.into(), |id| format!("恢复自 {id}")),
        confirmation_refs,
        restored_from_revision_id,
    };
    if append_revision(revisions_root, &revision, &verified).is_err() {
        return SaveConfigResult::SaveFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "revision_pending",
                "error",
                &format!("{label} 已验证写入，但 ConfigRevision 记录失败"),
                Some(relative_path.into()),
                Some("保留 recovery 状态并修复本地存储"),
            )],
            retryable: false,
            file_state: "verified_written_revision_pending".into(),
            recovery_ref: Some(revision.id),
        };
    }
    let mut asset = item.summary;
    asset.asset_content_hash = written_hash.clone();
    asset.container_content_hash = written_hash;
    SaveConfigResult::Saved {
        request_id,
        asset,
        revision: Box::new(revision),
        write_receipt: receipt,
    }
}

pub(crate) fn recover_config_revision_registered_at(
    database: &Path,
    managed_root: &Path,
    revisions_root: &Path,
    request: RecoverConfigRevisionRequest,
) -> SaveConfigResult {
    recover_config_revision_with_database(Some(database), managed_root, revisions_root, request)
}

fn recover_config_revision_with_database(
    _database: Option<&Path>,
    managed_root: &Path,
    revisions_root: &Path,
    request: RecoverConfigRevisionRequest,
) -> SaveConfigResult {
    let request_id = request.request_id.clone();
    if !validate_identifier(&request.request_id)
        || request.asset_id.len() > 160
        || !validate_identifier(&request.recovery_ref)
    {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "recovery_request_invalid",
                "error",
                "ConfigRevision 恢复引用无效",
                None,
                Some("重新加载当前 Instructions 后重试"),
            )],
        };
    }
    if list_revisions_at(revisions_root, &request.asset_id)
        .is_ok_and(|items| items.iter().any(|item| item.id == request.recovery_ref))
    {
        let loaded = match load_editor_at(
            managed_root,
            LoadEditorRequest {
                request_id: request.request_id,
                asset_id: request.asset_id,
            },
        ) {
            Ok(loaded) => loaded,
            Err(message) => {
                return SaveConfigResult::ValidationFailed {
                    request_id,
                    diagnostics: vec![diagnostic(
                        "recovery_asset_unavailable",
                        "error",
                        &message,
                        None,
                        Some("重新发现目标配置资产"),
                    )],
                }
            }
        };
        return SaveConfigResult::Unchanged {
            request_id,
            asset: loaded.asset,
        };
    }
    let loaded = match load_editor_at(
        managed_root,
        LoadEditorRequest {
            request_id: request.request_id,
            asset_id: request.asset_id,
        },
    ) {
        Ok(loaded) => loaded,
        Err(message) => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "recovery_asset_unavailable",
                    "error",
                    &message,
                    None,
                    Some("重新发现目标配置资产"),
                )],
            }
        }
    };
    let saved_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Nanos, true);
    let (relative_path, label) = match loaded.asset.kind.as_str() {
        "instructions" => ("instructions.md", "Instructions"),
        "context" => ("config/context.yaml", "上下文策略"),
        "rules" => ("config/rules.yaml", "Rule 引用"),
        "skills" => ("config/skills.yaml", "Skill 引用"),
        "mcp" => ("config/mcp.yaml", "MCP 引用"),
        "permissions" => ("config/permissions.yaml", "长期权限边界"),
        "sop" => ("config/sop.yaml", "SOP 引用"),
        "hooks" => ("config/hooks.yaml", "Hook 引用"),
        "commands" => ("config/commands.yaml", "Command 引用"),
        _ => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "recovery_kind_unsupported",
                    "error",
                    "目标配置资产类型尚不支持补记",
                    None,
                    Some("重新选择已冻结的配置资产"),
                )],
            }
        }
    };
    let revision = ConfigRevisionDto {
        id: request.recovery_ref,
        asset_id: loaded.asset.id.clone(),
        container_id: loaded.asset.container_id.clone(),
        locator: AssetLocatorDto {
            root_kind: RootKind::Managed,
            display_path: format!("受管 AgentPackage / {relative_path}"),
            relative_path: None,
        },
        asset_content_hash: loaded.asset.asset_content_hash.clone(),
        container_content_hash: loaded.asset.container_content_hash.clone(),
        source_asset_baseline_hash: loaded.baseline_ref.asset_content_hash,
        source_container_baseline_hash: loaded.baseline_ref.container_content_hash,
        redacted: false,
        write_receipt_id: stable_id(
            "receipt-recovery",
            &format!("{}:{saved_at}", loaded.asset.id),
        ),
        saved_at,
        summary: format!("补记已验证写入的 {label}"),
        confirmation_refs: Vec::new(),
        restored_from_revision_id: None,
    };
    if append_revision(revisions_root, &revision, &loaded.canonical_content).is_err() {
        return SaveConfigResult::SaveFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "revision_pending",
                "error",
                &format!("ConfigRevision 仍无法补记，{label} 文件未再次写入"),
                Some(relative_path.into()),
                Some("修复本地版本存储后重试恢复引用"),
            )],
            retryable: true,
            file_state: "verified_written_revision_pending".into(),
            recovery_ref: Some(revision.id),
        };
    }
    let receipt = WriteReceiptDto {
        id: revision.write_receipt_id.clone(),
        container_id: revision.container_id.clone(),
        previous_container_hash: revision.container_content_hash.clone(),
        written_container_hash: revision.container_content_hash.clone(),
        verified_at: revision.saved_at.clone(),
        atomic_replace: true,
    };
    SaveConfigResult::Saved {
        request_id,
        asset: loaded.asset,
        revision: Box::new(revision),
        write_receipt: receipt,
    }
}

pub(crate) fn restore_config_revision_registered_at(
    database: &Path,
    managed_root: &Path,
    revisions_root: &Path,
    request: RestoreConfigRevisionRequest,
) -> SaveConfigResult {
    restore_config_revision_with_database(Some(database), managed_root, revisions_root, request)
}

fn restore_config_revision_with_database(
    database: Option<&Path>,
    managed_root: &Path,
    revisions_root: &Path,
    request: RestoreConfigRevisionRequest,
) -> SaveConfigResult {
    let request_id = request.request_id.clone();
    if !validate_identifier(&request.request_id)
        || request.asset_id.len() > 160
        || !validate_identifier(&request.revision_id)
        || request.base_content.len() > 1024 * 1024
        || !request.confirmed
    {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "restore_request_invalid",
                "error",
                "ConfigRevision 恢复请求无效或尚未确认",
                None,
                Some("重新核对历史版本差异并确认恢复"),
            )],
        };
    }
    let revisions = match list_revisions_at(revisions_root, &request.asset_id) {
        Ok(revisions) => revisions,
        Err(message) => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "revision_unavailable",
                    "error",
                    &message,
                    None,
                    Some("重新加载配置历史后重试"),
                )],
            }
        }
    };
    if !revisions
        .iter()
        .any(|revision| revision.id == request.revision_id)
    {
        return SaveConfigResult::ValidationFailed {
            request_id,
            diagnostics: vec![diagnostic(
                "revision_asset_mismatch",
                "error",
                "目标 ConfigRevision 不属于当前配置资产",
                None,
                Some("重新选择该资产的历史版本"),
            )],
        };
    }
    let content = match read_revision_content_at(revisions_root, &request.revision_id) {
        Ok(content) => content,
        Err(message) => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "revision_content_invalid",
                    "error",
                    &message,
                    None,
                    Some("修复本地版本记录后重试"),
                )],
            }
        }
    };
    let loaded_asset = match load_editor_at(
        managed_root,
        LoadEditorRequest {
            request_id: format!("{}-kind", request.request_id),
            asset_id: request.asset_id.clone(),
        },
    ) {
        Ok(loaded) => loaded.asset,
        Err(message) => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "restore_asset_unavailable",
                    "error",
                    &message,
                    None,
                    Some("重新发现并加载目标配置资产"),
                )],
            }
        }
    };
    let asset_kind = loaded_asset.kind;
    let owner = match load_asset_locator_at(managed_root, &request.asset_id)
        .ok()
        .and_then(|locator| owner_from_locator(&locator, &asset_kind))
    {
        Some(owner) => owner,
        None => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "restore_owner_unavailable",
                    "error",
                    "无法从目标配置资产定位信息确认 owner",
                    None,
                    Some("重新发现并加载目标配置资产"),
                )],
            }
        }
    };
    let change = match asset_kind.as_str() {
        "instructions" => ConfigChangeDto::Instructions { value: content },
        "context" => ConfigChangeDto::Context { value: content },
        "rules" => ConfigChangeDto::Rules { value: content },
        "skills" => ConfigChangeDto::Skills { value: content },
        "mcp" => ConfigChangeDto::Mcp { value: content },
        "permissions" => ConfigChangeDto::Permissions { value: content },
        "sop" => ConfigChangeDto::Sop { value: content },
        "hooks" => ConfigChangeDto::Hooks { value: content },
        "commands" => ConfigChangeDto::Commands { value: content },
        _ => {
            return SaveConfigResult::ValidationFailed {
                request_id,
                diagnostics: vec![diagnostic(
                    "restore_kind_unsupported",
                    "error",
                    "目标配置资产类型尚不支持恢复",
                    None,
                    Some("选择已冻结的 Instructions、ContextPolicy、Rule 或 Skill 引用资产"),
                )],
            }
        }
    };
    let revision_id = request.revision_id;
    save_config_with_revision_source(
        managed_root,
        revisions_root,
        database,
        SaveConfigRequest {
            request_id: request.request_id,
            asset_id: request.asset_id,
            expected_owner: owner,
            change,
            expected_baseline: request.expected_baseline,
            base_content: request.base_content,
            confirmation_ref: request.confirmation_ref,
        },
        Some(revision_id),
    )
}

pub(crate) fn load_asset_locator_at(
    managed_root: &Path,
    asset_id: &str,
) -> Result<AssetLocatorDto, String> {
    let (assets, _) = discover_managed_assets(managed_root);
    assets
        .into_iter()
        .find(|item| item.summary.id == asset_id)
        .map(|item| item.container.locator)
        .ok_or_else(|| "配置资产不存在、不可用或身份已变化".to_string())
}

pub(crate) fn load_editor_at(
    managed_root: &Path,
    request: LoadEditorRequest,
) -> Result<LoadEditorResult, String> {
    if !validate_identifier(&request.request_id) || request.asset_id.len() > 160 {
        return Err("编辑器加载请求无效".into());
    }
    let (assets, _) = discover_managed_assets(managed_root);
    let item = assets
        .into_iter()
        .find(|item| item.summary.id == request.asset_id)
        .ok_or_else(|| "配置资产不存在、不可用或身份已变化".to_string())?;
    if item.summary.parse_status != "parsed" {
        return Err("配置资产当前不支持结构化编辑".into());
    }
    let baseline_id = stable_id(
        "baseline",
        &format!(
            "{}:{}:{}",
            item.summary.id, item.summary.asset_content_hash, item.summary.container_content_hash
        ),
    );
    Ok(LoadEditorResult {
        request_id: request.request_id,
        baseline_ref: BaselineRefDto {
            id: baseline_id,
            asset_id: item.summary.id.clone(),
            container_id: item.summary.container_id.clone(),
            asset_content_hash: item.summary.asset_content_hash.clone(),
            container_content_hash: item.summary.container_content_hash.clone(),
            target_exists: item.target_exists,
        },
        diagnostics: item.summary.diagnostics.clone(),
        asset: item.summary,
        canonical_content: item.content,
        redacted: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_request_rejects_removed_host_scan_flag() {
        let error = serde_json::from_value::<DiscoveryRequest>(serde_json::json!({
            "requestId": "discover",
            "includeClaudeUserRoot": false,
        }))
        .unwrap_err();
        assert!(error.to_string().contains("includeClaudeUserRoot"));
    }

    #[test]
    fn legacy_agent_fields_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let manifest = root.path().join("agent.yaml");
        fs::write(
            &manifest,
            "schemaVersion: 1\nid: alpha\nroleId: legacy-role\n",
        )
        .unwrap();
        assert_eq!(
            manifest_facts(&manifest).unwrap_err().code,
            "manifest_legacy_field_rejected"
        );

        let mut index = serde_json::Map::new();
        index.insert("id".into(), serde_json::json!("alpha"));
        index.insert("serviceGrants".into(), serde_json::json!([]));
        assert!(contains_rejected_agent_field(&index));
    }

    #[test]
    fn manifest_facts_require_canonical_team_id() {
        let root = tempfile::tempdir().unwrap();
        let manifest = root.path().join("agent.yaml");
        fs::write(&manifest, "schemaVersion: 1\nid: alpha\nteamId: team-one\n").unwrap();
        assert_eq!(
            manifest_facts(&manifest).unwrap(),
            ("alpha".into(), "team-one".into(), 1)
        );

        fs::write(&manifest, "schemaVersion: 1\nid: alpha\n").unwrap();
        assert_eq!(
            manifest_facts(&manifest).unwrap_err().code,
            "manifest_team_id_invalid"
        );
        fs::write(&manifest, "schemaVersion: 1\nid: alpha\nteamId: ../other\n").unwrap();
        assert_eq!(
            manifest_facts(&manifest).unwrap_err().code,
            "manifest_team_id_invalid"
        );
    }

    #[test]
    fn managed_asset_branches_preserve_owner() {
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("agt_alpha");
        fs::create_dir_all(package.join("config")).unwrap();
        fs::write(
            package.join("agent.yaml"),
            "schemaVersion: 1\nid: alpha\nteamId: team-one\n",
        )
        .unwrap();
        fs::write(package.join("instructions.md"), "# Alpha\n").unwrap();
        fs::write(package.join("config/context.yaml"), "not: valid context\n").unwrap();

        let (assets, _) = discover_managed_assets(root.path());
        for kind in ["instructions", "context", "rules"] {
            let asset = assets
                .iter()
                .find(|item| item.summary.kind == kind)
                .unwrap();
            assert_eq!(asset.summary.agent_id, "alpha");
            assert_eq!(asset.summary.team_id, "team-one");
        }
    }

    #[test]
    fn project_binding_change_is_not_part_of_v3_contract() {
        assert!(
            serde_json::from_value::<ConfigChangeDto>(serde_json::json!({
                "kind": "project_binding",
                "value": "legacy"
            }))
            .is_err()
        );
    }
}
