use std::{env, process::ExitCode};

use bandi_desktop_lib::cli_service::{self, LocalServicePaths};
use serde::Serialize;

fn usage() -> &'static str {
    "用法: bandi [--json] <命令>\n\n命令:\n  doctor\n  status\n  teams list\n  agents list --team-id <ID>\n  agents show --agent-id <ID>\n  task-briefs list --team-id <ID>\n  task-briefs show --task-brief-id <ID>\n  context show --team-id <ID> --agent-id <ID> [--task-brief-id <ID>]\n  config check\n\n只读检查 Bandi 配置事实；不启动外部工具，不创建或管理 Session。"
}

fn print_value<T: Serialize>(value: &T, json: bool) -> Result<(), String> {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(value).map_err(|_| "无法序列化 CLI 结果")?
        );
    } else {
        let value = serde_json::to_value(value).map_err(|_| "无法序列化 CLI 结果")?;
        if let Some(status) = value.get("status").and_then(|item| item.as_str()) {
            println!("状态: {status}");
        }
        println!(
            "{}",
            serde_json::to_string_pretty(&value).map_err(|_| "无法输出 CLI 结果")?
        );
    }
    Ok(())
}

fn platform_paths() -> Result<LocalServicePaths, String> {
    #[cfg(target_os = "windows")]
    let (home, app_data) = (
        env::var_os("USERPROFILE").ok_or("无法访问 Windows 用户目录")?,
        env::var_os("APPDATA").ok_or("无法访问 Windows 漫游数据目录")?,
    );
    #[cfg(target_os = "macos")]
    let (home, app_data) = {
        let home = env::var_os("HOME").ok_or("无法访问用户主目录")?;
        let app_data =
            std::path::PathBuf::from(&home).join("Library/Application Support/com.bandi.desktop");
        (home, app_data.into_os_string())
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let (home, app_data) = {
        let home = env::var_os("HOME").ok_or("无法访问用户主目录")?;
        let app_data = env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from(&home).join(".local/share"))
            .join("com.bandi.desktop");
        (home, app_data.into_os_string())
    };
    Ok(LocalServicePaths::from_roots(
        &std::path::PathBuf::from(home),
        &std::path::PathBuf::from(app_data),
    ))
}

fn option(args: &[&str], name: &str) -> Result<String, String> {
    let index = args
        .iter()
        .position(|item| *item == name)
        .ok_or_else(|| format!("缺少 {name}"))?;
    args.get(index + 1)
        .filter(|value| !value.starts_with("--"))
        .map(|value| (*value).to_string())
        .ok_or_else(|| format!("缺少 {name} 的值"))
}

fn optional_option(args: &[&str], name: &str) -> Result<Option<String>, String> {
    if args.iter().any(|item| *item == name) {
        option(args, name).map(Some)
    } else {
        Ok(None)
    }
}

fn only_options(args: &[&str], names: &[&str]) -> bool {
    let mut seen = Vec::new();
    let mut index = 0;
    while index < args.len() {
        if !names.contains(&args[index]) || seen.contains(&args[index]) || index + 1 == args.len() {
            return false;
        }
        seen.push(args[index]);
        index += 2;
    }
    true
}

fn run() -> Result<bool, String> {
    let mut args: Vec<String> = env::args().skip(1).collect();
    let json = if let Some(index) = args.iter().position(|item| item == "--json") {
        args.remove(index);
        true
    } else {
        false
    };
    let paths = platform_paths()?;
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["doctor"] => {
            let report = cli_service::doctor(&paths);
            let ok = report.status != "degraded";
            print_value(&report, json)?;
            Ok(ok)
        }
        ["status"] => {
            let report = cli_service::status(&paths)?;
            let ok = report.status != "degraded";
            print_value(&report, json)?;
            Ok(ok)
        }
        ["teams", "list"] => {
            print_value(&cli_service::list_teams(&paths)?, json)?;
            Ok(true)
        }
        ["agents", "list", options @ ..] if only_options(options, &["--team-id"]) => {
            print_value(
                &cli_service::list_agents(&paths, &option(options, "--team-id")?)?,
                json,
            )?;
            Ok(true)
        }
        ["agents", "show", options @ ..] if only_options(options, &["--agent-id"]) => {
            print_value(
                &cli_service::show_agent(&paths, &option(options, "--agent-id")?)?,
                json,
            )?;
            Ok(true)
        }
        ["task-briefs", "list", options @ ..] if only_options(options, &["--team-id"]) => {
            print_value(
                &cli_service::list_task_briefs(&paths, &option(options, "--team-id")?)?,
                json,
            )?;
            Ok(true)
        }
        ["task-briefs", "show", options @ ..] if only_options(options, &["--task-brief-id"]) => {
            print_value(
                &cli_service::show_task_brief(&paths, &option(options, "--task-brief-id")?)?,
                json,
            )?;
            Ok(true)
        }
        ["context", "show", options @ ..]
            if only_options(options, &["--team-id", "--agent-id", "--task-brief-id"]) =>
        {
            let task_brief_id = optional_option(options, "--task-brief-id")?;
            print_value(
                &cli_service::show_context(
                    &paths,
                    &option(options, "--team-id")?,
                    &option(options, "--agent-id")?,
                    task_brief_id.as_deref(),
                )?,
                json,
            )?;
            Ok(true)
        }
        ["config", "check"] => {
            let report = cli_service::check_config(&paths)?;
            let ok = report.status == "valid";
            print_value(&report, json)?;
            Ok(ok)
        }
        ["help"] | ["--help"] | ["-h"] => {
            println!("{}", usage());
            Ok(true)
        }
        _ => Err(usage().into()),
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(2),
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(1)
        }
    }
}
