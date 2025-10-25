#!/usr/bin/env tsx

/**
 * Единый тестовый файл для голосового ассистента
 * Поддерживает как мок-тестирование, так и реальный API
 */

import { fileURLToPath } from 'url';
import chalk from 'chalk';
import Voice from './voice.js';
import { AIProvider, AIMessage } from './ai/ai.js';

// Тестовые команды для проверки инструментов файловой системы
const TEST_COMMANDS = [
    "Попробуй посмотреть на все файлы, которые есть в той же директории что и ты",
    "Попробуй вывести все директории и файлы которые есть у меня на рабочем столе"
];

/**
 * Мок-провайдер AI для тестирования без реального API
 */
class MockAIProvider implements AIProvider {
    async query(messages: AIMessage[]): Promise<AIMessage> {
        const lastMessage = messages[messages.length - 1];
        console.log(chalk.cyan(`🤖 AI получил: "${lastMessage.content}"`));
        
        let response = "Это тестовый ответ от мок-провайдера.";
        
        if (lastMessage.content.includes("файлы") && lastMessage.content.includes("директории")) {
            response = "Я вижу файлы в текущей директории: package.json, lib/, components/, hooks/, и другие. Для просмотра рабочего стола мне нужны права доступа.";
        } else if (lastMessage.content.includes("рабочем столе")) {
            response = "Я попытаюсь получить список файлов с рабочего стола через терминальные команды.";
        }
        
        console.log(chalk.green(`🤖 AI отвечает: "${response}"`));
        
        return { role: 'assistant', content: response };
    }

    async stream(messages: AIMessage[]): Promise<ReadableStream<string>> {
        const response = await this.query(messages);
        return new ReadableStream({
            start(controller) {
                controller.enqueue(response.content);
                controller.close();
            }
        });
    }
}

/**
 * Мок-компоненты для тестирования
 */
class MockTranscriber {
    async initialize(): Promise<void> {}
    async start(onResult: (text: string) => void): Promise<void> {}
    async stop(): Promise<void> {}
    async destroy(): Promise<void> {}
}

class MockTTS {
    async initialize(): Promise<void> {}
    async speak(text: string): Promise<void> {
        console.log(chalk.cyan(`🔊 TTS: "${text}"`));
    }
    async stop(): Promise<void> {}
    async destroy(): Promise<void> {}
}

/**
 * Тестирование с мок-провайдером
 */
async function testWithMock() {
    console.log(chalk.bold.blue('🧪 Тестирование с мок-провайдером'));
    console.log(chalk.gray('====================================='));

    const voice = new Voice({
        name: 'Мок Ассистент',
        transcriber: new MockTranscriber(),
        tts: new MockTTS(),
        aiProvider: new MockAIProvider(),
        enableTranscription: false,
        enableTTS: true,
        useAnnouncerAI: false
    });

    await voice.initialize();
    console.log(chalk.green('✅ Мок-ассистент готов'));

    for (let i = 0; i < TEST_COMMANDS.length; i++) {
        const command = TEST_COMMANDS[i];
        console.log(chalk.yellow(`\n📝 Команда ${i + 1}: "${command}"`));
        await voice.ask(command);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await voice.destroy();
    console.log(chalk.green('✅ Мок-тест завершен\n'));
}

/**
 * Тестирование с реальным API
 */
async function testWithRealAPI() {
    console.log(chalk.bold.green('🚀 Тестирование с DeepSeek API'));
    console.log(chalk.gray('==================================='));

    if (!process.env.OPENROUTER_API_KEY) {
        console.log(chalk.yellow('⚠️ OPENROUTER_API_KEY не найден, пропускаем реальный тест'));
        return;
    }

    const voice = new Voice({
        name: 'DeepSeek Ассистент',
        model: 'deepseek/deepseek-chat-v3-0324:free',
        enableTranscription: false,
        enableTTS: false,
        useAnnouncerAI: false
    });

    try {
        await voice.initialize();
        console.log(chalk.green('✅ DeepSeek ассистент готов'));

        // Тестируем только одну команду для экономии лимитов
        const testCommand = "Попробуй посмотреть на все файлы, которые есть в той же директории что и ты";
        console.log(chalk.yellow(`\n📝 Тест: "${testCommand}"`));
        await voice.ask(testCommand);

        await voice.destroy();
        console.log(chalk.green('✅ Реальный тест завершен'));

    } catch (error: any) {
        if (error.message?.includes('rate-limited')) {
            console.log(chalk.yellow('⚠️ DeepSeek временно ограничен по запросам, это нормально для бесплатной модели'));
        } else {
            console.error(chalk.red('❌ Ошибка реального теста:'), error.message);
        }
        await voice.destroy();
    }
}

/**
 * Главная функция
 */
async function main() {
    console.log(chalk.bold.magenta('🎯 Тестирование голосового ассистента'));
    console.log(chalk.gray('======================================\n'));

    // Сначала мок-тест (всегда работает)
    await testWithMock();

    // Затем реальный тест (если есть API ключ)
    await testWithRealAPI();

    console.log(chalk.bold.green('🎉 Все тесты завершены!'));
}

// Запуск
if (import.meta.url.startsWith('file://') && process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(chalk.red('❌ Критическая ошибка:'), error);
        process.exit(1);
    });
}
