#!/usr/bin/env tsx

/**
 * CLI для тестирования Voice API v2
 * 
 * Запуск:
 * npx tsx lib/voice-v2-cli.ts
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
    console.log('  OPENROUTER_API_KEY=your_key npx tsx lib/voice-v2-cli.ts');
    process.exit(1);
}

import VoiceAssistant from './voice-v2';
import chalk from 'chalk';

console.log(chalk.bold.blue('\n🎙️  Voice Assistant v2 CLI\n'));

(async () => {
    try {
        console.log('Инициализация ассистента...\n');

        const assistant = await VoiceAssistant.create({
            ai: {
                // apiKey будет взят из OPENROUTER_API_KEY
                model: 'deepseek/deepseek-chat-v3-0324:free'
            },
            stt: {
                model: 'tiny',
                language: 'ru'
            },
            // TTS временно отключен для быстрого тестирования
            // Раскомментируйте для включения озвучивания:
            // tts: {},
            keyword: 'алиса',
            silenceThreshold: 2000
        });

        console.log(chalk.green('✅ Ассистент готов!\n'));

        // Подписка на события
        assistant.on('transcription', (text) => {
            // Не логируем каждую транскрипцию, чтобы не засорять вывод
        });

        assistant.on('keyword', () => {
            console.log(chalk.yellow('\n🎯 Ключевое слово обнаружено! Слушаю команду...\n'));
        });

        assistant.on('command', (command) => {
            console.log(chalk.cyan(`💬 Команда: "${command}"\n`));
        });

        assistant.on('processing', (command) => {
            console.log(chalk.blue(`⚙️  Обрабатываю: "${command}"...\n`));
        });

        assistant.on('response', (text) => {
            console.log(chalk.green(`\n🤖 Ответ:\n${text}\n`));
        });

        assistant.on('speaking', (text) => {
            console.log(chalk.magenta(`\n🔊 Озвучиваю: "${text}"\n`));
        });

        assistant.on('spoken', () => {
            console.log(chalk.green('✅ Озвучивание завершено\n'));
        });

        assistant.on('error', (error) => {
            console.error(chalk.red(`\n❌ Ошибка: ${error.message}\n`));
        });

        // Запуск прослушивания
        console.log(chalk.bold('👂 Начинаю прослушивание. Скажите "алиса" и команду.\n'));
        console.log(chalk.gray('Нажмите Ctrl+C для выхода.\n'));

        await assistant.startListening();

        // Обработка Ctrl+C
        process.on('SIGINT', async () => {
            console.log(chalk.yellow('\n\n🛑 Получен сигнал завершения...\n'));
            await assistant.stopListening();
            await assistant.destroy();
            console.log(chalk.green('👋 До свидания!\n'));
            process.exit(0);
        });

    } catch (error) {
        console.error(chalk.red('\n❌ Критическая ошибка:'), error);
        process.exit(1);
    }
})();

