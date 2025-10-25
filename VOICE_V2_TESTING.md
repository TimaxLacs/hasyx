# Voice API v2 - Инструкция по тестированию

## 🎯 Что было создано

1. **`lib/voice-v2.ts`** - Основной файл с новой архитектурой (742 строки)
2. **`lib/voice-v2-cli.ts`** - CLI для тестирования полного режима (голос → голос)
3. **`lib/voice-v2-text-cli.ts`** - CLI для тестирования текстового режима (текст → текст)
4. **`VOICE_V2_CHANGES.md`** - Документация по изменениям

---

## 🚀 Быстрый старт

### Вариант 1: Текстовый режим (рекомендуется для первого теста)

**Не требует микрофона и Zonos TTS**

```bash
# Способ 1: С автозагрузкой .env (рекомендуется)
npx tsx lib/voice-v2-text-cli.ts

# Способ 2: С явным указанием API ключа
OPENROUTER_API_KEY=your_key_here npx tsx lib/voice-v2-text-cli.ts
```

**Примечание:** CLI файлы автоматически загружают переменные из `.env` файла через `dotenv`.

Что произойдет:
- ✅ Инициализируется только AI модуль
- ✅ Вы сможете писать текстом и получать ответы
- ✅ Быстро и без настройки аудио

**Пример взаимодействия:**
```
💬  Voice Assistant v2 - Text Mode

Инициализация ассистента (только AI)...

✅ Ассистент готов!

Вы > Привет! Как дела?
⚙️  Думаю...

🤖 AI: Привет! У меня всё отлично, спасибо! 
Я готов помочь тебе с любыми вопросами. Как дела у тебя?

Вы > exit
```

---

### Вариант 2: Полный голосовой режим

**Требует микрофон и (опционально) Zonos TTS**

```bash
# С автозагрузкой .env
npx tsx lib/voice-v2-cli.ts

# Или с явным указанием API ключа
OPENROUTER_API_KEY=your_key_here npx tsx lib/voice-v2-cli.ts
```

Что произойдет:
- ✅ Инициализируется STT (Whisper)
- ✅ Инициализируется AI
- ⚠️ TTS (Zonos) временно отключен в CLI для быстрого тестирования
- ✅ Вы можете говорить через микрофон

**Для включения TTS** раскомментируйте строку в `lib/voice-v2-cli.ts`:

```typescript
// Было:
// tts: {},

// Стало:
tts: {},
```

---

## 🧪 Как протестировать API программно

### Пример 1: Простой текстовый запрос

```typescript
import VoiceAssistant from './lib/voice-v2';

const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/deepseek-chat-v3-0324:free' }
});

const response = await assistant.ask('Привет!');
console.log(response);

await assistant.destroy();
```

### Пример 2: С прослушиванием событий

```typescript
import VoiceAssistant from './lib/voice-v2';

const assistant = await VoiceAssistant.create({
    ai: {}
});

assistant.on('processing', () => {
    console.log('AI думает...');
});

assistant.on('response', (text) => {
    console.log('Ответ:', text);
});

assistant.on('error', (error) => {
    console.error('Ошибка:', error);
});

await assistant.ask('Расскажи анекдот');
await assistant.destroy();
```

### Пример 3: Голосовой ассистент с ключевым словом

```typescript
import VoiceAssistant from './lib/voice-v2';

const assistant = await VoiceAssistant.create({
    ai: {},
    stt: { model: 'tiny', language: 'ru' },
    keyword: 'алиса',
    silenceThreshold: 2000
});

assistant.on('keyword', () => {
    console.log('🎯 Ключевое слово обнаружено!');
});

assistant.on('command', (cmd) => {
    console.log('💬 Команда:', cmd);
});

assistant.on('response', (text) => {
    console.log('🤖 Ответ:', text);
});

await assistant.startListening();

// Остановка через Ctrl+C
process.on('SIGINT', async () => {
    await assistant.stopListening();
    await assistant.destroy();
    process.exit(0);
});
```

---

## ⚙️ Конфигурация

### AI Config (обязательный)

```typescript
ai: {
    apiKey?: string;          // По умолчанию из OPENROUTER_API_KEY
    model?: string;           // По умолчанию 'deepseek/deepseek-chat-v3-0324:free'
    systemPrompt?: string;    // Кастомный системный промпт
    useVoiceTags?: boolean;   // Использовать <VOICE> тэги (по умолчанию true)
}
```

### STT Config (опциональный)

```typescript
stt: {
    model?: string;           // 'tiny', 'base', 'small', 'medium', 'large'
    language?: string;        // По умолчанию 'ru'
    chunkDuration?: number;   // Длительность аудиочанка в мс (по умолчанию 2000)
}
```

### TTS Config (опциональный)

```typescript
tts: {
    port?: number;            // Порт для Zonos сервера (по умолчанию 5000)
    referenceAudio?: string;  // Путь к reference.wav
}
```

### Дополнительные параметры

```typescript
keyword?: string;             // Ключевое слово для активации (например, 'алиса')
silenceThreshold?: number;    // Порог тишины в мс (по умолчанию 2000)
```

---

## 📊 События

VoiceAssistant генерирует следующие события:

| Событие | Параметры | Описание |
|---------|-----------|----------|
| `transcription` | `(text: string)` | Распознан текст из речи |
| `keyword` | `()` | Обнаружено ключевое слово |
| `command` | `(command: string)` | Получена команда от пользователя |
| `processing` | `(command: string)` | AI начал обрабатывать запрос |
| `response` | `(text: string)` | Получен ответ от AI |
| `speaking` | `(text: string)` | Начато озвучивание |
| `spoken` | `()` | Озвучивание завершено |
| `error` | `(error: Error)` | Произошла ошибка |

---

## 🔍 Что тестировать

### Критичные сценарии:

1. ✅ **Создание ассистента только с AI**
   ```typescript
   const assistant = await VoiceAssistant.create({ ai: {} });
   ```

2. ✅ **Отправка текстового запроса**
   ```typescript
   const response = await assistant.ask('Привет');
   console.log(response);
   ```

3. ✅ **Прослушивание микрофона с STT**
   ```typescript
   const assistant = await VoiceAssistant.create({ 
       ai: {}, 
       stt: { model: 'tiny' } 
   });
   await assistant.startListening();
   ```

4. ✅ **Работа с ключевым словом**
   ```typescript
   const assistant = await VoiceAssistant.create({ 
       ai: {}, 
       stt: {}, 
       keyword: 'алиса' 
   });
   assistant.on('keyword', () => console.log('Обнаружено!'));
   await assistant.startListening();
   ```

5. ✅ **События работают корректно**
   ```typescript
   assistant.on('response', (text) => { /* ... */ });
   assistant.on('error', (err) => { /* ... */ });
   ```

6. ✅ **Освобождение ресурсов**
   ```typescript
   await assistant.destroy();  // Должно корректно закрыть все
   ```

### Граничные случаи:

- ❌ Попытка `startListening()` без STT конфига → должна выбросить ошибку
- ❌ Попытка `ask()` без API ключа → должна выбросить ошибку
- ✅ Множественные вызовы `ask()` подряд → должны обрабатываться последовательно
- ✅ Вызов `destroy()` дважды → не должен падать

---

## 🐛 Известные ограничения

1. **TTS прерывание не реализовано**
   - `tts.stop()` пока пустой метод
   - Нужно добавить в `AudioDeviceManager.playAudio()` механизм прерывания

2. **Dialog не поддерживает множественные параллельные запросы**
   - Если вызвать `ask()` дважды одновременно, второй запрос может потерять контекст
   - Решение: добавить очередь запросов

3. **Калибровка шума занимает 3 сэмпла**
   - Первые 6-8 секунд после запуска STT идет калибровка
   - Можно уменьшить `CALIBRATION_SAMPLES` для быстрого старта

4. **Zonos TTS требует внешний проект**
   - Сервер ZonosJS должен быть установлен в `/home/timax/projects/zonosjs-test`
   - Можно переконфигурировать через `tts.referenceAudio`

---

## 📝 Что делать дальше

### Если все работает:
1. Можно начинать миграцию с `voice.ts` на `voice-v2.ts`
2. Можно добавлять новые фичи (стриминг, множественные запросы)
3. Можно оптимизировать (параллельная инициализация модулей)

### Если есть проблемы:
1. Проверьте логи в консоли
2. Убедитесь, что `OPENROUTER_API_KEY` установлен
3. Проверьте, что микрофон доступен
4. Для TTS - убедитесь, что Zonos установлен

---

## 🎓 Ключевые отличия от voice.ts

| Старый API (voice.ts) | Новый API (voice-v2.ts) |
|-----------------------|-------------------------|
| `new Voice({ enableSTT: false })` | `VoiceAssistant.create({ ai: {} })` |
| `await voice.initialize()` | Инициализация внутри `create()` |
| `await voice.ask()` → `Promise<void>` | `await assistant.ask()` → `Promise<string>` |
| Нет событий наружу | `assistant.on('event', handler)` |
| Монолитный класс | Модульная архитектура |
| Автозапуск при импорте | Чистая библиотека |

---

**Готово к тестированию!** 🚀

Запустите:
```bash
npx tsx lib/voice-v2-text-cli.ts
```

