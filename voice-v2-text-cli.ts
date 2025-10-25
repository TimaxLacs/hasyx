#!/usr/bin/env tsx

/**
 * CLI для тестирования Voice API v2 в текстовом режиме (без STT/TTS)
 * 
 * Запуск:
 * npx tsx lib/voice-v2-text-cli.ts
 */

// Загружаем переменные окружения из .env
import dotenv from 'dotenv';
import path from 'path';

// Явно указываем путь к .env файлу относительно корня проекта
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.error('⚠️  Ошибка загрузки .env:', result.error.message);
    console.log('Попробуем загрузить из текущей директории...');
    dotenv.config();
}

// Проверка загрузки
if (!process.env.OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY не найден в окружении!');
    console.log('Пожалуйста, установите переменную окружения или добавьте в .env файл.');
    console.log('\nИспользование:');
    console.log('  OPENROUTER_API_KEY=your_key npx tsx lib/voice-v2-text-cli.ts');
    process.exit(1);
}

import VoiceAssistant from './voice-v2';
import chalk from 'chalk';
import * as readline from 'readline';

console.log(chalk.bold.blue('\n💬  Voice Assistant v2 - Text Mode\n'));

(async () => {
    try {
        console.log('Инициализация ассистента (только AI)...\n');

        const assistant = await VoiceAssistant.create({
            ai: {
                model: 'deepseek/deepseek-chat-v3-0324:free',
                useVoiceTags: false  // Не используем тэги <VOICE> в текстовом режиме
            }
            // STT и TTS не настроены - только текст
        });

        console.log(chalk.green('✅ Ассистент готов!\n'));

        // Создаем интерфейс для чтения из консоли
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.cyan('Вы > ')
        });

        // Подписка на события
        assistant.on('processing', () => {
            console.log(chalk.gray('⚙️  Думаю...'));
        });

        assistant.on('response', (text) => {
            console.log(chalk.green(`\n🤖 AI: ${text}\n`));
            rl.prompt();
        });

        assistant.on('error', (error) => {
            console.error(chalk.red(`\n❌ Ошибка: ${error.message}\n`));
            rl.prompt();
        });

        console.log(chalk.gray('Введите ваш вопрос и нажмите Enter.'));
        console.log(chalk.gray('Введите "exit" или нажмите Ctrl+C для выхода.\n'));

        rl.prompt();

        rl.on('line', async (line) => {
            const input = line.trim();

            if (!input) {
                rl.prompt();
                return;
            }

            if (input.toLowerCase() === 'exit') {
                rl.close();
                return;
            }

            try {
                await assistant.ask(input);
                // Ответ будет выведен через событие 'response'
            } catch (error) {
                // Ошибка будет обработана через событие 'error'
            }
        });

        rl.on('close', async () => {
            console.log(chalk.yellow('\n\n🛑 Завершение работы...\n'));
            await assistant.destroy();
            console.log(chalk.green('👋 До свидания!\n'));
            process.exit(0);
        });

    } catch (error) {
        console.error(chalk.red('\n❌ Критическая ошибка:'), error);
        process.exit(1);
    }
})();

