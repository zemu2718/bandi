use std::{fs, path::PathBuf};

use super::{
    contracts::*,
    restore::{preview_restore_at, restore_snapshot_at},
    storage::{create_snapshot_at, list_snapshots_at, load_entries},
};
use crate::{domain_store, local_service};

fn fixture(name: &str) -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf, String) {
    let root = tempfile::Builder::new().prefix(name).tempdir().unwrap();
    let managed = root.path().join("agents");
    let package = managed.join("agt_alpha");
    fs::create_dir_all(&package).unwrap();
    fs::write(package.join("agent.yaml"), "schemaVersion: 1\nid: alpha\n").unwrap();
    fs::write(package.join("instructions.md"), "# Alpha\n").unwrap();
    let discovery = local_service::discover_at(
        &managed,
        local_service::DiscoveryRequest {
            request_id: "discover".into(),
            include_claude_user_root: false,
        },
    );
    (
        root,
        managed,
        package,
        PathBuf::from("backups"),
        discovery.assets[0].id.clone(),
    )
}

fn create_request(asset_id: String) -> CreateBackupSnapshotRequest {
    CreateBackupSnapshotRequest {
        request_id: "backup-create-1".into(),
        scope: BackupFilesScopeDto {
            kind: "files".into(),
            asset_ids: vec![asset_id],
        },
    }
}

#[test]
fn shared_backup_fixture_round_trips() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../../packages/contracts/fixtures/backup-local.valid.json"
    ))
    .unwrap();
    let request: CreateBackupSnapshotRequest =
        serde_json::from_value(fixture["createRequest"].clone()).unwrap();
    let snapshot: BackupSnapshotDto = serde_json::from_value(fixture["snapshot"].clone()).unwrap();
    let preview_request: PreviewBackupRestoreRequest =
        serde_json::from_value(fixture["previewRequest"].clone()).unwrap();
    let preview: BackupRestorePreviewDto =
        serde_json::from_value(fixture["restorePreview"].clone()).unwrap();
    let restore_request: RestoreBackupSnapshotRequest =
        serde_json::from_value(fixture["restoreRequest"].clone()).unwrap();
    let result: BackupRestoreResultDto =
        serde_json::from_value(fixture["restoreResult"].clone()).unwrap();

    assert_eq!(request.scope.kind, "files");
    assert_eq!(request.scope.asset_ids, vec!["asset-instructions-1"]);
    assert_eq!(snapshot.entry_count as usize, snapshot.entries.len());
    assert_eq!(preview_request.snapshot_id, snapshot.id);
    assert!(preview.requires_confirmation);
    assert!(restore_request.confirmed);
    assert_eq!(result.kind, "restored");
    assert_eq!(serde_json::to_value(snapshot).unwrap(), fixture["snapshot"]);
}

#[test]
fn backup_requests_reject_paths_and_unknown_fields() {
    let invalid = serde_json::json!({
        "requestId": "backup-create-1",
        "scope": { "kind": "files", "assetIds": ["asset-instructions-1"] },
        "archivePath": "/tmp/backup"
    });
    assert!(serde_json::from_value::<CreateBackupSnapshotRequest>(invalid).is_err());
}

#[test]
fn preview_and_restore_reject_snapshot_containing_orchestration() {
    let (root, managed, _, relative_backup, asset_id) = fixture("backup-orchestration");
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        create_request(asset_id.clone()),
    )
    .unwrap();
    let connection = domain_store::open_at(&database).unwrap();
    connection
        .execute(
            "UPDATE backup_snapshot_entries SET asset_kind = 'orchestration' WHERE snapshot_id = ?1",
            [&snapshot.id],
        )
        .unwrap();
    drop(connection);

    let preview = preview_restore_at(
        &database,
        &managed,
        &backup_root,
        PreviewBackupRestoreRequest {
            request_id: "preview-orchestration".into(),
            snapshot_id: snapshot.id.clone(),
            asset_ids: vec![asset_id.clone()],
        },
    );
    assert!(preview.unwrap_err().contains("orchestration"));

    let restore = restore_snapshot_at(
        &database,
        &managed,
        &root.path().join("revisions"),
        &backup_root,
        RestoreBackupSnapshotRequest {
            request_id: "restore-orchestration".into(),
            snapshot_id: snapshot.id,
            asset_ids: vec![asset_id],
            preview_ref: "preview-missing".into(),
            confirmed: true,
        },
    );
    assert!(restore.unwrap_err().contains("orchestration"));
}

#[test]
fn snapshot_history_survives_reopen_and_detects_tampering() {
    let (root, managed, _, relative_backup, asset_id) = fixture("backup-history");
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        create_request(asset_id.clone()),
    )
    .unwrap();
    drop(domain_store::open_at(&database).unwrap());
    assert_eq!(list_snapshots_at(&database).unwrap()[0].id, snapshot.id);
    fs::write(
        backup_root
            .join(&snapshot.id)
            .join(format!("{asset_id}.content")),
        "tampered",
    )
    .unwrap();
    let preview = preview_restore_at(
        &database,
        &managed,
        &backup_root,
        PreviewBackupRestoreRequest {
            request_id: "preview-tampered".into(),
            snapshot_id: snapshot.id,
            asset_ids: vec![asset_id],
        },
    )
    .unwrap();
    assert!(!preview.can_restore);
    assert_eq!(preview.entries[0].status, "integrity_failed");
}

#[test]
fn multi_asset_snapshot_keeps_content_references_aligned() {
    let (root, managed, package, relative_backup, first_asset_id) = fixture("backup-multi");
    fs::create_dir_all(package.join("config")).unwrap();
    fs::write(
        package.join("config/rules.yaml"),
        "schemaVersion: 1\nrules:\n  - \"rule-demo\"\n",
    )
    .unwrap();
    let discovery = local_service::discover_at(
        &managed,
        local_service::DiscoveryRequest {
            request_id: "discover-two".into(),
            include_claude_user_root: false,
        },
    );
    let second_asset_id = discovery
        .assets
        .iter()
        .find(|asset| asset.kind == "rules")
        .unwrap()
        .id
        .clone();
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        CreateBackupSnapshotRequest {
            request_id: "backup-multi-create".into(),
            scope: BackupFilesScopeDto {
                kind: "files".into(),
                asset_ids: vec![second_asset_id.clone(), first_asset_id.clone()],
            },
        },
    )
    .unwrap();
    let connection = domain_store::open_at(&database).unwrap();
    let entries = load_entries(&connection, &snapshot.id).unwrap();
    for (entry, content_ref) in entries {
        assert_eq!(
            content_ref,
            format!("{}/{}.content", snapshot.id, entry.asset_id)
        );
        assert!(backup_root.join(content_ref).is_file());
    }
}

#[test]
fn failed_snapshot_database_write_cleans_directory() {
    let (root, managed, _, relative_backup, asset_id) = fixture("backup-cleanup");
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        create_request(asset_id.clone()),
    )
    .unwrap();
    let connection = domain_store::open_at(&database).unwrap();
    connection
        .execute("DROP TABLE backup_snapshot_entries", [])
        .unwrap();

    let failed = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        CreateBackupSnapshotRequest {
            request_id: "backup-create-failing".into(),
            scope: BackupFilesScopeDto {
                kind: "files".into(),
                asset_ids: vec![asset_id],
            },
        },
    );

    assert!(failed.is_err());
    assert!(backup_root.join(snapshot.id).is_dir());
    assert_eq!(fs::read_dir(&backup_root).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn restore_rejects_symlinked_snapshot_content() {
    use std::os::unix::fs::symlink;

    let (root, managed, _, relative_backup, asset_id) = fixture("backup-symlink");
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        create_request(asset_id.clone()),
    )
    .unwrap();
    let target = backup_root
        .join(&snapshot.id)
        .join(format!("{asset_id}.content"));
    fs::remove_file(&target).unwrap();
    symlink(root.path().join("outside"), &target).unwrap();
    let preview = preview_restore_at(
        &database,
        &managed,
        &backup_root,
        PreviewBackupRestoreRequest {
            request_id: "preview-symlink".into(),
            snapshot_id: snapshot.id,
            asset_ids: vec![asset_id],
        },
    )
    .unwrap();
    assert_eq!(preview.entries[0].status, "integrity_failed");
}

#[cfg(unix)]
#[test]
fn restore_rejects_symlinked_backup_ancestors() {
    use std::os::unix::fs::symlink;

    for linked_part in ["root", "snapshot"] {
        let (root, managed, _, relative_backup, asset_id) =
            fixture(&format!("backup-symlink-{linked_part}"));
        let database = root.path().join("bandi.db");
        let backup_root = root.path().join(relative_backup);
        let snapshot = create_snapshot_at(
            &database,
            &managed,
            &backup_root,
            create_request(asset_id.clone()),
        )
        .unwrap();
        if linked_part == "root" {
            let real_root = root.path().join("real-backups");
            fs::rename(&backup_root, &real_root).unwrap();
            symlink(&real_root, &backup_root).unwrap();
        } else {
            let snapshot_dir = backup_root.join(&snapshot.id);
            let real_dir = root.path().join("real-snapshot");
            fs::rename(&snapshot_dir, &real_dir).unwrap();
            symlink(&real_dir, &snapshot_dir).unwrap();
        }

        let preview = preview_restore_at(
            &database,
            &managed,
            &backup_root,
            PreviewBackupRestoreRequest {
                request_id: format!("preview-symlink-{linked_part}"),
                snapshot_id: snapshot.id,
                asset_ids: vec![asset_id],
            },
        )
        .unwrap();
        assert_eq!(preview.entries[0].status, "integrity_failed");
    }
}

#[test]
fn restore_creates_safety_snapshot_revision_and_rejects_stale_preview() {
    let (root, managed, package, relative_backup, asset_id) = fixture("backup-restore");
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let revisions = root.path().join("revisions");
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        create_request(asset_id.clone()),
    )
    .unwrap();
    fs::write(package.join("instructions.md"), "# Changed\n").unwrap();
    let preview = preview_restore_at(
        &database,
        &managed,
        &backup_root,
        PreviewBackupRestoreRequest {
            request_id: "preview-restore".into(),
            snapshot_id: snapshot.id.clone(),
            asset_ids: vec![asset_id.clone()],
        },
    )
    .unwrap();
    let result = restore_snapshot_at(
        &database,
        &managed,
        &revisions,
        &backup_root,
        RestoreBackupSnapshotRequest {
            request_id: "restore-1".into(),
            snapshot_id: snapshot.id,
            asset_ids: vec![asset_id.clone()],
            preview_ref: preview.preview_ref.clone(),
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(result.kind, "restored");
    assert_eq!(result.entries[0].status, "restored");
    assert!(result.entries[0].revision_id.is_some());
    assert_eq!(
        fs::read_to_string(package.join("instructions.md")).unwrap(),
        "# Alpha\n"
    );
    assert_eq!(list_snapshots_at(&database).unwrap().len(), 2);
    assert!(restore_snapshot_at(
        &database,
        &managed,
        &revisions,
        &backup_root,
        RestoreBackupSnapshotRequest {
            request_id: "restore-again".into(),
            snapshot_id: result.snapshot_id,
            asset_ids: vec![asset_id],
            preview_ref: preview.preview_ref,
            confirmed: true,
        },
    )
    .is_err());
}

#[test]
fn restore_reports_baseline_change_after_preview_without_writing() {
    let (root, managed, package, relative_backup, asset_id) = fixture("backup-baseline");
    let database = root.path().join("bandi.db");
    let backup_root = root.path().join(relative_backup);
    let snapshot = create_snapshot_at(
        &database,
        &managed,
        &backup_root,
        create_request(asset_id.clone()),
    )
    .unwrap();
    fs::write(package.join("instructions.md"), "# Before preview\n").unwrap();
    let preview = preview_restore_at(
        &database,
        &managed,
        &backup_root,
        PreviewBackupRestoreRequest {
            request_id: "preview-baseline".into(),
            snapshot_id: snapshot.id.clone(),
            asset_ids: vec![asset_id.clone()],
        },
    )
    .unwrap();
    fs::write(package.join("instructions.md"), "# External\n").unwrap();
    let result = restore_snapshot_at(
        &database,
        &managed,
        &root.path().join("revisions"),
        &backup_root,
        RestoreBackupSnapshotRequest {
            request_id: "restore-baseline".into(),
            snapshot_id: snapshot.id,
            asset_ids: vec![asset_id],
            preview_ref: preview.preview_ref,
            confirmed: true,
        },
    )
    .unwrap();
    assert_eq!(result.kind, "restore_failed");
    assert_eq!(result.entries[0].status, "baseline_changed");
    assert_eq!(
        fs::read_to_string(package.join("instructions.md")).unwrap(),
        "# External\n"
    );
}
