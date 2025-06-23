import { AskHasyx, ensureOpenRouterApiKey } from 'hasyx/lib/ask-hasyx';



// Запуск приложения
if (require.main === module) {
  (async () => {
    try {
      await ensureOpenRouterApiKey();
      const projectName = process.env.npm_package_name || 'Hasyx Project';
      const consoleAsk = new AskHasyx(
        process.env.OPENROUTER_API_KEY!
      );
      console.log('Просто начните вводить ваши запросы ниже. Для выхода нажмите CTRL+C.');
      console.log('---');
      await consoleAsk.repl();
    } catch (error) {
      console.error('❌ Произошла критическая ошибка при запуске AI-ассистента:', error);
      process.exit(1);
    }
  })();
} 