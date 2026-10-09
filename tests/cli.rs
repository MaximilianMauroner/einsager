use std::{fs, process::Command};

#[test]
fn cli_always_returns_json_errors_with_failure_status() {
    let empty_login = tempfile::TempDir::new().unwrap();
    for arguments in [vec![], vec!["one", "two"], vec!["recording.m4a"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_einsager-transcribe"))
            .args(arguments)
            .env("CODEX_HOME", empty_login.path())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stderr.is_empty());
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(value["error"].as_str().is_some());
        assert!(value.get("text").is_none());
    }
}

#[test]
fn empty_codex_home_falls_back_to_home_login() {
    let home = tempfile::TempDir::new().unwrap();
    fs::create_dir(home.path().join(".codex")).unwrap();
    fs::write(
        home.path().join(".codex/auth.json"),
        r#"{"tokens":{"access_token":"fake-test-token"}}"#,
    )
    .unwrap();
    let audio = home.path().join("empty.m4a");
    fs::write(&audio, b"").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_einsager-transcribe"))
        .arg(&audio)
        .env("CODEX_HOME", "")
        .env("HOME", home.path())
        .output()
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    // The audio error proves the login under HOME was read; no request is sent.
    assert!(value["error"].as_str().unwrap().contains("nonempty"));
}
