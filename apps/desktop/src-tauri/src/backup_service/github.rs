use std::{collections::HashMap, sync::Mutex, time::Duration};

use keyring::{Entry, Error as KeyringError};
use reqwest::{header, redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const DEVICE_CODE_ENDPOINT: &str = "https://github.com/login/device/code";
pub(crate) const ACCESS_TOKEN_ENDPOINT: &str = "https://github.com/login/oauth/access_token";
pub(crate) const API_USER_ENDPOINT: &str = "https://api.github.com/user";
pub(crate) const API_REPOSITORIES_ENDPOINT: &str = "https://api.github.com/user/repos";
#[cfg(test)]
pub(crate) const DEFAULT_REPOSITORY_NAME: &str = "bandi-backup";
const API_VERSION: &str = "2022-11-28";
const KEYRING_SERVICE: &str = "com.bandi.desktop.github";
const KEYRING_ACCOUNT: &str = "remote-backup";
const MAX_ACTIVE_FLOWS: usize = 8;
const MAX_FLOW_TTL_SECONDS: u64 = 900;

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: String,
    token_type: String,
    scope: String,
}

#[derive(Deserialize)]
struct DeviceFlowErrorResponse {
    error: String,
    #[serde(default)]
    interval: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeviceFlowError {
    AuthorizationPending,
    SlowDown(Option<u64>),
    ExpiredToken,
    AccessDenied,
    Unknown,
}

impl DeviceFlowErrorResponse {
    fn kind(&self) -> DeviceFlowError {
        match self.error.as_str() {
            "authorization_pending" => DeviceFlowError::AuthorizationPending,
            "slow_down" => DeviceFlowError::SlowDown(self.interval),
            "expired_token" => DeviceFlowError::ExpiredToken,
            "access_denied" => DeviceFlowError::AccessDenied,
            _ => DeviceFlowError::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeviceFlowStartDto {
    pub(crate) flow_id: String,
    pub(crate) user_code: String,
    pub(crate) verification_uri: String,
    pub(crate) expires_at_epoch_seconds: u64,
    pub(crate) interval_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum DeviceFlowPollDto {
    Pending { retry_after_epoch_seconds: u64 },
    SlowDown { retry_after_epoch_seconds: u64 },
    Authorized { account: GitHubAccountDto },
    Expired,
    Denied,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatePrivateRepositoryRequest {
    pub(crate) name: String,
    pub(crate) private: bool,
    pub(crate) auto_init: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitHubAccountDto {
    pub(crate) id: u64,
    pub(crate) login: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivateRepositoryDto {
    pub(crate) id: u64,
    pub(crate) owner: String,
    pub(crate) name: String,
    pub(crate) default_branch: String,
}

#[derive(Deserialize)]
struct GitHubUserResponse {
    id: u64,
    login: String,
}

#[derive(Deserialize)]
struct GitHubRepositoryResponse {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    default_branch: String,
    owner: GitHubOwnerResponse,
}

#[derive(Deserialize)]
struct GitHubOwnerResponse {
    login: String,
}

#[derive(Clone)]
struct DeviceFlow {
    device_code: String,
    expires_at_epoch_seconds: u64,
    next_poll_at_epoch_seconds: u64,
    interval_seconds: u64,
}

#[derive(Default)]
pub(crate) struct DeviceFlowStore {
    flows: HashMap<String, DeviceFlow>,
}

pub(crate) fn github_http_client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("Bandi-Desktop")
        .build()
        .map_err(|_| "无法初始化 GitHub HTTP 客户端".into())
}

pub(crate) async fn start_device_flow(
    client: &Client,
    flows: &Mutex<DeviceFlowStore>,
    client_id: Option<&str>,
    now_epoch_seconds: u64,
) -> Result<DeviceFlowStartDto, String> {
    let client_id = require_client_id(client_id)?;
    let response = client
        .post(DEVICE_CODE_ENDPOINT)
        .header(header::ACCEPT, "application/json")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(format!("client_id={client_id}&scope=repo%20read%3Auser"))
        .send()
        .await
        .map_err(|_| "无法连接 GitHub Device Flow".to_string())?
        .error_for_status()
        .map_err(|_| "GitHub 拒绝 Device Flow 请求".to_string())?
        .json::<DeviceCodeResponse>()
        .await
        .map_err(|_| "GitHub Device Flow 响应无效".to_string())?;
    validate_device_code_response(&response)?;
    let flow_id = format!("{:x}", Sha256::digest(response.device_code.as_bytes()));
    let flow = DeviceFlow::from_response(&response, now_epoch_seconds)?;
    let result = DeviceFlowStartDto {
        flow_id: flow_id.clone(),
        user_code: response.user_code,
        verification_uri: response.verification_uri,
        expires_at_epoch_seconds: flow.expires_at_epoch_seconds,
        interval_seconds: flow.interval_seconds,
    };
    flows
        .lock()
        .map_err(|_| "GitHub 登录流程状态不可用".to_string())?
        .insert(flow_id, flow, now_epoch_seconds)?;
    Ok(result)
}

pub(crate) async fn poll_device_flow(
    client: &Client,
    flows: &Mutex<DeviceFlowStore>,
    client_id: Option<&str>,
    flow_id: &str,
    now_epoch_seconds: u64,
) -> Result<DeviceFlowPollDto, String> {
    let client_id = require_client_id(client_id)?;
    validate_flow_id(flow_id)?;
    let flow = flows
        .lock()
        .map_err(|_| "GitHub 登录流程状态不可用".to_string())?
        .for_poll(flow_id, now_epoch_seconds)?;
    let response = client
        .post(ACCESS_TOKEN_ENDPOINT)
        .header(header::ACCEPT, "application/json")
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(format!(
            "client_id={client_id}&device_code={}&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code",
            percent_encode(&flow.device_code)
        ))
        .send()
        .await
        .map_err(|_| "无法轮询 GitHub Device Flow".to_string())?
        .error_for_status()
        .map_err(|_| "GitHub 拒绝 Device Flow 轮询".to_string())?;
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "无法读取 GitHub Device Flow 响应".to_string())?;
    if let Ok(token) = serde_json::from_slice::<AccessTokenResponse>(&bytes) {
        validate_access_token(&token)?;
        let account = load_account_with_token(client, &token.access_token).await?;
        store_access_token(&token.access_token)?;
        finish_flow(flows, flow_id)?;
        return Ok(DeviceFlowPollDto::Authorized { account });
    }
    let error: DeviceFlowErrorResponse =
        serde_json::from_slice(&bytes).map_err(|_| "GitHub Device Flow 响应无效".to_string())?;
    handle_flow_error(flows, flow_id, error, now_epoch_seconds)
}

pub(crate) async fn load_github_account(client: &Client) -> Result<GitHubAccountDto, String> {
    let token = load_access_token()?;
    load_account_with_token(client, &token).await
}

pub(crate) async fn create_private_repository(
    client: &Client,
    request: CreatePrivateRepositoryRequest,
) -> Result<PrivateRepositoryDto, String> {
    validate_private_repository_request(&request)?;
    let token = load_access_token()?;
    let response = github_request(client.post(API_REPOSITORIES_ENDPOINT), &token)
        .json(&request)
        .send()
        .await
        .map_err(|_| "无法创建 GitHub Private 仓库".to_string())?
        .error_for_status()
        .map_err(|_| "GitHub 拒绝创建 Private 仓库".to_string())?
        .json::<GitHubRepositoryResponse>()
        .await
        .map_err(|_| "GitHub 仓库响应无效".to_string())?;
    private_repository_dto(response)
}

pub(crate) async fn connect_private_repository(
    client: &Client,
    owner: &str,
    name: &str,
) -> Result<PrivateRepositoryDto, String> {
    validate_repository_name(owner, "仓库所有者")?;
    validate_repository_name(name, "仓库名称")?;
    let token = load_access_token()?;
    let endpoint = format!("https://api.github.com/repos/{owner}/{name}");
    let response = github_request(client.get(endpoint), &token)
        .send()
        .await
        .map_err(|_| "无法连接 GitHub 仓库".to_string())?
        .error_for_status()
        .map_err(|_| "GitHub 仓库不存在或不可访问".to_string())?
        .json::<GitHubRepositoryResponse>()
        .await
        .map_err(|_| "GitHub 仓库响应无效".to_string())?;
    private_repository_dto(response)
}

pub(crate) fn delete_access_token() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(_) => Err("无法从系统钥匙串删除 GitHub 凭据".into()),
    }
}

pub(crate) fn load_access_token() -> Result<String, String> {
    credential_entry()?
        .get_password()
        .map_err(|_| "GitHub 凭据不可用，请重新授权".into())
}

fn store_access_token(token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 512 || token.chars().any(char::is_whitespace) {
        return Err("GitHub 返回的凭据无效".into());
    }
    credential_entry()?
        .set_password(token)
        .map_err(|_| "无法将 GitHub 凭据保存到系统钥匙串".into())
}

fn credential_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|_| "无法访问 GitHub 系统钥匙串条目".into())
}

async fn load_account_with_token(client: &Client, token: &str) -> Result<GitHubAccountDto, String> {
    let user = github_request(client.get(API_USER_ENDPOINT), token)
        .send()
        .await
        .map_err(|_| "无法读取 GitHub 账号".to_string())?
        .error_for_status()
        .map_err(|_| "GitHub 凭据无效或权限不足".to_string())?
        .json::<GitHubUserResponse>()
        .await
        .map_err(|_| "GitHub 账号响应无效".to_string())?;
    validate_repository_name(&user.login, "GitHub 登录名")?;
    if user.id == 0 {
        return Err("GitHub 账号标识无效".into());
    }
    Ok(GitHubAccountDto {
        id: user.id,
        login: user.login,
    })
}

fn github_request(builder: reqwest::RequestBuilder, token: &str) -> reqwest::RequestBuilder {
    builder
        .bearer_auth(token)
        .header(header::ACCEPT, "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
}

fn percent_encode(value: &str) -> String {
    value.bytes().fold(String::new(), |mut encoded, byte| {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            use std::fmt::Write;
            let _ = write!(encoded, "%{byte:02X}");
        }
        encoded
    })
}

fn private_repository_dto(
    repository: GitHubRepositoryResponse,
) -> Result<PrivateRepositoryDto, String> {
    validate_private_repository(&repository)?;
    Ok(PrivateRepositoryDto {
        id: repository.id,
        owner: repository.owner.login,
        name: repository.name,
        default_branch: repository.default_branch,
    })
}

fn handle_flow_error(
    flows: &Mutex<DeviceFlowStore>,
    flow_id: &str,
    error: DeviceFlowErrorResponse,
    now_epoch_seconds: u64,
) -> Result<DeviceFlowPollDto, String> {
    match error.kind() {
        DeviceFlowError::AuthorizationPending => Ok(DeviceFlowPollDto::Pending {
            retry_after_epoch_seconds: flows
                .lock()
                .map_err(|_| "GitHub 登录流程状态不可用".to_string())?
                .next_poll_at(flow_id)?,
        }),
        DeviceFlowError::SlowDown(server_interval) => {
            let retry_after_epoch_seconds = flows
                .lock()
                .map_err(|_| "GitHub 登录流程状态不可用".to_string())?
                .slow_down(flow_id, now_epoch_seconds, server_interval)?;
            Ok(DeviceFlowPollDto::SlowDown {
                retry_after_epoch_seconds,
            })
        }
        DeviceFlowError::ExpiredToken => {
            finish_flow(flows, flow_id)?;
            Ok(DeviceFlowPollDto::Expired)
        }
        DeviceFlowError::AccessDenied => {
            finish_flow(flows, flow_id)?;
            Ok(DeviceFlowPollDto::Denied)
        }
        DeviceFlowError::Unknown => Err("GitHub Device Flow 返回未知状态".into()),
    }
}

fn finish_flow(flows: &Mutex<DeviceFlowStore>, flow_id: &str) -> Result<(), String> {
    flows
        .lock()
        .map_err(|_| "GitHub 登录流程状态不可用".to_string())?
        .finish(flow_id);
    Ok(())
}

impl DeviceFlow {
    fn from_response(
        response: &DeviceCodeResponse,
        now_epoch_seconds: u64,
    ) -> Result<Self, String> {
        Ok(Self {
            device_code: response.device_code.clone(),
            expires_at_epoch_seconds: now_epoch_seconds
                .checked_add(response.expires_in)
                .ok_or_else(|| "GitHub 登录流程过期时间无效".to_string())?,
            next_poll_at_epoch_seconds: now_epoch_seconds
                .checked_add(response.interval)
                .ok_or_else(|| "GitHub 登录轮询时间无效".to_string())?,
            interval_seconds: response.interval,
        })
    }
}

impl DeviceFlowStore {
    fn insert(
        &mut self,
        flow_id: String,
        flow: DeviceFlow,
        now_epoch_seconds: u64,
    ) -> Result<(), String> {
        self.flows
            .retain(|_, item| now_epoch_seconds < item.expires_at_epoch_seconds);
        if self.flows.len() >= MAX_ACTIVE_FLOWS || self.flows.contains_key(&flow_id) {
            return Err("GitHub 登录流程数量已达上限或流程重复".into());
        }
        self.flows.insert(flow_id, flow);
        Ok(())
    }

    fn for_poll(&mut self, flow_id: &str, now_epoch_seconds: u64) -> Result<DeviceFlow, String> {
        let flow = self
            .flows
            .get_mut(flow_id)
            .ok_or_else(|| "GitHub 登录流程不存在".to_string())?;
        if now_epoch_seconds >= flow.expires_at_epoch_seconds {
            self.flows.remove(flow_id);
            return Err("GitHub 登录流程已过期".into());
        }
        if now_epoch_seconds < flow.next_poll_at_epoch_seconds {
            return Err("GitHub 登录轮询过于频繁".into());
        }
        flow.next_poll_at_epoch_seconds = now_epoch_seconds
            .checked_add(flow.interval_seconds)
            .ok_or_else(|| "GitHub 登录轮询时间无效".to_string())?;
        Ok(flow.clone())
    }

    fn next_poll_at(&self, flow_id: &str) -> Result<u64, String> {
        self.flows
            .get(flow_id)
            .map(|flow| flow.next_poll_at_epoch_seconds)
            .ok_or_else(|| "GitHub 登录流程不存在".into())
    }

    fn slow_down(
        &mut self,
        flow_id: &str,
        now_epoch_seconds: u64,
        server_interval: Option<u64>,
    ) -> Result<u64, String> {
        let flow = self
            .flows
            .get_mut(flow_id)
            .ok_or_else(|| "GitHub 登录流程不存在".to_string())?;
        flow.interval_seconds = server_interval
            .unwrap_or_else(|| flow.interval_seconds.saturating_add(5))
            .clamp(1, 60);
        flow.next_poll_at_epoch_seconds = now_epoch_seconds
            .checked_add(flow.interval_seconds)
            .ok_or_else(|| "GitHub 登录轮询时间无效".to_string())?;
        Ok(flow.next_poll_at_epoch_seconds)
    }

    fn finish(&mut self, flow_id: &str) {
        self.flows.remove(flow_id);
    }
}

fn require_client_id(client_id: Option<&str>) -> Result<&str, String> {
    let client_id = client_id.ok_or_else(|| "未配置 GitHub OAuth Client ID".to_string())?;
    if client_id.len() < 8
        || client_id.len() > 128
        || !client_id.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err("GitHub OAuth Client ID 无效".into());
    }
    Ok(client_id)
}

fn validate_private_repository_request(
    request: &CreatePrivateRepositoryRequest,
) -> Result<(), String> {
    validate_repository_name(&request.name, "仓库名称")?;
    if !request.private || !request.auto_init {
        return Err("远程备份仓库必须为 Private 且初始化默认分支".into());
    }
    Ok(())
}

fn validate_private_repository(repository: &GitHubRepositoryResponse) -> Result<(), String> {
    if repository.id == 0 || !repository.private {
        return Err("远程备份只允许有效的 Private 仓库".into());
    }
    validate_repository_name(&repository.owner.login, "仓库所有者")?;
    validate_repository_name(&repository.name, "仓库名称")?;
    if repository.full_name != format!("{}/{}", repository.owner.login, repository.name) {
        return Err("GitHub 仓库身份不一致".into());
    }
    if repository.default_branch.is_empty()
        || repository.default_branch.len() > 255
        || repository.default_branch.chars().any(char::is_control)
    {
        return Err("GitHub 仓库默认分支无效".into());
    }
    Ok(())
}

pub(super) fn validate_repository_name(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 100
        || value.starts_with('.')
        || value.ends_with('.')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(format!("{label}无效"));
    }
    Ok(())
}

fn validate_flow_id(value: &str) -> Result<(), String> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("GitHub 登录流程标识无效".into());
    }
    Ok(())
}

fn validate_device_code_response(response: &DeviceCodeResponse) -> Result<(), String> {
    if response.device_code.is_empty()
        || response.device_code.len() > 512
        || response.user_code.is_empty()
        || response.user_code.len() > 32
        || response.verification_uri != "https://github.com/login/device"
        || !(1..=MAX_FLOW_TTL_SECONDS).contains(&response.expires_in)
        || !(1..=60).contains(&response.interval)
    {
        return Err("GitHub Device Flow 响应无效".into());
    }
    Ok(())
}

fn validate_access_token(token: &AccessTokenResponse) -> Result<(), String> {
    if token.token_type != "bearer"
        || token.access_token.is_empty()
        || token.access_token.len() > 512
        || token.access_token.chars().any(char::is_whitespace)
        || token.scope.split(',').all(|scope| scope.trim() != "repo")
    {
        return Err("GitHub Device Flow 凭据响应无效".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response() -> DeviceCodeResponse {
        DeviceCodeResponse {
            device_code: "device-secret".into(),
            user_code: "ABCD-EFGH".into(),
            verification_uri: "https://github.com/login/device".into(),
            expires_in: 900,
            interval: 5,
        }
    }

    #[test]
    fn flow_store_enforces_poll_interval_and_expiry() {
        let mut store = DeviceFlowStore::default();
        let flow = DeviceFlow::from_response(&response(), 100).unwrap();
        let id = format!("{:x}", Sha256::digest(b"device-secret"));
        store.insert(id.clone(), flow, 100).unwrap();
        assert!(store.for_poll(&id, 104).is_err());
        assert_eq!(
            store.for_poll(&id, 105).unwrap().device_code,
            "device-secret"
        );
        assert!(store.for_poll(&id, 1_000).is_err());
    }

    #[test]
    fn private_repository_rejects_public_visibility() {
        let repository = GitHubRepositoryResponse {
            id: 1,
            name: DEFAULT_REPOSITORY_NAME.into(),
            full_name: format!("alice/{DEFAULT_REPOSITORY_NAME}"),
            private: false,
            default_branch: "main".into(),
            owner: GitHubOwnerResponse {
                login: "alice".into(),
            },
        };
        assert!(validate_private_repository(&repository).is_err());
    }

    #[test]
    fn token_response_is_never_serializable_or_debuggable() {
        let token = AccessTokenResponse {
            access_token: "secret".into(),
            token_type: "bearer".into(),
            scope: "repo".into(),
        };
        assert!(validate_access_token(&token).is_ok());
    }
}
