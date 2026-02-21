use dark_light::Mode;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rfd::FileDialog;
use serde::Serialize;
use std::{
  collections::VecDeque,
  env, fs,
  path::{Path, PathBuf},
  process::Command,
  sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use url::Url;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFilePayload {
  file_path: String,
  file_name: String,
  base_href: String,
  content: String,
}

#[derive(Default)]
struct PendingOpenPaths {
  queue: Mutex<VecDeque<String>>,
}

impl PendingOpenPaths {
  fn push(&self, path: String) {
    if let Ok(mut queue) = self.queue.lock() {
      queue.push_back(path);
    }
  }

  fn pop(&self) -> Option<String> {
    self.queue.lock().ok().and_then(|mut queue| queue.pop_front())
  }
}

#[derive(Default)]
struct FileWatchInner {
  watcher: Option<RecommendedWatcher>,
  watched_path: Option<PathBuf>,
}

#[derive(Default)]
struct FileWatchState {
  inner: Mutex<FileWatchInner>,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupOptions {
  #[serde(skip_serializing_if = "Option::is_none")]
  theme: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  toc_open: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  auto_refresh: Option<bool>,
}

impl StartupOptions {
  fn is_empty(&self) -> bool {
    self.theme.is_none() && self.toc_open.is_none() && self.auto_refresh.is_none()
  }
}

struct StartupOptionsState {
  options: StartupOptions,
}

#[derive(Default)]
struct ParsedLaunchArgs {
  launch_path: Option<String>,
  startup_options: StartupOptions,
  exit_after_print: bool,
}

fn print_cli_help() {
  println!(
    "{} {}\n\nUsage:\n  mudkip [OPTIONS] [FILE]\n\nOptions:\n  --theme <dark|light>      Set startup theme.\n  --dark                    Alias for --theme dark.\n  --light                   Alias for --theme light.\n  --toc[=<open|closed>]     Open TOC drawer on launch (default when no value: open).\n  --toc-open                Open TOC drawer on launch.\n  --toc-closed              Close TOC drawer on launch.\n  --watch[=<on|off>]        Enable auto-refresh watch on launch (default when no value: on).\n  --no-watch                Disable auto-refresh watch on launch.\n  -h, --help                Show this help and exit.\n  -V, --version             Show version and exit.",
    env!("CARGO_PKG_NAME"),
    env!("CARGO_PKG_VERSION")
  );
}

fn print_cli_version() {
  println!("{} {}", env!("CARGO_PKG_NAME"), env!("CARGO_PKG_VERSION"));
}

fn parse_theme_value(value: &str) -> Option<String> {
  match value.to_ascii_lowercase().as_str() {
    "dark" | "vscode-dark" => Some("vscode-dark".to_string()),
    "light" | "vscode-light" => Some("vscode-light".to_string()),
    _ => None,
  }
}

fn parse_toggle_value(value: &str) -> Option<bool> {
  match value.to_ascii_lowercase().as_str() {
    "1" | "true" | "yes" | "on" | "open" | "enabled" => Some(true),
    "0" | "false" | "no" | "off" | "closed" | "close" | "disabled" => Some(false),
    _ => None,
  }
}

fn parse_cli_args<I, S>(args: I) -> ParsedLaunchArgs
where
  I: IntoIterator<Item = S>,
  S: AsRef<str>,
{
  let args: Vec<String> = args.into_iter().map(|arg| arg.as_ref().to_string()).collect();
  let mut parsed = ParsedLaunchArgs::default();
  let mut index = 0usize;
  let mut positional_only = false;

  while index < args.len() {
    let raw_arg = &args[index];

    if !positional_only {
      if raw_arg == "--" {
        positional_only = true;
        index += 1;
        continue;
      }

      match raw_arg.as_str() {
        "-h" | "--help" => {
          print_cli_help();
          parsed.exit_after_print = true;
          index += 1;
          continue;
        }
        "-V" | "--version" => {
          print_cli_version();
          parsed.exit_after_print = true;
          index += 1;
          continue;
        }
        "--dark" => {
          parsed.startup_options.theme = Some("vscode-dark".to_string());
          index += 1;
          continue;
        }
        "--light" => {
          parsed.startup_options.theme = Some("vscode-light".to_string());
          index += 1;
          continue;
        }
        "--toc-open" => {
          parsed.startup_options.toc_open = Some(true);
          index += 1;
          continue;
        }
        "--toc-closed" | "--toc-close" | "--no-toc" => {
          parsed.startup_options.toc_open = Some(false);
          index += 1;
          continue;
        }
        "--no-watch" | "--watch-off" | "--no-auto-refresh" => {
          parsed.startup_options.auto_refresh = Some(false);
          index += 1;
          continue;
        }
        "--theme" => {
          if let Some(value) = args.get(index + 1) {
            if value.starts_with('-') {
              log::warn!("Ignoring --theme without a value.");
              index += 1;
            } else {
              if let Some(theme) = parse_theme_value(value) {
                parsed.startup_options.theme = Some(theme);
              } else {
                log::warn!(
                  "Ignoring unsupported --theme value '{}'. Expected dark or light.",
                  value
                );
              }
              index += 2;
            }
          } else {
            log::warn!("Ignoring --theme without a value.");
            index += 1;
          }
          continue;
        }
        "--toc" => {
          let mut consumed_value = false;

          if let Some(value) = args.get(index + 1).and_then(|arg| parse_toggle_value(arg)) {
            parsed.startup_options.toc_open = Some(value);
            consumed_value = true;
          }

          if consumed_value {
            index += 2;
          } else {
            parsed.startup_options.toc_open = Some(true);
            index += 1;
          }
          continue;
        }
        "--watch" | "--auto-refresh" => {
          let mut consumed_value = false;

          if let Some(value) = args.get(index + 1).and_then(|arg| parse_toggle_value(arg)) {
            parsed.startup_options.auto_refresh = Some(value);
            consumed_value = true;
          }

          if consumed_value {
            index += 2;
          } else {
            parsed.startup_options.auto_refresh = Some(true);
            index += 1;
          }
          continue;
        }
        _ => {}
      }

      if let Some(value) = raw_arg.strip_prefix("--theme=") {
        if let Some(theme) = parse_theme_value(value) {
          parsed.startup_options.theme = Some(theme);
        } else {
          log::warn!(
            "Ignoring unsupported --theme value '{}'. Expected dark or light.",
            value
          );
        }
        index += 1;
        continue;
      }

      if let Some(value) = raw_arg.strip_prefix("--toc=") {
        if let Some(is_open) = parse_toggle_value(value) {
          parsed.startup_options.toc_open = Some(is_open);
        } else {
          log::warn!(
            "Ignoring unsupported --toc value '{}'. Expected open/closed/on/off.",
            value
          );
        }
        index += 1;
        continue;
      }

      if let Some(value) = raw_arg
        .strip_prefix("--watch=")
        .or_else(|| raw_arg.strip_prefix("--auto-refresh="))
      {
        if let Some(is_enabled) = parse_toggle_value(value) {
          parsed.startup_options.auto_refresh = Some(is_enabled);
        } else {
          log::warn!(
            "Ignoring unsupported watch value '{}'. Expected on/off/true/false.",
            value
          );
        }
        index += 1;
        continue;
      }

      if raw_arg.starts_with('-') {
        index += 1;
        continue;
      }
    }

    if parsed.launch_path.is_none() {
      let candidate = Path::new(raw_arg);
      parsed.launch_path =
        canonicalize_if_markdown(candidate).map(|path| path.to_string_lossy().to_string());
    }

    index += 1;
  }

  parsed
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn create_temp_markdown_file() -> PathBuf {
    let unique_suffix = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock should be after unix epoch")
      .as_nanos();
    let path = env::temp_dir().join(format!("mudkip-cli-parser-{unique_suffix}.md"));
    fs::write(&path, "# test\n").expect("should create temp markdown file");
    path
  }

  #[test]
  fn parse_cli_args_reads_startup_options_and_markdown_path() {
    let temp_path = create_temp_markdown_file();
    let path_arg = temp_path.to_string_lossy().to_string();

    let parsed = parse_cli_args([
      "--theme",
      "light",
      "--toc-open",
      "--watch=off",
      path_arg.as_str(),
    ]);

    assert_eq!(parsed.startup_options.theme.as_deref(), Some("vscode-light"));
    assert_eq!(parsed.startup_options.toc_open, Some(true));
    assert_eq!(parsed.startup_options.auto_refresh, Some(false));
    assert_eq!(
      parsed.launch_path,
      Some(
        fs::canonicalize(&temp_path)
          .expect("canonical path should exist")
          .to_string_lossy()
          .to_string()
      )
    );

    let _ = fs::remove_file(temp_path);
  }

  #[test]
  fn parse_cli_args_does_not_treat_option_values_as_file_paths() {
    let temp_path = create_temp_markdown_file();
    let path_arg = temp_path.to_string_lossy().to_string();

    let parsed = parse_cli_args(["--theme", "dark", "--watch", "on", path_arg.as_str()]);

    assert_eq!(parsed.startup_options.theme.as_deref(), Some("vscode-dark"));
    assert_eq!(parsed.startup_options.auto_refresh, Some(true));
    assert!(parsed.launch_path.is_some());

    let _ = fs::remove_file(temp_path);
  }

  #[test]
  fn parse_cli_args_marks_help_for_exit() {
    let parsed = parse_cli_args(["--help"]);
    assert!(parsed.exit_after_print);
  }

  #[test]
  fn parse_cli_args_theme_without_value_does_not_consume_next_flag() {
    let parsed = parse_cli_args(["--theme", "--toc-open"]);
    assert_eq!(parsed.startup_options.theme, None);
    assert_eq!(parsed.startup_options.toc_open, Some(true));
  }
}

fn is_markdown_path(path: &Path) -> bool {
  path
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| {
      matches!(
        ext.to_ascii_lowercase().as_str(),
        "md" | "markdown" | "mdown" | "mkd" | "txt"
      )
    })
    .unwrap_or(false)
}

fn canonicalize_if_markdown(path: &Path) -> Option<PathBuf> {
  if !is_markdown_path(path) || !path.exists() {
    return None;
  }

  fs::canonicalize(path).ok()
}

fn build_payload(path: &Path) -> Result<MarkdownFilePayload, String> {
  let canonical_path = fs::canonicalize(path)
    .map_err(|err| format!("Failed to resolve file path '{}': {err}", path.display()))?;

  if !is_markdown_path(&canonical_path) {
    return Err("Requested path does not look like markdown.".to_string());
  }

  let bytes = fs::read(&canonical_path)
    .map_err(|err| format!("Failed to read file '{}': {err}", canonical_path.display()))?;
  let content = String::from_utf8_lossy(&bytes).to_string();

  let file_name = canonical_path
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or_else(|| "Unable to determine file name.".to_string())?
    .to_string();

  let parent_dir = canonical_path
    .parent()
    .ok_or_else(|| "Unable to determine parent directory.".to_string())?;
  let base_href = Url::from_directory_path(parent_dir)
    .map_err(|_| "Unable to convert parent directory to file URL.".to_string())?
    .to_string();

  Ok(MarkdownFilePayload {
    file_path: canonical_path.to_string_lossy().to_string(),
    file_name,
    base_href,
    content,
  })
}

fn try_spawn(command: &str, args: &[&str]) -> bool {
  Command::new(command).args(args).spawn().is_ok()
}

fn focus_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

fn queue_external_open(app: &AppHandle, file_path: String, emit_event: bool) {
  let pending_paths = app.state::<PendingOpenPaths>();
  pending_paths.push(file_path.clone());

  if !emit_event {
    return;
  }

  if let Some(window) = app.get_webview_window("main") {
    let _ = window.emit("file:opened-external", file_path);
    focus_main_window(app);
  }
}

fn is_file_change_event(kind: &EventKind) -> bool {
  matches!(kind, EventKind::Create(_) | EventKind::Modify(_))
}

#[tauri::command]
fn pick_markdown_file() -> Result<Option<MarkdownFilePayload>, String> {
  let selected_file = FileDialog::new()
    .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "txt"])
    .pick_file();

  match selected_file {
    Some(path) => {
      if !is_markdown_path(&path) {
        return Err("Selected file does not look like markdown.".to_string());
      }
      Ok(Some(build_payload(&path)?))
    }
    None => Ok(None),
  }
}

#[tauri::command]
fn read_markdown_file(path: String) -> Result<MarkdownFilePayload, String> {
  build_payload(Path::new(&path))
}

#[tauri::command]
fn open_in_vscode(path: String, line: u32) -> Result<(), String> {
  let line_number = if line == 0 { 1 } else { line };
  let target = format!("{path}:{line_number}");

  #[cfg(target_os = "macos")]
  {
    if try_spawn("code", &["-n", "-g", &target]) {
      return Ok(());
    }
    if try_spawn("open", &["-a", "Visual Studio Code", "--args", "-n", "-g", &target]) {
      return Ok(());
    }
    return Err(
      "Unable to launch Visual Studio Code. Install the `code` shell command or ensure VS Code is installed."
        .to_string(),
    );
  }

  #[cfg(not(target_os = "macos"))]
  {
    if try_spawn("code", &["-n", "-g", &target]) {
      return Ok(());
    }
    Err(
      "Unable to launch Visual Studio Code using the `code` command. Ensure VS Code CLI is installed."
        .to_string(),
    )
  }
}

#[tauri::command]
fn theme_get_system() -> &'static str {
  match dark_light::detect() {
    Ok(Mode::Light) => "vscode-light",
    _ => "vscode-dark",
  }
}

#[tauri::command]
fn filewatch_start(
  app: AppHandle,
  watch_state: State<FileWatchState>,
  path: String,
) -> Result<(), String> {
  let canonical_path = fs::canonicalize(Path::new(&path))
    .map_err(|err| format!("Failed to resolve file path '{path}': {err}"))?;

  if !is_markdown_path(&canonical_path) {
    return Err("Can only watch markdown files.".to_string());
  }

  let mut inner = watch_state
    .inner
    .lock()
    .map_err(|_| "Failed to lock file watch state.".to_string())?;

  if inner.watcher.is_some() && inner.watched_path.as_ref() == Some(&canonical_path) {
    return Ok(());
  }

  inner.watcher = None;
  inner.watched_path = None;

  let watched_path_for_events = canonical_path.clone();
  let app_handle = app.clone();
  let mut watcher =
    notify::recommended_watcher(move |event_result: notify::Result<notify::Event>| {
      let Ok(event) = event_result else {
        return;
      };

      if !is_file_change_event(&event.kind) {
        return;
      }

      let payload = match build_payload(&watched_path_for_events) {
        Ok(payload) => payload,
        Err(_) => return,
      };

      if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("file:changed", payload);
      }
    })
    .map_err(|err| format!("Failed to initialize markdown file watcher: {err}"))?;

  watcher
    .watch(canonical_path.as_path(), RecursiveMode::NonRecursive)
    .map_err(|err| format!("Failed to watch markdown file '{}': {err}", canonical_path.display()))?;

  inner.watched_path = Some(canonical_path);
  inner.watcher = Some(watcher);

  Ok(())
}

#[tauri::command]
fn filewatch_stop(watch_state: State<FileWatchState>) -> Result<(), String> {
  let mut inner = watch_state
    .inner
    .lock()
    .map_err(|_| "Failed to lock file watch state.".to_string())?;

  inner.watcher = None;
  inner.watched_path = None;

  Ok(())
}

#[tauri::command]
fn file_consume_pending_opened_path(pending_paths: State<PendingOpenPaths>) -> Option<String> {
  pending_paths.pop()
}

#[tauri::command]
fn app_get_startup_options(startup_options: State<StartupOptionsState>) -> StartupOptions {
  startup_options.options.clone()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let parsed_launch_args = parse_cli_args(env::args().skip(1));
  if parsed_launch_args.exit_after_print {
    return;
  }

  let launch_path = parsed_launch_args.launch_path.clone();
  let startup_options = parsed_launch_args.startup_options.clone();

  tauri::Builder::default()
    .manage(PendingOpenPaths::default())
    .manage(FileWatchState::default())
    .manage(StartupOptionsState {
      options: startup_options.clone(),
    })
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      let parsed_args = parse_cli_args(argv.into_iter().skip(1));
      if parsed_args.exit_after_print {
        return;
      }

      let should_focus = parsed_args.launch_path.is_some() || !parsed_args.startup_options.is_empty();

      if !parsed_args.startup_options.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.emit("app:startup-options", parsed_args.startup_options);
        }
      }

      if let Some(path) = parsed_args.launch_path {
        queue_external_open(app, path, true);
      } else if should_focus {
        focus_main_window(app);
      }
    }))
    .invoke_handler(tauri::generate_handler![
      pick_markdown_file,
      read_markdown_file,
      open_in_vscode,
      theme_get_system,
      filewatch_start,
      filewatch_stop,
      file_consume_pending_opened_path,
      app_get_startup_options
    ])
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      if let Some(path) = launch_path.clone() {
        queue_external_open(&app.handle(), path.clone(), false);

        if let Some(window) = app.get_webview_window("main") {
          let _ = window.emit("file:open-on-launch", path);
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Opened { urls } = event {
        for url in urls {
          let Ok(path) = url.to_file_path() else {
            continue;
          };

          let Some(canonical_path) = canonicalize_if_markdown(&path) else {
            continue;
          };

          queue_external_open(app, canonical_path.to_string_lossy().to_string(), true);
        }
      }
    });
}
