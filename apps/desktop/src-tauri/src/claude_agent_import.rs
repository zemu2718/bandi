use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

const MAX_SOURCE_BYTES: u64 = 256 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreviewClaudeAgentRequest {
    pub(crate) source_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeAgentPreviewDto {
    pub(crate) tool_id: &'static str,
    pub(crate) source_path: String,
    pub(crate) source_file_name: String,
    pub(crate) source_baseline_hash: String,
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) instructions: String,
    pub(crate) recognized_fields: Vec<String>,
    pub(crate) ignored_fields: Vec<String>,
}

fn read_source(path: &str) -> Result<(String, Vec<u8>), String> {
    let selected = Path::new(path);
    if !selected.is_absolute()
        || selected.extension().and_then(|value| value.to_str()) != Some("md")
    {
        return Err("CLAUDE_AGENT_INVALID: 请选择 .claude/agents 下的 Markdown Agent 文件".into());
    }
    let metadata = fs::symlink_metadata(selected)
        .map_err(|_| "CLAUDE_AGENT_UNAVAILABLE: 来源文件不存在或不可访问".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES
    {
        return Err(
            "CLAUDE_AGENT_INVALID: 来源必须是小于 256 KiB 的普通文件且不能是符号链接".into(),
        );
    }
    let canonical = fs::canonicalize(selected)
        .map_err(|_| "CLAUDE_AGENT_UNAVAILABLE: 无法规范化来源文件".to_string())?;
    let parent = canonical
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str());
    let claude = canonical
        .parent()
        .and_then(Path::parent)
        .and_then(Path::file_name)
        .and_then(|value| value.to_str());
    if parent != Some("agents") || claude != Some(".claude") {
        return Err("CLAUDE_AGENT_INVALID: 来源必须直接位于 .claude/agents 目录".into());
    }
    let bytes = fs::read(&canonical)
        .map_err(|_| "CLAUDE_AGENT_UNAVAILABLE: 无法读取来源文件".to_string())?;
    Ok((canonical.to_string_lossy().into_owned(), bytes))
}

fn parse_source(canonical: String, bytes: Vec<u8>) -> Result<ClaudeAgentPreviewDto, String> {
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| "CLAUDE_AGENT_INVALID: 来源文件必须是 UTF-8".to_string())?;
    let (frontmatter, instructions) = if let Some(rest) = content.strip_prefix("---\n") {
        let end = rest
            .find("\n---\n")
            .ok_or_else(|| "CLAUDE_AGENT_INVALID: YAML frontmatter 未闭合".to_string())?;
        (&rest[..end], rest[end + 5..].to_string())
    } else if let Some(rest) = content.strip_prefix("---\r\n") {
        let end = rest
            .find("\r\n---\r\n")
            .ok_or_else(|| "CLAUDE_AGENT_INVALID: YAML frontmatter 未闭合".to_string())?;
        (&rest[..end], rest[end + 7..].to_string())
    } else {
        ("", content)
    };
    let fields: serde_yaml::Mapping = if frontmatter.is_empty() {
        serde_yaml::Mapping::new()
    } else {
        serde_yaml::from_str(frontmatter)
            .map_err(|_| "CLAUDE_AGENT_INVALID: YAML frontmatter 无法解析".to_string())?
    };
    let string_field = |key: &str| -> Result<Option<String>, String> {
        match fields.get(serde_yaml::Value::String(key.into())) {
            None => Ok(None),
            Some(serde_yaml::Value::String(value)) => Ok(Some(value.trim().to_string())),
            Some(_) => Err(format!("CLAUDE_AGENT_INVALID: {key} 必须是字符串")),
        }
    };
    let fallback = Path::new(&canonical)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Imported Agent")
        .to_string();
    let name = string_field("name")?
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback);
    let description = string_field("description")?.filter(|value| !value.is_empty());
    if name.chars().count() > 128 || instructions.len() > 256 * 1024 || instructions.contains('\0')
    {
        return Err("CLAUDE_AGENT_INVALID: Agent 名称或正文超出限制".into());
    }
    let keys: Vec<String> = fields
        .keys()
        .filter_map(serde_yaml::Value::as_str)
        .map(str::to_string)
        .collect();
    let recognized_fields = keys
        .iter()
        .filter(|key| matches!(key.as_str(), "name" | "description"))
        .cloned()
        .collect();
    let ignored_fields = keys
        .into_iter()
        .filter(|key| !matches!(key.as_str(), "name" | "description"))
        .collect();
    let source_file_name = Path::new(&canonical)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("agent.md")
        .to_string();
    Ok(ClaudeAgentPreviewDto {
        tool_id: "claude-code",
        source_path: canonical,
        source_file_name,
        source_baseline_hash: crate::local_service::hash_bytes(&bytes),
        name,
        description,
        instructions,
        recognized_fields,
        ignored_fields,
    })
}

pub(crate) fn preview(request: PreviewClaudeAgentRequest) -> Result<ClaudeAgentPreviewDto, String> {
    let (canonical, bytes) = read_source(&request.source_path)?;
    parse_source(canonical, bytes)
}

pub(crate) fn verify(
    source_path: &str,
    expected_hash: &str,
) -> Result<ClaudeAgentPreviewDto, String> {
    let preview = preview(PreviewClaudeAgentRequest {
        source_path: source_path.into(),
    })?;
    if preview.source_baseline_hash != expected_hash {
        return Err("CLAUDE_AGENT_SOURCE_CHANGED: 来源文件在预览后发生变化，请重新预览".into());
    }
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_agent_without_writing_source() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join(".claude/agents");
        fs::create_dir_all(&agents).unwrap();
        let source = agents.join("reviewer.md");
        let original = b"---\nname: Reviewer\ndescription: Reviews code\nmodel: sonnet\n---\nCheck changes carefully.\n";
        fs::write(&source, original).unwrap();
        let preview = preview(PreviewClaudeAgentRequest {
            source_path: source.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(preview.name, "Reviewer");
        assert_eq!(preview.instructions, "Check changes carefully.\n");
        assert_eq!(preview.ignored_fields, vec!["model"]);
        assert_eq!(fs::read(source).unwrap(), original);
    }

    #[test]
    fn supports_crlf_frontmatter() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join(".claude/agents");
        fs::create_dir_all(&agents).unwrap();
        let source = agents.join("windows.md");
        fs::write(
            &source,
            "---\r\nname: Windows Agent\r\ndescription: CRLF\r\n---\r\nKeep CRLF.\r\n",
        )
        .unwrap();
        let result = preview(PreviewClaudeAgentRequest {
            source_path: source.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert_eq!(result.name, "Windows Agent");
        assert_eq!(result.instructions, "Keep CRLF.\r\n");
    }

    #[test]
    fn rejects_invalid_sources_and_changed_content() {
        let root = tempfile::tempdir().unwrap();
        let agents = root.path().join(".claude/agents");
        fs::create_dir_all(&agents).unwrap();
        let outside = root.path().join("outside.md");
        fs::write(&outside, "outside").unwrap();
        assert!(preview(PreviewClaudeAgentRequest {
            source_path: outside.to_string_lossy().into_owned(),
        })
        .unwrap_err()
        .contains("直接位于"));

        let invalid_utf8 = agents.join("invalid.md");
        fs::write(&invalid_utf8, [0xff]).unwrap();
        assert!(preview(PreviewClaudeAgentRequest {
            source_path: invalid_utf8.to_string_lossy().into_owned(),
        })
        .unwrap_err()
        .contains("UTF-8"));

        let source = agents.join("agent.md");
        fs::write(&source, "first").unwrap();
        let first = preview(PreviewClaudeAgentRequest {
            source_path: source.to_string_lossy().into_owned(),
        })
        .unwrap();
        fs::write(&source, "second").unwrap();
        assert!(verify(
            source.to_string_lossy().as_ref(),
            &first.source_baseline_hash
        )
        .unwrap_err()
        .contains("SOURCE_CHANGED"));
    }
}
