#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
mkdir -p .agents/tmp .agents/artifacts/plans/wispr-flow-live-dictation/native
zsh -n build.sh
cargo fmt --check
cargo test --locked -j 1
cargo clippy --locked -j 1 --all-targets -- -D warnings
swiftc -j 1 DictationSession.swift DictationDelivery.swift KeyboardShortcuts.swift tests/SessionTests.swift -o .agents/tmp/session-tests -framework AppKit
.agents/tmp/session-tests
swiftc -j 1 DictationSession.swift DictationBar.swift tests/UIProbe.swift -o .agents/tmp/ui-probe -framework AppKit
.agents/tmp/ui-probe .agents/artifacts/plans/wispr-flow-live-dictation/native
swift -j 1 scripts/make-app-icon.swift .agents/tmp/einsager.icns
