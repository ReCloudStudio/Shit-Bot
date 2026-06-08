# X/Twitter Monitor Bot

自动监控 X/Twitter 用户发帖，通过 Discord/Telegram Bot 推送到群组/频道。

## 功能特性

- 通过 X/Twitter GraphQL API 直接获取推文
- 支持 Cookie 认证 或 用户名/密码/TOTP 登录
- 支持关键词过滤（包含/排除）
- 支持媒体过滤（图片/视频）
- 支持排除转推/回复
- 推文渲染为图片发送
- 多管理员审批机制
- SQLite 持久化存储
- Discord Embed 推送
- Telegram HTML 格式推送
- 定时轮询，可配置间隔

## 安装

```bash
npm install
cp config.example.json config.json
# 编辑 config.json 填入配置
```

## 配置说明

复制 `config.example.json` 为 `config.json`，按需修改：

### users - 监控用户

```json
{
  "users": [
    {
      "username": "elonmusk",
      "displayName": "Elon Musk",
      "filters": {
        "keywords": {
          "include": ["tesla", "spacex"],
          "exclude": ["ad", "sponsored"]
        },
        "media": { "requireMedia": false },
        "excludeRetweets": true,
        "excludeReplies": false
      }
    }
  ]
}
```

| 字段                         | 类型     | 说明                              |
| ---------------------------- | -------- | --------------------------------- |
| `username`                   | string   | X/Twitter 用户名（不含 @）        |
| `displayName`                | string   | 显示名称（可选）                  |
| `filters.keywords.include`   | string[] | 必须包含的关键词（空数组=不限制） |
| `filters.keywords.exclude`   | string[] | 排除的关键词                      |
| `filters.media.requireMedia` | boolean  | 是否只推送包含媒体的推文          |
| `filters.excludeRetweets`    | boolean  | 是否排除转推                      |
| `filters.excludeReplies`     | boolean  | 是否排除回复                      |

### discord - Discord 配置

```json
{
  "discord": {
    "enabled": true,
    "token": "YOUR_DISCORD_BOT_TOKEN",
    "channelId": "YOUR_CHANNEL_ID",
    "adminChannelId": "YOUR_ADMIN_CHANNEL_ID",
    "embedColor": "#1DA1F2"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用 Discord |
| `token` | string | Bot Token |
| `channelId` | string | 目标频道 ID |
| `adminChannelId` | string | 管理员审批频道 ID（可选） |
| `embedColor` | string | Embed 颜色（十六进制） |

### telegram - Telegram 配置

```json
{
  "telegram": {
    "enabled": true,
    "token": "YOUR_TELEGRAM_BOT_TOKEN",
    "chatId": "-1001234567890",
    "adminChatIds": ["111111111", "222222222"],
    "parseMode": "HTML",
    "apiRoot": ""
  }
}
```

| 字段           | 类型     | 说明                               |
| -------------- | -------- | ---------------------------------- |
| `enabled`      | boolean  | 是否启用 Telegram                  |
| `token`        | string   | Bot Token（从 @BotFather 获取）    |
| `chatId`       | string   | 目标群组/频道 ID                   |
| `adminChatIds` | string[] | 管理员 Chat ID 数组（审批用）      |
| `parseMode`    | string   | 消息格式（`HTML` 或 `Markdown`）   |
| `apiRoot`      | string   | Telegram API 代理地址（留空=直连） |

### twitter - X/Twitter 认证配置

提供以下两种方式之一进行认证：

**方式一：Cookie 认证（推荐）**

从浏览器中提取 `auth_token` 和 `ct0` 两个 Cookie：

```json
{
  "twitter": {
    "authToken": "你的 auth_token",
    "ct0": "你的 ct0"
  }
}
```

**方式二：用户名/密码登录**

提供 X 账号的用户名和密码，程序启动时会自动登录获取 Cookie：

```json
{
  "twitter": {
    "username": "你的用户名",
    "password": "你的密码",
    "email": "你的邮箱",
    "totpSecret": "你的 TOTP Secret"
  }
}
```

| 字段         | 类型   | 说明                                                      |
| ------------ | ------ | --------------------------------------------------------- |
| `authToken`  | string | Cookie `auth_token`（方式一必填）                         |
| `ct0`        | string | Cookie `ct0`（方式一必填）                                |
| `username`   | string | X/Twitter 用户名（方式二必填）                            |
| `password`   | string | X/Twitter 密码（方式二必填）                              |
| `email`      | string | 注册邮箱（登录遇到验证时使用）                            |
| `totpSecret` | string | TOTP 二次验证密钥（Base32 格式，开启 2FA 时使用）         |

> **注意**：也可以通过环境变量配置，详见下方「环境变量」章节。

### 全局配置

```json
{
  "enableApproval": true,
  "sendAsImage": true,
  "pollIntervalMinutes": 5,
  "maxPostsPerFetch": 20,
  "maxTweetAgeMinutes": 60
}
```

| 字段                  | 类型    | 默认值 | 说明                                |
| --------------------- | ------- | ------ | ----------------------------------- |
| `enableApproval`      | boolean | false  | 是否启用审批（需配置 adminChatIds） |
| `sendAsImage`         | boolean | false  | 是否渲染为图片发送                  |
| `pollIntervalMinutes` | number  | 5      | 轮询间隔（分钟）                    |
| `maxPostsPerFetch`    | number  | 20     | 每次最多获取推文数                  |
| `maxTweetAgeMinutes`  | number  | 60     | 推文最大年龄（超过则跳过）          |

## 获取 Token

### X/Twitter Cookie

**获取 `auth_token` 和 `ct0`：**

1. 在浏览器中登录 https://x.com
2. 打开开发者工具（F12）→ Application → Cookies → `https://x.com`
3. 找到并复制 `auth_token` 和 `ct0` 的值
4. 填入 `config.json` 的 `twitter` 部分

> **提示**：Cookie 有效期较长，但更换密码或主动登出会失效。失效后需重新获取。

**使用用户名/密码登录（可选）：**

如果不想手动提取 Cookie，可以在 `config.json` 中填入 `username` 和 `password`（以及可选的 `email`、`totpSecret`），程序启动时会自动登录并打印获取到的 Cookie。

也可以使用 `totpSecret` 字段支持 2FA 二次验证（Base32 格式）。

### Discord Bot Token

1. 访问 https://discord.com/developers/applications
2. 创建应用 → Bot → 复制 Token
3. 邀请 Bot 到服务器，授予 `Send Messages` 和 `Embed Links` 权限
4. 右键频道 → 复制频道 ID

### Telegram Bot Token

1. 在 Telegram 搜索 @BotFather
2. 发送 `/newbot` 创建 Bot
3. 复制 Token
4. 获取 Chat ID：发送消息给 Bot，访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`

### Telegram Admin Chat ID

1. 给 Bot 发送任意消息
2. 访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`
3. 在返回的 JSON 中找到 `chat.id`

## 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start
```

## 审批功能

启用 `enableApproval` 后，支持 Telegram 和 Discord 双平台审批：

**Telegram 审批**：配置 `telegram.adminChatIds`
**Discord 审批**：配置 `discord.adminChannelId`

流程：

1. 推文同时发送给 Telegram 管理员和 Discord 审批频道
2. 管理员点击 ✅ 或 ❌ 按钮
3. 任意一位管理员审批通过后，推文发送到目标群组/频道
4. 其他管理员收到审批结果通知（包含审批人）

> 可以只配置一个平台的管理员，也可以同时配置两个平台。

## 数据存储

使用 SQLite 存储已发送的推文记录：

- 数据库位置：`data/bot.db`
- 自动清理 30 天前的记录

查看记录：

```bash
sqlite3 data/bot.db "SELECT * FROM sent_tweets ORDER BY sent_at DESC LIMIT 10"
```

## 过滤规则说明

| 规则                 | 说明                       |
| -------------------- | -------------------------- |
| `keywords.include`   | 推文必须包含至少一个关键词 |
| `keywords.exclude`   | 推文包含任一关键词则跳过   |
| `media.requireMedia` | 只推送包含媒体的推文       |
| `excludeRetweets`    | 跳过转推                   |
| `excludeReplies`     | 跳过回复                   |

## 环境变量

可选，在 `.env` 文件中配置：

```env
DISCORD_TOKEN=your_discord_bot_token
TELEGRAM_TOKEN=your_telegram_bot_token

# Twitter/X Cookie 认证
TWITTER_AUTH_TOKEN=your_auth_token
TWITTER_CT0=your_ct0

# Twitter/X 用户名/密码登录（可选）
# TWITTER_USERNAME=your_username
# TWITTER_PASSWORD=your_password
# TWITTER_EMAIL=your_email@example.com
# TWITTER_TOTP_SECRET=your_totp_base32_secret
```

环境变量会覆盖 `config.json` 中的对应配置。

## License

MIT
