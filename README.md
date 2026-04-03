# Ink Town V1

Ink Town V1 now includes two desktop apps in one repository:

- `Ink Town Editor` (Tauri + React): map editing
- `Ink Town Game` (Rust + Bevy): observer simulator with 20 NPC planning loop

## Architecture

Rust workspace modules:

- `crates/world-core`: shared world model, chunk IO, registry validation, pixel patch application
- `crates/sim-core`: event queue engine, conflict detection/replan, observation compression, planner schema validation
- `src-tauri`: editor desktop shell and command bridge (delegates to `world-core`)
- `apps/game-client`: Bevy observer client + LLM gateway

Frontend editor modules:

- `src/renderer/`: Canvas renderer
- `src/editor/`: editor GUI

Data:

- `data/world/`: `world.json` + chunk files (`chunks/c_x_y.json`)
- `data/registry/`: registry schema (`registry.json`)

## Commands

Install JS dependencies:

```bash
npm install
```

Editor frontend checks:

```bash
npm run test
npm run build
```

Rust tests (`world-core`, `sim-core`, editor tauri layer):

```bash
npm run rust:test
```

Run editor:

```bash
npm run tauri:dev
```

Build editor:

```bash
npm run tauri:build
```

Check game app compile:

```bash
npm run game:check
```

Run game app:

```bash
npm run game:run
```

## Game Runtime Defaults

- Render FPS: unlimited by default (`INK_TOWN_RENDER_FPS=30|60|120|unlimited`)
- Logic tick: 10Hz fixed (`INK_TOWN_LOGIC_HZ`)
- NPC count: 20 (`INK_TOWN_NPC_COUNT`)
- World meta path: `data/world/world.json` (`INK_TOWN_WORLD_META`)
- LLM provider:
  - If `OPENAI_API_KEY` is set, uses OpenAI-compatible gateway
  - Otherwise uses built-in mock provider

## GitHub CI

- Workflow: `.github/workflows/windows-editor-build.yml`
- Current target: Windows x64 editor NSIS EXE artifact + release draft

## Notes

- Runtime format policy is strict current-format only (no legacy compatibility branches).
- If future format changes are needed, use explicit migration scripts rather than runtime fallback code.
