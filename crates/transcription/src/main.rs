use reqwest::blocking::{Client, multipart};
use serde::Deserialize;
use serde_json::json;
use std::{
    env,
    ffi::OsString,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::ExitCode,
    time::Duration,
};

const ENDPOINT: &str = "https://chatgpt.com/backend-api/transcribe";
const MAX_AUDIO_BYTES: u64 = 25 * 1024 * 1024;
const USAGE: &str = "Usage: einsager-transcribe recording.m4a (or recording.wav)";

#[derive(Deserialize)]
struct Auth {
    tokens: Option<Tokens>,
}

#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    account_id: Option<String>,
}

#[derive(Deserialize)]
struct Transcript {
    text: String,
}

fn read_login(auth_home: &Path) -> Result<Tokens, String> {
    let file = File::open(auth_home.join("auth.json"))
        .map_err(|_| "Cannot read the file-based Codex login. Run codex login with file credential storage, or select your Codex folder.")?;
    let auth: Auth = serde_json::from_reader(file)
        .map_err(|_| "Cannot read Codex login. Run codex login first.")?;
    auth.tokens
        .filter(|tokens| !tokens.access_token.is_empty())
        .ok_or_else(|| "ChatGPT login missing. Run codex login first.".into())
}

fn read_audio(audio_path: &Path) -> Result<multipart::Part, String> {
    let suffix = audio_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let content_type = match suffix.as_str() {
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        _ => return Err("Recording must be a WAV or M4A audio file.".into()),
    };
    let file = File::open(audio_path)
        .map_err(|_| "Cannot read recording. Retry or start a new dictation.")?;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot read recording. Retry or start a new dictation.")?;
    if !metadata.is_file() {
        return Err("Cannot read recording. Retry or start a new dictation.".into());
    }
    let length = metadata.len();
    if length == 0 || length > MAX_AUDIO_BYTES {
        return Err("Recording must be nonempty and no larger than 25 MiB.".into());
    }
    // Stream from the opened file. A file that grows cannot exceed its validated length.
    multipart::Part::reader_with_length(file.take(length), length)
        .file_name(format!("dictation.{suffix}"))
        .mime_str(content_type)
        .map_err(|_| "Cannot prepare recording for transcription.".into())
}

fn transcribe(audio_path: &Path, auth_home: &Path, endpoint: &str) -> Result<String, String> {
    let tokens = read_login(auth_home)?;
    let audio = read_audio(audio_path)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .user_agent(concat!("einsager/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Cannot start Codex transcription connection.")?;
    let mut request = client
        .post(endpoint)
        .bearer_auth(tokens.access_token)
        .header("originator", "Codex Desktop")
        .multipart(multipart::Form::new().part("file", audio));
    if let Some(account_id) = tokens.account_id.filter(|value| !value.is_empty()) {
        request = request.header("ChatGPT-Account-ID", account_id);
    }
    let response = request
        .send()
        .map_err(|_| "Codex transcription connection failed or timed out.")?;
    let status = response.status().as_u16();
    if status != 200 {
        let hint = if status == 401 {
            " Run codex login again."
        } else {
            ""
        };
        return Err(format!("Codex transcription returned HTTP {status}.{hint}"));
    }
    response
        .json::<Transcript>()
        .map(|result| result.text)
        .map_err(|_| "Codex returned an unexpected transcription response.".into())
}

fn run() -> Result<String, String> {
    let mut args = env::args_os().skip(1);
    let audio = args.next().ok_or(USAGE)?;
    if args.next().is_some() {
        return Err(USAGE.into());
    }
    let auth_home = auth_home(env::var_os("CODEX_HOME"), dirs::home_dir())?;
    transcribe(Path::new(&audio), &auth_home, ENDPOINT)
}

/// Codex uses CODEX_HOME or .codex in the OS user's home, including USERPROFILE on Windows.
fn auth_home(codex_home: Option<OsString>, user_home: Option<PathBuf>) -> Result<PathBuf, String> {
    if let Some(path) = codex_home.filter(|path| !path.is_empty()) {
        return Ok(path.into());
    }
    user_home
        .map(|path| path.join(".codex"))
        .ok_or_else(|| "Cannot find Codex login. Set CODEX_HOME to your Codex folder.".into())
}

fn main() -> ExitCode {
    match run() {
        Ok(text) => {
            println!("{}", json!({ "text": text }));
            ExitCode::SUCCESS
        }
        Err(error) => {
            println!("{}", json!({ "error": error }));
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests;
