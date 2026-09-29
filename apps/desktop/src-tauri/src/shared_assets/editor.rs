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
    imported_package: Option<&PackageSnapshot>,
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
        if request.kind == "skill" {
            if let Some(package) = imported_package {
                for directory in package.directories() {
                    let target = directory
                        .split('/')
                        .fold(staging.clone(), |path, part| path.join(part));
                    fs::create_dir_all(target).map_err(|_| {
                        "SHARED_ASSET_WRITE_FAILED: 无法创建 Skill 子目录".to_string()
                    })?;
                }
                for file in &package.files {
                    let target = file
                        .path
                        .split('/')
                        .fold(staging.clone(), |path, part| path.join(part));
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent).map_err(|_| {
                            "SHARED_ASSET_WRITE_FAILED: 无法创建 Skill 子目录".to_string()
                        })?;
                    }
                    restricted_atomic_write(&target, &file.bytes, false, "Skill 包文件")?;
                }
            } else {
                restricted_atomic_write(
                    &staging.join("SKILL.md"),
                    content.as_bytes(),
                    false,
                    "共享资产正文",
                )?;
            }
        } else {
            restricted_atomic_write(
                &staging.join(content_file(&request.kind).unwrap_or("CONTENT.md")),
                content.as_bytes(),
                false,
                "共享资产正文",
            )?;
        }
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
        fs::remove_dir_all(&target).map_err(|_| {
            "SHARED_ASSET_VERIFY_FAILED: 写后重读失败且无法清理未登记资产".to_string()
        })?;
        return Err("SHARED_ASSET_VERIFY_FAILED: 写后重读验证失败，未保留未登记资产".into());
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
    let package_files = package_snapshot(&package, &node.kind)?.files;
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
        package_files,
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

fn proposed_skill_package(
    files: Option<Vec<PackageFile>>,
    current_files: &[PackageFile],
    entrypoint: &str,
) -> Result<PackageSnapshot, String> {
    let files = files.unwrap_or_else(|| {
        let mut files = current_files.to_vec();
        if let Some(current) = files.iter_mut().find(|file| file.path == "SKILL.md") {
            current.bytes = entrypoint.as_bytes().to_vec();
        } else {
            files.push(PackageFile::text("SKILL.md", entrypoint));
        }
        files
    });
    let snapshot = asset_package::from_files(files, SKILL_LIMITS)?;
    if snapshot
        .files
        .iter()
        .find(|file| file.path == "SKILL.md")
        .map(PackageFile::utf8)
        .transpose()?
        != Some(entrypoint)
    {
        return Err("SHARED_ASSET_PACKAGE_INVALID: SKILL.md 与 proposedContent 不一致".into());
    }
    Ok(snapshot)
}

fn replace_skill_package(
    root: &Path,
    asset_id: &str,
    manifest: &[u8],
    package: &PackageSnapshot,
) -> Result<(), String> {
    let target = root.join(asset_id);
    let staging = root.join(format!(".bandi-staging-{asset_id}-update"));
    let backup = root.join(format!(".bandi-staging-{asset_id}-backup"));
    if staging.exists() || backup.exists() {
        return Err("SHARED_ASSET_STAGING_CONFLICT: Skill 更新暂存目录已存在".into());
    }
    fs::create_dir(&staging)
        .map_err(|_| "SHARED_ASSET_WRITE_FAILED: 无法创建 Skill 暂存目录".to_string())?;
    let prepared = (|| {
        restricted_atomic_write(
            &staging.join("asset.yaml"),
            manifest,
            false,
            "共享资产 manifest",
        )?;
        for directory in package.directories() {
            let path = directory
                .split('/')
                .fold(staging.clone(), |path, part| path.join(part));
            fs::create_dir_all(path)
                .map_err(|_| "SHARED_ASSET_WRITE_FAILED: 无法创建 Skill 子目录".to_string())?;
        }
        for file in &package.files {
            let path = file
                .path
                .split('/')
                .fold(staging.clone(), |path, part| path.join(part));
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|_| "SHARED_ASSET_WRITE_FAILED: 无法创建 Skill 子目录".to_string())?;
            }
            restricted_atomic_write(&path, &file.bytes, false, "Skill 包文件")?;
        }
        let verified = package_snapshot(&staging, "skill")?;
        if verified.fingerprint != package.fingerprint {
            return Err("SHARED_ASSET_VERIFY_FAILED: Skill 包暂存验证失败".into());
        }
        Ok(())
    })();
    if let Err(error) = prepared {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }
    fs::rename(&target, &backup)
        .map_err(|_| "SHARED_ASSET_WRITE_FAILED: 无法隔离原 Skill 包".to_string())?;
    if fs::rename(&staging, &target).is_err() {
        let _ = fs::rename(&backup, &target);
        let _ = fs::remove_dir_all(&staging);
        return Err("SHARED_ASSET_WRITE_FAILED: 无法提交 Skill 包".into());
    }
    if fs::remove_dir_all(&backup).is_err() {
        return Err("SHARED_ASSET_RECOVERY_REQUIRED: Skill 已写入，但旧包清理失败".into());
    }
    Ok(())
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
    if loaded.asset.kind != "skill" && request.package_files.is_some() {
        return Err("SHARED_ASSET_PACKAGE_INVALID: 只有 Skill 支持目录包编辑".into());
    }
    let proposed_package = if loaded.asset.kind == "skill" {
        Some(proposed_skill_package(
            request.package_files.clone(),
            &loaded.package_files,
            &proposed,
        )?)
    } else {
        None
    };
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
    let package_unchanged = proposed_package
        .as_ref()
        .is_none_or(|package| package.fingerprint == loaded.asset.container_content_hash);
    if proposed == loaded.canonical_content && package_unchanged {
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
    let current_container_hash = if loaded.asset.kind == "skill" {
        package_snapshot(&root.join(&request.asset_id), "skill")?.fingerprint
    } else {
        container_hash(&current_manifest, &current_content)
    };
    if hash(&current_content) != request.expected_baseline.asset_content_hash
        || current_container_hash != request.expected_baseline.container_content_hash
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
    if let Some(package) = proposed_package.as_ref() {
        replace_skill_package(root, &request.asset_id, &manifest_bytes, package)?;
    } else {
        restricted_atomic_write(&content_path, proposed.as_bytes(), true, "共享资产正文")?;
    }
    let verified = fs::read_to_string(
        root.join(&request.asset_id)
            .join(content_file(&loaded.asset.kind).unwrap_or("CONTENT.md")),
    )
    .map_err(|_| "SHARED_ASSET_VERIFY_FAILED".to_string())?;
    if verified != proposed {
        return Err("SHARED_ASSET_VERIFY_FAILED: 写后正文不一致".into());
    }
    let mut node = loaded.asset;
    node.content_hash = hash(verified.as_bytes());
    node.container_content_hash = proposed_package.as_ref().map_or_else(
        || container_hash(&manifest_bytes, verified.as_bytes()),
        |package| package.fingerprint.clone(),
    );
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
