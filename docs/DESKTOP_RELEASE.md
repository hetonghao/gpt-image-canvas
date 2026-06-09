# AI Cove Design Desktop Release

## Scope

The desktop app is a Tauri wrapper around the shared AI Cove Design Web/API code:

- Web UI: `apps/web`
- Local API sidecar: `apps/api`
- Shared contracts: `packages/shared`
- Desktop-only shell/update/release glue: `src-tauri`, `apps/web/src/shared/desktop`, `scripts/desktop-*.mjs`

Do not fork canvas, prompt pool, gallery, or provider configuration into a separate desktop feature tree.

## Signing Keys

The updater public key is stored in `src-tauri/tauri.conf.json`.

The updater private key must stay outside the repository. The current local development key is:

```sh
/Users/hetonghao/.codex/tmp/ai-cove-design-updater.key
```

Do not commit private keys, passwords, cookies, sessions, or generated release artifacts.

The macOS desktop package currently follows the same lightweight distribution mode as Two Sides: updater artifacts are signed for Tauri updates, and the `.app` bundle defaults to ad-hoc signing (`APPLE_SIGNING_IDENTITY=-`) instead of Developer ID notarization. On first open, macOS may require allowing the app in System Settings.

## Build

Run from `gpt-image-canvas/`:

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat /Users/hetonghao/.codex/tmp/ai-cove-design-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
pnpm desktop:build
```

For a debug package:

```sh
TAURI_SIGNING_PRIVATE_KEY="$(cat /Users/hetonghao/.codex/tmp/ai-cove-design-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
pnpm desktop:build -- --debug
```

`desktop:build` runs:

1. `desktop:sync-version`
2. Tauri build
3. `desktop:prepare-sidecar` through Tauri `beforeBuildCommand`
4. macOS `.app` code-signature verification with `codesign --verify --deep --strict`
5. release artifact collection into `desktop-release/`
6. release `latest.json` generation, merged with an existing manifest when present

The API sidecar uses `pnpm deploy --config.node-linker=hoisted` so Tauri can copy a Node-resolvable dependency tree into the app bundle. On macOS, the copied Node binary is stripped before Tauri signs/packages the app. This keeps the packaged Node runtime smaller without changing API dependencies.

## Artifacts

macOS builds write:

- `desktop-release/ai-cove-design-desktop-macos.dmg`
- `desktop-release/ai-cove-design-desktop-macos-aarch64.app.tar.gz`
- `desktop-release/ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig`
- `desktop-release/latest.json`

Windows builds write:

- `desktop-release/ai-cove-design-desktop-windows.exe`
- `desktop-release/ai-cove-design-desktop-windows.exe.sig`
- `desktop-release/latest.json`

The public Web download button expects installers under:

- `/downloads/ai-cove-design-desktop-macos.dmg`
- `/downloads/ai-cove-design-desktop-windows.exe`

After `desktop:build`, sync generated artifacts into the New API public downloads directory:

```sh
pnpm desktop:publish-downloads
```

`desktop:publish-downloads` validates `desktop-release/latest.json` before copying. The manifest must include a non-empty version and each listed updater platform must have a non-empty signature, updater URL, existing updater archive, matching `.sig` file, and the expected platform installer.

By default this copies `desktop-release/*` release artifacts into:

```text
../new-api/web/default/public/downloads/
```

Override the target with `AI_COVE_DESIGN_DOWNLOADS_DIR` when publishing to another static root.

## Cross-platform Assembly

When macOS and Windows artifacts are built by separate runners, assemble the downloaded platform release directories into one publishable directory:

```sh
pnpm desktop:assemble-release desktop-release-inputs desktop-release
```

The assembler copies installers, updater archives, and signatures into `desktop-release/`, then writes a merged `latest.json`. It fails fast if platform manifests have different versions, duplicate updater platform keys, or colliding artifact filenames.

The GitHub workflow `.github/workflows/desktop-release.yml` runs the same flow:

1. build macOS artifacts on `macos-14`
2. build Windows artifacts on `windows-latest`
3. upload each platform's `desktop-release/*`
4. assemble a merged `ai-cove-design-desktop-release` artifact

Required repository secrets:

- `AI_COVE_DESIGN_TAURI_SIGNING_PRIVATE_KEY`
- `AI_COVE_DESIGN_TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty is allowed when the key has no password)

## Production Upload

Upload installers, updater archives, signatures, and `latest.json` to:

```text
https://ai-cove.com/downloads/
```

If macOS and Windows are built separately, keep the current production manifest before building the next platform:

```sh
AI_COVE_DESIGN_EXISTING_LATEST_JSON=/path/to/current/latest.json \
TAURI_SIGNING_PRIVATE_KEY="$(cat /Users/hetonghao/.codex/tmp/ai-cove-design-updater.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
pnpm desktop:build
```

If `AI_COVE_DESIGN_EXISTING_LATEST_JSON` is not set, the script reads `desktop-release/latest.json` before cleaning the release directory. The output manifest keeps existing platform entries and replaces only the current platform entry.

When publishing through New API static assets, run `pnpm desktop:publish-downloads` before the New API Web build/release step so `/downloads/latest.json` and installer links are present in the built public assets.

Verify the static assets from the New API Web directory, not from `gpt-image-canvas/`:

```sh
cd ../new-api/web/default
pnpm build
find dist/downloads -maxdepth 1 -type f -print | sort
```

For the platform release path, `deploy/release-all.sh release` now syncs `gpt-image-canvas/desktop-release/` into `new-api/web/default/public/downloads/` before building the New API Docker image. For a desktop release where missing downloads should stop the release, run:

```sh
AI_COVE_REQUIRE_DESKTOP_DOWNLOADS=1 ./deploy/release-all.sh release
```

The strict guard requires `latest.json`, the macOS `.dmg`, the Windows `.exe`, both updater archives, and both signatures.

When desktop release artifacts are present, `release-all` also runs:

```sh
pnpm desktop:validate-release <desktop-release-dir>
```

That validation requires both `darwin-aarch64` and `windows-x86_64` updater platform entries before artifacts are copied into New API public downloads.

## Verification

Before publishing, run:

```sh
pnpm desktop:build:test
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
pnpm desktop:validate-release
pnpm desktop:publish-downloads
```

Then verify the generated app can start the packaged sidecar and that `/api/health` returns `{"status":"ok"}`.

## Size Notes

The macOS DMG and updater archive are already compressed package formats. The largest current payload is the local Node/API sidecar:

- copied Node runtime
- production API `node_modules`
- built Web assets

The first safe reduction is stripping the copied macOS Node binary during `desktop:prepare-sidecar`. Further reductions should avoid deleting third-party dependency contents unless a runtime import test proves the packaged API still works.

## Remaining Release Risks

- Windows packaging must be validated on a Windows runner before publishing the Windows installer.
- Production publishing still needs a release run that uploads both platform artifacts and the merged `latest.json` to the public downloads directory.
