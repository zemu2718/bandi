use super::editor::{persist_recovery_record, revision_for};
use super::*;
use crate::domain_store::TeamDtoV4;
use tempfile::tempdir;

fn snapshot() -> LongTermDomainSnapshotDtoV4 {
    LongTermDomainSnapshotDtoV4 {
        schema_version: 4,
        teams: vec![TeamDtoV4 {
            id: "xinghe".into(),
            name: "星河".into(),
            mark: None,
            color: None,
            mission: None,
            boundary: None,
            member_agent_ids: vec!["zhouce".into()],
            shared_asset_ids: vec!["skill-review".into()],
        }],
        task_briefs: Vec::new(),
    }
}

#[test]
fn discovers_v1_and_v2_and_ignores_staging() {
    let root = tempdir().unwrap();
    let v1 = root.path().join("skill-review");
    fs::create_dir(&v1).unwrap();
    fs::write(
        v1.join("asset.yaml"),
        "schemaVersion: 1\nid: skill-review\nkind: skill\nteamId: xinghe\ncontentFile: SKILL.md\n",
    )
    .unwrap();
    fs::write(v1.join("SKILL.md"), "# Review\n").unwrap();
    fs::create_dir(root.path().join(".bandi-staging-hidden")).unwrap();
    let result = discover(root.path(), &snapshot());
    assert_eq!(result.nodes.len(), 1);
    assert!(matches!(
        result.nodes[0].source,
        SharedAssetSourceDto::Legacy
    ));
    assert!(!result.nodes[0].container_content_hash.is_empty());
}

fn write_skill(root: &Path, content: &str) {
    let package = root.join("skill-review");
    fs::create_dir(&package).unwrap();
    fs::write(
            package.join("asset.yaml"),
            "schemaVersion: 2\nid: skill-review\nname: Review\nkind: skill\nteamId: xinghe\ncontentFile: SKILL.md\nsource:\n  kind: authored\n",
        )
        .unwrap();
    fs::write(package.join("SKILL.md"), content).unwrap();
}

#[test]
fn skill_package_editor_tracks_and_replaces_nested_files() {
    let root = tempdir().unwrap();
    let revisions = tempdir().unwrap();
    write_skill(root.path(), "# Before\n");
    fs::create_dir(root.path().join("skill-review/references")).unwrap();
    fs::write(root.path().join("skill-review/references/check.md"), "old").unwrap();
    let editor = load_editor_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SharedAssetIdentityRequest {
            request_id: "load-package".into(),
            asset_id: "skill-review".into(),
        },
    )
    .unwrap();
    assert_eq!(editor.package_files.len(), 2);
    let result = save_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SaveSharedAssetRequest {
            request_id: "save-package".into(),
            asset_id: "skill-review".into(),
            expected_baseline: editor.baseline_ref,
            base_content: editor.canonical_content,
            proposed_content: "# After\n".into(),
            package_files: Some(vec![
                PackageFile::text("SKILL.md", "# After\n"),
                PackageFile::text("scripts/run.txt", "safe"),
            ]),
            confirmation_ref: None,
        },
        Vec::new(),
    )
    .unwrap();
    assert!(matches!(result, SharedAssetMutationResult::Saved { .. }));
    assert!(!root
        .path()
        .join("skill-review/references/check.md")
        .exists());
    assert_eq!(
        fs::read_to_string(root.path().join("skill-review/scripts/run.txt")).unwrap(),
        "safe"
    );
}

#[test]
fn skill_package_preserves_binary_attachments() {
    let root = tempdir().unwrap();
    let revisions = tempdir().unwrap();
    write_skill(root.path(), "# Before\n");
    let editor = load_editor_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SharedAssetIdentityRequest {
            request_id: "load-binary".into(),
            asset_id: "skill-review".into(),
        },
    )
    .unwrap();
    save_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SaveSharedAssetRequest {
            request_id: "save-binary".into(),
            asset_id: "skill-review".into(),
            expected_baseline: editor.baseline_ref,
            base_content: editor.canonical_content,
            proposed_content: "# After\n".into(),
            package_files: Some(vec![
                PackageFile::text("SKILL.md", "# After\n"),
                PackageFile {
                    path: "assets/data.bin".into(),
                    bytes: vec![0, 159, 146, 150],
                },
            ]),
            confirmation_ref: None,
        },
        Vec::new(),
    )
    .unwrap();
    assert_eq!(
        fs::read(root.path().join("skill-review/assets/data.bin")).unwrap(),
        vec![0, 159, 146, 150]
    );

    let editor = load_editor_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SharedAssetIdentityRequest {
            request_id: "reload-binary".into(),
            asset_id: "skill-review".into(),
        },
    )
    .unwrap();
    save_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SaveSharedAssetRequest {
            request_id: "save-entrypoint-only".into(),
            asset_id: "skill-review".into(),
            expected_baseline: editor.baseline_ref,
            base_content: editor.canonical_content,
            proposed_content: "# Final\n".into(),
            package_files: None,
            confirmation_ref: None,
        },
        Vec::new(),
    )
    .unwrap();
    assert_eq!(
        fs::read(root.path().join("skill-review/assets/data.bin")).unwrap(),
        vec![0, 159, 146, 150]
    );
}

#[test]
fn rejects_mcp_secrets() {
    for key in [
        "token",
        "apiKey",
        "accessKey",
        "authorization",
        "auth",
        "bearer",
        "clientKey",
    ] {
        assert!(validate_content("mcp", &format!("{key}: secret\n")).is_err());
    }
    assert!(validate_content("mcp", "servers: {}\n").is_ok());
}

#[test]
fn rejects_kind_content_file_mismatch_and_serializes_source_union() {
    let root = tempdir().unwrap();
    let package = root.path().join("skill-review");
    fs::create_dir(&package).unwrap();
    fs::write(
            package.join("asset.yaml"),
            "schemaVersion: 2\nid: skill-review\nname: Review\nkind: skill\nteamId: xinghe\ncontentFile: RULE.md\nsource:\n  kind: authored\n",
        )
        .unwrap();
    fs::write(package.join("RULE.md"), "# Review\n").unwrap();
    assert_eq!(
        discover(root.path(), &snapshot()).nodes[0].parse_status,
        "invalid"
    );

    let value = serde_json::to_value(SharedAssetSourceDto::Imported {
        file_name: "review.md".into(),
        imported_hash: hash(b"review"),
        imported_at: "2026-09-09T00:00:00Z".into(),
    })
    .unwrap();
    assert_eq!(value["kind"], "imported");
    assert_eq!(value["fileName"], "review.md");
}

#[test]
fn save_rejects_base_content_mismatch_and_external_change() {
    let root = tempdir().unwrap();
    let revisions = tempdir().unwrap();
    write_skill(root.path(), "# Before\n");
    let editor = load_editor_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SharedAssetIdentityRequest {
            request_id: "load-1".into(),
            asset_id: "skill-review".into(),
        },
    )
    .unwrap();
    let bad_base = SaveSharedAssetRequest {
        request_id: "save-1".into(),
        asset_id: "skill-review".into(),
        expected_baseline: editor.baseline_ref.clone(),
        base_content: "# Forged\n".into(),
        proposed_content: "# After\n".into(),
        package_files: None,
        confirmation_ref: None,
    };
    assert!(save_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        bad_base,
        Vec::new()
    )
    .unwrap_err()
    .contains("BASE_CONTENT_INVALID"));

    fs::write(root.path().join("skill-review/SKILL.md"), "# External\n").unwrap();
    let changed = save_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SaveSharedAssetRequest {
            request_id: "save-2".into(),
            asset_id: "skill-review".into(),
            expected_baseline: editor.baseline_ref,
            base_content: editor.canonical_content,
            proposed_content: "# After\n".into(),
            package_files: None,
            confirmation_ref: None,
        },
        Vec::new(),
    )
    .unwrap();
    assert!(matches!(
        changed,
        SharedAssetMutationResult::BaselineChanged { .. }
    ));
    assert_eq!(
        fs::read_to_string(root.path().join("skill-review/SKILL.md")).unwrap(),
        "# External\n"
    );
}

#[test]
fn confirmation_returns_actual_affected_agents() {
    let root = tempdir().unwrap();
    let revisions = tempdir().unwrap();
    write_skill(root.path(), "# Before\n");
    let editor = load_editor_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SharedAssetIdentityRequest {
            request_id: "load-confirm".into(),
            asset_id: "skill-review".into(),
        },
    )
    .unwrap();
    let result = save_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SaveSharedAssetRequest {
            request_id: "save-confirm".into(),
            asset_id: "skill-review".into(),
            expected_baseline: editor.baseline_ref,
            base_content: editor.canonical_content,
            proposed_content: "# After\n".into(),
            package_files: None,
            confirmation_ref: None,
        },
        vec!["agent-b".into(), "agent-a".into()],
    )
    .unwrap();
    match result {
        SharedAssetMutationResult::ConfirmationRequired {
            affected_agent_ids, ..
        } => assert_eq!(affected_agent_ids, vec!["agent-b", "agent-a"]),
        _ => panic!("应要求确认共享影响"),
    }
}

#[test]
fn recovery_ref_is_bound_one_time_and_revision_keeps_both_baselines() {
    let root = tempdir().unwrap();
    let revisions = tempdir().unwrap();
    write_skill(root.path(), "# Current\n");
    let loaded = load_editor_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        SharedAssetIdentityRequest {
            request_id: "load-2".into(),
            asset_id: "skill-review".into(),
        },
    )
    .unwrap();
    let saved_at = Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true);
    let (revision, receipt) = revision_for(
        &loaded.asset,
        "sha256:asset-base",
        "sha256:container-base",
        &saved_at,
        "测试补记",
    );
    assert_eq!(revision.source_asset_baseline_hash, "sha256:asset-base");
    assert_eq!(
        revision.source_container_baseline_hash,
        "sha256:container-base"
    );
    let recovery_ref =
        persist_recovery_record(revisions.path(), &loaded.asset, &revision, &receipt).unwrap();
    assert!(recover_revision_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        RecoverSharedAssetRevisionRequest {
            request_id: "recover-forged".into(),
            asset_id: "skill-review".into(),
            recovery_ref: "recovery-forged".into(),
        },
    )
    .is_err());
    let recovered = recover_revision_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        RecoverSharedAssetRevisionRequest {
            request_id: "recover-1".into(),
            asset_id: "skill-review".into(),
            recovery_ref: recovery_ref.clone(),
        },
    )
    .unwrap();
    assert!(matches!(recovered, SharedAssetMutationResult::Saved { .. }));
    assert!(recover_revision_at(
        root.path(),
        revisions.path(),
        &snapshot(),
        RecoverSharedAssetRevisionRequest {
            request_id: "recover-2".into(),
            asset_id: "skill-review".into(),
            recovery_ref,
        },
    )
    .is_err());

    let collision = tempdir().unwrap();
    let (revision, receipt) = revision_for(
        &loaded.asset,
        "sha256:asset-base",
        "sha256:container-base",
        &saved_at,
        "测试覆盖保护",
    );
    fs::write(
        collision.path().join(format!("{}.json", revision.id)),
        "do-not-overwrite",
    )
    .unwrap();
    let collision_ref =
        persist_recovery_record(collision.path(), &loaded.asset, &revision, &receipt).unwrap();
    assert!(recover_revision_at(
        root.path(),
        collision.path(),
        &snapshot(),
        RecoverSharedAssetRevisionRequest {
            request_id: "recover-collision".into(),
            asset_id: "skill-review".into(),
            recovery_ref: collision_ref,
        },
    )
    .is_err());
    assert_eq!(
        fs::read_to_string(collision.path().join(format!("{}.json", revision.id))).unwrap(),
        "do-not-overwrite"
    );
}

#[test]
fn directory_import_preserves_package_and_consumes_preview_once() {
    let source = tempdir().unwrap();
    let package = source.path().join("review");
    fs::create_dir_all(package.join("scripts")).unwrap();
    fs::create_dir_all(package.join("assets")).unwrap();
    fs::write(package.join("SKILL.md"), "# Review\n").unwrap();
    fs::write(package.join("scripts/run.sh"), "exit 0\n").unwrap();
    fs::write(package.join("assets/data.bin"), [0, 159, 146, 150]).unwrap();

    let preview = preview_import_at(
        package,
        SelectSharedAssetImportRequest {
            request_id: "preview-directory".into(),
            team_id: "team-personal".into(),
            kind: "skill".into(),
        },
    )
    .unwrap();
    assert_eq!(preview.file_count, 3);

    let storage = tempdir().unwrap();
    let database = storage.path().join("bandi.db");
    let root = storage.path().join("shared-assets");
    let revisions = storage.path().join("revisions");
    let request = CommitSharedAssetImportRequest {
        request_id: "commit-directory".into(),
        preview_ref: preview.preview_ref.clone(),
        expected_source_hash: preview.source_hash,
        team_id: "team-personal".into(),
        asset_id: "skill-imported-review".into(),
        name: "Imported review".into(),
        confirmed: true,
    };
    assert!(matches!(
        commit_import_at(&database, &root, &revisions, request),
        Ok(SharedAssetMutationResult::Saved { .. })
    ));
    assert_eq!(
        fs::read(root.join("skill-imported-review/assets/data.bin")).unwrap(),
        vec![0, 159, 146, 150]
    );
    assert_eq!(
        fs::read_to_string(root.join("skill-imported-review/scripts/run.sh")).unwrap(),
        "exit 0\n"
    );
    let replay = commit_import_at(
        &database,
        &root,
        &revisions,
        CommitSharedAssetImportRequest {
            request_id: "commit-directory-replay".into(),
            preview_ref: preview.preview_ref,
            expected_source_hash: "unused".into(),
            team_id: "team-personal".into(),
            asset_id: "skill-imported-review-copy".into(),
            name: "Imported review copy".into(),
            confirmed: true,
        },
    )
    .unwrap_err();
    assert!(replay.contains("PREVIEW_EXPIRED"));
}

#[test]
fn import_rejects_reserved_manifest_and_changed_source_without_partial_asset() {
    let reserved = tempdir().unwrap();
    fs::write(reserved.path().join("SKILL.md"), "# Review\n").unwrap();
    fs::write(reserved.path().join("asset.yaml"), "not a Bandi manifest").unwrap();
    assert!(preview_import_at(
        reserved.path().to_path_buf(),
        SelectSharedAssetImportRequest {
            request_id: "preview-reserved".into(),
            team_id: "team-personal".into(),
            kind: "skill".into(),
        },
    )
    .unwrap_err()
    .contains("RESERVED_PATH_REJECTED"));

    let source = tempdir().unwrap();
    fs::write(source.path().join("SKILL.md"), "# Before\n").unwrap();
    let preview = preview_import_at(
        source.path().to_path_buf(),
        SelectSharedAssetImportRequest {
            request_id: "preview-change".into(),
            team_id: "team-personal".into(),
            kind: "skill".into(),
        },
    )
    .unwrap();
    fs::write(source.path().join("SKILL.md"), "# After\n").unwrap();
    let storage = tempdir().unwrap();
    let root = storage.path().join("shared-assets");
    let error = commit_import_at(
        &storage.path().join("bandi.db"),
        &root,
        &storage.path().join("revisions"),
        CommitSharedAssetImportRequest {
            request_id: "commit-change".into(),
            preview_ref: preview.preview_ref,
            expected_source_hash: preview.source_hash,
            team_id: "team-personal".into(),
            asset_id: "skill-changed".into(),
            name: "Changed".into(),
            confirmed: true,
        },
    )
    .unwrap_err();
    assert!(error.contains("SOURCE_CHANGED"));
    assert!(!root.join("skill-changed").exists());
}

#[cfg(unix)]
#[test]
fn rejects_symlinked_content() {
    use std::os::unix::fs::symlink;
    let root = tempdir().unwrap();
    let outside = tempdir().unwrap();
    let package = root.path().join("skill-review");
    fs::create_dir(&package).unwrap();
    fs::write(
        package.join("asset.yaml"),
        "schemaVersion: 1\nid: skill-review\nkind: skill\nteamId: xinghe\ncontentFile: SKILL.md\n",
    )
    .unwrap();
    fs::write(outside.path().join("secret.md"), "secret").unwrap();
    symlink(outside.path().join("secret.md"), package.join("SKILL.md")).unwrap();
    assert_eq!(
        discover(root.path(), &snapshot()).nodes[0].parse_status,
        "invalid"
    );
}
