try {
  process.loadEnvFile();
} catch {
  // .env необязателен: на сервере переменные могут прийти из systemd
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  adminIds: list('ADMIN_IDS').map(Number).filter(Number.isSafeInteger),
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 4000,
  corsOrigins: list('CORS_ORIGINS'),
  allowedUrlHosts: list('ALLOWED_URL_HOSTS').map((h) => h.toLowerCase()),
  dbPath: process.env.DB_PATH || './data/stats.db',
};

export type Config = typeof config;
