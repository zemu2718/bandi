mod contracts;
mod git_transport;
mod github;
mod portable;
mod portable_restore;
mod remote;
mod remote_state;
mod restore;
mod storage;

pub(crate) use contracts::{
    BackupRestorePreviewDto, BackupRestoreResultDto, BackupSnapshotDto,
    CreateBackupSnapshotRequest, PreviewBackupRestoreRequest, RestoreBackupSnapshotRequest,
};
pub(crate) use git_transport::{list_remote_history, push_portable_snapshot};
pub(crate) use github::{
    connect_private_repository, create_private_repository, delete_access_token, github_http_client,
    load_access_token, load_github_account, poll_device_flow, start_device_flow,
    CreatePrivateRepositoryRequest, DeviceFlowPollDto, DeviceFlowStore,
};
pub(crate) use portable::{
    create_portable_snapshot_at, list_portable_snapshots_at, CreatePortableSnapshotRequest,
    PortableSnapshotManifestV1, PortableSnapshotSummaryDto,
};
pub(crate) use portable_restore::{
    preview_portable_restore_at, restore_portable_snapshot_at, PortableRestorePreviewDto,
    PortableRestoreRequest, PortableRestoreResultDto,
};
pub(crate) use remote::automatic_backup_due;
pub(crate) use remote_state::{
    load_remote_state, store_remote_state, RemoteBackupState, RemoteRepositoryState,
};
pub(crate) use restore::{preview_restore_at, restore_snapshot_at};
pub(crate) use storage::{create_snapshot_at, list_snapshots_at};

#[cfg(test)]
mod tests;
