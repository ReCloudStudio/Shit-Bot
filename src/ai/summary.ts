import { getDatabase } from '../storage';
import { getConfig } from '../config';
import { formatUtc8 } from './time';

let tableReady = false;

function ensureTable(): void {
  if (tableReady) return;
  const db = getDatabase();
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL DEFAULT 'discord',
      channel_id TEXT NOT NULL,
      message_id TEXT,
      author TEXT NOT NULL,
      content TEXT NOT NULL,
      images TEXT,
      images_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);
  // 兼容旧库：补上 images / images_at 列（已存在则忽略）
  try {
    db.run('ALTER TABLE channel_messages ADD COLUMN images TEXT');
  } catch {
    // column already exists
  }
  try {
    db.run('ALTER TABLE channel_messages ADD COLUMN images_at INTEGER');
  } catch {
    // column already exists
  }
  db.run('CREATE INDEX IF NOT EXISTS idx_cm_time ON channel_messages(platform, channel_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cm_msg ON channel_messages(platform, channel_id, message_id)');
  tableReady = true;
}

/** 把数据库里的 images 字段（JSON 字符串或 null）安全解析回字符串数组。 */
function parseImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string' && !!u) : [];
  } catch {
    return [];
  }
}

export function recordChannelMessage(
  platform: string,
  channelId: string,
  messageId: string | null,
  author: string,
  content: string,
  createdAt: number,
  images?: string[]
): void {
  const cfg = getConfig().ai.summary;
  if (!cfg?.enabled) return;
  const text = String(content || '').trim();
  const imgs = (images || []).filter((u) => typeof u === 'string' && !!u).slice(0, 6);
  // 纯图片(无文字)的消息也要记录，否则历史里会丢图
  if (!text && imgs.length === 0) return;

  ensureTable();
  const db = getDatabase();

  if (messageId) {
    const exists = db
      .query('SELECT 1 FROM channel_messages WHERE platform = ? AND channel_id = ? AND message_id = ?')
      .get(platform, channelId, messageId);
    if (exists) return;
  }

  db.run(
    'INSERT INTO channel_messages (platform, channel_id, message_id, author, content, images, images_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      platform,
      channelId,
      messageId,
      author,
      text.slice(0, 2000),
      imgs.length ? JSON.stringify(imgs) : null,
      // 记录图片"入库时刻"≈附件签名 URL 的签发时刻，供读取时判断是否已过期
      imgs.length ? Date.now() : null,
      createdAt,
    ]
  );

  const maxKeep = cfg.maxMessagesPerChannel ?? 500;
  db.run(
    `DELETE FROM channel_messages
     WHERE platform = ? AND channel_id = ? AND id NOT IN (
       SELECT id FROM channel_messages WHERE platform = ? AND channel_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?
     )`,
    [platform, channelId, platform, channelId, maxKeep]
  );
}

export function getRecentChannelMessages(
  platform: string,
  channelId: string,
  count: number,
  excludeMessageId?: string
): Array<{
  author: string;
  content: string;
  created_at: number;
  images: string[];
  images_at: number | null;
}> {
  ensureTable();
  const db = getDatabase();
  const rows = (
    excludeMessageId
      ? db
          .query(
            `SELECT author, content, images, images_at, created_at FROM channel_messages
             WHERE platform = ? AND channel_id = ? AND (message_id IS NULL OR message_id != ?)
             ORDER BY created_at DESC, id DESC LIMIT ?`
          )
          .all(platform, channelId, excludeMessageId, count)
      : db
          .query(
            `SELECT author, content, images, images_at, created_at FROM channel_messages
             WHERE platform = ? AND channel_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`
          )
          .all(platform, channelId, count)
  ) as Array<{
    author: string;
    content: string;
    images: string | null;
    images_at: number | null;
    created_at: number;
  }>;
  return rows.reverse().map((r) => ({
    author: r.author,
    content: r.content,
    created_at: r.created_at,
    images: parseImages(r.images),
    images_at: r.images_at,
  }));
}

export function getChannelMessageCount(platform: string, channelId: string): number {
  ensureTable();
  const row = getDatabase()
    .query('SELECT COUNT(*) as c FROM channel_messages WHERE platform = ? AND channel_id = ?')
    .get(platform, channelId) as { c: number };
  return row.c;
}

export function getOldestStoredMessageId(platform: string, channelId: string): string | null {
  ensureTable();
  const row = getDatabase()
    .query(
      `SELECT message_id FROM channel_messages
       WHERE platform = ? AND channel_id = ? AND message_id IS NOT NULL
       ORDER BY created_at ASC, id ASC LIMIT 1`
    )
    .get(platform, channelId) as { message_id: string } | undefined;
  return row ? row.message_id : null;
}

// Discord 附件签名 URL 约 24h 过期，留 1h 余量后就不再把链接当可读图抛给模型
const FRESH_IMG_MS = 23 * 60 * 60 * 1000;
// 单次输出的图片直链总量上限，避免图片密集频道撑爆上下文
const MAX_IMG_URLS = 40;

export function formatForSummary(
  msgs: Array<{
    author: string;
    content: string;
    created_at: number;
    images?: string[];
    images_at?: number | null;
  }>
): string {
  const out: string[] = [];
  let last: string | null = null;
  let urlBudget = MAX_IMG_URLS;
  const now = Date.now();
  for (const m of msgs) {
    const text = m.content.trim();
    const imgs = (m.images || []).filter(Boolean);
    if (!text && imgs.length === 0) continue;
    // 纯图片消息也要显示出来，正文用占位提示
    const body = text || '（图片）';
    if (m.author === last) {
      // 同一作者的连续消息用 \n 续在同一组里，不再重复时间与作者名
      out.push(body);
    } else {
      // 新的作者分组：整组只在开头带一个 UTC+8 时间
      out.push(`[${formatUtc8(m.created_at)}] ${m.author}: ${body}`);
      last = m.author;
    }
    // 该条消息若带图，紧随其后标注图片直链，供模型按需用 read_image 查看
    if (imgs.length) {
      const fresh = m.images_at != null && now - m.images_at < FRESH_IMG_MS;
      if (!fresh) {
        // 链接已过期：只告知有图、不给死链，避免模型加载失败后臆测
        out.push(`[图片 ${imgs.length} 张：链接已过期，无法查看]`);
      } else if (urlBudget <= 0) {
        out.push(`[图片 ${imgs.length} 张：链接从略]`);
      } else {
        const show = imgs.slice(0, urlBudget);
        urlBudget -= show.length;
        out.push(`[图片: ${show.join(' ')}]`);
      }
    }
  }
  return out.join('\n');
}
