use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use crate::local_service;

pub(crate) const PROFILE_VERSION: &str = "memory-v4";
const MEMORY_RELATIVE_PATH: &str = "memory/long-term.md";

#[derive(Debug, Clone)]
pub(crate) struct ResolvedMemoryTarget {
    pub(crate) space_id: String,
    pub(crate) agent_id: String,
    pub(crate) state: &'static str,
    pub(crate) root_kind: local_service::RootKind,
    pub(crate) relative_path: String,
    pub(crate) root: PathBuf,
    pub(crate) target: PathBuf,
}

pub(crate) fn validate_id(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != "..";
    valid.then_some(()).ok_or_else(|| format!("{label}无效"))
}

fn agent_package(agents_root: &Path, agent_id: &str) -> Result<PathBuf, String> {
    validate_id(agent_id, "Agent 标识")?;
    let package = agents_root.join(format!("agt_{agent_id}"));
    let metadata =
        fs::symlink_metadata(&package).map_err(|_| "受管 AgentPackage 不存在".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("受管 AgentPackage 必须是普通目录".into());
    }
    let identity_path = package.join(".bandi-agent.json");
    let identity_metadata = fs::symlink_metadata(&identity_path)
        .map_err(|_| "Agent 身份索引不存在或不可读取".to_string())?;
    if identity_metadata.file_type().is_symlink() || !identity_metadata.is_file() {
        return Err("Agent 身份索引必须是普通文件".into());
    }
    let identity: serde_json::Value = serde_json::from_slice(
        &fs::read(identity_path).map_err(|_| "Agent 身份索引不存在或不可读取".to_string())?,
    )
    .map_err(|_| "Agent 身份索引已损坏".to_string())?;
    if identity.get("id").and_then(serde_json::Value::as_str) != Some(agent_id) {
        return Err("Agent 身份索引与请求不匹配".into());
    }
    Ok(package)
}

fn build(
    agents_root: &Path,
    agent_id: &str,
    space_id: &str,
    state: &'static str,
) -> Result<ResolvedMemoryTarget, String> {
    let root = agent_package(agents_root, agent_id)?;
    let relative_path = MEMORY_RELATIVE_PATH.to_string();
    let target = root.join(&relative_path);
    Ok(ResolvedMemoryTarget {
        space_id: space_id.into(),
        agent_id: agent_id.into(),
        state,
        root_kind: local_service::RootKind::Managed,
        relative_path,
        root,
        target,
    })
}

pub(crate) fn discover_requested(
    agents_root: &Path,
    agent_id: &str,
) -> Result<Vec<ResolvedMemoryTarget>, String> {
    Ok(vec![resolve_requested(
        agents_root,
        &format!("memory-agent-{agent_id}"),
        agent_id,
    )?])
}

pub(crate) fn resolve_requested(
    agents_root: &Path,
    space_id: &str,
    agent_id: &str,
) -> Result<ResolvedMemoryTarget, String> {
    validate_id(space_id, "MemorySpace 标识")?;
    validate_id(agent_id, "Agent 标识")?;
    if space_id != format!("memory-agent-{agent_id}") {
        return Err("目标 MemorySpace 不存在或 Agent 无权访问".into());
    }
    build(agents_root, agent_id, space_id, "active")
}

pub(crate) fn read(target: &ResolvedMemoryTarget) -> Result<(String, bool), String> {
    ensure_safe_chain(&target.root, &target.relative_path, false)?;
    match fs::read_to_string(&target.target) {
        Ok(content) => Ok((content, true)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((String::new(), false)),
        Err(_) => Err("无法读取正式 Memory".into()),
    }
}

pub(crate) fn ensure_safe_chain(
    root: &Path,
    relative_path: &str,
    create_parent: bool,
) -> Result<(), String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("正式 Memory 相对路径无效".into());
    }
    let mut current = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("正式 Memory 路径包含符号链接或非目录分量".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && create_parent => {
                fs::create_dir(&current).map_err(|_| "无法创建正式 Memory 目标目录".to_string())?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(_) => return Err("无法检查正式 Memory 目标目录".into()),
        }
    }
    if let Ok(metadata) = fs::symlink_metadata(root.join(relative)) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("正式 Memory 目标必须是普通文件".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agent_root() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        let package = root.path().join("agt_agent-1");
        fs::create_dir(&package).unwrap();
        fs::write(
            package.join(".bandi-agent.json"),
            br#"{"id":"agent-1","teamId":"team-1","status":"active"}"#,
        )
        .unwrap();
        root
    }

    #[test]
    fn resolves_only_agent_owned_v4_target() {
        let root = agent_root();
        let target = resolve_requested(root.path(), "memory-agent-agent-1", "agent-1").unwrap();
        assert_eq!(PROFILE_VERSION, "memory-v4");
        assert_eq!(target.agent_id, "agent-1");
        assert!(resolve_requested(root.path(), "memory-agent-agent-2", "agent-1").is_err());
    }

    #[test]
    fn rejects_symlink_in_memory_path() {
        let root = agent_root();
        let target = resolve_requested(root.path(), "memory-agent-agent-1", "agent-1").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path(), target.root.join("memory")).unwrap();
            assert!(ensure_safe_chain(&target.root, &target.relative_path, true).is_err());
        }
    }
}
