#!/bin/zsh
set -euo pipefail
cd "${0:A:h}"
app="${PWD}/dist/einsager.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>CodexDictation</string>
<key>CFBundleIdentifier</key><string>local.max.codexdictation.poc</string>
<key>CFBundleName</key><string>einsager</string>
<key>CFBundleIconFile</key><string>einsager.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>2</string>
<key>CFBundleShortVersionString</key><string>0.2.0</string>
<key>LSUIElement</key><true/>
<key>NSMicrophoneUsageDescription</key><string>Record speech when you press the dictation hotkey, then send it to ChatGPT for transcription using your Codex login.</string>
</dict></plist>
PLIST
cargo build --locked --release -j 1
cp target/release/einsager-transcribe "$app/Contents/MacOS/einsager-transcribe"
codesign --force --sign - "$app/Contents/MacOS/einsager-transcribe"
cp assets/icons/einsager-breath.pdf "$app/Contents/Resources/einsager-breath.pdf"
swift -j 1 scripts/make-app-icon.swift "$app/Contents/Resources/einsager.icns"
swiftc -j 1 DictationSession.swift DictationDelivery.swift DictationBar.swift KeyboardShortcuts.swift Dictation.swift -o "$app/Contents/MacOS/CodexDictation" -framework AppKit -framework AVFoundation -framework Carbon
codesign --force --sign - "$app"
print -r -- "$app"
