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

const CODEX_ENDPOINT: &str = "https://chatgpt.com/backend-api/transcribe";
const API_ENDPOINT: &str = "https://api.openai.com/v1/audio/transcriptions";
const MAX_KEY_BYTES: u64 = 4096;
const MAX_AUDIO_BYTES: u64 = 25 * 1024 * 1024;
const USAGE: &str = "Usage: einsager-transcribe --provider api-key|codex-login recording.wav (or recording.m4a). API keys are read from stdin.";

enum Credentials {
    ApiKey(String),
    CodexLogin(Tokens),
}

impl Credentials {
    fn label(&self) -> &'static str {
        match self {
            Self::ApiKey(_) => "OpenAI API",
            Self::CodexLogin(_) => "Codex",
        }
    }
}

fn read_api_key(input: impl Read) -> Result<String, String> {
    let mut key = String::new();
    input
        .take(MAX_KEY_BYTES + 1)
        .read_to_string(&mut key)
        .map_err(|_| "Cannot read OpenAI API key from stdin.")?;
    let value = key.trim();
    if key.len() > MAX_KEY_BYTES as usize
        || !value.starts_with("sk-")
        || value.len() < 10
        || !value.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err("Enter a valid OpenAI API key in Settings.".into());
    }
    Ok(value.into())
}

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

fn transcribe(
    audio_path: &Path,
    credentials: &Credentials,
    endpoint: &str,
) -> Result<String, String> {
    let label = credentials.label();
    let audio = read_audio(audio_path)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(90))
        .user_agent(concat!("einsager/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| format!("Cannot start {label} transcription connection."))?;
    let form = multipart::Form::new().part("file", audio);
    let request = client.post(endpoint);
    let request = match credentials {
        Credentials::ApiKey(key) => request.bearer_auth(key).multipart(
            form.text("model", "gpt-transcribe")
                .text("response_format", "json"),
        ),
        Credentials::CodexLogin(tokens) => {
            let mut request = request
                .bearer_auth(&tokens.access_token)
                .header("originator", "Codex Desktop");
            if let Some(account_id) = tokens.account_id.as_ref().filter(|value| !value.is_empty()) {
                request = request.header("ChatGPT-Account-ID", account_id);
            }
            request.multipart(form)
        }
    };
    let response = request
        .send()
        .map_err(|_| format!("{label} transcription connection failed or timed out."))?;
    let status = response.status().as_u16();
    if status != 200 {
        let hint = match (credentials, status) {
            (Credentials::ApiKey(_), 401 | 403) => {
                " Check your API key and project permissions in Settings."
            }
            (Credentials::ApiKey(_), 429) => " Check API billing, credit balance, and rate limits.",
            (Credentials::CodexLogin(_), 401) => " Run codex login again.",
            _ => "",
        };
        return Err(format!(
            "{label} transcription returned HTTP {status}.{hint}"
        ));
    }
    response
        .json::<Transcript>()
        .map(|result| result.text)
        .map_err(|_| format!("{label} returned an unexpected transcription response."))
}

fn run() -> Result<String, String> {
    let mut args = env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--provider")) {
        return Err(USAGE.into());
    }
    let provider = args.next().ok_or(USAGE)?;
    let audio = args.next().ok_or(USAGE)?;
    if args.next().is_some() {
        return Err(USAGE.into());
    }
    let (credentials, endpoint) = match provider.to_str() {
        Some("api-key") => (
            Credentials::ApiKey(read_api_key(std::io::stdin().lock())?),
            API_ENDPOINT,
        ),
        Some("codex-login") => {
            let home = auth_home(env::var_os("CODEX_HOME"), dirs::home_dir())?;
            (Credentials::CodexLogin(read_login(&home)?), CODEX_ENDPOINT)
        }
        _ => return Err(USAGE.into()),
    };
    transcribe(Path::new(&audio), &credentials, endpoint)
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
