# Voice API - Документация по использованию

Полное руководство по интеграции голосового ассистента в ваши проекты.

---

## 📋 Содержание

1. [Быстрый старт](#быстрый-старт)
2. [Базовая конфигурация](#базовая-конфигурация)
3. [Сценарии использования](#сценарии-использования)
4. [Кастомные компоненты](#кастомные-компоненты)
5. [Управление устройствами](#управление-устройствами)
6. [API Reference](#api-reference)

---

## 🚀 Быстрый старт

### Установка

```bash
npm install
```

### Минимальный пример

```typescript
import Voice from './lib/voice.js';

const voice = new Voice({
    name: 'Мой Ассистент',
    apikey: process.env.OPENROUTER_API_KEY
});

await voice.initialize();
await voice.ask("Привет! Как дела?");
await voice.destroy();
```

---

## ⚙️ Базовая конфигурация

### Интерфейс VoiceOptions

```typescript
interface VoiceOptions {
    // AI настройки
    apikey?: string;                    // API ключ для OpenRouter
    model?: string;                     // Модель AI (по умолчанию: deepseek/deepseek-chat-v3-0324:free)
    system_prompt?: string;             // Кастомный системный промпт
    name?: string;                      // Имя ассистента (для активации голосом)
    
    // Компоненты (опционально)
    transcriber?: ITranscriber;         // Кастомный STT движок
    tts?: ITextToSpeech;               // Кастомный TTS движок
    aiProvider?: AIProvider;            // Кастомный AI провайдер
    
    // Флаги включения/выключения
    enableTranscription?: boolean;      // Включить STT (по умолчанию: true)
    enableTTS?: boolean;                // Включить TTS (по умолчанию: true)
    useAnnouncerAI?: boolean;          // Использовать AI-диктора (по умолчанию: false)
    
    // Дополнительно
    silenceThreshold?: number;          // Порог тишины в мс
}
```

---

## 🎯 Сценарии использования

### 1. Только AI с озвучкой (без распознавания речи)

Используйте когда нужно только отправлять текстовые команды и получать голосовые ответы.

```typescript
import Voice from './lib/voice.js';

async function textToSpeechAssistant() {
    const voice = new Voice({
        name: 'Голосовой помощник',
        apikey: process.env.OPENROUTER_API_KEY,
        model: 'deepseek/deepseek-chat-v3-0324:free',
        enableTranscription: false,  // ❌ Отключаем распознавание речи
        enableTTS: true,              // ✅ Включаем озвучку
    });

    await voice.initialize();

    // Отправляем текстовые команды
    await voice.ask("Расскажи анекдот");
    await voice.ask("Какая сегодня погода?");
    
    await voice.destroy();
}
```

**Когда использовать:**
- Чат-боты с голосовым выводом
- Текстовые интерфейсы с озвучкой
- Accessibility приложения

---

### 2. Только транскрибатор + AI (без озвучки)

Используйте когда нужно распознавать речь и получать текстовые ответы.

```typescript
import Voice from './lib/voice.js';

async function speechToTextAssistant() {
    const voice = new Voice({
        name: 'Текстовый помощник',
        apikey: process.env.OPENROUTER_API_KEY,
        model: 'deepseek/deepseek-chat-v3-0324:free',
        enableTranscription: true,    // ✅ Включаем распознавание речи
        enableTTS: false,              // ❌ Отключаем озвучку
    });

    await voice.initialize();

    // Запускаем прослушивание
    // Ассистент будет ждать ключевое слово (по умолчанию "алиса")
    await voice.startListening();

    // Голосовые команды будут распознаваться и обрабатываться
    // Ответы будут выводиться в консоль/логи
    
    // Программа будет работать до остановки
    // Для остановки: Ctrl+C или voice.destroy()
}
```

**Когда использовать:**
- Голосовые команды для систем
- Диктовка текста
- Голосовое управление без обратной связи

---

### 3. Полное решение (STT + AI + TTS)

Полноценный голосовой ассистент с распознаванием речи и озвучкой ответов.

```typescript
import Voice from './lib/voice.js';

async function fullVoiceAssistant() {
    const voice = new Voice({
        name: 'Алиса',                    // Ключевое слово для активации
        apikey: process.env.OPENROUTER_API_KEY,
        model: 'deepseek/deepseek-chat-v3-0324:free',
        enableTranscription: true,        // ✅ Распознавание речи
        enableTTS: true,                  // ✅ Озвучка ответов
        useAnnouncerAI: false,           // Опционально: краткие ответы
    });

    await voice.initialize();
    
    console.log('🎤 Скажите "Алиса" для активации...');
    await voice.startListening();

    // Ассистент работает в фоне:
    // 1. Слушает ключевое слово "Алиса"
    // 2. После активации записывает команду
    // 3. Отправляет в AI
    // 4. Озвучивает ответ
    
    // Для остановки используйте Ctrl+C
}
```

**Когда использовать:**
- Умные колонки
- Голосовые помощники
- Hands-free приложения

---

### 4. Только AI (без STT и TTS)

Используйте для тестирования или интеграции только AI логики.

```typescript
import Voice from './lib/voice.js';

async function aiOnlyAssistant() {
    const voice = new Voice({
        name: 'AI Помощник',
        apikey: process.env.OPENROUTER_API_KEY,
        model: 'deepseek/deepseek-chat-v3-0324:free',
        enableTranscription: false,   // ❌ Без STT
        enableTTS: false,              // ❌ Без TTS
    });

    await voice.initialize();

    // Просто отправляем команды и получаем ответы
    await voice.ask("Напиши функцию сортировки массива на TypeScript");
    await voice.ask("Объясни что такое замыкания");
    
    await voice.destroy();
}
```

**Когда использовать:**
- Тестирование AI логики
- Интеграция в существующие системы
- Разработка и отладка

---

## 🔧 Кастомные компоненты

### Кастомный STT (Speech-to-Text)

Создайте свой движок распознавания речи, реализовав интерфейс `ITranscriber`.

```typescript
import { ITranscriber } from './lib/voice.js';

class MyCustomSTT implements ITranscriber {
    async initialize(): Promise<void> {
        // Инициализация вашего STT движка
        console.log('Инициализация кастомного STT...');
    }

    async start(onResult: (text: string) => void): Promise<void> {
        // Запуск распознавания речи
        // Когда распознан текст, вызывайте onResult(text)
        
        // Пример:
        setInterval(() => {
            const recognizedText = "Распознанный текст";
            onResult(recognizedText);
        }, 5000);
    }

    async stop(): Promise<void> {
        // Остановка распознавания
        console.log('Остановка STT...');
    }

    async destroy(): Promise<void> {
        // Освобождение ресурсов
        console.log('Уничтожение STT...');
    }
}

// Использование
const voice = new Voice({
    name: 'Ассистент',
    transcriber: new MyCustomSTT(),  // 👈 Ваш STT
    enableTranscription: true,
    enableTTS: false,
});
```

**Примеры STT движков:**
- Google Speech-to-Text API
- Azure Speech Services
- Whisper (локально)
- Vosk (локально)
- Web Speech API (браузер)

---

### Кастомный TTS (Text-to-Speech)

Создайте свой движок синтеза речи, реализовав интерфейс `ITextToSpeech`.

```typescript
import { ITextToSpeech } from './lib/voice.js';

class MyCustomTTS implements ITextToSpeech {
    async initialize(): Promise<void> {
        // Инициализация вашего TTS движка
        console.log('Инициализация кастомного TTS...');
    }

    async speak(text: string): Promise<void> {
        // Синтез и воспроизведение речи
        console.log(`Озвучиваю: "${text}"`);
        
        // Здесь ваша логика TTS
        // Например, вызов API или локального движка
    }

    async stop(): Promise<void> {
        // Прерывание текущего воспроизведения
        console.log('Остановка TTS...');
    }

    async destroy(): Promise<void> {
        // Освобождение ресурсов
        console.log('Уничтожение TTS...');
    }
}

// Использование
const voice = new Voice({
    name: 'Ассистент',
    tts: new MyCustomTTS(),  // 👈 Ваш TTS
    enableTranscription: false,
    enableTTS: true,
});
```

**Примеры TTS движков:**
- Google Text-to-Speech API
- Azure Speech Services
- ElevenLabs
- Zonos (локально)
- Web Speech API (браузер)

---

### Кастомный AI провайдер

Используйте свою модель или API, реализовав интерфейс `AIProvider`.

```typescript
import { AIProvider, AIMessage } from './lib/ai/ai.js';

class MyCustomAI implements AIProvider {
    async query(messages: AIMessage[]): Promise<AIMessage> {
        // Отправка запроса к вашей AI модели
        const lastMessage = messages[messages.length - 1];
        
        // Ваша логика обработки
        const response = await fetch('https://my-ai-api.com/chat', {
            method: 'POST',
            body: JSON.stringify({ message: lastMessage.content })
        });
        
        const data = await response.json();
        
        return {
            role: 'assistant',
            content: data.response
        };
    }

    async stream(messages: AIMessage[]): Promise<ReadableStream<string>> {
        // Реализация стриминга (опционально)
        const response = await this.query(messages);
        return new ReadableStream({
            start(controller) {
                controller.enqueue(response.content);
                controller.close();
            }
        });
    }
}

// Использование
const voice = new Voice({
    name: 'Ассистент',
    aiProvider: new MyCustomAI(),  // 👈 Ваш AI
    enableTranscription: false,
    enableTTS: false,
});
```

**Примеры AI провайдеров:**
- OpenAI API
- Anthropic Claude
- Google Gemini
- Ollama (локально)
- LM Studio (локально)

---

## 🎛️ Управление устройствами

### Выбор устройства ввода (микрофон)

```typescript
import Voice from './lib/voice.js';
import { AudioDeviceManager } from './lib/voice-device.js';

async function selectInputDevice() {
    // Создаем менеджер устройств
    const deviceManager = new AudioDeviceManager();
    await deviceManager.initialize();

    // Получаем список доступных устройств ввода
    const inputDevices = deviceManager.listInputDevices();
    
    console.log('Доступные микрофоны:');
    inputDevices.forEach((device, index) => {
        console.log(`${index + 1}. ${device.name} (ID: ${device.id})`);
    });

    // Выбираем устройство (например, второе в списке)
    const selectedDevice = inputDevices[1];

    // Создаем Voice с выбранным устройством
    const voice = new Voice({
        name: 'Ассистент',
        // Здесь можно передать кастомный транскрибатор
        // который будет использовать selectedDevice
    });

    await voice.initialize();
    await voice.startListening();
}
```

### Выбор устройства вывода (динамики)

```typescript
import { AudioDeviceManager } from './lib/voice-device.js';

async function selectOutputDevice() {
    const deviceManager = new AudioDeviceManager();
    await deviceManager.initialize();

    // Получаем список доступных устройств вывода
    const outputDevices = deviceManager.listOutputDevices();
    
    console.log('Доступные динамики:');
    outputDevices.forEach((device, index) => {
        console.log(`${index + 1}. ${device.name} (ID: ${device.id})`);
    });

    // Выбираем устройство для вывода
    const selectedDevice = outputDevices[0];

    // Используйте selectedDevice в вашем кастомном TTS
}
```

### Автоматический выбор лучших устройств

```typescript
import { AudioDeviceManager } from './lib/voice-device.js';

async function autoSelectDevices() {
    const deviceManager = new AudioDeviceManager();
    await deviceManager.initialize();

    // Автоматически выбирает лучшее устройство ввода
    const bestInput = await deviceManager.getBestInputDevice();
    console.log(`Лучший микрофон: ${bestInput?.name}`);

    // Автоматически выбирает лучшее устройство вывода
    const bestOutput = await deviceManager.getBestOutputDevice();
    console.log(`Лучшие динамики: ${bestOutput?.name}`);
}
```

---

## 📚 API Reference

### Класс Voice

#### Конструктор

```typescript
constructor(options: VoiceOptions)
```

#### Методы

##### `initialize(): Promise<void>`
Инициализирует все компоненты (STT, TTS, AI).

```typescript
await voice.initialize();
```

##### `startListening(): Promise<void>`
Запускает прослушивание с ключевым словом.

```typescript
await voice.startListening();
```

##### `ask(command: string): Promise<void>`
Отправляет текстовую команду в AI.

```typescript
await voice.ask("Привет!");
```

##### `destroy(): Promise<void>`
Освобождает все ресурсы.

```typescript
await voice.destroy();
```

---

### Интерфейсы

#### ITranscriber

```typescript
interface ITranscriber {
    initialize(): Promise<void>;
    start(onResult: (text: string) => void): Promise<void>;
    stop(): Promise<void>;
    destroy(): Promise<void>;
}
```

#### ITextToSpeech

```typescript
interface ITextToSpeech {
    initialize(): Promise<void>;
    speak(text: string): Promise<void>;
    stop(): Promise<void>;
    destroy(): Promise<void>;
}
```

#### AIProvider

```typescript
interface AIProvider {
    query(messages: AIMessage[]): Promise<AIMessage>;
    stream(messages: AIMessage[]): Promise<ReadableStream<string>>;
}
```

---

## 🌟 Примеры интеграции

### Интеграция в Next.js приложение

```typescript
// app/api/voice/route.ts
import Voice from '@/lib/voice';

export async function POST(request: Request) {
    const { message } = await request.json();
    
    const voice = new Voice({
        apikey: process.env.OPENROUTER_API_KEY,
        enableTranscription: false,
        enableTTS: false,
    });

    await voice.initialize();
    await voice.ask(message);
    await voice.destroy();

    return Response.json({ success: true });
}
```

### Интеграция в Electron приложение

```typescript
// main.ts
import Voice from './lib/voice';

let voice: Voice | null = null;

ipcMain.handle('voice:start', async () => {
    voice = new Voice({
        name: 'Ассистент',
        apikey: process.env.OPENROUTER_API_KEY,
    });
    
    await voice.initialize();
    await voice.startListening();
});

ipcMain.handle('voice:stop', async () => {
    if (voice) {
        await voice.destroy();
        voice = null;
    }
});
```

---

## 🔐 Переменные окружения

Создайте файл `.env` в корне проекта:

```env
# OpenRouter API ключ
OPENROUTER_API_KEY=sk-or-v1-ваш-ключ-здесь

# Опционально: другие настройки
DEFAULT_AI_MODEL=deepseek/deepseek-chat-v3-0324:free
ASSISTANT_NAME=Алиса
```

---

## 🐛 Отладка

### Включение debug логов

```typescript
const voice = new Voice({
    name: 'Ассистент',
    apikey: process.env.OPENROUTER_API_KEY,
});

// Voice автоматически выводит debug информацию в консоль
```

### Обработка ошибок

```typescript
try {
    await voice.initialize();
    await voice.ask("Тестовая команда");
} catch (error) {
    console.error('Ошибка Voice API:', error);
    // Обработка ошибки
} finally {
    await voice.destroy();
}
```

---

## 📝 Лицензия

MIT

---

## 🤝 Поддержка

Если у вас возникли вопросы или проблемы:
1. Проверьте примеры выше
2. Изучите исходный код в `lib/voice.ts`
3. Запустите тесты: `npm run voice-test`

---

**Создано для проекта Hasyx** 🚀
