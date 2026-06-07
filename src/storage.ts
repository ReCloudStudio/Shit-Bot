import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');

let db: Database.Database | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function initDatabase(): void {
  ensureDataDir();

  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_tweets (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      content TEXT,
      url TEXT,
      sent_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sent_tweets_author ON sent_tweets(author)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sent_tweets_sent_at ON sent_tweets(sent_at)
  `);

  console.log(`Database initialized: ${DB_PATH}`);
}

export function getDatabase(): Database.Database {
  if (!db) {
    initDatabase();
  }
  return db!;
}

export function markAsSent(tweetId: string, author?: string, content?: string, url?: string): void {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO sent_tweets (id, author, content, url, sent_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(tweetId, author || '', content || '', url || '', Date.now());
}

export function isAlreadySent(tweetId: string): boolean {
  const database = getDatabase();

  const stmt = database.prepare('SELECT 1 FROM sent_tweets WHERE id = ?');
  const row = stmt.get(tweetId);

  return !!row;
}

export function markMultipleAsSent(tweets: Array<{ id: string; author: string; content: string; url: string }>): void {
  const database = getDatabase();

  const stmt = database.prepare(`
    INSERT OR IGNORE INTO sent_tweets (id, author, content, url, sent_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((items: typeof tweets) => {
    for (const tweet of items) {
      stmt.run(tweet.id, tweet.author, tweet.content, tweet.url, Date.now());
    }
  });

  insertMany(tweets);
}

export function isTooOld(publishedAt: Date, maxAgeMinutes: number): boolean {
  const now = Date.now();
  const tweetTime = publishedAt.getTime();
  const ageMinutes = (now - tweetTime) / (1000 * 60);
  return ageMinutes > maxAgeMinutes;
}

export function cleanupOldRecords(maxAgeDays: number = 30): number {
  const database = getDatabase();

  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);

  const stmt = database.prepare('DELETE FROM sent_tweets WHERE sent_at < ?');
  const result = stmt.run(cutoff);

  if (result.changes > 0) {
    console.log(`Cleaned up ${result.changes} old records`);
  }

  return result.changes;
}

export function getSentCount(): number {
  const database = getDatabase();

  const stmt = database.prepare('SELECT COUNT(*) as count FROM sent_tweets');
  const row = stmt.get() as { count: number };

  return row.count;
}

export function getRecentTweets(limit: number = 10): Array<{
  id: string;
  author: string;
  content: string;
  url: string;
  sent_at: number;
}> {
  const database = getDatabase();

  const stmt = database.prepare('SELECT * FROM sent_tweets ORDER BY sent_at DESC LIMIT ?');
  return stmt.all(limit) as any[];
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log('Database closed');
  }
}
