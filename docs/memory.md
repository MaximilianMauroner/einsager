# macOS memory verification

The acceptance target is at most 30,000,000 bytes of physical footprint after
the app settles in the background. Max revised the earlier 50 MB peak target
to this background target. Temporary panel and dictation peaks are acceptable.
Record those peaks, including any active transcription helper, separately.
System services such as `coreaudiod` are outside this sum. RSS includes resident
shared pages and is a separate value; use physical footprint for comparison
with Activity Monitor's Memory column.

## Automated checks

Build and package on macOS, then run the native checks:

```sh
pnpm build
pnpm package
pnpm test:native
```

The native test binary uses the production services with synthetic PCM and a
fixture helper. It checks a 599-second recording, Retry, cancellation, late
permission callbacks, clipboard restoration on a private pasteboard, 500
history entries, and 20 recording cycles. Views stay hidden. It does not
record a microphone, send audio to ChatGPT, move the pointer, or change the
general clipboard. Evidence is written to `.agents/artifacts/`.
The hidden integration process keeps its existing 50 MB peak regression check.
That test process is not the live background acceptance measurement.

`pnpm test:packaged` selects these checks on macOS and also verifies the signed
production bundle in an isolated, inactive launch. The shipped binary must
not contain the test driver. Its `--profile` and `--helper` overrides must
be supplied together and must select a profile different from the normal one.

The Rust upload probe uses fixture credentials and a local server. The server
discards incoming bytes in fixed buffers, so its memory cannot grow with the
request. Build it with one compiler worker:

```sh
cargo test --locked --release -j 1 --bin einsager-transcribe --no-run
```

Run the printed release test executable with
`streaming_upload_memory_probe --ignored --nocapture`. Sample the PID printed
as `UPLOAD_MEMORY_PROBE` during its 19.2 MB upload. The probe calls the same
`transcribe` function as the production CLI. It includes the test harness and
local server overhead, so it gives a conservative helper measurement.

## Measure the installed app

Use the PID of the main native app, and also sample its helper during upload:

```sh
footprint -p <pid> -f bytes --noCategories
ps -o rss= -p <pid>
```

Record idle, open history and settings, recording, upload, and post-recording
states. Read `phys_footprint_peak` as well as the current value. Check another
20 sessions if a new change affects ownership of a recorder, view, timer, or
child process.

Real microphone, Fn gestures, automatic paste, focus return, and docking need
an interactive run with permission on the target Mac. The isolated test and
CI do not establish that acceptance. Do not run desktop automation that takes
focus on an active shared desktop without Max's agreement.
