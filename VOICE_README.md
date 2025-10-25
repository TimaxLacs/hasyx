# Voice Assistant - Модульная архитектура 🎯

> Гибкий голосовой ассистент с возможностью использования любых комбинаций компонентов

---

## 🚀 Быстрый старт

```typescript
import Voice from './lib/voice';

// Полный голосовой ассистент
const voice = new Voice({
    enableTranscription: true,  // STT
    enableTTS: true,            // TTS
});

await voice.initialize();
await voice.startListening();
```

**Готово!** Говорите "алиса" и задавайте команды.

---

## ✨ Ключевые возможности

### 🎛️ Модульная архитектура

Используйте **только то, что нужно:**

- 🎤 **STT** - Распознавание речи (Whisper)
- 🤖 **AI** - Обработка команд (OpenRouter)
- 🔊 **TTS** - Синтез речи (ZonosJS)

### 🔧 Гибкая конфигурация

```typescript
// Только AI и TTS (ввод через консоль)
const voice = new Voice({
    enableTranscription: false,
    enableTTS: true,
});
await voice.initializeAI();
await voice.initializeTTS();

// Только STT и AI (вывод в консоль)
const voice = new Voice({
    enableTranscription: true,
    enableTTS: false,
});
await voice.initializeSTT();
await voice.initializeAI();
```

### 🎯 Независимые методы

Каждый метод делает **только свою работу:**

```typescript
// Инициализация
await voice.initializeSTT();   // Только STT
await voice.initializeTTS();   // Только TTS
await voice.initializeAI();    // Только AI

// Использование
await voice.startListening();       // С обработкой команд
await voice.startListeningRaw(cb);  // Raw режим
await voice.speak("текст");         // Озвучивание
await voice.ask("команда");         // AI обработка
await voice.stopListening();        // Остановка
```

---

## 📊 Режимы работы

| Режим | STT | AI | TTS | Применение |
|-------|-----|----|----|-----------|
| **Полный ассистент** | ✅ | ✅ | ✅ | Голосовой помощник |
| **Консоль → Голос** | ❌ | ✅ | ✅ | Текстовый ввод, голосовой ответ |
| **Голос → Консоль** | ✅ | ✅ | ❌ | Голосовой ввод, текстовый ответ |
| **Raw STT** | ✅ | ❌ | ❌ | Только распознавание |
| **Только AI** | ❌ | ✅ | ❌ | Текстовый бот |
| **Только TTS** | ❌ | ❌ | ✅ | Озвучивание |

---

## 💡 Примеры использования

### 1️⃣ Полный голосовой ассистент

```typescript
const voice = new Voice({
    enableTranscription: true,
    enableTTS: true,
});

await voice.initialize();
await voice.startListening();
```

### 2️⃣ Текстовый ввод → Голосовой вывод

```typescript
const voice = new Voice({
    enableTranscription: false,
    enableTTS: true,
});

await voice.initializeAI();
await voice.initializeTTS();

// Вводите команды в консоли
await voice.ask("Привет!");
```

### 3️⃣ Голосовой ввод → Текстовый вывод

```typescript
const voice = new Voice({
    enableTranscription: true,
    enableTTS: false,
});

await voice.initializeSTT();
await voice.initializeAI();
await voice.startListening();

// Говорите команды, ответы в консоли
```

### 4️⃣ Raw распознавание речи

```typescript
const voice = new Voice({
    enableTranscription: true,
});

await voice.initializeSTT();

await voice.startListeningRaw((text) => {
    console.log("Распознано:", text);
    // Ваша кастомная обработка
});
```

### 5️⃣ Только озвучивание

```typescript
const voice = new Voice({
    enableTTS: true,
});

await voice.initializeTTS();

await voice.speak("Привет!");
await voice.speak("Как дела?");
```

### 6️⃣ Текстовый AI бот

```typescript
const voice = new Voice();

await voice.initializeAI();

await voice.ask("Что такое JavaScript?");
// Ответ в консоли
```

---

## 🏗️ Архитектура

### До рефакторинга ❌

```typescript
startListening() {
    this.transcriber.start(...);
    
    // ❌ Логика управления командами в методе STT
    setInterval(() => {
        await this.ask(command);  // Вызов AI
    });
}
```

**Проблемы:**
- Смешивание ответственностей
- Невозможность использовать компоненты отдельно
- Всегда инициализировались все компоненты

### После рефакторинга ✅

```typescript
// CommandManager отвечает за обработку команд
class CommandManager {
    startCommandSession(onCommandReady) { }
    processTranscription(text) { }
    stopCommandSession() { }
}

// startListening() делает только свою работу
startListening() {
    this.commandManager = new CommandManager();
    this.commandManager.startCommandSession((cmd) => this.ask(cmd));
    this.transcriber.start((text) => {
        this.commandManager.processTranscription(text);
    });
}
```

**Решено:**
- ✅ Каждый метод делает только свою работу
- ✅ Независимые компоненты
- ✅ Модульная инициализация
- ✅ Гибкая конфигурация

---

## 📚 Документация

- **[VOICE_QUICKSTART.md](VOICE_QUICKSTART.md)** - Быстрый старт
- **[VOICE_USAGE_EXAMPLES.md](VOICE_USAGE_EXAMPLES.md)** - Подробные примеры
- **[VOICE_REFACTORING_SUMMARY.md](VOICE_REFACTORING_SUMMARY.md)** - Детали рефакторинга
- **[VOICE_CHANGELOG.md](VOICE_CHANGELOG.md)** - Список изменений

---

## 🎮 Встроенные примеры

```bash
npx tsx lib/voice.ts
```

В конце `lib/voice.ts` есть 4 готовых примера:
1. `runFullVoiceAssistant()` - полный режим (запускается по умолчанию)
2. `runConsoleWithTTS()` - текст → голос
3. `runVoiceWithConsoleOutput()` - голос → текст
4. `runSTTOnly()` - только распознавание

Раскомментируйте нужный режим в конце файла!

---

## 🔧 Настройки

```typescript
const voice = new Voice({
    // Компоненты
    enableTranscription: true,   // Включить STT
    enableTTS: false,             // Включить TTS
    
    // Поведение
    name: 'джарвис',             // Ключевое слово для активации
    silenceThreshold: 3000,      // Тишина = конец команды (мс)
    
    // AI
    apikey: 'your-key',          // API ключ OpenRouter
    model: 'model-name',         // Модель AI
    system_prompt: 'prompt',     // Системный промпт
    
    // Кастомные движки (опционально)
    transcriber: mySTT,          // Реализация ITranscriber
    tts: myTTS,                  // Реализация ITextToSpeech
    aiProvider: myAI,            // Реализация AIProvider
});
```

---

## 🎯 API Reference

### Инициализация

```typescript
await voice.initialize()      // Инициализировать всё
await voice.initializeSTT()   // Только STT
await voice.initializeTTS()   // Только TTS
await voice.initializeAI()    // Только AI
```

### Прослушивание

```typescript
await voice.startListening()           // С обработкой команд
await voice.startListeningRaw(callback) // Raw режим
await voice.stopListening()            // Остановить
```

### AI и TTS

```typescript
await voice.ask(command)    // Отправить команду в AI
await voice.speak(text)     // Озвучить текст
```

### Жизненный цикл

```typescript
await voice.destroy()       // Освободить все ресурсы
```

---

## 🎉 Преимущества

✅ **Модульность** - используйте только нужные компоненты  
✅ **Гибкость** - любые комбинации STT/AI/TTS  
✅ **Независимость** - каждый метод делает только свою работу  
✅ **Расширяемость** - легко добавить кастомные движки  
✅ **Тестируемость** - компоненты тестируются независимо  
✅ **Совместимость** - старый код работает без изменений  

---

## 🚀 Начните прямо сейчас!

1. Выберите режим из примеров выше
2. Скопируйте код
3. Запустите

Для детальных примеров смотрите [VOICE_QUICKSTART.md](VOICE_QUICKSTART.md)

---

**Версия:** Модульная архитектура  
**Статус:** ✅ Production Ready  
**Лицензия:** MIT  

