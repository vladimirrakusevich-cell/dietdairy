import { Telegraf } from 'telegraf';
import cron from 'node-cron';
import dayjsLib from 'dayjs';
import utc from 'dayjs-plugin-utc';
import tz from 'dayjs-plugin-timezone';

dayjsLib.extend(utc);
dayjsLib.extend(tz);
const dayjs = (d) => dayjsLib.tz(d, process.env.TZ || 'Europe/Moscow');

const bot = new Telegraf(process.env.BOT_TOKEN);

const state = {
  users: new Set(),
  window: { start: '12:00', end: '21:00' },
  water: { goalMl: Number(process.env.DEFAULT_WATER_GOAL_ML) || 2700, takenMl: 0 },
  reminders: { water: { start: '09:00', end: '21:00', everyMin: 90 }, windowPins: true },
  schedule: []
};

const helpText = `
Команды:
/start — активировать бота
/status — статус целей и напоминаний
/setwatergoal 2700 — цель воды (мл)
/addwater 300 — учесть выпито (мл)
/resetwater — сброс учёта воды
/setwaterrem 09:00 21:00 90 — напоминания воды с-до каждые N минут
/setwindow 12:00 21:00 — окно питания
/importplan <JSON> — импорт расписания [{\"time\":\"12:30\",\"text\":\"...\"}]
/clearplan — очистить план
`;

bot.start(async (ctx) => {
  state.users.add(ctx.chat.id);
  await ctx.reply('Бот активирован. ' + helpText);
});
bot.help((ctx) => ctx.reply(helpText));

bot.command('status', (ctx) => {
  const { start, end } = state.window;
  const w = state.water;
  ctx.reply(
    `Окно питания: ${start}–${end}\n` +
    `Вода: цель ${w.goalMl} мл, выпито ${w.takenMl} мл, остаток ${Math.max(w.goalMl - w.takenMl, 0)} мл\n` +
    `Напоминания воды: ${state.reminders.water.start}–${state.reminders.water.end} каждые ${state.reminders.water.everyMin} мин\n` +
    `План уведомлений: ${state.schedule.length} элементов`
  );
});

bot.command('setwatergoal', (ctx) => {
  const v = Number(ctx.message.text.split(' ')[1]);
  if (!v) return ctx.reply('Укажите число мл: /setwatergoal 2700');
  state.water.goalMl = v;
  ctx.reply(`Цель воды установлена: ${v} мл`);
});

bot.command('addwater', (ctx) => {
  const v = Number(ctx.message.text.split(' ')[1]);
  if (!v) return ctx.reply('Укажите число мл: /addwater 300');
  state.water.takenMl += v;
  const rest = Math.max(state.water.goalMl - state.water.takenMl, 0);
  ctx.reply(`Учтено: +${v} мл. Осталось: ${rest} мл`);
});

bot.command('resetwater', (ctx) => {
  state.water.takenMl = 0;
  ctx.reply('Учёт воды сброшен.');
});

bot.command('setwaterrem', (ctx) => {
  const [_, s, e, m] = ctx.message.text.split(' ');
  if (!s || !e || !m) return ctx.reply('Пример: /setwaterrem 09:00 21:00 90');
  state.reminders.water = { start: s, end: e, everyMin: Number(m) };
  ctx.reply(`Напоминания воды: ${s}–${e} каждые ${m} мин`);
});

bot.command('setwindow', (ctx) => {
  const [_, s, e] = ctx.message.text.split(' ');
  if (!s || !e) return ctx.reply('Пример: /setwindow 12:00 21:00');
  state.window = { start: s, end: e };
  ctx.reply(`Окно питания: ${s}–${e}`);
});

bot.command('importplan', async (ctx) => {
  const json = ctx.message.text.replace('/importplan', '').trim();
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) throw new Error('Not array');
    state.schedule = arr;
    await ctx.reply(`Импортировано элементов: ${arr.length}`);
  } catch {
    await ctx.reply('Ошибка импорта. Ожидаю JSON-массив: [{\"time\":\"12:30\",\"text\":\"Обед\"}]');
  }
});

bot.command('clearplan', (ctx) => {
  state.schedule = [];
  ctx.reply('План очищен.');
});

function toMinutes(hhmm){ const [h,m]=hhmm.split(':').map(Number); return h*60+m; }
function isWithin(x, a, b){ const xm=toMinutes(x), am=toMinutes(a), bm=toMinutes(b); return xm>=am && xm<=bm; }

function broadcast(text){
  for (const chatId of state.users) bot.telegram.sendMessage(chatId, text);
}

cron.schedule('* * * * *', async () => {
  const now = dayjs();
  const hhmm = now.format('HH:mm');

  if (state.reminders.windowPins && ['12:00', '21:00'].includes(hhmm)) {
    broadcast(hhmm === '12:00' ? '⏰ Старт окна питания' : '✅ Окно питания завершено');
  }

  const { start, end, everyMin } = state.reminders.water;
  if (isWithin(hhmm, start, end)) {
    const sinceStart = toMinutes(hhmm) - toMinutes(start);
    if (sinceStart >= 0 && sinceStart % everyMin === 0) {
      broadcast('💧 Напоминание: сделайте пару глотков воды');
    }
  }

  state.schedule
    .filter(item => item.time === hhmm)
    .forEach(item => broadcast(item.text));
});

bot.launch().then(()=> console.log('Bot started'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
