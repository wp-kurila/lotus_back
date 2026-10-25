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
      // Время на корректное завершение: закрыть HTTP-сервер, остановить бота, закрыть базу
      kill_timeout: 5000,
    },
  ],
};
