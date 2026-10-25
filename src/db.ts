import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export interface Click {
  url: string;
  title: string | null;
  date: string;
  time: string;
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
      url        TEXT    NOT NULL,
      title      TEXT,
      date       TEXT    NOT NULL,
      time       TEXT    NOT NULL,
      created_at INTEGER NOT NULL -- unix ms, UTC
    );
    CREATE INDEX IF NOT EXISTS clicks_created_at ON clicks (created_at);
  `);

  const insert = db.prepare<[string, string | null, string, string, number]>(
    'INSERT INTO clicks (url, title, date, time, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const total = db.prepare<[number], { total: number }>(
    'SELECT COUNT(*) AS total FROM clicks WHERE created_at >= ?',
  );
  // Одно и то же событие в разные даты — разные строки статистики
  const top = db.prepare<[number, number], EventStat>(`
    SELECT url, MAX(title) AS title, date, time, COUNT(*) AS clicks
    FROM clicks
    WHERE created_at >= ?
    GROUP BY url, date, time
    ORDER BY clicks DESC
    LIMIT ?
  `);

  return {
    addClick(click: Click) {
      insert.run(click.url, click.title, click.date, click.time, Date.now());
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
