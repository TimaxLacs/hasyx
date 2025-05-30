#!/usr/bin/env node

import { ask } from './lib/ask';

async function main() {
  console.log('🚀 Тестируем ask с puppeteer и results[uuid]...\n');

  // Первый вопрос: запуск браузера и открытие страницы
  console.log('=== Этап 1: Запуск браузера ===');
  const response1 = await ask.ask(`
  Используй puppeteer для открытия браузера и перехода на https://example.com. 
  Сохрани браузер и страницу в results['browser'] и results['page'] соответственно.
  Верни title страницы.
  `);

  console.log('AI Ответ 1:', response1);
  console.log('\n');

  // Второй вопрос: использование уже открытого браузера для перехода на другую страницу
  console.log('=== Этап 2: Переход на другую страницу ===');
  const response2 = await ask.ask(`
  Используй уже открытый браузер из results['browser'] и страницу из results['page'].
  Перейди на https://github.com и верни новый title страницы.
  `);

  console.log('AI Ответ 2:', response2);
  console.log('\n');

  // Третий вопрос: еще один переход
  console.log('=== Этап 3: Еще один переход ===');
  const response3 = await ask.ask(`
  Используй ту же страницу из results['page'] для перехода на https://stackoverflow.com.
  Верни title этой страницы и закрой браузер.
  `);

  console.log('AI Ответ 3:', response3);

  console.log('\n✅ Тест завершен!');
}

main().catch(console.error); 