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

The API sidecar uses `pnpm deploy --config.node-linker=hoisted` so Tauri can copy a Node-resolvable dependency tree into the app bundle. On macOS, the copied Node binary is stripped and then ad-hoc signed before Tauri packages the app. This keeps the packaged Node runtime smaller without leaving a modified executable signature that Gatekeeper can kill after download quarantine.

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

The public Web download button uses the stable COS installer aliases:

- `/downloads/design/ai-cove-design-desktop-macos.dmg`
- `/downloads/design/ai-cove-design-desktop-windows.exe`

`desktop:publish-downloads` remains a local compatibility helper for copying a validated release to an explicit static directory. It is not the production release path:

```sh
pnpm desktop:publish-downloads
```

`desktop:publish-downloads` validates `desktop-release/latest.json` before copying. The manifest must include a non-empty version and each listed updater platform must have a non-empty signature, updater URL, existing updater archive, matching `.sig` file, and the expected platform installer.

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

Use the official CI artifact and the platform-owned COS publisher:

```sh
AI_COVE_DESIGN_RELEASE_DIR=/path/to/ai-cove-design-desktop-release \
AI_COVE_DESIGN_COSCLI_CONFIG=/path/to/coscli-config.yaml \
  ../deploy/release-all.sh design-desktop-publish
```

The public layout is:

```text
https://ai-cove.com/downloads/design/latest.json
https://ai-cove.com/downloads/design/ai-cove-design-desktop-macos.dmg
https://ai-cove.com/downloads/design/ai-cove-design-desktop-windows.exe
https://ai-cove.com/downloads/design/versions/<version>/...
```

The publisher validates both platforms and signatures, uploads immutable version objects first, uploads root stable aliases next, and uploads root `latest.json` last. The updater endpoint in `src-tauri/tauri.conf.json` is `https://ai-cove.com/downloads/design/latest.json`; production desktop assets are not copied into New API.

## Verification

Before publishing, run:

```sh
pnpm desktop:build:test
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
pnpm desktop:validate-release
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
