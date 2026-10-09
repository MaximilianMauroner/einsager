#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
app="${PWD}/dist/einsager.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
uv sync
python_path="${PWD}/.venv/bin/python"
python3 - "$app" "$python_path" <<'PY'
import plistlib, sys
from pathlib import Path
app, python = sys.argv[1:]
info = {
    'CFBundleExecutable': 'CodexDictation',
    'CFBundleIdentifier': 'local.max.codexdictation.poc',
    'CFBundleName': 'einsager',
    'CFBundlePackageType': 'APPL',
    'CFBundleVersion': '2',
    'CFBundleShortVersionString': '0.2.0',
    'LSUIElement': True,
    'NSMicrophoneUsageDescription': 'Record speech when you press the dictation hotkey, then send it to ChatGPT for transcription using your Codex login.',
    'DictationPython': python,
}
with (Path(app) / 'Contents/Info.plist').open('wb') as file:
    plistlib.dump(info, file)
PY
cp transcribe.py "$app/Contents/Resources/transcribe.py"
python3 scripts/make-icon.py
cp assets/icons/einsager-breath.pdf "$app/Contents/Resources/einsager-breath.pdf"
swiftc -j 1 DictationSession.swift DictationDelivery.swift DictationBar.swift KeyboardShortcuts.swift Dictation.swift -o "$app/Contents/MacOS/CodexDictation" -framework AppKit -framework AVFoundation -framework Carbon
codesign --force --sign - "$app"
print -r -- "$app"
