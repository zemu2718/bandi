use super::*;

pub(crate) fn preview_import_at(
    path: PathBuf,
    request: SelectSharedAssetImportRequest,
) -> Result<SharedAssetImportPreviewDto, String> {
    if !valid_id(&request.team_id) || !SHARED_ASSET_KINDS.contains(&request.kind.as_str()) {
        return Err("SHARED_ASSET_VALIDATION_FAILED: Team 或类型无效".into());
    }
    ensure_regular_file(&path, "导入来源")?;
    let metadata = fs::metadata(&path)
        .map_err(|_| "SHARED_ASSET_SOURCE_UNREADABLE: 无法读取导入来源".to_string())?;
    if metadata.len() > MAX_CONTENT_BYTES as u64 {
        return Err("SHARED_ASSET_TOO_LARGE: 导入文件超过 256 KiB".into());
    }
    let bytes = fs::read(&path)
        .map_err(|_| "SHARED_ASSET_SOURCE_UNREADABLE: 无法读取导入来源".to_string())?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "SHARED_ASSET_SOURCE_INVALID: 导入文件必须是 UTF-8".to_string())?;
    validate_content(&request.kind, text)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "SHARED_ASSET_SOURCE_INVALID: 文件名无效".to_string())?
        .to_string();
    let suggested_name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("asset")
        .trim()
        .to_string();
    let suggested_id = suggested_name
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let source_hash = hash(&bytes);
    let now = SystemTime::now();
    let expires_at_time = now + IMPORT_TTL;
    let expires_at = chrono::DateTime::<Utc>::from(expires_at_time).to_rfc3339();
    let preview_ref = local_service::stable_id(
        "asset-preview",
        &format!(
            "{}:{}:{}",
            request.request_id,
            source_hash,
            Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ),
    );
    imports()
        .lock()
        .map_err(|_| "SHARED_ASSET_PREVIEW_UNAVAILABLE".to_string())?
        .insert(
            preview_ref.clone(),
            ImportRecord {
                path,
                team_id: request.team_id,
                kind: request.kind.clone(),
                file_name: file_name.clone(),
                source_hash: source_hash.clone(),
                expires_at: expires_at_time,
            },
        );
    Ok(SharedAssetImportPreviewDto {
        request_id: request.request_id,
        preview_ref,
        file_name,
        kind: request.kind,
        size: bytes.len(),
        source_hash,
        suggested_name,
        suggested_id,
        expires_at,
        diagnostics: Vec::new(),
    })
}

pub(crate) fn commit_import_at(
    database: &Path,
    root: &Path,
    revisions_root: &Path,
    request: CommitSharedAssetImportRequest,
) -> Result<SharedAssetMutationResult, String> {
    if !request.confirmed {
        return Err("SHARED_ASSET_CONFIRMATION_REQUIRED: 导入尚未确认".into());
    }
    let record = imports()
        .lock()
        .map_err(|_| "SHARED_ASSET_PREVIEW_UNAVAILABLE".to_string())?
        .remove(&request.preview_ref)
        .ok_or_else(|| "SHARED_ASSET_PREVIEW_EXPIRED: 导入预览不存在或已使用".to_string())?;
    if SystemTime::now() > record.expires_at {
        return Err("SHARED_ASSET_PREVIEW_EXPIRED: 导入预览已过期".into());
    }
    if record.team_id != request.team_id || record.source_hash != request.expected_source_hash {
        return Err("SHARED_ASSET_PREVIEW_MISMATCH: 导入预览与提交不一致".into());
    }
    ensure_regular_file(&record.path, "导入来源")?;
    let bytes = fs::read(&record.path)
        .map_err(|_| "SHARED_ASSET_SOURCE_CHANGED: 导入来源不可再读取".to_string())?;
    if hash(&bytes) != record.source_hash {
        return Err("SHARED_ASSET_SOURCE_CHANGED: 导入来源在预览后发生变化".into());
    }
    let content = String::from_utf8(bytes)
        .map_err(|_| "SHARED_ASSET_SOURCE_CHANGED: 导入来源不再是 UTF-8".to_string())?;
    let source = SharedAssetSourceDto::Imported {
        file_name: record.file_name,
        imported_hash: record.source_hash,
        imported_at: Utc::now().to_rfc3339(),
    };
    create_at(
        database,
        root,
        revisions_root,
        CreateSharedAssetRequest {
            request_id: request.request_id,
            team_id: request.team_id,
            asset_id: request.asset_id,
            name: request.name,
            kind: record.kind,
            content,
        },
        source,
    )
}
