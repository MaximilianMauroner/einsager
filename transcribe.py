#!/usr/bin/env python3
"""One-shot dictation using the internal ChatGPT endpoint and local Codex login."""
import argparse
import json
import os
from pathlib import Path
import sys
from curl_cffi import CurlMime, requests

ENDPOINT = "https://chatgpt.com/backend-api/transcribe"


def transcribe(audio_path):
    auth_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    try:
        tokens = json.loads((auth_home / "auth.json").read_text()).get("tokens") or {}
    except (OSError, ValueError):
        raise RuntimeError("Cannot read Codex login. Run codex login first.") from None
    token = tokens.get("access_token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("ChatGPT login missing. Run codex login first.")
    audio = Path(audio_path).read_bytes()
    if not audio or len(audio) > 25 * 1024 * 1024:
        raise RuntimeError("Recording must be nonempty and smaller than 25 MB.")
    suffix = Path(audio_path).suffix.lower()
    content_type = {".wav": "audio/wav", ".m4a": "audio/mp4"}.get(suffix)
    if content_type is None:
        raise RuntimeError("Recording must be a WAV or M4A audio file.")
    headers = {
        "Authorization": "Bearer " + token,
        "originator": "Codex Desktop",
    }
    if tokens.get("account_id"):
        headers["ChatGPT-Account-ID"] = tokens["account_id"]
    multipart = CurlMime()
    multipart.addpart(name="file", content_type=content_type, filename="dictation" + suffix, data=audio)
    try:
        response = requests.post(ENDPOINT, headers=headers, multipart=multipart,
                                 impersonate="chrome", timeout=90, allow_redirects=False)
    except requests.RequestsError:
        raise RuntimeError("Codex transcription connection failed or timed out.") from None
    finally:
        multipart.close()
    if response.status_code != 200:
        hint = " Run codex login again." if response.status_code == 401 else ""
        raise RuntimeError(f"Codex transcription returned HTTP {response.status_code}.{hint}")
    result = response.json()
    if not isinstance(result, dict) or not isinstance(result.get("text"), str):
        raise RuntimeError("Codex returned an unexpected transcription response.")
    return result["text"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps({"text": transcribe(args.audio)}))
    except (OSError, ValueError, RuntimeError) as error:
        print(json.dumps({"error": str(error)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
