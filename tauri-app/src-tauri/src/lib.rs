use rfd::FileDialog;
use serde::Serialize;
use std::{env, fs, path::Path, process::Command};
use url::Url;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFilePayload {
  file_path: String,
  file_name: String,
  base_href: String,
  content: String,
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

fn build_payload(path: &Path) -> Result<MarkdownFilePayload, String> {
  let canonical_path = fs::canonicalize(path)
    .map_err(|err| format!("Failed to resolve file path '{}': {err}", path.display()))?;
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
  let candidate = Path::new(&path);
  if !is_markdown_path(candidate) {
    return Err("Requested path does not look like markdown.".to_string());
  }

  build_payload(candidate)
}

#[tauri::command]
fn get_launch_markdown_path() -> Option<String> {
  env::args().skip(1).find_map(|arg| {
    if arg.starts_with('-') {
      return None;
    }

    let path = Path::new(&arg);
    if !is_markdown_path(path) || !path.exists() {
      return None;
    }

    fs::canonicalize(path)
      .ok()
      .map(|canonical| canonical.to_string_lossy().to_string())
  })
}

fn try_spawn(command: &str, args: &[&str]) -> bool {
  Command::new(command).args(args).spawn().is_ok()
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      pick_markdown_file,
      read_markdown_file,
      get_launch_markdown_path,
      open_in_vscode
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
