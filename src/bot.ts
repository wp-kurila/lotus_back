import { Bot, GrammyError } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type { Click, Db } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

// Окна скользящие (последние N дней от текущего момента), поэтому часовой пояс не важен
const PERIODS: Record<string, { label: string; ms: number }> = {
  day: { label: 'За 24 часа', ms: DAY },
  week: { label: 'За 7 дней', ms: 7 * DAY },
  month: { label: 'За 30 дней', ms: 30 * DAY },
  all: { label: 'За всё время', ms: Infinity },
};

const COMMANDS = Object.entries(PERIODS).map(([command, { label }]) => ({
  command,
  description: `Статистика ${label.toLowerCase()}`,
}));

const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } } as const;

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatClick(click: Click) {
  return ['🎟 Клик на «Купить билет»', `<b>${esc(click.eventId)}</b>`, `🔗 ${esc(click.url)}`].join('\n');
}

// Строка списка ~35 видимых символов, лимит Telegram — 4096: 50 строк влезают с большим запасом
const STATS_LIMIT = 50;

function formatStats(db: Db, period: { label: string; ms: number }) {
  const since = Number.isFinite(period.ms) ? Date.now() - period.ms : 0;
  const { total, events, top } = db.stats(since, STATS_LIMIT);
  if (total === 0) return `📊 ${period.label}: кликов нет`;

  const lines = top.map((e, i) => `${i + 1}. <a href="${esc(e.url)}">${esc(e.eventId)}</a> — <b>${e.clicks}</b>`);
  const restEvents = events - top.length;
  if (restEvents > 0) {
    const restClicks = total - top.reduce((sum, e) => sum + e.clicks, 0);
    lines.push(
      `…и ещё ${restEvents} ${plural(restEvents, 'событие', 'события', 'событий')}, ` +
        `${restClicks} ${plural(restClicks, 'клик', 'клика', 'кликов')}`,
    );
  }
  return [
    `📊 ${period.label}: <b>${total}</b> ${plural(total, 'клик', 'клика', 'кликов')}`,
    '',
    ...lines,
  ].join('\n');
}

export function createBot(token: string, adminIds: number[], db: Db) {
  const bot = new Bot(token);
  // Повторяем только то, что Telegram точно не выполнил (429, 5xx). При сетевой ошибке
  // сообщение могло уже уйти, и повтор дал бы дубль; опрос обновлений grammY повторяет сам
  bot.api.config.use(autoRetry({ rethrowHttpErrors: true }));

  // Каждое входящее обновление в лог: если ответ задвоится, будет видно, пришло ли оно дважды
  bot.use((ctx, next) => {
    console.log(`update ${ctx.update.update_id} from ${ctx.from?.id}: ${ctx.message?.text ?? '-'}`);
    return next();
  });

  bot.command('start', (ctx) => {
    const id = ctx.from?.id;
    if (id !== undefined && adminIds.includes(id)) {
      const help = COMMANDS.map((c) => `/${c.command} — ${c.description.toLowerCase()}`).join('\n');
      return ctx.reply(`Сюда будут приходить клики на «Купить билет».\n\n${help}`);
    }
    return ctx.reply(`Твой Telegram ID: <code>${id}</code>\nДобавь его в ADMIN_IDS, чтобы получать уведомления.`, HTML);
  });

  const admin = bot.filter((ctx) => ctx.from !== undefined && adminIds.includes(ctx.from.id));
  for (const [command, period] of Object.entries(PERIODS)) {
    admin.command(command, (ctx) => ctx.reply(formatStats(db, period), HTML));
  }

  bot.catch((err) => console.error('Ошибка бота:', err.error));

  return {
    async notify(click: Click) {
      const text = formatClick(click);
      const results = await Promise.allSettled(adminIds.map((id) => bot.api.sendMessage(id, text, HTML)));
      for (const r of results) {
        if (r.status === 'rejected') console.error('Не удалось отправить уведомление:', r.reason);
      }
    },

    // Резолвится только после stop()
    async start() {
      // Меню команд видно только админам
      await Promise.allSettled(
        adminIds.map((id) => bot.api.setMyCommands(COMMANDS, { scope: { type: 'chat', chat_id: id } })),
      );
      try {
        await bot.start({
          // Если процесс упал, не успев подтвердить обновление, после перезапуска Telegram
          // пришлёт его снова и команда получит второй ответ. Ценой потери команд,
          // отправленных за секунды перезапуска, начинаем с чистой очереди.
          drop_pending_updates: true,
          onStart: (me) => console.log(`Бот @${me.username} запущен`),
        });
      } catch (err) {
        if (err instanceof GrammyError && err.error_code === 409) {
          throw new Error(
            'Бот с этим токеном уже запущен в другом месте (409 Conflict). Должна работать ровно одна копия: проверь pm2 ls, systemd и локальный npm run dev',
            { cause: err },
          );
        }
        throw err;
      }
    },

    stop() {
      return bot.stop();
    },
  };
}
