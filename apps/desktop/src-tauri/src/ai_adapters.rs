use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum BuiltInClientId {
    ClaudeCode,
    ClaudeDesktop,
    Codex,
    GeminiCli,
    GrokBuild,
    Opencode,
    Openclaw,
    Hermes,
    Pi,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ClientAdapterId {
    ClaudeCodeTerminalV1,
    ClaudeDesktopConfigV1,
    CodexTerminalV1,
    GeminiCliTerminalV1,
    GrokBuildConfigV1,
    OpencodeTerminalV1,
    OpenclawTerminalV1,
    HermesTerminalV1,
    PiTerminalV1,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TerminalId {
    Terminal,
    #[serde(rename = "iterm2")]
    ITerm2,
    Warp,
    Ghostty,
    Wezterm,
    Kitty,
    Alacritty,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ClientLaunchIntentV3 {
    StartWithContext,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClientLaunchRequestV3 {
    pub(crate) client_id: BuiltInClientId,
    pub(crate) adapter_id: ClientAdapterId,
    pub(crate) terminal_id: TerminalId,
    pub(crate) intent: ClientLaunchIntentV3,
    pub(crate) team_id: String,
    pub(crate) agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) task_id: Option<String>,
}

pub(crate) struct ClientLaunchValidationInput<'a> {
    pub(crate) team_id: &'a str,
    pub(crate) agent_id: &'a str,
    pub(crate) task_id: Option<&'a str>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CapabilityStatus {
    Supported,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CapabilityFact {
    pub(crate) status: CapabilityStatus,
    pub(crate) reason: String,
    pub(crate) evidence: Vec<String>,
    pub(crate) remediation: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ClientLaunchOutcomeV3 {
    ContextPrepared,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ClientLaunchResultV3 {
    pub(crate) client_id: BuiltInClientId,
    pub(crate) adapter_id: ClientAdapterId,
    pub(crate) terminal_id: TerminalId,
    pub(crate) intent: ClientLaunchIntentV3,
    pub(crate) team_id: String,
    pub(crate) agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) task_id: Option<String>,
    pub(crate) capability: CapabilityFact,
    pub(crate) outcome: ClientLaunchOutcomeV3,
}

pub(crate) fn prepare_context(
    request: ClientLaunchRequestV3,
    validate_context: impl FnOnce(ClientLaunchValidationInput<'_>) -> Result<(), String>,
) -> Result<ClientLaunchResultV3, String> {
    validate_context(ClientLaunchValidationInput {
        team_id: &request.team_id,
        agent_id: &request.agent_id,
        task_id: request.task_id.as_deref(),
    })?;
    Ok(ClientLaunchResultV3 {
        client_id: request.client_id,
        adapter_id: request.adapter_id,
        terminal_id: request.terminal_id,
        intent: request.intent,
        team_id: request.team_id,
        agent_id: request.agent_id,
        task_id: request.task_id,
        capability: CapabilityFact {
            status: CapabilityStatus::Supported,
            reason: "上下文已准备；请在自己的客户端中继续".into(),
            evidence: vec!["仅复核 Team、Agent 与可选 TaskBrief，未访问目录或调用外部进程".into()],
            remediation: vec!["切换到自己的客户端继续".into()],
        },
        outcome: ClientLaunchOutcomeV3::ContextPrepared,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ClientLaunchRequestV3 {
        ClientLaunchRequestV3 {
            client_id: BuiltInClientId::ClaudeCode,
            adapter_id: ClientAdapterId::ClaudeCodeTerminalV1,
            terminal_id: TerminalId::Terminal,
            intent: ClientLaunchIntentV3::StartWithContext,
            team_id: "team-1".into(),
            agent_id: "agent-1".into(),
            task_id: Some("brief-1".into()),
        }
    }

    #[test]
    fn launch_v3_only_prepares_validated_context() {
        let result = prepare_context(request(), |context| {
            assert_eq!(context.task_id, Some("brief-1"));
            Ok(())
        })
        .unwrap();
        assert_eq!(result.outcome, ClientLaunchOutcomeV3::ContextPrepared);
    }

    #[test]
    fn launch_v3_returns_validation_error() {
        assert_eq!(
            prepare_context(request(), |_| Err("Team 不存在".into())).unwrap_err(),
            "Team 不存在"
        );
    }
}
