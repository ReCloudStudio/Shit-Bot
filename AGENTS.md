# AGENTS.md

## Environment

- **Runtime**: Bun (`packageManager: bun`). Always use `bun install`, `bun run <script>`.
- **Nix-first**: If the host lacks `bun`, `node`, etc., create or update `flake.nix` (`nix develop` / `nix shell`) instead of assuming global installs.
- **No npm/pnpm/yarn**.

## Commands

```bash
bun install          # install deps
bun run dev          # tsx src/index.ts (hot-reload dev server)
bun run build        # tsc && tsc-alias && cp src/web/ui.html dist/web/ui.html
bun run start        # node dist/index.js
```

Build copies `src/web/ui.html` into `dist/web/` because tsc does not copy non-`.ts` assets.

## Architecture

- Single Node.js process, not serverless/Workers.
- `src/index.ts` — entrypoint: loads config → inits SQLite, Twitter client, Discord/Telegram bots, cron scheduler, web server.
- `src/config.ts` — config loader: reads first found file from `config.yaml > config.yml > config.toml > config.json`, merges env vars, validates.
- `src/storage.ts` — `better-sqlite3` (native C++ addon). Two tables: `sent_tweets`, `image_cache`. DB at `data/bot.db`.
- `src/bots/` — Discord (`discord.js`), Telegram (`telegraf`), and OneBot11 (QQ) clients.
- `src/twitter/` — X/Twitter API via `twitter-openapi-typescript`; supports cookie auth or username/password login with TOTP.
- `src/approval.ts` — multi-admin approval flow (Telegram inline keyboard + Discord buttons + OneBot11 text commands).
- `src/web/server.ts` — HTTP server on configurable port (default 3000). Serves `ui.html` + REST API for config CRUD.
- Config secrets are **never committed** — `config.yaml/json/toml` are in `.gitignore`.

## OneBot11 (QQ) 集成

通过 [OneBot11 协议](https://onebot.dev/) 支持 QQ 消息收发。

### 配置

```yaml
onebot:
  enabled: true
  url: "ws://127.0.0.1:8080"  # OneBot11 WebSocket 地址
  token: ""                    # 可选：访问令牌
  secret: ""                   # 可选：签名密钥
  reconnectInterval: 5000      # 重连间隔（毫秒）
```

或通过环境变量：
```bash
ONEBOT_ENABLED=true
ONEBOT_URL=ws://127.0.0.1:8080
ONEBOT_TOKEN=your_token
ONEBOT_SECRET=your_secret
```

### 群组配置

```yaml
groups:
  - name: my-group
    onebot:
      groupId: 123456789       # QQ 群号
      r14GroupId: 987654321    # R14 内容群号（可选）
    approval:
      onebotAdminGroupIds:     # 审批通知群号
        - 111222333
```

### 审批流程

OneBot11 使用文本命令进行审批：
- `/approve <审批ID>` — 批准推文
- `/reject <审批ID>` — 拒绝推文

审批消息会发送到配置的管理员群，包含推文内容和审批 ID。

### 文件结构

- `src/bots/onebot.ts` — OneBot11 WebSocket 客户端和消息发送
- `src/types.ts` — `OneBotConfig`, `GroupOneBotConfig` 类型定义
- `src/storage.ts` — `sent_onebot_messages` 表存储已发送消息

## Key gotchas

- `better-sqlite3` is a **native C++ module** — requires a C++ toolchain. Bun handles native modules; Node requires `node-gyp`.
- Config file format is auto-detected by extension. Saving always writes back in the same format (YAML or JSON).
- When editing config via API, masked secrets (`••••••••`) are treated as "no change" — the existing value is preserved.
- Web UI: `fetchAllTweets` is defined in both `src/twitter/client.ts` and `src/rss/fetcher.ts`. The one used is from `twitter/client.ts` (imported in `index.ts`).

## Import path convention

All internal imports use the `@/` alias (`@/` maps to `src/`). This avoids fragile relative paths like `../../../foo`:
```typescript
import { getConfig } from '@/config';          // instead of '../config'
import { PluginDefinition } from '@/plugins/types'; // instead of '../../../plugins/types'
```

Configured via `tsconfig.json` `baseUrl` + `paths`. Built with `tsc` + `tsc-alias` (resolves aliases to relative paths in `dist/`).

## TypeScript conventions

- Use `const`, never `var`.
- Avoid `any`; narrow types first, then use explicit assertions.
- Prefer `type` over `interface` unless declaration merging is needed.
- No `enum` — use literal unions.
- Public API functions must declare return types explicitly.
- Files: `kebab-case.ts`.
- All internal imports use `@/` alias (`@/config`, `@/ai/chat`, etc.). No relative paths like `../../foo`.
