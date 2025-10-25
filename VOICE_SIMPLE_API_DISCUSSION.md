# Voice API - Обсуждение максимально простого API

## 🎯 Цель: Один вызов = рабочий ассистент

---

## 💡 Твоя идея

> "Я бы хотел, чтобы юзер мог одним вызовом класса пользоваться уже базовым войсом"

**Это значит:**
```typescript
// Просто создал и сразу работает
const voice = new Voice();
await voice.ask('Привет');
```

---

## 🤔 Варианты реализации

### Вариант 1: Синхронный конструктор + ленивая инициализация

```typescript
// Создание мгновенное
const voice = new Voice();

// Инициализация происходит автоматически при первом вызове
await voice.ask('Привет');  // Внутри сам инициализируется
```

**Преимущества:**
- ✅ Самый простой API
- ✅ Не нужно думать об инициализации
- ✅ Работает из коробки

**Недостатки:**
- ⚠️ Первый вызов будет медленным (инициализация)
- ⚠️ Непредсказуемая задержка
- ⚠️ Сложнее обрабатывать ошибки инициализации

---

### Вариант 2: Async конструктор через статический метод

```typescript
// Один вызов, но async
const voice = await Voice.create();

// Сразу работает
await voice.ask('Привет');
```

**Преимущества:**
- ✅ Простой API
- ✅ Предсказуемая инициализация
- ✅ Явные ошибки при создании
- ✅ Первый вызов быстрый

**Недостатки:**
- ⚠️ Нужно помнить про `await` при создании

---

### Вариант 3: Синхронный конструктор + явная инициализация

```typescript
// Создание
const voice = new Voice();

// Инициализация (один раз)
await voice.initialize();

// Работа
await voice.ask('Привет');
```

**Преимущества:**
- ✅ Явный контроль над инициализацией
- ✅ Предсказуемая производительность

**Недостатки:**
- ❌ Два вызова вместо одного
- ❌ Пользователь может забыть про initialize()

---

## 🎨 Рекомендация: Гибридный подход

### Идея: Лучшее из обоих миров

```typescript
class Voice {
    private initialized: boolean = false;
    
    constructor(options?: VoiceOptions) {
        // Синхронная настройка
        this.options = { ...defaults, ...options };
    }
    
    /**
     * Автоматическая инициализация при первом использовании
     */
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        
        // Инициализация компонентов
        await this.initializeComponents();
        this.initialized = true;
    }
    
    /**
     * Отправить запрос AI
     */
    async ask(text: string): Promise<string> {
        await this.ensureInitialized();  // Автоматически инициализируется
        return await this.dialog.ask(text);
    }
    
    /**
     * Запустить прослушивание
     */
    async startListening(): Promise<void> {
        await this.ensureInitialized();  // Автоматически инициализируется
        await this.transcriber.start(...);
    }
    
    /**
     * Озвучить текст
     */
    async speak(text: string): Promise<void> {
        await this.ensureInitialized();  // Автоматически инициализируется
        await this.tts.speak(text);
    }
}
```

### Использование:

```typescript
// Вариант 1: Минималистичный (один вызов)
const voice = new Voice();
await voice.ask('Привет');  // Сам инициализируется

// Вариант 2: С настройками
const voice = new Voice({
    model: 'gpt-4o-mini',
    apiKey: 'my-key'
});
await voice.ask('Привет');

// Вариант 3: Явная инициализация (опционально)
const voice = new Voice();
await voice.initialize();  // Можно вызвать явно, если нужно
await voice.ask('Привет');  // Уже инициализирован
```

**Преимущества:**
- ✅ Один вызов для создания
- ✅ Автоматическая инициализация
- ✅ Можно явно инициализировать, если нужно
- ✅ Предсказуемая производительность (инициализация один раз)
- ✅ Явные ошибки при инициализации

---

## 📝 Примеры использования

### Пример 1: Самый простой случай

```typescript
const voice = new Voice();
const response = await voice.ask('Привет');
console.log(response);
```

**2 строки кода!**

---

### Пример 2: С настройками

```typescript
const voice = new Voice({
    model: 'deepseek/deepseek-chat-v3-0324:free',
    apiKey: process.env.OPENROUTER_API_KEY
});

const response = await voice.ask('Как дела?');
console.log(response);
```

---

### Пример 3: Полный голосовой ассистент

```typescript
const voice = new Voice();

// Подписываемся на события
voice.on('transcription', (text) => {
    console.log('Услышал:', text);
});

voice.on('response', (text) => {
    console.log('AI ответил:', text);
});

// Запускаем прослушивание
await voice.startListening();
```

---

### Пример 4: Композиция методов

```typescript
const voice = new Voice();

// Текст -> AI -> Текст
const response = await voice.ask('Привет');

// Текст -> AI -> Голос
const response = await voice.ask('Привет');
await voice.speak(response);

// Голос -> AI -> Текст
voice.on('transcription', async (text) => {
    const response = await voice.ask(text);
    console.log(response);
});
await voice.startListening();

// Голос -> AI -> Голос (автоматический цикл)
voice.on('transcription', async (text) => {
    const response = await voice.ask(text);
    await voice.speak(response);
});
await voice.startListening();
```

---

## 🔧 Конфигурация

### Минимальная (работает из коробки)

```typescript
const voice = new Voice();
```

**Дефолты:**
- AI: OpenRouter + DeepSeek (из env)
- STT: Whisper tiny (если вызван startListening)
- TTS: Zonos (если вызван speak)
- Устройства: Автоматический выбор лучших

---

### Частичная (переопределяем только нужное)

```typescript
const voice = new Voice({
    model: 'gpt-4o-mini',
    whisperModel: 'base',  // Вместо tiny
    ttsVoice: 'ru-RU-female'
});
```

---

### Полная (полный контроль)

```typescript
const voice = new Voice({
    // AI
    model: 'deepseek/deepseek-chat-v3-0324:free',
    apiKey: process.env.OPENROUTER_API_KEY,
    systemPrompt: 'Ты - помощник программиста',
    
    // STT
    whisperModel: 'base',
    whisperLanguage: 'ru',
    
    // TTS
    ttsVoice: 'ru-RU-female',
    
    // Устройства
    inputDevice: 'USB Microphone',
    outputDevice: 'Bluetooth Speaker',
    
    // Поведение
    keyword: 'алиса',
    silenceThreshold: 500
});
```

---

### Кастомные компоненты (для продвинутых)

```typescript
const voice = new Voice({
    // Кастомный AI
    ai: new MyCustomAI(),
    
    // Кастомный STT
    transcriber: new MyCustomSTT(),
    
    // Кастомный TTS
    tts: new MyCustomTTS()
});
```

---

## 🎯 Итоговый API

### Класс Voice

```typescript
class Voice extends EventEmitter {
    constructor(options?: VoiceOptions)
    
    // Основные методы
    async ask(text: string): Promise<string>
    async speak(text: string): Promise<void>
    async startListening(): Promise<void>
    async stopListening(): Promise<void>
    async stopSpeaking(): Promise<void>
    
    // Опциональная явная инициализация
    async initialize(): Promise<void>
    
    // Очистка
    async destroy(): Promise<void>
    
    // События
    on('transcription', (text: string) => void)
    on('response', (text: string) => void)
    on('speaking', (text: string) => void)
    on('error', (error: Error) => void)
}
```

### Интерфейс VoiceOptions

```typescript
interface VoiceOptions {
    // AI (обязательно, но с дефолтами)
    model?: string;
    apiKey?: string;
    systemPrompt?: string;
    
    // STT (опционально, создается при первом startListening)
    whisperModel?: 'tiny' | 'base' | 'small' | 'medium';
    whisperLanguage?: string;
    
    // TTS (опционально, создается при первом speak)
    ttsVoice?: string;
    
    // Устройства (опционально, автовыбор)
    inputDevice?: string;
    outputDevice?: string;
    
    // Поведение
    keyword?: string;
    silenceThreshold?: number;
    
    // Кастомные компоненты (для продвинутых)
    ai?: AIModule;
    transcriber?: STTModule;
    tts?: TTSModule;
}
```

---

## ✨ Ключевые принципы

### 1. Работает из коробки
```typescript
const voice = new Voice();
await voice.ask('Привет');  // Просто работает
```

### 2. Ленивая инициализация компонентов
- AI инициализируется при первом `ask()`
- STT инициализируется при первом `startListening()`
- TTS инициализируется при первом `speak()`

### 3. Композиция методов
- Пользователь сам решает что вызывать
- Нет жестких режимов
- Максимальная гибкость

### 4. Умные дефолты
- API ключ из env
- Лучшая бесплатная модель
- Автовыбор устройств
- Оптимальные настройки

### 5. Постепенное усложнение
- Новичок: `new Voice()` и готово
- Средний: Переопределяет нужные опции
- Продвинутый: Передает кастомные компоненты

---

## 🤔 Вопросы к тебе

### 1. Нравится ли такой подход?
```typescript
const voice = new Voice();  // Один вызов
await voice.ask('Привет');  // Сразу работает
```

### 2. Нужна ли явная инициализация?
```typescript
// Вариант A: Автоматическая (рекомендую)
const voice = new Voice();
await voice.ask('Привет');  // Сам инициализируется

// Вариант B: Явная (опционально)
const voice = new Voice();
await voice.initialize();  // Можно вызвать явно
await voice.ask('Привет');
```

### 3. Как насчет конфигурации?
```typescript
// Вариант A: Плоский объект (проще)
const voice = new Voice({
    model: 'gpt-4',
    whisperModel: 'base',
    ttsVoice: 'ru-RU'
});

// Вариант B: Вложенный объект (структурированнее)
const voice = new Voice({
    ai: { model: 'gpt-4' },
    stt: { model: 'base' },
    tts: { voice: 'ru-RU' }
});
```

### 4. Нужны ли хелперы?
```typescript
// Хелпер для частого случая
await voice.askAndSpeak('Привет');  // ask + speak в одном

// Хелпер для автоматического цикла
await voice.startVoiceLoop();  // Автоматически: слушать -> спросить -> озвучить
```

---

## 📊 Сравнение подходов

| Подход | Простота | Гибкость | Предсказуемость |
|--------|----------|----------|-----------------|
| `new Voice()` + auto-init | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| `await Voice.create()` | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| `new Voice()` + `initialize()` | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**Рекомендация:** `new Voice()` + автоматическая инициализация

---

## 🎯 Итоговое решение

### Что я предлагаю:

```typescript
// 1. Создание - синхронное, мгновенное
const voice = new Voice(options?);

// 2. Использование - автоматическая инициализация при первом вызове
await voice.ask('Привет');
await voice.speak('Привет');
await voice.startListening();

// 3. Опциональная явная инициализация
await voice.initialize();  // Если нужен контроль

// 4. Композиция методов
const response = await voice.ask('Привет');
await voice.speak(response);

// 5. События для сложных случаев
voice.on('transcription', async (text) => {
    const response = await voice.ask(text);
    await voice.speak(response);
});
```

**Это дает:**
- ✅ Один вызов для создания
- ✅ Работает из коробки
- ✅ Автоматическая инициализация
- ✅ Композиция методов
- ✅ Максимальная гибкость

---

**Что скажешь? Нравится такой подход?**

