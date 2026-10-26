// pm2: pm2 startOrRestart ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'lotus-back',
      script: 'dist/main.js',
      cwd: __dirname,
      // Строго один экземпляр: бот на long polling, вторая копия получит 409 Conflict
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '200M',
      // При падениях подряд пауза перед рестартом растёт до 15 с: две копии бота
      // не будут перебивать друг друга каждую секунду
      exp_backoff_restart_delay: 1000,
      // Время на корректное завершение: закрыть HTTP-сервер, остановить бота, закрыть базу
      kill_timeout: 5000,
      // Метка времени у каждой строки лога, в том числе у console.log бота
      time: true,
    },
  ],
};
