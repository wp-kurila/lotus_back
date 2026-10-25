# lotus_back

Сбор кликов на «Билеты» с сайта-афиши и Telegram-бот со статистикой. Один процесс: HTTP API (Fastify) и бот (grammY, long polling), данные в SQLite.

## Запуск

1. Создай бота у [@BotFather](https://t.me/BotFather) и возьми токен.
2. `cp .env.example .env`, впиши `BOT_TOKEN`.
3. `npm install && npm run dev`
4. Напиши боту `/start`: он ответит твоим Telegram ID. Впиши его в `ADMIN_IDS` и перезапусти.

После этого каждый клик приходит тебе в личку, а в меню бота появляются команды:

| Команда  | Период                          |
| -------- | ------------------------------- |
| `/day`   | последние 24 часа               |
| `/week`  | последние 7 дней                |
| `/month` | последние 30 дней               |
| `/all`   | за всё время                    |

Команды отвечают только тем, кто указан в `ADMIN_IDS`.

> С одним токеном может работать только один экземпляр бота. Если локально запустить копию при работающем проде, бот упадёт с ошибкой `409 Conflict`. Для разработки заведи отдельного тестового бота.

## API

`POST /api/clicks`. Тело — JSON (`application/json` или `text/plain`, второй вариант нужен для `sendBeacon`):

```json
{ "url": "https://example.com/events/42", "title": "Джаз-вечер", "date": "15 ноября", "time": "19:00" }
```

`url`, `date`, `time` обязательны, `title` — нет. `date` и `time` хранятся и показываются как есть. Ответ: `204`. Повторный клик того же посетителя (IP) на то же событие в течение 10 минут не считается. Лимит — 30 запросов в минуту с одного IP.

Хост в `url` должен быть в `ALLOWED_URL_HOSTS` (поддомены тоже подходят). Иначе любой желающий сможет присылать тебе в личку произвольные ссылки. Если «Билеты» ведут на внешнюю кассу, добавь и её домен.

`GET /health` → `{ "ok": true }`.

## Фронт

```ts
const API_URL = '/api/clicks'; // или https://api.example.com/api/clicks

export function trackTicketClick(event: { url: string; title?: string; date: string; time: string }) {
  const body = JSON.stringify(event);
  // sendBeacon не обрывается при уходе со страницы и не требует CORS-preflight
  if (!navigator.sendBeacon?.(API_URL, body)) {
    fetch(API_URL, { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}
```

```tsx
<a href={event.ticketsUrl} onClick={() => trackTicketClick({ url: event.pageUrl, title: event.title, date: event.date, time: event.time })}>
  Билеты
</a>
```

Если фронт шлёт `Content-Type: application/json` с другого домена, укажи его домен в `CORS_ORIGINS`.

## Деплой на VPS

Нужен Node.js 22+.

```bash
git clone … /opt/lotus_back && cd /opt/lotus_back
npm ci && npm run build
cp .env.example .env   # заполнить
```

`/etc/systemd/system/lotus-back.service`:

```ini
[Unit]
Description=lotus-back
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/lotus_back
ExecStart=/usr/bin/node dist/main.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now lotus-back
journalctl -u lotus-back -f   # логи
```

Пользователю из `User=` нужны права на запись в `data/`. Сервер слушает `127.0.0.1`, наружу его отдаёт nginx. Проще всего на том же домене, что и сайт: тогда CORS не нужен.

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

`X-Forwarded-For` принимается только от локального прокси, поэтому подделать IP снаружи нельзя.

Вся статистика лежит в одном файле `data/stats.db`. Его достаточно иногда копировать в бэкап.
