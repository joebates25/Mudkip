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

fn resolve_markdown_arg<I, S>(args: I) -> Option<String>
where
  I: IntoIterator<Item = S>,
  S: AsRef<str>,
{
  args.into_iter().find_map(|arg| {
    let raw_arg = arg.as_ref();
    if raw_arg.starts_with('-') {
      return None;
    }

    let candidate = Path::new(raw_arg);
    canonicalize_if_markdown(candidate).map(|canonical| canonical.to_string_lossy().to_string())
  })
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

fn queue_external_open(app: &AppHandle, file_path: String, emit_event: bool) {
  let pending_paths = app.state::<PendingOpenPaths>();
  pending_paths.push(file_path.clone());

  if !emit_event {
    return;
  }

  if let Some(window) = app.get_webview_window("main") {
    let _ = window.emit("file:opened-external", file_path);
    let _ = window.show();
    let _ = window.set_focus();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let launch_path = resolve_markdown_arg(env::args().skip(1));

  tauri::Builder::default()
    .manage(PendingOpenPaths::default())
    .manage(FileWatchState::default())
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(path) = resolve_markdown_arg(argv.into_iter().skip(1)) {
        queue_external_open(app, path, true);
      }
    }))
    .invoke_handler(tauri::generate_handler![
      pick_markdown_file,
      read_markdown_file,
      open_in_vscode,
      theme_get_system,
      filewatch_start,
      filewatch_stop,
      file_consume_pending_opened_path
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
