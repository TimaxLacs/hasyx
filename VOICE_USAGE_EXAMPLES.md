# Примеры использования Voice Assistant

## 🎯 Модульная архитектура

Теперь вы можете использовать компоненты независимо друг от друга!

---

## 📚 Варианты использования

### 1️⃣ Полный голосовой ассистент (STT + AI + TTS)

```typescript
import Voice from './lib/voice';

const voice = new Voice({
    enableTranscription: true,
    enableTTS: true,
});

await voice.initialize();
await voice.startListening();

// Ассистент слушает ключевое слово, обрабатывает команды через AI
// и озвучивает ответы
```

---

### 2️⃣ AI + TTS (ввод через консоль, голосовой вывод)

```typescript
import Voice from './lib/voice';
import readline from 'readline';

const voice = new Voice({
    enableTranscription: false,
    enableTTS: true,
});

// Инициализируем только AI и TTS
await voice.initializeAI();
await voice.initializeTTS();

// Создаем интерфейс консоли
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on('line', async (input: string) => {
    await voice.ask(input);  // AI обрабатывает и озвучивает ответ
});
```

**Применение:**
- Текстовый интерфейс с голосовым ответом
- Тестирование TTS без микрофона
- Чат-боты с голосовым выводом

---

### 3️⃣ STT + AI (голосовой ввод, текстовый вывод)

```typescript
import Voice from './lib/voice';

const voice = new Voice({
    enableTranscription: true,
    enableTTS: false,
});

// Инициализируем только STT и AI
await voice.initializeSTT();
await voice.initializeAI();

// Слушаем команды, ответы выводятся в консоль
await voice.startListening();

// Ответы AI будут в консоли, можно перехватить через handleDialogEvent
```

**Применение:**
- Голосовой ввод для систем без TTS
- Разработка с выводом в терминал/файл
- Системы с внешним TTS

---

### 4️⃣ Только STT (raw режим)

```typescript
import Voice from './lib/voice';

const voice = new Voice({
    enableTranscription: true,
    enableTTS: false,
});

await voice.initializeSTT();

// Raw режим: получаем распознанный текст напрямую
await voice.startListeningRaw((text: string) => {
    console.log(`📝 Распознано: "${text}"`);
    
    // Ваша кастомная обработка
    if (text.includes('стоп')) {
        voice.stopListening();
    }
});
```

**Применение:**
- Кастомная обработка команд
- Интеграция с другими AI
- Распознавание без AI-обработки

---

### 5️⃣ Только AI (без голоса)

```typescript
import Voice from './lib/voice';

const voice = new Voice({
    enableTranscription: false,
    enableTTS: false,
});

await voice.initializeAI();

// Текстовый AI ассистент
await voice.ask("Какая сегодня погода?");

// Ответ придет через handleDialogEvent или можно перехватить
```

**Применение:**
- Чистый текстовый AI
- Тестирование AI без голоса
- CLI инструменты

---

### 6️⃣ Только TTS (озвучивание текста)

```typescript
import Voice from './lib/voice';

const voice = new Voice({
    enableTranscription: false,
    enableTTS: true,
});

await voice.initializeTTS();

// Просто озвучиваем текст
await voice.speak("Привет, как дела?");
await voice.speak("Это тестовое сообщение.");
```

**Применение:**
- Озвучивание уведомлений
- Голосовые подсказки
- Аудиокниги/новости

---

## 🔧 Гибкая конфигурация

### Использование кастомного AI провайдера

```typescript
import Voice from './lib/voice';
import { MyCustomAIProvider } from './my-ai';

const voice = new Voice({
    aiProvider: new MyCustomAIProvider(),
    enableTranscription: true,
    enableTTS: false,
});

await voice.initialize();
```

### Использование кастомного STT движка

```typescript
import Voice from './lib/voice';
import type { ITranscriber } from './lib/voice';

class MyCustomSTT implements ITranscriber {
    async initialize() { /* ... */ }
    async start(onResult: (text: string) => void) { /* ... */ }
    async stop() { /* ... */ }
    async destroy() { /* ... */ }
}

const voice = new Voice({
    transcriber: new MyCustomSTT(),
    enableTranscription: true,
});

await voice.initializeSTT();
```

### Использование кастомного TTS движка

```typescript
import Voice from './lib/voice';
import type { ITextToSpeech } from './lib/voice';

class MyCustomTTS implements ITextToSpeech {
    async initialize() { /* ... */ }
    async speak(text: string) { /* ... */ }
    async stop() { /* ... */ }
    async destroy() { /* ... */ }
}

const voice = new Voice({
    tts: new MyCustomTTS(),
    enableTTS: true,
});

await voice.initializeTTS();
```

---

## 🎬 Управление жизненным циклом

```typescript
const voice = new Voice({ /* ... */ });

// 1. Инициализация всех компонентов
await voice.initialize();

// ИЛИ инициализация только нужных:
await voice.initializeSTT();
await voice.initializeAI();
await voice.initializeTTS();

// 2. Работа
await voice.startListening();         // С автоматической обработкой команд
// ИЛИ
await voice.startListeningRaw(cb);   // Raw режим

// 3. Остановка
await voice.stopListening();

// 4. Очистка ресурсов
await voice.destroy();
```

---

## 📊 Сравнение режимов

| Режим | STT | AI | TTS | Применение |
|-------|-----|----|----|-----------|
| **Полный ассистент** | ✅ | ✅ | ✅ | Полноценный голосовой помощник |
| **Консоль → Голос** | ❌ | ✅ | ✅ | Текстовый ввод, голосовой ответ |
| **Голос → Консоль** | ✅ | ✅ | ❌ | Голосовой ввод, текстовый ответ |
| **Raw STT** | ✅ | ❌ | ❌ | Только распознавание речи |
| **Только AI** | ❌ | ✅ | ❌ | Текстовый AI ассистент |
| **Только TTS** | ❌ | ❌ | ✅ | Озвучивание текста |

---

## 💡 Дополнительные возможности

### Обработка событий Dialog

```typescript
import Voice from './lib/voice';
import type { DialogEvent } from './lib/ai/dialog';

class MyVoice extends Voice {
    protected async handleDialogEvent(event: DialogEvent): Promise<void> {
        // Ваша кастомная обработка
        if (event.type === 'ai_response') {
            console.log("AI ответил:", event.content);
            // Отправить в БД, файл, API и т.д.
        }
        
        // Вызываем базовую обработку
        await super.handleDialogEvent(event);
    }
}
```

### Настройка порога тишины и имени

```typescript
const voice = new Voice({
    name: 'джарвис',           // Ключевое слово для активации
    silenceThreshold: 3000,    // 3 секунды тишины = конец команды
    enableTranscription: true,
});
```

---

## 🚀 Быстрый старт

Запустите один из готовых примеров из `lib/voice.ts`:

```bash
# Полный ассистент (по умолчанию)
npx tsx lib/voice.ts

# Или отредактируйте файл и раскомментируйте нужный режим:
# runConsoleWithTTS()         // AI + TTS
# runVoiceWithConsoleOutput() // STT + AI
# runSTTOnly()                // Только STT
```

---

## 🎯 Ключевые преимущества новой архитектуры

✅ **Модульность** - используйте только нужные компоненты  
✅ **Независимость** - каждый метод делает только свою работу  
✅ **Гибкость** - легко комбинировать разные режимы  
✅ **Расширяемость** - простая интеграция кастомных движков  
✅ **Тестируемость** - компоненты тестируются отдельно  

---

Теперь вы можете создавать любые комбинации компонентов для вашего случая использования! 🎉

