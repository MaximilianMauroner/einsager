# Releasing

A version tag builds the app on GitHub Actions and creates a draft release.
You review the draft and publish it.

## Publish a version

1. Choose the version, for example `0.2.0`. Set it in `package.json` and in
   `crates/transcription/Cargo.toml`, then update the lock file:

   ```sh
   cargo update --workspace
   ```

2. Merge that change to `main` through a pull request with passing checks.
3. Tag the merged commit and push the tag:

   ```sh
   git switch main && git pull
   git tag v0.2.0
   git push origin v0.2.0
   ```

4. The [Release workflow](../.github/workflows/release.yml) checks that the tag
   matches both versions, builds Linux x64, macOS arm64, and Windows x64, runs
   the packaged-app smoke test on each, and creates a draft release. The draft
   holds one archive per system and `SHA256SUMS.txt`.
5. Open the draft on GitHub. Edit the generated notes, download each archive,
   and start it on its system. Then click **Publish release**.

If a job fails for a reason outside the code, for example a network error,
rerun the failed jobs. If the code must change, fix it on `main` and release a
new patch version, for example `v0.2.1`. Do not move a tag that people may
already have downloaded.

## Add missing systems to a release

A release can lack an archive, for example when it was built by hand on one
system. To add the others, open **Actions → Release → Run workflow**, enter the
existing tag, for example `v0.2.0`, and run it. The workflow builds the tagged
commit on each system. It uploads only the archives that the release does not
have, never replaces one, and updates `SHA256SUMS.txt` to list every archive.
The release stays published or draft, as it was.

## Build a release by hand

Use this when GitHub Actions is not available. On each system, from a clean
checkout of the tagged commit:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm package
```

Archive the output in `release/` with the names the workflow uses:

| System | Command in `release/` |
|---|---|
| Linux | `tar -czf einsager-0.2.0-linux-x64.tar.gz einsager-linux-x64` |
| macOS | `ditto -c -k --keepParent einsager-darwin-arm64/einsager.app einsager-0.2.0-macos-arm64.zip` |
| Windows | Compress the `einsager-win32-x64` folder to `einsager-0.2.0-windows-x64.zip` |

Then create the draft and add the archives:

```sh
gh release create v0.2.0 --draft --title "einsager v0.2.0" --generate-notes
gh release upload v0.2.0 einsager-0.2.0-*
```

## Signing

Releases are not signed with an Apple Developer ID or a Windows certificate,
and they are not notarized. `pnpm package` gives the macOS app an ad-hoc
signature, so macOS offers **Open Anyway** for a download instead of calling it
damaged. The [README](../README.md#install) explains the first start on each
system.

Local builds use the persistent certificate set up by `pnpm install:macos` when
it is present. GitHub runners have no local certificate and keep the ad-hoc
release signature. See [local updates](usage.md#local-macos-updates) for the
certificate's storage and permission behavior.
