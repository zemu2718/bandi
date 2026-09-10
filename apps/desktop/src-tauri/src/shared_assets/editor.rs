use super::*;

fn recovery_record_path(revisions_root: &Path, recovery_ref: &str) -> PathBuf {
    revisions_root
        .join("pending")
        .join(format!("{recovery_ref}.json"))
}

pub(super) fn persist_recovery_record(
    revisions_root: &Path,
    node: &SharedAssetNodeDto,
    revision: &ConfigRevisionDto,
    receipt: &WriteReceiptDto,
) -> Result<String, String> {
    let recovery_ref = local_service::stable_id(
        "recovery",
        &format!("{}:{}:{}", node.id, node.content_hash, revision.id),
    );
    let record = RevisionRecoveryRecord {
        id: recovery_ref.clone(),
        asset_id: node.id.clone(),
        asset_content_hash: node.content_hash.clone(),
        container_content_hash: node.container_content_hash.clone(),
        expires_at: chrono::DateTime::<Utc>::from(SystemTime::now() + RECOVERY_TTL).to_rfc3339(),
        revision: revision.clone(),
        write_receipt: receipt.clone(),
    };
    let bytes = serde_json::to_vec(&record)
        .map_err(|_| "SHARED_ASSET_RECOVERY_FAILED: 无法序列化恢复记录".to_string())?;
    let path = recovery_record_path(revisions_root, &recovery_ref);
    let parent = path
        .parent()
        .ok_or_else(|| "SHARED_ASSET_RECOVERY_FAILED: 恢复记录目录无效".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|_| "SHARED_ASSET_RECOVERY_FAILED: 无法创建恢复记录目录".to_string())?;
    ensure_regular_directory(parent, "共享资产恢复记录目录")?;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "SHARED_ASSET_RECOVERY_FAILED: 恢复记录已存在或无法创建".to_string())?;
    if file
        .write_all(&bytes)
        .and_then(|_| file.sync_all())
        .is_err()
    {
        let _ = fs::remove_file(path);
        return Err("SHARED_ASSET_RECOVERY_FAILED: 无法完整写入恢复记录".into());
    }
    Ok(recovery_ref)
}

fn load_recovery_record(
    revisions_root: &Path,
    recovery_ref: &str,
) -> Result<(RevisionRecoveryRecord, PathBuf), String> {
    if !valid_id(recovery_ref) || !recovery_ref.starts_with("recovery-") {
        return Err("SHARED_ASSET_RECOVERY_INVALID".into());
    }
    let path = recovery_record_path(revisions_root, recovery_ref);
    ensure_regular_file(&path, "共享资产恢复记录")
        .map_err(|_| "SHARED_ASSET_RECOVERY_INVALID".to_string())?;
    let bytes = fs::read(&path).map_err(|_| "SHARED_ASSET_RECOVERY_INVALID".to_string())?;
    let record: RevisionRecoveryRecord =
        serde_json::from_slice(&bytes).map_err(|_| "SHARED_ASSET_RECOVERY_INVALID".to_string())?;
    if record.id != recovery_ref {
        return Err("SHARED_ASSET_RECOVERY_INVALID".into());
    }
    Ok((record, path))
}

pub(super) fn revision_for(
    node: &SharedAssetNodeDto,
    previous_asset_hash: &str,
    previous_container_hash: &str,
    saved_at: &str,
    summary: &str,
) -> (ConfigRevisionDto, WriteReceiptDto) {
    let container_id = local_service::stable_id("container", &format!("shared:{}", node.id));
    let receipt_id = local_service::stable_id(
        "receipt",
        &format!(
            "{}:{previous_container_hash}:{}:{saved_at}",
            node.id, node.container_content_hash
        ),
    );
    let revision = ConfigRevisionDto {
        id: local_service::stable_id(
            "revision",
            &format!(
                "{}:{previous_container_hash}:{}:{saved_at}",
                node.id, node.container_content_hash
            ),
        ),
        asset_id: node.id.clone(),
        container_id: container_id.clone(),
        locator: node.locator.clone(),
        asset_content_hash: node.content_hash.clone(),
        container_content_hash: node.container_content_hash.clone(),
        source_asset_baseline_hash: previous_asset_hash.into(),
        source_container_baseline_hash: previous_container_hash.into(),
        redacted: false,
        write_receipt_id: receipt_id.clone(),
        saved_at: saved_at.into(),
        summary: summary.into(),
        confirmation_refs: Vec::new(),
        restored_from_revision_id: None,
    };
    let receipt = WriteReceiptDto {
        id: receipt_id,
        container_id,
        previous_container_hash: previous_container_hash.into(),
        written_container_hash: node.container_content_hash.clone(),
        verified_at: saved_at.into(),
        atomic_replace: true,
    };
    (revision, receipt)
}

pub(crate) fn create_at(
    database: &Path,
    root: &Path,
    revisions_root: &Path,
    request: CreateSharedAssetRequest,
    source: SharedAssetSourceDto,
) -> Result<SharedAssetMutationResult, String> {
    validate_request(
        &request.team_id,
        &request.asset_id,
        &request.name,
        &request.kind,
    )?;
    let content = validate_content(&request.kind, &request.content)?;
    let snapshot = domain_store::load_long_term_domain_snapshot_v4_at(database)?;
    if !snapshot.teams.iter().any(|team| team.id == request.team_id) {
        return Err("SHARED_ASSET_TEAM_NOT_FOUND: Team 不存在".into());
    }
    if snapshot.teams.iter().any(|team| {
        team.shared_asset_ids
            .iter()
            .any(|id| id == &request.asset_id)
    }) {
        return Err("SHARED_ASSET_ID_CONFLICT: 共享资产标识已登记".into());
    }
    fs::create_dir_all(root)
        .map_err(|_| "SHARED_ASSET_STORAGE_UNAVAILABLE: 无法创建共享资产根".to_string())?;
    ensure_regular_directory(root, "共享资产根")?;
    let target = root.join(&request.asset_id);
    if target.exists() {
        return Err("SHARED_ASSET_ID_CONFLICT: 共享资产目录已存在".into());
    }
    let manifest_bytes = build_manifest(&request, source)?;
    let staging = root.join(format!(
        ".bandi-staging-{}-{}",
        request.asset_id,
        &hash(request.request_id.as_bytes())[7..19]
    ));
    if staging.exists() {
        return Err("SHARED_ASSET_STAGING_CONFLICT: 暂存目录已存在".into());
    }
    fs::create_dir(&staging)
        .map_err(|_| "SHARED_ASSET_WRITE_FAILED: 无法创建暂存目录".to_string())?;
    let written = (|| {
        restricted_atomic_write(
            &staging.join("asset.yaml"),
            &manifest_bytes,
            false,
            "共享资产 manifest",
        )?;
        restricted_atomic_write(
            &staging.join(content_file(&request.kind).unwrap_or("CONTENT.md")),
            content.as_bytes(),
            false,
            "共享资产正文",
        )?;
        fs::rename(&staging, &target)
            .map_err(|_| "SHARED_ASSET_WRITE_FAILED: 无法提交共享资产目录".to_string())
    })();
    if let Err(error) = written {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    let unregistered = LongTermDomainSnapshotDtoV4 {
        schema_version: snapshot.schema_version,
        teams: snapshot.teams.clone(),
        task_briefs: snapshot.task_briefs.clone(),
    };
    let mut node = discover_package(
        root,
        &target,
        &request.asset_id,
        &LongTermDomainSnapshotDtoV4 {
            schema_version: unregistered.schema_version,
            teams: unregistered
                .teams
                .into_iter()
                .map(|mut team| {
                    if team.id == request.team_id {
                        team.shared_asset_ids.push(request.asset_id.clone());
                    }
                    team
                })
                .collect(),
            task_briefs: unregistered.task_briefs,
        },
    );
    if node.parse_status != "parsed" {
        return Err("SHARED_ASSET_VERIFY_FAILED: 写后重读验证失败".into());
    }
    if domain_store::register_shared_asset_at(database, &request.team_id, &request.asset_id)
        .is_err()
    {
        return Ok(SharedAssetMutationResult::RegistrationPending {
            request_id: request.request_id,
            asset: node,
            file_state: "verified_written_registration_pending".into(),
            diagnostics: vec![diagnostic(
                "shared_asset_registration_pending",
                "error",
                "共享资产已验证写入，但 Team 登记未完成",
                None,
                Some("重试修复登记"),
            )],
        });
    }
    let saved_at = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let empty_hash = hash(&[]);
    let (revision, receipt) =
        revision_for(&node, &empty_hash, &empty_hash, &saved_at, "创建共享资产");
    if local_service::append_revision(revisions_root, &revision, &content).is_err() {
        let recovery_ref = persist_recovery_record(revisions_root, &node, &revision, &receipt)?;
        return Ok(SharedAssetMutationResult::RevisionPending {
            request_id: request.request_id,
            asset: node,
            file_state: "verified_written_revision_pending".into(),
            recovery_ref,
            diagnostics: vec![diagnostic(
                "revision_pending",
                "error",
                "共享资产已验证写入，但版本记录失败",
                None,
                Some("使用 recoveryRef 补记版本"),
            )],
        });
    }
    node.current_revision_id = Some(revision.id.clone());
    Ok(SharedAssetMutationResult::Saved {
        request_id: request.request_id,
        asset: node,
        revision: Box::new(revision),
        write_receipt: receipt,
    })
}

pub(crate) fn load_editor_at(
    root: &Path,
    revisions_root: &Path,
    snapshot: &LongTermDomainSnapshotDtoV4,
    request: SharedAssetIdentityRequest,
) -> Result<SharedAssetEditorDto, String> {
    if !valid_id(&request.asset_id) {
        return Err("SHARED_ASSET_ID_INVALID".into());
    }
    let package = root.join(&request.asset_id);
    ensure_regular_directory(&package, "共享资产目录")?;
    let mut node = discover_package(root, &package, &request.asset_id, snapshot);
    if node.parse_status != "parsed" {
        return Err("SHARED_ASSET_INVALID: 资产不可编辑".into());
    }
    let content_path = node
        .locator
        .relative_path
        .as_deref()
        .map(|path| root.join(path))
        .ok_or_else(|| "SHARED_ASSET_CONTENT_MISSING".to_string())?;
    let canonical_content = fs::read_to_string(content_path)
        .map_err(|_| "SHARED_ASSET_CONTENT_UNREADABLE".to_string())?;
    let container_id = local_service::stable_id("container", &format!("shared:{}", node.id));
    let baseline_ref = BaselineRefDto {
        id: local_service::stable_id(
            "baseline",
            &format!("{}:{}", node.id, node.container_content_hash),
        ),
        asset_id: node.id.clone(),
        container_id,
        asset_content_hash: node.content_hash.clone(),
        container_content_hash: node.container_content_hash.clone(),
        target_exists: true,
    };
    let current_revision_id = local_service::list_revisions_at(revisions_root, &node.id)?
        .first()
        .map(|revision| revision.id.clone());
    node.current_revision_id = current_revision_id.clone();
    Ok(SharedAssetEditorDto {
        request_id: request.request_id,
        asset: node,
        canonical_content,
        baseline_ref,
        current_revision_id,
    })
}

fn side(content: String, manifest_bytes: &[u8]) -> ConfigSideDto {
    ConfigSideDto {
        asset_content_hash: hash(content.as_bytes()),
        container_content_hash: container_hash(manifest_bytes, content.as_bytes()),
        content,
        redacted: false,
    }
}

pub(crate) fn save_at(
    root: &Path,
    revisions_root: &Path,
    snapshot: &LongTermDomainSnapshotDtoV4,
    request: SaveSharedAssetRequest,
    affected_agent_ids: Vec<String>,
) -> Result<SharedAssetMutationResult, String> {
    let loaded = load_editor_at(
        root,
        revisions_root,
        snapshot,
        SharedAssetIdentityRequest {
            request_id: request.request_id.clone(),
            asset_id: request.asset_id.clone(),
        },
    )?;
    let manifest_path = root.join(&request.asset_id).join("asset.yaml");
    let manifest_bytes =
        fs::read(&manifest_path).map_err(|_| "SHARED_ASSET_MANIFEST_UNREADABLE".to_string())?;
    let proposed = validate_content(&loaded.asset.kind, &request.proposed_content)?;
    if loaded.baseline_ref.asset_id != request.expected_baseline.asset_id
        || loaded.baseline_ref.container_id != request.expected_baseline.container_id
    {
        return Err("SHARED_ASSET_BASELINE_INVALID".into());
    }
    if hash(request.base_content.as_bytes()) != request.expected_baseline.asset_content_hash {
        return Err("SHARED_ASSET_BASE_CONTENT_INVALID: baseContent 与预期正文基线不一致".into());
    }
    if loaded.baseline_ref.asset_content_hash != request.expected_baseline.asset_content_hash
        || loaded.baseline_ref.container_content_hash
            != request.expected_baseline.container_content_hash
    {
        return Ok(SharedAssetMutationResult::BaselineChanged {
            request_id: request.request_id,
            asset_id: loaded.asset.id.clone(),
            locator: loaded.asset.locator.clone(),
            base: side(request.base_content, &manifest_bytes),
            current: side(loaded.canonical_content, &manifest_bytes),
            proposed: side(proposed, &manifest_bytes),
            diagnostics: vec![diagnostic(
                "shared_asset_baseline_changed",
                "warning",
                "共享资产在编辑期间发生变化",
                None,
                Some("比较当前内容后重新保存"),
            )],
        });
    }
    if proposed == loaded.canonical_content {
        return Ok(SharedAssetMutationResult::Unchanged {
            request_id: request.request_id,
            asset: loaded.asset,
        });
    }
    let proposed_hash = hash(proposed.as_bytes());
    if !affected_agent_ids.is_empty() {
        match request.confirmation_ref.as_deref() {
            None => {
                let challenge = local_service::issue_confirmation(
                    revisions_root,
                    &request.asset_id,
                    &proposed_hash,
                    &request.expected_baseline.asset_content_hash,
                    "更新会影响正在引用该资产的 Agent",
                )?;
                return Ok(SharedAssetMutationResult::ConfirmationRequired {
                    request_id: request.request_id,
                    challenge,
                    affected_agent_ids,
                    diagnostics: vec![diagnostic(
                        "shared_asset_impact_confirmation_required",
                        "warning",
                        "共享资产正在被 Agent 使用",
                        None,
                        Some("查看受影响 Agent 后确认更新"),
                    )],
                });
            }
            Some(confirmation_ref) => local_service::consume_confirmation(
                revisions_root,
                confirmation_ref,
                &request.asset_id,
                &proposed_hash,
                &request.expected_baseline.asset_content_hash,
            )
            .map_err(|_| {
                "SHARED_ASSET_CONFIRMATION_INVALID: 确认已过期或与本次更新不匹配".to_string()
            })?,
        }
    } else if request.confirmation_ref.is_some() {
        return Err("SHARED_ASSET_CONFIRMATION_INVALID: 当前更新不需要确认".into());
    }
    let content_path = root.join(
        loaded
            .asset
            .locator
            .relative_path
            .as_deref()
            .ok_or_else(|| "SHARED_ASSET_CONTENT_MISSING".to_string())?,
    );
    let current_content =
        fs::read(&content_path).map_err(|_| "SHARED_ASSET_CONTENT_UNREADABLE".to_string())?;
    let current_manifest =
        fs::read(&manifest_path).map_err(|_| "SHARED_ASSET_MANIFEST_UNREADABLE".to_string())?;
    if hash(&current_content) != request.expected_baseline.asset_content_hash
        || container_hash(&current_manifest, &current_content)
            != request.expected_baseline.container_content_hash
    {
        return Ok(SharedAssetMutationResult::BaselineChanged {
            request_id: request.request_id,
            asset_id: loaded.asset.id,
            locator: loaded.asset.locator,
            base: side(request.base_content, &manifest_bytes),
            current: side(
                String::from_utf8_lossy(&current_content).into_owned(),
                &current_manifest,
            ),
            proposed: side(proposed, &manifest_bytes),
            diagnostics: vec![diagnostic(
                "shared_asset_baseline_changed",
                "warning",
                "共享资产在提交前发生变化",
                None,
                Some("比较当前内容后重新保存"),
            )],
        });
    }
    restricted_atomic_write(&content_path, proposed.as_bytes(), true, "共享资产正文")?;
    let verified =
        fs::read_to_string(&content_path).map_err(|_| "SHARED_ASSET_VERIFY_FAILED".to_string())?;
    if verified != proposed {
        return Err("SHARED_ASSET_VERIFY_FAILED: 写后正文不一致".into());
    }
    let mut node = loaded.asset;
    node.content_hash = hash(verified.as_bytes());
    node.container_content_hash = container_hash(&manifest_bytes, verified.as_bytes());
    let saved_at = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let (revision, receipt) = revision_for(
        &node,
        &request.expected_baseline.asset_content_hash,
        &request.expected_baseline.container_content_hash,
        &saved_at,
        "更新共享资产",
    );
    if local_service::append_revision(revisions_root, &revision, &verified).is_err() {
        let recovery_ref = persist_recovery_record(revisions_root, &node, &revision, &receipt)?;
        return Ok(SharedAssetMutationResult::RevisionPending {
            request_id: request.request_id,
            asset: node,
            file_state: "verified_written_revision_pending".into(),
            recovery_ref,
            diagnostics: vec![diagnostic(
                "revision_pending",
                "error",
                "共享资产已验证写入，但版本记录失败",
                None,
                Some("使用 recoveryRef 补记版本"),
            )],
        });
    }
    node.current_revision_id = Some(revision.id.clone());
    Ok(SharedAssetMutationResult::Saved {
        request_id: request.request_id,
        asset: node,
        revision: Box::new(revision),
        write_receipt: receipt,
    })
}

pub(crate) fn repair_registration_at(
    database: &Path,
    root: &Path,
    revisions_root: &Path,
    request: SharedAssetIdentityRequest,
) -> Result<SharedAssetMutationResult, String> {
    if !valid_id(&request.asset_id) {
        return Err("SHARED_ASSET_ID_INVALID".into());
    }
    let manifest = fs::read(root.join(&request.asset_id).join("asset.yaml"))
        .map_err(|_| "SHARED_ASSET_MANIFEST_UNREADABLE".to_string())
        .and_then(|bytes| {
            parse_manifest(&bytes).map_err(|_| "SHARED_ASSET_MANIFEST_INVALID".to_string())
        })?;
    if manifest.id != request.asset_id {
        return Err("SHARED_ASSET_IDENTITY_INVALID".into());
    }
    domain_store::register_shared_asset_at(database, &manifest.team_id, &manifest.id)?;
    let snapshot = domain_store::load_long_term_domain_snapshot_v4_at(database)?;
    let loaded = load_editor_at(root, revisions_root, &snapshot, request)?;
    Ok(SharedAssetMutationResult::Unchanged {
        request_id: loaded.request_id,
        asset: loaded.asset,
    })
}

pub(crate) fn recover_revision_at(
    root: &Path,
    revisions_root: &Path,
    snapshot: &LongTermDomainSnapshotDtoV4,
    request: RecoverSharedAssetRevisionRequest,
) -> Result<SharedAssetMutationResult, String> {
    let mut loaded = load_editor_at(
        root,
        revisions_root,
        snapshot,
        SharedAssetIdentityRequest {
            request_id: request.request_id.clone(),
            asset_id: request.asset_id.clone(),
        },
    )?;
    let (record, record_path) = load_recovery_record(revisions_root, &request.recovery_ref)?;
    let expires_at = chrono::DateTime::parse_from_rfc3339(&record.expires_at)
        .map_err(|_| "SHARED_ASSET_RECOVERY_INVALID".to_string())?;
    if expires_at < Utc::now()
        || record.asset_id != request.asset_id
        || record.asset_content_hash != loaded.asset.content_hash
        || record.container_content_hash != loaded.asset.container_content_hash
        || record.revision.asset_id != request.asset_id
        || record.revision.asset_content_hash != loaded.asset.content_hash
        || record.revision.container_content_hash != loaded.asset.container_content_hash
    {
        return Err("SHARED_ASSET_RECOVERY_INVALID: 恢复引用已过期或与当前资产不匹配".into());
    }
    if local_service::append_revision(revisions_root, &record.revision, &loaded.canonical_content)
        .is_err()
    {
        return Err("SHARED_ASSET_RECOVERY_FAILED: 仍无法写入版本记录".into());
    }
    fs::remove_file(record_path)
        .map_err(|_| "SHARED_ASSET_RECOVERY_FAILED: 版本已补记，但恢复引用未能消费".to_string())?;
    loaded.asset.current_revision_id = Some(record.revision.id.clone());
    Ok(SharedAssetMutationResult::Saved {
        request_id: request.request_id,
        asset: loaded.asset,
        revision: Box::new(record.revision),
        write_receipt: record.write_receipt,
    })
}
