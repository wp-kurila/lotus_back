import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Config } from './config.js';
import type { Click, Db } from './db.js';

// Повторный клик того же посетителя на то же событие в течение окна не считается
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

interface ClickBody {
  url: string;
  title?: string;
  date: string;
  time: string;
}

const clickSchema = {
  type: 'object',
  required: ['url', 'date', 'time'],
  properties: {
    url: { type: 'string', maxLength: 500 },
    title: { type: 'string', maxLength: 200 },
    date: { type: 'string', minLength: 1, maxLength: 50 },
    time: { type: 'string', minLength: 1, maxLength: 20 },
  },
} as const;

export async function createServer(config: Config, db: Db, onClick: (click: Click) => void) {
  // Доверяем X-Forwarded-For только от локального nginx, иначе IP можно подделать
  const server = Fastify({ logger: true, trustProxy: 'loopback' });

  // navigator.sendBeacon шлёт строку как text/plain — разбираем её как JSON
  server.removeContentTypeParser('text/plain');
  server.addContentTypeParser('text/plain', { parseAs: 'string' }, server.getDefaultJsonParser('error', 'error'));

  await server.register(cors, { origin: config.corsOrigins.length > 0 ? config.corsOrigins : false });
  await server.register(rateLimit, { global: false });

  const recent = new Map<string, number>();
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [key, at] of recent) if (at < cutoff) recent.delete(key);
  }, DEDUP_WINDOW_MS);
  server.addHook('onClose', async () => clearInterval(cleanup));

  function isDuplicate(key: string) {
    const now = Date.now();
    const last = recent.get(key);
    if (last !== undefined && now - last < DEDUP_WINDOW_MS) return true;
    recent.set(key, now);
    return false;
  }

  function isAllowedUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (config.allowedUrlHosts.length === 0) return true;
    const host = url.hostname.toLowerCase();
    return config.allowedUrlHosts.some((h) => host === h || host.endsWith(`.${h}`));
  }

  server.get('/health', async () => ({ ok: true }));

  server.post<{ Body: ClickBody }>(
    '/api/clicks',
    {
      schema: { body: clickSchema },
      bodyLimit: 4096,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const url = req.body.url.trim();
      if (!isAllowedUrl(url)) return reply.code(400).send({ error: 'Недопустимый url' });

      const click: Click = {
        url,
        title: req.body.title?.trim() || null,
        date: req.body.date.trim(),
        time: req.body.time.trim(),
      };
      if (!isDuplicate(`${req.ip}|${click.url}|${click.date}|${click.time}`)) {
        db.addClick(click);
        onClick(click);
      }
      return reply.code(204).send();
    },
  );

  return server;
}
