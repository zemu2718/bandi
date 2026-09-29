use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy)]
pub(crate) struct PackageLimits {
    pub(crate) max_files: usize,
    pub(crate) max_file_bytes: u64,
    pub(crate) max_total_bytes: u64,
    pub(crate) max_depth: usize,
}

pub(crate) const SKILL_ENTRYPOINT_LIMIT: u64 = 256 * 1024;
pub(crate) const SKILL_LIMITS: PackageLimits = PackageLimits {
    max_files: 512,
    max_file_bytes: 10 * 1024 * 1024,
    max_total_bytes: 50 * 1024 * 1024,
    max_depth: 12,
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PackageFile {
    pub(crate) path: String,
    pub(crate) bytes: Vec<u8>,
}

impl PackageFile {
    pub(crate) fn text(path: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            bytes: content.into().into_bytes(),
        }
    }

    pub(crate) fn utf8(&self) -> Result<&str, String> {
        std::str::from_utf8(&self.bytes)
            .map_err(|_| "ASSET_PACKAGE_ENTRYPOINT_INVALID: SKILL.md 必须是 UTF-8".to_string())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PackageSnapshot {
    pub(crate) files: Vec<PackageFile>,
    directories: Vec<String>,
    pub(crate) fingerprint: String,
    pub(crate) total_bytes: u64,
}

impl PackageSnapshot {
    pub(crate) fn directories(&self) -> impl Iterator<Item = &str> {
        self.directories.iter().map(String::as_str)
    }
}

fn sensitive_component(value: &str) -> bool {
    let folded = value.to_lowercase();
    matches!(
        folded.as_str(),
        ".git"
            | ".hg"
            | ".svn"
            | ".ssh"
            | ".env"
            | "credentials"
            | "credentials.json"
            | "secrets"
            | "cookies"
            | "sessions"
            | "keychain"
            | "cache"
            | "caches"
            | "history"
            | "histories"
            | "log"
            | "logs"
            | "id_rsa"
            | "id_ed25519"
    ) || folded.ends_with(".pem")
        || folded.ends_with(".key")
        || folded.ends_with(".db")
        || folded.ends_with(".sqlite")
        || folded.ends_with(".sqlite3")
}

pub(crate) fn validate_relative_path(value: &str, limits: PackageLimits) -> Result<(), String> {
    let path = Path::new(value);
    let mut depth = 0;
    if value.is_empty()
        || path.is_absolute()
        || value.contains('\\')
        || value.chars().any(char::is_control)
    {
        return Err("ASSET_PACKAGE_PATH_INVALID: 包含无效相对路径".into());
    }
    if value.eq_ignore_ascii_case("asset.yaml") {
        return Err("ASSET_PACKAGE_RESERVED_PATH_REJECTED: asset.yaml 为 Bandi 保留文件".into());
    }
    for component in path.components() {
        match component {
            Component::Normal(part) if !part.is_empty() => {
                let part = part
                    .to_str()
                    .ok_or_else(|| "ASSET_PACKAGE_PATH_INVALID: 文件名必须是 UTF-8".to_string())?;
                if sensitive_component(part) {
                    return Err("ASSET_PACKAGE_SENSITIVE_PATH_REJECTED: 包含敏感文件或目录".into());
                }
                depth += 1;
            }
            _ => return Err("ASSET_PACKAGE_PATH_INVALID: 包含无效相对路径".into()),
        }
    }
    if depth == 0 || depth > limits.max_depth {
        return Err("ASSET_PACKAGE_DEPTH_EXCEEDED: 目录层级超过限制".into());
    }
    Ok(())
}

fn digest_field(digest: &mut Sha256, bytes: &[u8]) {
    digest.update((bytes.len() as u64).to_be_bytes());
    digest.update(bytes);
}

fn fingerprint(directories: &[String], files: &[PackageFile]) -> String {
    let empty_hash = Sha256::digest([]).to_vec();
    let mut entries = directories
        .iter()
        .map(|path| {
            (
                path.as_str(),
                b"directory".as_slice(),
                0,
                empty_hash.clone(),
            )
        })
        .chain(files.iter().map(|file| {
            (
                file.path.as_str(),
                b"file".as_slice(),
                file.bytes.len() as u64,
                Sha256::digest(&file.bytes).to_vec(),
            )
        }))
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.0.cmp(right.0).then(left.1.cmp(right.1)));
    let mut digest = Sha256::new();
    for (path, entry_type, length, content_hash) in entries {
        digest_field(&mut digest, path.as_bytes());
        digest_field(&mut digest, entry_type);
        digest_field(&mut digest, &length.to_be_bytes());
        digest_field(&mut digest, &content_hash);
    }
    format!("sha256:{:x}", digest.finalize())
}

fn validate_entries(
    directories: &mut Vec<String>,
    files: &mut Vec<PackageFile>,
    limits: PackageLimits,
) -> Result<u64, String> {
    if files.is_empty() || files.len() > limits.max_files {
        return Err("ASSET_PACKAGE_FILE_COUNT_EXCEEDED: 文件数量无效或超过限制".into());
    }
    directories.sort();
    directories.dedup();
    files.sort_by(|left, right| left.path.cmp(&right.path));
    let mut folded = HashSet::new();
    for path in directories
        .iter()
        .map(String::as_str)
        .chain(files.iter().map(|file| file.path.as_str()))
    {
        validate_relative_path(path, limits)?;
        if !folded.insert(path.to_lowercase()) {
            return Err("ASSET_PACKAGE_PATH_CONFLICT: 包含大小写折叠重名路径".into());
        }
    }
    let mut total = 0_u64;
    for file in files.iter() {
        let size = file.bytes.len() as u64;
        if size > limits.max_file_bytes {
            return Err("ASSET_PACKAGE_FILE_TOO_LARGE: 单个文件超过限制".into());
        }
        if file.path == "SKILL.md" {
            if size > SKILL_ENTRYPOINT_LIMIT {
                return Err("ASSET_PACKAGE_ENTRYPOINT_TOO_LARGE: SKILL.md 超过 256 KiB".into());
            }
            file.utf8()?;
        }
        total = total
            .checked_add(size)
            .ok_or_else(|| "ASSET_PACKAGE_TOO_LARGE: 包大小超过限制".to_string())?;
        if total > limits.max_total_bytes {
            return Err("ASSET_PACKAGE_TOO_LARGE: 包大小超过限制".into());
        }
    }
    Ok(total)
}

pub(crate) fn from_files(
    files: Vec<PackageFile>,
    limits: PackageLimits,
) -> Result<PackageSnapshot, String> {
    let mut directories = files
        .iter()
        .flat_map(|file| {
            let parts = file.path.split('/').collect::<Vec<_>>();
            (1..parts.len()).map(move |length| parts[..length].join("/"))
        })
        .collect();
    from_entries(files, &mut directories, limits)
}

fn from_entries(
    mut files: Vec<PackageFile>,
    directories: &mut Vec<String>,
    limits: PackageLimits,
) -> Result<PackageSnapshot, String> {
    let total_bytes = validate_entries(directories, &mut files, limits)?;
    Ok(PackageSnapshot {
        fingerprint: fingerprint(directories, &files),
        files,
        directories: directories.clone(),
        total_bytes,
    })
}

#[cfg(unix)]
fn reject_hard_link(metadata: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    if metadata.nlink() > 1 {
        return Err("ASSET_PACKAGE_HARD_LINK_REJECTED: 资产包不允许异常硬链接".into());
    }
    Ok(())
}

#[cfg(not(unix))]
fn reject_hard_link(_: &fs::Metadata) -> Result<(), String> {
    Ok(())
}

#[derive(Default)]
struct ReadBudget {
    files: usize,
    bytes: u64,
}

#[cfg(unix)]
fn same_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev() && left.ino() == right.ino()
}

#[cfg(not(unix))]
fn same_identity(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    left.file_type() == right.file_type() && left.len() == right.len()
}

fn open_regular_file(path: &Path) -> Result<fs::File, String> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options
        .open(path)
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法安全打开资产包文件".to_string())
}

fn read_file(
    path: &Path,
    observed: &fs::Metadata,
    limits: PackageLimits,
    budget: &mut ReadBudget,
) -> Result<Vec<u8>, String> {
    reject_hard_link(observed)?;
    if observed.len() > limits.max_file_bytes {
        return Err("ASSET_PACKAGE_FILE_TOO_LARGE: 单个文件超过限制".into());
    }
    let next_total = budget
        .bytes
        .checked_add(observed.len())
        .ok_or_else(|| "ASSET_PACKAGE_TOO_LARGE: 包大小超过限制".to_string())?;
    if next_total > limits.max_total_bytes {
        return Err("ASSET_PACKAGE_TOO_LARGE: 包大小超过限制".into());
    }
    let mut file = open_regular_file(path)?;
    let opened = file
        .metadata()
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法检查已打开文件".to_string())?;
    if !opened.is_file() || opened.len() != observed.len() || !same_identity(observed, &opened) {
        return Err("ASSET_PACKAGE_SOURCE_CHANGED: 资产包文件在读取前发生变化".into());
    }
    let max_read = observed.len().saturating_add(1);
    let mut bytes = Vec::with_capacity(observed.len() as usize);
    file.by_ref()
        .take(max_read)
        .read_to_end(&mut bytes)
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法读取资产包文件".to_string())?;
    let verified = file
        .metadata()
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法复核已打开文件".to_string())?;
    if bytes.len() as u64 != observed.len()
        || verified.len() != observed.len()
        || !same_identity(&opened, &verified)
    {
        return Err("ASSET_PACKAGE_SOURCE_CHANGED: 资产包文件在读取期间发生变化".into());
    }
    budget.bytes = next_total;
    Ok(bytes)
}

fn collect(
    root: &Path,
    directory: &Path,
    limits: PackageLimits,
    ignored_root_file: Option<&str>,
    budget: &mut ReadBudget,
    files: &mut Vec<PackageFile>,
    directories: &mut Vec<String>,
) -> Result<(), String> {
    let directory_before = fs::symlink_metadata(directory)
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法检查资产包目录".to_string())?;
    if directory_before.file_type().is_symlink() || !directory_before.is_dir() {
        return Err("ASSET_PACKAGE_SOURCE_CHANGED: 资产包目录在扫描期间发生变化".into());
    }
    let mut entries = fs::read_dir(directory)
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法读取资产包".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法枚举资产包".to_string())?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 无法检查资产包条目".to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("ASSET_PACKAGE_SYMLINK_REJECTED: 资产包不允许符号链接".into());
        }
        let relative = path
            .strip_prefix(root)
            .ok()
            .and_then(Path::to_str)
            .ok_or_else(|| "ASSET_PACKAGE_PATH_INVALID: 文件名必须是 UTF-8".to_string())?
            .replace(std::path::MAIN_SEPARATOR, "/");
        if ignored_root_file.is_some_and(|name| relative.eq_ignore_ascii_case(name)) {
            continue;
        }
        validate_relative_path(&relative, limits)?;
        if metadata.is_dir() {
            directories.push(relative);
            collect(
                root,
                &path,
                limits,
                ignored_root_file,
                budget,
                files,
                directories,
            )?;
        } else if metadata.is_file() {
            budget.files += 1;
            if budget.files > limits.max_files {
                return Err("ASSET_PACKAGE_FILE_COUNT_EXCEEDED: 文件数量超过限制".into());
            }
            let bytes = read_file(&path, &metadata, limits, budget)?;
            files.push(PackageFile {
                path: relative,
                bytes,
            });
        } else {
            return Err("ASSET_PACKAGE_ENTRY_REJECTED: 资产包仅允许普通文件和目录".into());
        }
    }
    let directory_after = fs::symlink_metadata(directory)
        .map_err(|_| "ASSET_PACKAGE_SOURCE_CHANGED: 资产包目录在扫描期间发生变化".to_string())?;
    if !directory_after.is_dir() || !same_identity(&directory_before, &directory_after) {
        return Err("ASSET_PACKAGE_SOURCE_CHANGED: 资产包目录在扫描期间发生变化".into());
    }
    Ok(())
}

pub(crate) fn read_directory(
    root: &Path,
    limits: PackageLimits,
) -> Result<PackageSnapshot, String> {
    read_directory_with_ignored_root_file(root, limits, None)
}

pub(crate) fn read_managed_directory(
    root: &Path,
    limits: PackageLimits,
    ignored_root_file: &str,
) -> Result<PackageSnapshot, String> {
    read_directory_with_ignored_root_file(root, limits, Some(ignored_root_file))
}

fn read_directory_with_ignored_root_file(
    root: &Path,
    limits: PackageLimits,
    ignored_root_file: Option<&str>,
) -> Result<PackageSnapshot, String> {
    let metadata = fs::symlink_metadata(root)
        .map_err(|_| "ASSET_PACKAGE_UNREADABLE: 资产包目录不存在".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("ASSET_PACKAGE_ROOT_REJECTED: 资产包来源必须是普通目录".into());
    }
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut budget = ReadBudget::default();
    collect(
        root,
        root,
        limits,
        ignored_root_file,
        &mut budget,
        &mut files,
        &mut directories,
    )?;
    from_entries(files, &mut directories, limits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_deterministic_binary_safe_and_path_sensitive() {
        let a = from_files(
            vec![
                PackageFile::text("z.txt", "2"),
                PackageFile {
                    path: "a/data.bin".into(),
                    bytes: vec![0, 159, 146, 150],
                },
            ],
            SKILL_LIMITS,
        )
        .unwrap();
        let b = from_files(a.files.iter().rev().cloned().collect(), SKILL_LIMITS).unwrap();
        assert_eq!(a.fingerprint, b.fingerprint);
        assert_ne!(
            a.fingerprint,
            from_files(vec![PackageFile::text("other", "2")], SKILL_LIMITS)
                .unwrap()
                .fingerprint
        );
    }

    #[test]
    fn frozen_limits_and_unsafe_names_are_rejected() {
        assert_eq!(SKILL_LIMITS.max_depth, 12);
        assert_eq!(SKILL_LIMITS.max_files, 512);
        assert_eq!(SKILL_LIMITS.max_file_bytes, 10 * 1024 * 1024);
        assert_eq!(SKILL_LIMITS.max_total_bytes, 50 * 1024 * 1024);
        for path in [
            "../secret",
            "a/NAME",
            "a/na\u{0}me",
            ".git/config",
            "secret.pem",
            "cache/index.json",
            "history/events.json",
            "logs/latest.txt",
            "state.sqlite",
            "asset.yaml",
            "ASSET.YAML",
        ] {
            let files = if path == "a/NAME" {
                vec![
                    PackageFile::text("a/name", "1"),
                    PackageFile::text(path, "2"),
                ]
            } else {
                vec![PackageFile::text(path, "x")]
            };
            assert!(
                from_files(files, SKILL_LIMITS).is_err(),
                "accepted {path:?}"
            );
        }
        assert!(from_files(
            vec![PackageFile {
                path: "SKILL.md".into(),
                bytes: vec![0xff],
            }],
            SKILL_LIMITS,
        )
        .is_err());
    }

    #[test]
    fn total_budget_is_enforced_while_reading() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("one"), [1_u8; 6]).unwrap();
        fs::write(root.path().join("two"), [2_u8; 6]).unwrap();
        let error = read_directory(
            root.path(),
            PackageLimits {
                max_files: 2,
                max_file_bytes: 8,
                max_total_bytes: 10,
                max_depth: 2,
            },
        )
        .unwrap_err();
        assert!(error.contains("TOO_LARGE"));
    }

    #[cfg(unix)]
    #[test]
    fn links_are_rejected_without_leaking_paths() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        symlink(outside.path(), root.path().join("linked")).unwrap();
        let error = read_directory(root.path(), SKILL_LIMITS).unwrap_err();
        assert!(error.contains("SYMLINK"));
        assert!(!error.contains(root.path().to_string_lossy().as_ref()));

        let hard = tempfile::tempdir().unwrap();
        fs::write(hard.path().join("SKILL.md"), "# skill").unwrap();
        fs::hard_link(hard.path().join("SKILL.md"), hard.path().join("copy.md")).unwrap();
        assert!(read_directory(hard.path(), SKILL_LIMITS)
            .unwrap_err()
            .contains("HARD_LINK"));
    }
}
