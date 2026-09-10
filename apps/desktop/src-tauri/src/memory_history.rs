use std::{fs, io::Write, path::Path};

use rusqlite::params;

use crate::{domain_store, local_service, memory_service::MemoryRevisionDto, memory_target};

fn root(revisions_root: &Path) -> std::path::PathBuf {
    revisions_root.join("memory")
}

pub(crate) fn append(
    revisions_root: &Path,
    revision: &MemoryRevisionDto,
    content: &str,
) -> Result<(), String> {
    memory_target::validate_id(&revision.id, "MemoryRevision 标识")?;
    let root = root(revisions_root);
    fs::create_dir_all(&root).map_err(|_| "无法创建 MemoryRevision 目录".to_string())?;
    let record_path = root.join(format!("{}.json", revision.id));
    let content_path = root.join(format!("{}.content", revision.id));
    let bytes =
        serde_json::to_vec(revision).map_err(|_| "MemoryRevision 无法序列化".to_string())?;
    let mut content_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&content_path)
        .map_err(|_| "MemoryRevision 已存在或无法创建".to_string())?;
    if content_file
        .write_all(content.as_bytes())
        .and_then(|_| content_file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(&content_path);
        return Err("MemoryRevision 正文无法完整写入".into());
    }
    let record_result = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&record_path)
        .and_then(|mut file| file.write_all(&bytes).and_then(|_| file.sync_all()));
    if record_result.is_err() {
        let _ = fs::remove_file(content_path);
        return Err("MemoryRevision 记录已存在或无法创建".into());
    }
    Ok(())
}

pub(crate) fn read(
    revisions_root: &Path,
    space_id: &str,
    revision_id: &str,
) -> Result<String, String> {
    memory_target::validate_id(revision_id, "MemoryRevision 标识")?;
    let root = root(revisions_root);
    let record_path = root.join(format!("{revision_id}.json"));
    let content_path = root.join(format!("{revision_id}.content"));
    for path in [&record_path, &content_path] {
        let metadata =
            fs::symlink_metadata(path).map_err(|_| "MemoryRevision 不存在或不完整".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("MemoryRevision 记录必须是普通文件".into());
        }
    }
    let revision: MemoryRevisionDto = serde_json::from_slice(
        &fs::read(record_path).map_err(|_| "无法读取 MemoryRevision".to_string())?,
    )
    .map_err(|_| "MemoryRevision 记录无效".to_string())?;
    if revision.id != revision_id || revision.space_id != space_id {
        return Err("MemoryRevision 身份或归属不一致".into());
    }
    let content = fs::read_to_string(content_path)
        .map_err(|_| "无法读取 MemoryRevision 历史内容".to_string())?;
    if local_service::hash_bytes(content.as_bytes()) != revision.content_hash {
        return Err("MemoryRevision 历史内容校验失败".into());
    }
    Ok(content)
}

pub(crate) fn ensure(
    revisions_root: &Path,
    revision: &MemoryRevisionDto,
    content: &str,
) -> Result<(), String> {
    match append(revisions_root, revision, content) {
        Ok(()) => Ok(()),
        Err(_)
            if read(revisions_root, &revision.space_id, &revision.id).as_deref() == Ok(content) =>
        {
            Ok(())
        }
        Err(message) => Err(message),
    }
}

pub(crate) fn belongs_to_space(
    database: &Path,
    space_id: &str,
    revision_id: &str,
) -> Result<bool, String> {
    let connection = domain_store::open_at(database)?;
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM memory_revisions WHERE id = ?1 AND space_id = ?2)",
            params![revision_id, space_id],
            |row| row.get(0),
        )
        .map_err(|_| "无法验证 MemoryRevision 归属".to_string())
}
