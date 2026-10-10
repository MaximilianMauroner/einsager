#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h:h:h}"
mkdir -p .agents/tmp .agents/artifacts/plans/wispr-flow-live-dictation/native
zsh -n apps/macos/scripts/build.sh
cargo fmt --check
cargo test --locked -j 1
cargo clippy --locked -j 1 --all-targets -- -D warnings
swiftc -j 1 apps/macos/src/DictationSession.swift apps/macos/src/DictationDelivery.swift apps/macos/src/KeyboardShortcuts.swift apps/macos/tests/SessionTests.swift -o .agents/tmp/session-tests -framework AppKit
.agents/tmp/session-tests
swiftc -j 1 apps/macos/src/DictationSession.swift apps/macos/src/DictationBar.swift apps/macos/tests/UIProbe.swift -o .agents/tmp/ui-probe -framework AppKit
.agents/tmp/ui-probe .agents/artifacts/plans/wispr-flow-live-dictation/native
swift -j 1 apps/macos/scripts/make-app-icon.swift .agents/tmp/einsager.icns
