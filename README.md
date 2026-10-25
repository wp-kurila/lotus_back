# lotus_back

Сбор кликов на «Купить билет» с [lotusarena.life](https://lotusarena.life) и Telegram-бот со статистикой. Один процесс: HTTP API (Fastify) и бот (grammY, long polling), данные в SQLite.

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
{ "url": "https://lotusarena.life/ru/phuket/events/ddt-phuket/" }
```

Сервер берёт из ссылки slug события (последний сегмент пути, `ddt-phuket`), поэтому клики с `/ru/`, `/en/` и `/th/` версий одной страницы считаются вместе. Время клика сервер ставит сам. Query и hash из ссылки отбрасываются.

Ответ: `204`. Повторный клик того же посетителя (IP) на то же событие в течение 10 минут не считается. Лимит — 30 запросов в минуту с одного IP.

Хост в `url` должен быть в `ALLOWED_URL_HOSTS` (поддомены тоже подходят). Иначе любой желающий сможет присылать тебе в личку произвольные ссылки.

`GET /health` → `{ "ok": true }`.

## Фронт

Сайт — репозиторий `lotus_next` (Next.js, статический экспорт). Запросы к бэку лежат в `src/api/`, кнопка — `src/components/events/ticket-button.tsx`. Данные уходят через `sendBeacon` как `text/plain`, поэтому CORS-preflight не нужен.

Для локальной проверки в `.env.local` фронта:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

В `.env` бэка тогда нужен `ALLOWED_URL_HOSTS=lotusarena.life,localhost`, потому что `url` будет вида `http://localhost:3000/...`.

## Деплой

Пуш в `master` запускает GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)):

1. Проект собирается на раннере.
2. `dist/`, `package*.json`, `ecosystem.config.cjs` и `.env` уходят по SSH в `/var/www/lotus_back`.
3. На сервере выполняется `npm ci --omit=dev`, и процесс перезапускается через pm2 ([ecosystem.config.cjs](ecosystem.config.cjs)).
4. Если сервис не ответил на `/health` за 15 секунд, деплой считается упавшим, а в логе Actions появляются последние строки `pm2 logs`.

Вручную: Actions → Build and deploy → Run workflow.

`.env` собирается из секретов при каждом деплое. База `data/stats.db` на сервере при этом не трогается.

Секреты репозитория (Settings → Secrets and variables → Actions):

| Секрет            | Что это                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `SSH_HOST`        | IP или домен сервера                                                    |
| `SSH_USER`        | пользователь на сервере, `ubuntu`                                       |
| `SSH_PRIVATE_KEY` | приватный ключ; публичный должен лежать в `~/.ssh/authorized_keys` на сервере |
| `BOT_TOKEN`       | токен бота                                                              |
| `ADMIN_IDS`       | Telegram ID через запятую                                               |

Логи на сервере: `pm2 logs lotus-back`.

### Один раз на сервере

Нужны Node.js 22+ и pm2. Папка под проект:

```bash
sudo mkdir -p /var/www/lotus_back && sudo chown ubuntu:ubuntu /var/www/lotus_back
```

Чтобы pm2 поднимал процессы после перезагрузки, нужен `pm2 startup`. Если на сервере pm2 уже так настроен для других проектов, ничего делать не нужно: деплой сам вызывает `pm2 save`.

Сервер слушает `127.0.0.1:4000`, наружу его отдаёт nginx на поддомене `api.shamanphuket.com`. Это временно, пока нет доступа к DNS `lotusarena.life`. DNS: A-запись `api` → IP сервера.

`/etc/nginx/sites-available/lotus_api`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name api.shamanphuket.com;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /health {
        proxy_pass http://127.0.0.1:4000;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/lotus_api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.shamanphuket.com   # когда DNS-запись уже работает
```

`X-Forwarded-For` принимается только от локального прокси, поэтому подделать IP снаружи нельзя.

Вся статистика лежит в одном файле `data/stats.db`. Его достаточно иногда копировать в бэкап.
