# Voice Assistant - Быстрый старт 🚀

## ✨ Новая модульная архитектура!

Теперь вы можете использовать **любые комбинации** компонентов:
- 🎤 **STT** (распознавание речи)
- 🤖 **AI** (обработка команд)
- 🔊 **TTS** (синтез речи)

---

## 🎯 Выберите свой вариант

### 1. Полный голосовой ассистент

```typescript
import Voice from './lib/voice';

const voice = new Voice({
    enableTranscription: true,
    enableTTS: true,
});

await voice.initialize();
await voice.startListening();
```

**Что получаем:**
- ✅ Говорите ключевое слово "алиса"
- ✅ Произносите команду
- ✅ AI обрабатывает и озвучивает ответ

---

### 2. Текст → Голос (без микрофона)

```typescript
const voice = new Voice({
    enableTranscription: false,
    enableTTS: true,
});

await voice.initializeAI();
await voice.initializeTTS();

// Вводите команды в консоли
await voice.ask("Привет! Как дела?");
```

**Что получаем:**
- ✅ Пишете команды в консоль
- ✅ AI обрабатывает
- ✅ Ответ озвучивается

---

### 3. Голос → Текст (без TTS)

```typescript
const voice = new Voice({
    enableTranscription: true,
    enableTTS: false,
});

await voice.initializeSTT();
await voice.initializeAI();
await voice.startListening();
```

**Что получаем:**
- ✅ Говорите команды голосом
- ✅ AI обрабатывает
- ✅ Ответы в консоли

---

### 4. Только распознавание речи

```typescript
const voice = new Voice({
    enableTranscription: true,
    enableTTS: false,
});

await voice.initializeSTT();

await voice.startListeningRaw((text) => {
    console.log("Распознано:", text);
    // Ваша обработка
});
```

**Что получаем:**
- ✅ Чистое распознавание речи
- ✅ Без AI обработки
- ✅ Полный контроль над результатом

---

### 5. Только озвучивание

```typescript
const voice = new Voice({
    enableTranscription: false,
    enableTTS: true,
});

await voice.initializeTTS();

await voice.speak("Привет!");
await voice.speak("Как дела?");
```

**Что получаем:**
- ✅ Простое озвучивание текста
- ✅ Без STT и AI

---

### 6. Только AI (текстовый бот)

```typescript
const voice = new Voice({
    enableTranscription: false,
    enableTTS: false,
});

await voice.initializeAI();

await voice.ask("Что такое JavaScript?");
// Ответ в консоли
```

**Что получаем:**
- ✅ Чистый текстовый AI
- ✅ Без голосовых функций

---

## 🎮 Запуск встроенных примеров

```bash
# Запуск с примером по умолчанию
npx tsx lib/voice.ts
```

В файле `lib/voice.ts` есть 4 готовых примера:
- `runFullVoiceAssistant()` - полный режим (по умолчанию)
- `runConsoleWithTTS()` - текст → голос
- `runVoiceWithConsoleOutput()` - голос → текст
- `runSTTOnly()` - только распознавание

Раскомментируйте нужный в конце файла!

---

## 📊 Таблица возможностей

| Режим | Микрофон | AI | Голос | Когда использовать |
|-------|----------|-------|-------|-------------------|
| **Полный** | ✅ | ✅ | ✅ | Полноценный ассистент |
| **Консоль→Голос** | ❌ | ✅ | ✅ | Нет микрофона |
| **Голос→Консоль** | ✅ | ✅ | ❌ | Нет TTS |
| **Raw STT** | ✅ | ❌ | ❌ | Только распознавание |
| **Только AI** | ❌ | ✅ | ❌ | Текстовый бот |
| **Только TTS** | ❌ | ❌ | ✅ | Озвучивание |

---

## 🔧 Настройки

```typescript
const voice = new Voice({
    // Основные компоненты
    enableTranscription: true,  // Включить STT
    enableTTS: false,            // Включить TTS
    
    // Настройки поведения
    name: 'джарвис',            // Ключевое слово
    silenceThreshold: 3000,     // Тишина = конец команды (мс)
    
    // AI настройки
    apikey: 'your-key',         // API ключ
    model: 'model-name',        // Модель AI
    
    // Кастомные движки (опционально)
    transcriber: mySTT,         // Ваш STT
    tts: myTTS,                 // Ваш TTS
    aiProvider: myAI,           // Ваш AI
});
```

---

## 📚 Подробная документация

- `VOICE_USAGE_EXAMPLES.md` - Подробные примеры всех режимов
- `VOICE_REFACTORING_SUMMARY.md` - Что изменилось в архитектуре
- `lib/voice.ts` - Исходный код с примерами

---

## 💡 Частые вопросы

### Как использовать только AI без голоса?

```typescript
const voice = new Voice({
    enableTranscription: false,
    enableTTS: false,
});
await voice.initializeAI();
await voice.ask("ваш вопрос");
```

### Как получить raw текст от STT?

```typescript
await voice.initializeSTT();
await voice.startListeningRaw((text) => {
    // Обрабатывайте текст как хотите
});
```

### Можно ли использовать свой TTS/STT?

Да! Реализуйте интерфейсы `ITranscriber` или `ITextToSpeech` и передайте в конструктор:

```typescript
const voice = new Voice({
    transcriber: new MyCustomSTT(),
    tts: new MyCustomTTS(),
});
```

### Как остановить прослушивание?

```typescript
await voice.stopListening();
```

### Как освободить ресурсы?

```typescript
await voice.destroy();
```

---

## 🎉 Готово!

Выберите нужный режим и начинайте использовать! 

Для детальных примеров смотрите `VOICE_USAGE_EXAMPLES.md`

