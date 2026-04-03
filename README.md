# Ink Town

仓库已按项目职责拆分为独立目录：

- `editor/`: 地图编辑器（Tauri + React + TypeScript）
- `game/`: 主游戏观察器（Rust + Bevy）
- `shared/`: 共用 Rust 核心库（world-core / sim-core）
- `data/`: 世界数据与索引库（供 editor / game 共同读取）

## 目录结构

- `editor/src/`: 编辑器前端
- `editor/src-tauri/`: 编辑器 Rust 后端
- `game/src/`: 游戏客户端
- `shared/world-core/`: 世界模型、chunk 读写、registry 校验
- `shared/sim-core/`: NPC 事件队列、冲突重排、观测压缩、Schema 校验

## Editor

安装依赖（在 `editor/` 下）：

```bash
cd editor
npm install
```

前端测试与构建：

```bash
npm run test
npm run build
```

Rust 侧测试（含 shared crates + editor tauri）：

```bash
npm run rust:test
```

运行编辑器：

```bash
npm run tauri:dev
```

构建编辑器安装包：

```bash
npm run tauri:build
```

## Game

编译检查：

```bash
cargo check --manifest-path game/Cargo.toml
```

运行：

```bash
cargo run --manifest-path game/Cargo.toml
```

默认参数：

- 渲染帧率：无限制（`INK_TOWN_RENDER_FPS=30|60|120|unlimited`）
- 逻辑 Tick：`10Hz`（`INK_TOWN_LOGIC_HZ`）
- NPC 数量：`20`（`INK_TOWN_NPC_COUNT`）
- 默认地图：`../data/world/world.json`（可用 `INK_TOWN_WORLD_META` 覆盖）
- LLM：存在 `OPENAI_API_KEY` 时走 OpenAI 兼容网关，否则用 mock provider

## CI

工作流：`.github/workflows/windows-editor-build.yml`

当前会自动构建并发布：

- Editor Windows x64 安装包
- Game Windows x64 可执行文件

## 版本策略

- 运行时仅支持当前格式，不追加向后兼容分支。
- 格式升级通过迁移脚本处理，不在 runtime 内维护 legacy fallback。
