use super::*;

fn fixture() -> (
    tempfile::TempDir,
    std::path::PathBuf,
    std::path::PathBuf,
    std::path::PathBuf,
    std::path::PathBuf,
) {
    let root = tempfile::tempdir().unwrap();
    let database = root.path().join("bandi.db");
    domain_store::open_at(&database).unwrap();
    let agents = root.path().join("agents");
    let agent = agents.join("agt_alpha");
    fs::create_dir_all(agent.join("config")).unwrap();
    fs::write(
        agent.join(".bandi-agent.json"),
        br#"{"id":"alpha","teamId":"team-personal","status":"active"}"#,
    )
    .unwrap();
    fs::write(
        agent.join("agent.yaml"),
        "schemaVersion: 1\nid: alpha\nteamId: team-personal\nstatus: active\n",
    )
    .unwrap();
    fs::write(agent.join("instructions.md"), "# Alpha\n").unwrap();
    fs::write(
        agent.join("config/rules.yaml"),
        "schemaVersion: 1\nrules: []\n",
    )
    .unwrap();
    fs::create_dir(agent.join("memory")).unwrap();
    fs::write(agent.join("memory/long-term.md"), "private memory").unwrap();

    let shared = root.path().join("shared-assets");
    let skill = shared.join("skill-one");
    fs::create_dir_all(skill.join("references")).unwrap();
    fs::write(skill.join("asset.yaml"), "schemaVersion: 2\nid: skill-one\nname: Skill One\nkind: skill\nteamId: team-personal\ncontentFile: SKILL.md\nsource:\n  kind: authored\n").unwrap();
    fs::write(skill.join("SKILL.md"), "# Skill\n").unwrap();
    fs::write(skill.join("references/guide.txt"), "guide").unwrap();
    let portable = root.path().join("portable");
    (root, database, agents, shared, portable)
}

#[test]
fn complete_snapshot_is_content_addressed_and_memory_is_opt_in() {
    let (_root, database, agents, shared, portable) = fixture();
    let without = create_portable_snapshot_at(
        &database,
        &agents,
        &shared,
        &portable,
        CreatePortableSnapshotRequest {
            request_id: "without-memory".into(),
            include_memory: false,
        },
    )
    .unwrap();
    assert!(without
        .entries
        .iter()
        .any(|entry| entry.path == "domain/domain-v4.json"));
    assert!(without
        .entries
        .iter()
        .any(|entry| entry.path == "agents/agt_alpha/.bandi-agent.json"));
    assert!(without
        .entries
        .iter()
        .any(|entry| entry.path == "shared-assets/skill-one/references/guide.txt"));
    assert!(!without
        .entries
        .iter()
        .any(|entry| entry.kind == PortableEntryKind::Memory));
    assert!(!portable
        .join(&without.snapshot_id)
        .join("bandi.db")
        .exists());

    let with = create_portable_snapshot_at(
        &database,
        &agents,
        &shared,
        &portable,
        CreatePortableSnapshotRequest {
            request_id: "with-memory".into(),
            include_memory: true,
        },
    )
    .unwrap();
    assert!(with
        .entries
        .iter()
        .any(|entry| entry.path == "agents/agt_alpha/memory/long-term.md"));
    assert_eq!(list_portable_snapshots_at(&portable).unwrap().len(), 2);
    assert_eq!(
        read_portable_snapshot_at(&portable, &with.snapshot_id)
            .unwrap()
            .manifest_hash,
        with.manifest_hash
    );
}

#[test]
fn strict_manifest_and_object_integrity_reject_tampering() {
    let (_root, database, agents, shared, portable) = fixture();
    let manifest = create_portable_snapshot_at(
        &database,
        &agents,
        &shared,
        &portable,
        CreatePortableSnapshotRequest {
            request_id: "tamper".into(),
            include_memory: false,
        },
    )
    .unwrap();
    let directory = portable.join(&manifest.snapshot_id);
    fs::write(directory.join(&manifest.entries[0].object_ref), b"tampered").unwrap();
    assert!(read_portable_snapshot_at(&portable, &manifest.snapshot_id)
        .unwrap_err()
        .contains("INTEGRITY_FAILED"));

    let mut encoded = serde_json::to_value(&manifest).unwrap();
    encoded
        .as_object_mut()
        .unwrap()
        .insert("futureField".into(), true.into());
    fs::write(
        directory.join(MANIFEST_FILE),
        serde_json::to_vec(&encoded).unwrap(),
    )
    .unwrap();
    assert!(read_portable_snapshot_at(&portable, &manifest.snapshot_id)
        .unwrap_err()
        .contains("MANIFEST_INVALID"));
}

#[cfg(unix)]
#[test]
fn source_links_fail_closed() {
    use std::os::unix::fs::symlink;
    let (_root, database, agents, shared, portable) = fixture();
    let outside = tempfile::NamedTempFile::new().unwrap();
    symlink(outside.path(), agents.join("agt_alpha/config/linked.yaml")).unwrap();
    assert!(create_portable_snapshot_at(
        &database,
        &agents,
        &shared,
        &portable,
        CreatePortableSnapshotRequest {
            request_id: "linked".into(),
            include_memory: false
        },
    )
    .unwrap_err()
    .contains("SYMLINK"));
}
