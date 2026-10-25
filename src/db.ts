import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export interface Click {
  // Slug события из адреса страницы, одинаковый для всех языковых версий
  eventId: string;
  url: string;
}

export interface EventStat extends Click {
  clicks: number;
}

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS clicks (
      id         INTEGER PRIMARY KEY,
      event_id   TEXT    NOT NULL,
      url        TEXT    NOT NULL,
      created_at INTEGER NOT NULL -- unix ms, UTC
    );
    CREATE INDEX IF NOT EXISTS clicks_created_at ON clicks (created_at);
  `);

  const insert = db.prepare<[string, string, number]>(
    'INSERT INTO clicks (event_id, url, created_at) VALUES (?, ?, ?)',
  );
  const total = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) AS total FROM clicks WHERE created_at >= ?',
  );
  const top = db.prepare<[number, number], EventStat>(`
    SELECT event_id AS eventId, MAX(url) AS url, COUNT(*) AS clicks
    FROM clicks
    WHERE created_at >= ?
    GROUP BY event_id
    ORDER BY clicks DESC
    LIMIT ?
  `);

  return {
    addClick(click: Click) {
      insert.run(click.eventId, click.url, Date.now());
    },
    stats(since: number, limit = 10) {
      return {
        total: total.get(since)?.total ?? 0,
        top: top.all(since, limit),
      };
    },
    close() {
      db.close();
    },
  };
}

export type Db = ReturnType<typeof openDb>;
