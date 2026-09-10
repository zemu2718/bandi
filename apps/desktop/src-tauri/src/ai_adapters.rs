use serde::{Deserialize, Serialize};

#[cfg(not(test))]
use std::process::Command;

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

impl BuiltInClientId {
    pub(crate) const fn adapter_id(self) -> ClientAdapterId {
        match self {
            Self::ClaudeCode => ClientAdapterId::ClaudeCodeTerminalV1,
            Self::ClaudeDesktop => ClientAdapterId::ClaudeDesktopConfigV1,
            Self::Codex => ClientAdapterId::CodexTerminalV1,
            Self::GeminiCli => ClientAdapterId::GeminiCliTerminalV1,
            Self::GrokBuild => ClientAdapterId::GrokBuildConfigV1,
            Self::Opencode => ClientAdapterId::OpencodeTerminalV1,
            Self::Openclaw => ClientAdapterId::OpenclawTerminalV1,
            Self::Hermes => ClientAdapterId::HermesTerminalV1,
            Self::Pi => ClientAdapterId::PiTerminalV1,
        }
    }
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

impl TerminalId {
    const fn mac_app(self) -> &'static str {
        match self {
            Self::Terminal => "Terminal",
            Self::ITerm2 => "iTerm",
            Self::Warp => "Warp",
            Self::Ghostty => "Ghostty",
            Self::Wezterm => "WezTerm",
            Self::Kitty => "kitty",
            Self::Alacritty => "Alacritty",
        }
    }
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

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct ValidatedLaunchContext {
    pub(crate) prompt: String,
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ContextDelivery {
    InitialPrompt,
    ManualCopy,
    None,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ClientLaunchOutcomeV3 {
    TerminalLaunchRequested,
    ApplicationLaunchRequested,
    ManualContextRequired,
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
    pub(crate) context_delivery: ContextDelivery,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) manual_prompt: Option<String>,
    pub(crate) outcome: ClientLaunchOutcomeV3,
}

#[derive(Debug, PartialEq, Eq)]
struct LaunchSpec {
    program: &'static str,
    args: Vec<String>,
    context_delivery: ContextDelivery,
    outcome: ClientLaunchOutcomeV3,
}

fn launch_spec(request: &ClientLaunchRequestV3) -> LaunchSpec {
    if request.client_id == BuiltInClientId::ClaudeDesktop {
        return LaunchSpec {
            program: "/usr/bin/open",
            args: vec!["-a".into(), "Claude".into()],
            context_delivery: ContextDelivery::ManualCopy,
            outcome: ClientLaunchOutcomeV3::ApplicationLaunchRequested,
        };
    }
    LaunchSpec {
        program: "/usr/bin/open",
        args: vec!["-a".into(), request.terminal_id.mac_app().into()],
        context_delivery: ContextDelivery::ManualCopy,
        outcome: ClientLaunchOutcomeV3::ManualContextRequired,
    }
}

#[cfg(not(test))]
fn execute(spec: &LaunchSpec) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("CLIENT_LAUNCH_UNSUPPORTED_PLATFORM: 当前平台暂不支持客户端启动".into());
    }
    Command::new(spec.program)
        .args(&spec.args)
        .spawn()
        .map(|_| ())
        .map_err(|_| "CLIENT_LAUNCH_REQUEST_FAILED: 无法提交受控启动请求".into())
}

#[cfg(test)]
fn execute(_spec: &LaunchSpec) -> Result<(), String> {
    Ok(())
}

pub(crate) fn request_launch(
    request: ClientLaunchRequestV3,
    validate_context: impl FnOnce(
        ClientLaunchValidationInput<'_>,
    ) -> Result<ValidatedLaunchContext, String>,
) -> Result<ClientLaunchResultV3, String> {
    if request.client_id.adapter_id() != request.adapter_id {
        return Err("INVALID_CLIENT_ADAPTER: 客户端与适配器不匹配".into());
    }
    let context = validate_context(ClientLaunchValidationInput {
        team_id: &request.team_id,
        agent_id: &request.agent_id,
        task_id: request.task_id.as_deref(),
    })?;
    let spec = launch_spec(&request);
    execute(&spec)?;
    let manual_prompt = Some(context.prompt);
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
            reason: "已提交固定客户端打开请求；上下文需要手动粘贴".into(),
            evidence: vec!["Team、Agent 与可选 TaskBrief 已由后端重取并复核".into()],
            remediation: vec!["将已复制的上下文粘贴到打开的客户端".into()],
        },
        context_delivery: spec.context_delivery,
        manual_prompt,
        outcome: spec.outcome,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(client_id: BuiltInClientId) -> ClientLaunchRequestV3 {
        ClientLaunchRequestV3 {
            client_id,
            adapter_id: client_id.adapter_id(),
            terminal_id: TerminalId::Terminal,
            intent: ClientLaunchIntentV3::StartWithContext,
            team_id: "team-1".into(),
            agent_id: "agent-1".into(),
            task_id: Some("brief-1".into()),
        }
    }

    #[test]
    fn rejects_adapter_mismatch_before_domain_validation() {
        let mut invalid = request(BuiltInClientId::ClaudeCode);
        invalid.adapter_id = ClientAdapterId::CodexTerminalV1;
        assert!(request_launch(invalid, |_| panic!("不应校验"))
            .unwrap_err()
            .contains("INVALID_CLIENT_ADAPTER"));
    }

    #[test]
    fn terminal_tools_only_open_fixed_terminal() {
        let spec = launch_spec(&request(BuiltInClientId::ClaudeCode));
        assert_eq!(spec.program, "/usr/bin/open");
        assert_eq!(spec.args, ["-a", "Terminal"]);
        assert_eq!(spec.context_delivery, ContextDelivery::ManualCopy);
        assert_eq!(spec.outcome, ClientLaunchOutcomeV3::ManualContextRequired);
    }

    #[test]
    fn desktop_application_only_opens_fixed_application() {
        let desktop = launch_spec(&request(BuiltInClientId::ClaudeDesktop));
        assert_eq!(desktop.args, ["-a", "Claude"]);
        assert_eq!(desktop.context_delivery, ContextDelivery::ManualCopy);
        assert_eq!(
            desktop.outcome,
            ClientLaunchOutcomeV3::ApplicationLaunchRequested
        );
    }

    #[test]
    fn request_result_requires_manual_context() {
        let result = request_launch(request(BuiltInClientId::Codex), |_| {
            Ok(ValidatedLaunchContext {
                prompt: "verified".into(),
            })
        })
        .unwrap();
        assert_eq!(result.outcome, ClientLaunchOutcomeV3::ManualContextRequired);
        assert_eq!(result.context_delivery, ContextDelivery::ManualCopy);
        assert_eq!(result.manual_prompt.as_deref(), Some("verified"));
    }
}
