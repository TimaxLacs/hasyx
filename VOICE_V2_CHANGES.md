# Voice API v2 - Архитектурные изменения

## 📋 Что было сделано

Создан файл `lib/voice-v2.ts` с полной архитектурной реорганизацией на основе плана из `VOICE_ARCHITECTURE_PLAN.md`.

---

## 🏗️ Ключевые архитектурные изменения

### 1. ✅ Модульная архитектура

**Создано 3 независимых модуля:**

- **`STTModule`** - интерфейс для распознавания речи
  - Реализация: `WhisperSTT`
  - Вся логика Whisper инкапсулирована
  
- **`TTSModule`** - интерфейс для синтеза речи
  - Реализация: `ZonosTTS`
  - Вся логика Zonos инкапсулирована
  
- **`AIModule`** - интерфейс для AI
  - Реализация: `OpenRouterAI`
  - Dialog интегрирован внутри, Promise API наружу

### 2. ✅ Event-Driven API

**VoiceAssistant** теперь наследует `EventEmitter` и генерирует события:

```typescript
assistant.on('transcription', (text) => { });  // Распознан текст
assistant.on('keyword', () => { });            // Обнаружено ключевое слово
assistant.on('command', (cmd) => { });         // Получена команда
assistant.on('processing', (cmd) => { });      // AI обрабатывает
assistant.on('response', (text) => { });       // Ответ от AI
assistant.on('speaking', (text) => { });       // Начато озвучивание
assistant.on('spoken', () => { });             // Озвучивание завершено
assistant.on('error', (error) => { });         // Ошибка
```

### 3. ✅ Упрощенная конфигурация

**Один способ создания** - через `VoiceAssistant.create()`:

```typescript
// Минимальный вариант (только AI, текст -> текст)
const assistant = await VoiceAssistant.create({
    ai: {}
});

// С STT (голос -> текст)
const assistant = await VoiceAssistant.create({
    ai: {},
    stt: { model: 'base', language: 'ru' }
});

// С TTS (текст -> голос)
const assistant = await VoiceAssistant.create({
    ai: {},
    tts: { port: 5000 }
});

// Полный (голос -> голос)
const assistant = await VoiceAssistant.create({
    ai: { model: 'gpt-4o-mini' },
    stt: { model: 'base' },
    tts: {},
    keyword: 'алиса',
    silenceThreshold: 2000
});
```

### 4. ✅ Разделение ответственности

**Каждый класс имеет одну ответственность:**

- `WhisperSTT` - только распознавание речи
- `ZonosTTS` - только синтез речи
- `OpenRouterAI` - только работа с AI
- `CommandManager` - только управление потоком команд
- `VoiceAssistant` - фасад и оркестрация

### 5. ✅ Предсказуемое API

**Promise-based методы:**

```typescript
// ask() возвращает результат
const response = await assistant.ask('Привет');
console.log(response);  // Полный ответ от AI

// startListening() явно требует STT
await assistant.startListening();  // Ошибка если нет STT конфига

// destroy() всегда работает
await assistant.destroy();
```

### 6. ✅ Убрано из плана (упрощения)

- ❌ **Режимы работы (mode)** - вместо этого опциональные компоненты
- ❌ **Builder Pattern** - достаточно простого конфига
- ❌ **Отдельный Orchestrator** - логика встроена в VoiceAssistant
- ❌ **VoiceDeviceManager** - используется AudioDeviceManager напрямую
- ❌ **Автозапуск** - файл теперь чистая библиотека

---

## 📊 Сравнение: До и После

### Было (voice.ts):

```typescript
const voice = new Voice({
    apikey: process.env.OPENROUTER_API_KEY,
    enableTranscription: false,
    enableTTS: false
});

await voice.initialize();
await voice.ask("Привет");  // Promise<void>, нет результата
await voice.destroy();
```

### Стало (voice-v2.ts):

```typescript
const assistant = await VoiceAssistant.create({
    ai: {}  // STT и TTS опциональны
});

const response = await assistant.ask("Привет");  // Promise<string>
console.log(response);
await assistant.destroy();
```

**Улучшения:**
- ✅ Меньше кода (3 строки вместо 5)
- ✅ Возвращает результат
- ✅ Не нужно знать о внутренних состояниях
- ✅ Дефолтные настройки работают из коробки

---

## 🔧 Что сохранено из оригинала

### Вся функциональность:
- ✅ Whisper STT с калибровкой тишины
- ✅ Zonos TTS через ZonosJS
- ✅ OpenRouter AI через Dialog
- ✅ Управление командами с ключевым словом
- ✅ Обработка аудио с динамическим порогом тишины
- ✅ Буферизация команд
- ✅ Тэги `<VOICE>` для извлечения текста

### Вся логика:
- ✅ RMS вычисление для громкости
- ✅ Адаптивная калибровка шума
- ✅ Обработка аудио чанков
- ✅ WAV формат для Whisper
- ✅ Интеграция с AudioDeviceManager

---

## 🎯 Как использовать новый API

### Пример 1: Простой текстовый AI

```typescript
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/deepseek-chat-v3-0324:free' }
});

const response = await assistant.ask('Привет!');
console.log(response);

await assistant.destroy();
```

### Пример 2: AI с озвучиванием ответов

```typescript
const assistant = await VoiceAssistant.create({
    ai: {},
    tts: {}  // Использует дефолтные настройки Zonos
});

await assistant.ask('Расскажи анекдот');
// Ответ будет озвучен автоматически

await assistant.destroy();
```

### Пример 3: Голосовой ассистент с ключевым словом

```typescript
const assistant = await VoiceAssistant.create({
    ai: {},
    stt: { model: 'tiny', language: 'ru' },
    tts: {},
    keyword: 'алиса',
    silenceThreshold: 2000
});

// Подписка на события
assistant.on('transcription', (text) => {
    console.log('Распознано:', text);
});

assistant.on('keyword', () => {
    console.log('Ключевое слово обнаружено!');
});

assistant.on('response', (text) => {
    console.log('AI ответил:', text);
});

// Запуск прослушивания
await assistant.startListening();

// Остановка по Ctrl+C
process.on('SIGINT', async () => {
    await assistant.stopListening();
    await assistant.destroy();
    process.exit(0);
});
```

### Пример 4: Подписка на все события

```typescript
const assistant = await VoiceAssistant.create({
    ai: {},
    stt: {},
    tts: {},
    keyword: 'алиса'
});

assistant.on('transcription', (text) => console.log('📝', text));
assistant.on('keyword', () => console.log('🎯 Keyword!'));
assistant.on('command', (cmd) => console.log('💬', cmd));
assistant.on('processing', (cmd) => console.log('⚙️', cmd));
assistant.on('response', (text) => console.log('🤖', text));
assistant.on('speaking', (text) => console.log('🔊', text));
assistant.on('spoken', () => console.log('✅ Done speaking'));
assistant.on('error', (err) => console.error('❌', err));

await assistant.startListening();
```

---

## 🚀 Следующие шаги

### Для тестирования нового API:

1. **Создать CLI скрипт** (например, `lib/voice-v2-cli.ts`):
```typescript
import VoiceAssistant from './voice-v2';

(async () => {
    const assistant = await VoiceAssistant.create({
        ai: {},
        stt: { model: 'tiny' },
        tts: {},
        keyword: 'алиса'
    });

    await assistant.startListening();

    process.on('SIGINT', async () => {
        await assistant.destroy();
        process.exit(0);
    });
})();
```

2. **Запустить:**
```bash
npx tsx lib/voice-v2-cli.ts
```

### Для миграции с voice.ts:

1. Заменить импорты:
```typescript
// Было:
import Voice from './lib/voice';

// Стало:
import VoiceAssistant from './lib/voice-v2';
```

2. Заменить код инициализации:
```typescript
// Было:
const voice = new Voice({ enableTranscription: false });
await voice.initialize();

// Стало:
const assistant = await VoiceAssistant.create({ ai: {} });
```

3. Заменить вызовы методов:
```typescript
// Было:
await voice.ask("test");  // Promise<void>

// Стало:
const response = await assistant.ask("test");  // Promise<string>
```

---

## ✅ Преимущества новой архитектуры

### Для пользователей:
- ✅ **Проще использовать** - меньше кода для базовых случаев
- ✅ **Понятнее** - явные ошибки вместо молчаливых отказов
- ✅ **Гибче** - можно подписаться на любое событие
- ✅ **Предсказуемее** - методы либо работают, либо выбрасывают ошибку
- ✅ **Возврат результата** - `ask()` возвращает Promise<string>

### Для разработчиков:
- ✅ **Модульность** - каждый компонент независим
- ✅ **Тестируемость** - легко мокать модули
- ✅ **Расширяемость** - легко добавить новый STT/TTS/AI
- ✅ **Поддерживаемость** - четкие границы ответственности
- ✅ **Читаемость** - понятная структура кода

---

## 📦 Структура файла voice-v2.ts

```
voice-v2.ts (742 строки)
├── Интерфейсы (строки 1-113)
│   ├── STTModule, TTSModule, AIModule
│   ├── STTConfig, TTSConfig, AIConfig
│   └── VoiceAssistantConfig
│
├── WhisperSTT (строки 115-332)
│   ├── Калибровка тишины
│   ├── Обработка аудио чанков
│   └── WAV сохранение
│
├── ZonosTTS (строки 334-430)
│   ├── Управление сервером
│   └── Синтез речи
│
├── OpenRouterAI (строки 432-521)
│   ├── Dialog интеграция
│   └── Promise API
│
├── CommandManager (строки 523-603)
│   ├── Детекция ключевого слова
│   └── Буферизация команд
│
└── VoiceAssistant (строки 605-742)
    ├── Event-driven API
    ├── Оркестрация модулей
    └── Публичный API
```

---

**Статус:** ✅ Готово к тестированию  
**Создано:** 2025-10-25  
**Версия:** 2.0  

