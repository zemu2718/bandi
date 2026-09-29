#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AutomaticBackupDecision {
    Disabled,
    Wait,
    CreateAndPush,
    PushExisting,
    ResolveRemoteConflict,
    Reauthorize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AutomaticBackupContext {
    pub(crate) enabled: bool,
    pub(crate) repository_connected: bool,
    pub(crate) credential_available: bool,
    pub(crate) remote_conflict: bool,
    pub(crate) local_changes: bool,
    pub(crate) pending_snapshot: bool,
    pub(crate) now_epoch_seconds: u64,
    pub(crate) last_success_epoch_seconds: Option<u64>,
    pub(crate) minimum_interval_seconds: u64,
}

pub(crate) fn decide_automatic_backup(context: AutomaticBackupContext) -> AutomaticBackupDecision {
    if !context.enabled || !context.repository_connected {
        return AutomaticBackupDecision::Disabled;
    }
    if !context.credential_available {
        return AutomaticBackupDecision::Reauthorize;
    }
    if context.remote_conflict {
        return AutomaticBackupDecision::ResolveRemoteConflict;
    }
    if context.pending_snapshot {
        return AutomaticBackupDecision::PushExisting;
    }
    if !context.local_changes || !interval_elapsed(context) {
        return AutomaticBackupDecision::Wait;
    }
    AutomaticBackupDecision::CreateAndPush
}

pub(crate) fn automatic_backup_due(
    enabled: bool,
    repository_connected: bool,
    credential_available: bool,
    remote_conflict: bool,
    local_changes: bool,
    now_epoch_seconds: u64,
    last_success_epoch_seconds: Option<u64>,
    minimum_interval_seconds: u64,
) -> bool {
    decide_automatic_backup(AutomaticBackupContext {
        enabled,
        repository_connected,
        credential_available,
        remote_conflict,
        local_changes,
        pending_snapshot: false,
        now_epoch_seconds,
        last_success_epoch_seconds,
        minimum_interval_seconds,
    }) == AutomaticBackupDecision::CreateAndPush
}

fn interval_elapsed(context: AutomaticBackupContext) -> bool {
    context.last_success_epoch_seconds.map_or(true, |last| {
        context.now_epoch_seconds.saturating_sub(last) >= context.minimum_interval_seconds
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> AutomaticBackupContext {
        AutomaticBackupContext {
            enabled: true,
            repository_connected: true,
            credential_available: true,
            remote_conflict: false,
            local_changes: true,
            pending_snapshot: false,
            now_epoch_seconds: 200,
            last_success_epoch_seconds: Some(100),
            minimum_interval_seconds: 60,
        }
    }

    #[test]
    fn conflict_and_missing_credential_block_automatic_write() {
        let mut value = context();
        value.remote_conflict = true;
        assert_eq!(
            decide_automatic_backup(value),
            AutomaticBackupDecision::ResolveRemoteConflict
        );
        value.remote_conflict = false;
        value.credential_available = false;
        assert_eq!(
            decide_automatic_backup(value),
            AutomaticBackupDecision::Reauthorize
        );
    }

    #[test]
    fn due_helper_requires_all_safe_preconditions() {
        let value = context();
        assert!(automatic_backup_due(
            value.enabled,
            value.repository_connected,
            value.credential_available,
            value.remote_conflict,
            value.local_changes,
            value.now_epoch_seconds,
            value.last_success_epoch_seconds,
            value.minimum_interval_seconds,
        ));
        assert!(!automatic_backup_due(
            value.enabled,
            value.repository_connected,
            false,
            value.remote_conflict,
            value.local_changes,
            value.now_epoch_seconds,
            value.last_success_epoch_seconds,
            value.minimum_interval_seconds,
        ));
    }

    #[test]
    fn due_change_creates_snapshot_but_pending_snapshot_is_reused() {
        let mut value = context();
        assert_eq!(
            decide_automatic_backup(value),
            AutomaticBackupDecision::CreateAndPush
        );
        value.pending_snapshot = true;
        assert_eq!(
            decide_automatic_backup(value),
            AutomaticBackupDecision::PushExisting
        );
    }
}
