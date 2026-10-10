use super::*;
use std::{fs, io::Write, net::TcpListener, thread};
use tempfile::TempDir;

#[test]
fn codex_home_overrides_each_platform_home_without_touching_credentials() {
    for home in ["/home/test", "/Users/test", "C:\\Users\\test"] {
        let home = std::path::PathBuf::from(home);
        assert_eq!(
            auth_home(None, Some(home.clone())).unwrap(),
            home.join(".codex")
        );
        assert_eq!(
            auth_home(Some("".into()), Some(home.clone())).unwrap(),
            home.join(".codex")
        );
        assert_eq!(
            auth_home(Some("custom-codex".into()), Some(home)).unwrap(),
            std::path::PathBuf::from("custom-codex")
        );
    }
    assert!(auth_home(None, None).is_err());
    assert_eq!(
        auth_home(Some("custom-codex".into()), None).unwrap(),
        std::path::PathBuf::from("custom-codex")
    );
}

fn fixture(extension: &str) -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().unwrap();
    fs::write(
        dir.path().join("auth.json"),
        r#"{"tokens":{"access_token":"fake-test-token","account_id":"fake-test-account"}}"#,
    )
    .unwrap();
    let audio = dir.path().join(format!("sample.{extension}"));
    fs::write(&audio, b"test audio").unwrap();
    (dir, audio)
}

fn server(status: &str, body: &str, extra_headers: &str) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/transcribe", listener.local_addr().unwrap());
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}",
        body.len()
    );
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = stream.read(&mut buffer).unwrap();
            assert!(count > 0, "request ended before its body");
            request.extend_from_slice(&buffer[..count]);
            let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
            let length: usize = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length: "))
                .unwrap()
                .parse()
                .unwrap();
            if request.len() >= header_end + 4 + length {
                break;
            }
        }
        stream.write_all(response.as_bytes()).unwrap();
        String::from_utf8(request).unwrap()
    });
    (endpoint, handle)
}

#[test]
fn m4a_request_matches_codex_protocol() {
    let (dir, audio) = fixture("m4a");
    let (endpoint, request) = server("200 OK", r#"{"text":"Grüße from Rust"}"#, "");
    assert_eq!(
        transcribe(&audio, dir.path(), &endpoint).unwrap(),
        "Grüße from Rust"
    );
    let request = request.join().unwrap().to_ascii_lowercase();
    for expected in [
        "post /transcribe http/1.1",
        "authorization: bearer fake-test-token",
        "originator: codex desktop",
        concat!("user-agent: einsager/", env!("CARGO_PKG_VERSION")),
        "chatgpt-account-id: fake-test-account",
        "name=\"file\"; filename=\"dictation.m4a\"",
        "content-type: audio/mp4",
        "test audio",
    ] {
        assert!(request.contains(expected), "missing {expected}");
    }
}

#[test]
fn wav_and_login_without_account_remain_supported() {
    let (dir, audio) = fixture("WAV");
    fs::write(
        dir.path().join("auth.json"),
        r#"{"tokens":{"access_token":"fake-test-token"}}"#,
    )
    .unwrap();
    let (endpoint, request) = server("200 OK", r#"{"text":"WAV transcript","extra":true}"#, "");
    assert_eq!(
        transcribe(&audio, dir.path(), &endpoint).unwrap(),
        "WAV transcript"
    );
    let request = request.join().unwrap().to_ascii_lowercase();
    assert!(request.contains("filename=\"dictation.wav\""));
    assert!(request.contains("content-type: audio/wav"));
    assert!(!request.contains("chatgpt-account-id:"));
}

#[test]
fn invalid_audio_is_rejected_before_network_use() {
    let (dir, audio) = fixture("m4a");
    fs::write(&audio, b"").unwrap();
    assert!(
        transcribe(&audio, dir.path(), "http://127.0.0.1:1")
            .unwrap_err()
            .contains("nonempty")
    );
    File::create(&audio)
        .unwrap()
        .set_len(MAX_AUDIO_BYTES + 1)
        .unwrap();
    assert!(
        transcribe(&audio, dir.path(), "http://127.0.0.1:1")
            .unwrap_err()
            .contains("25 MiB")
    );
    let unsupported = audio.with_extension("txt");
    fs::rename(audio, &unsupported).unwrap();
    assert!(
        transcribe(&unsupported, dir.path(), "http://127.0.0.1:1")
            .unwrap_err()
            .contains("WAV or M4A")
    );
}

#[test]
fn invalid_login_is_rejected_before_network_use() {
    let (dir, audio) = fixture("m4a");
    for auth in ["not json", "{}", r#"{"tokens":{"access_token":""}}"#] {
        fs::write(dir.path().join("auth.json"), auth).unwrap();
        assert!(
            transcribe(&audio, dir.path(), "http://127.0.0.1:1")
                .unwrap_err()
                .contains("login")
        );
    }
    fs::remove_file(dir.path().join("auth.json")).unwrap();
    assert!(read_login(dir.path()).err().unwrap().contains("login"));
}

#[test]
fn auth_failure_reports_recovery_without_response_or_token() {
    let (dir, audio) = fixture("m4a");
    let (endpoint, request) = server("401 Unauthorized", "private server detail", "");
    assert_eq!(
        transcribe(&audio, dir.path(), &endpoint).unwrap_err(),
        "Codex transcription returned HTTP 401. Run codex login again."
    );
    request.join().unwrap();
}

#[test]
fn redirects_never_forward_login() {
    let (dir, audio) = fixture("m4a");
    let destination = TcpListener::bind("127.0.0.1:0").unwrap();
    destination.set_nonblocking(true).unwrap();
    let location = format!(
        "Location: http://{}/token-leak\r\n",
        destination.local_addr().unwrap()
    );
    let (endpoint, request) = server("302 Found", "", &location);
    assert_eq!(
        transcribe(&audio, dir.path(), &endpoint).unwrap_err(),
        "Codex transcription returned HTTP 302."
    );
    request.join().unwrap();
    assert_eq!(
        destination.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}

#[test]
fn malformed_responses_are_recoverable() {
    let (dir, audio) = fixture("m4a");
    for body in ["not json", r#"{"text":null}"#, r#"{"text":5}"#, "[]", "{}"] {
        let (endpoint, request) = server("200 OK", body, "");
        assert_eq!(
            transcribe(&audio, dir.path(), &endpoint).unwrap_err(),
            "Codex returned an unexpected transcription response."
        );
        request.join().unwrap();
    }
}

#[test]
fn connection_failure_does_not_expose_credentials() {
    let (dir, audio) = fixture("m4a");
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    assert_eq!(
        transcribe(&audio, dir.path(), &endpoint).unwrap_err(),
        "Codex transcription connection failed or timed out."
    );
}
