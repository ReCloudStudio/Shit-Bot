import { getDatabase } from '../storage';
import { getConfig } from '../config';

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
      created_at INTEGER NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_cm_time ON channel_messages(platform, channel_id, created_at)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cm_msg ON channel_messages(platform, channel_id, message_id)');
  tableReady = true;
}

export function recordChannelMessage(
  platform: string,
  channelId: string,
  messageId: string | null,
  author: string,
  content: string,
  createdAt: number
): void {
  const cfg = getConfig().ai.summary;
  if (!cfg?.enabled) return;
  const text = String(content || '').trim();
  if (!text) return;

  ensureTable();
  const db = getDatabase();

  if (messageId) {
    const exists = db
      .query('SELECT 1 FROM channel_messages WHERE platform = ? AND channel_id = ? AND message_id = ?')
      .get(platform, channelId, messageId);
    if (exists) return;
  }

  db.run(
    'INSERT INTO channel_messages (platform, channel_id, message_id, author, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [platform, channelId, messageId, author, text.slice(0, 2000), createdAt]
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
): Array<{ author: string; content: string }> {
  ensureTable();
  const db = getDatabase();
  const rows = (
    excludeMessageId
      ? db
          .query(
            `SELECT author, content FROM channel_messages
             WHERE platform = ? AND channel_id = ? AND (message_id IS NULL OR message_id != ?)
             ORDER BY created_at DESC, id DESC LIMIT ?`
          )
          .all(platform, channelId, excludeMessageId, count)
      : db
          .query(
            `SELECT author, content FROM channel_messages
             WHERE platform = ? AND channel_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`
          )
          .all(platform, channelId, count)
  ) as Array<{ author: string; content: string }>;
  return rows.reverse();
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

export function formatForSummary(msgs: Array<{ author: string; content: string }>): string {
  const out: string[] = [];
  let last: string | null = null;
  for (const m of msgs) {
    const text = m.content.trim();
    if (!text) continue;
    if (m.author === last) {
      out.push(text);
    } else {
      out.push(`${m.author}: ${text}`);
      last = m.author;
    }
  }
  return out.join('\n');
}
