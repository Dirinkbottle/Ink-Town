# Ink Town V1

Ink Town V1 is a desktop 2D world editor built with Tauri + React + Rust core.

## What is implemented

- World load/render/edit/save loop
- Infinite chunk map storage (`data/world/chunks/c_x_y.json`)
- Pixel model with extensible flat JSON fields (`color`, `material`, `durability`, custom properties)
- Registry-driven material/attribute/value options (`data/registry/`)
- Rust-side schema + registry validation
- Canvas2D dirty-chunk rendering and basic map editor GUI

## Project structure

- `src-tauri/`: Rust core + Tauri commands
- `src/renderer/`: Canvas renderer
- `src/editor/`: editor GUI
- `data/world/`: world meta + chunk files
- `data/registry/`: registry indexes + schema

## Commands

```bash
npm install
npm run test
npm run build
```

Rust core tests (without desktop WebKit dependencies):

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Run desktop app (requires Tauri Linux system libs):

```bash
npm run tauri:dev
```

Build desktop app:

```bash
npm run tauri:build
```

## GitHub CI

- Workflow: `.github/workflows/windows-editor-build.yml`
- Trigger:
  - push to `main` / `master`
  - manual run from `workflow_dispatch`
- Output artifact:
  - `ink-town-editor-windows-x64-exe`
  - from `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*.exe`

## Linux dependencies for Tauri

On Linux, desktop feature compilation needs WebKitGTK stack. If build fails with `libsoup-3.0` or `javascriptcoregtk-4.1` missing, install corresponding system packages and retry.
