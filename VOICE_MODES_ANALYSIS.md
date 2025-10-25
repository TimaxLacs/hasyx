# Анализ: Режимы vs Композиция методов

## 🤔 Вопрос: Нужны ли режимы?

### Вариант 1: С режимами (из плана)
```typescript
// Режим определяет что будет работать
const assistant = await VoiceAssistant.create({
    mode: 'text-only'  // ❌ Ограничивает возможности
});
```

**Проблемы:**
- ❌ Пользователь должен заранее знать что ему нужно
- ❌ Нельзя гибко комбинировать
- ❌ Дополнительная абстракция без реальной пользы
- ❌ Сложнее код (нужна логика переключения режимов)

---

### Вариант 2: Без режимов - композиция методов ✅

```typescript
// Создаем ассистента с нужными компонентами
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' },
    stt: { model: 'whisper' },      // Опционально
    tts: { voice: 'ru-RU' }         // Опционально
});

// Пользователь сам решает что вызывать
```

#### Сценарий 1: Только AI (текст -> текст)
```typescript
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' }
    // Не передаем stt и tts
});

// Просто вызываем ask
const response = await assistant.ask('Привет');
console.log(response);
```

#### Сценарий 2: AI + TTS (текст -> голос)
```typescript
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' },
    tts: { voice: 'ru-RU' }
});

// Вызываем ask, потом speak
const response = await assistant.ask('Привет');
await assistant.speak(response);

// Или в одну строку
await assistant.askAndSpeak('Привет');
```

#### Сценарий 3: STT + AI (голос -> текст)
```typescript
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' },
    stt: { model: 'whisper' }
});

// Слушаем и обрабатываем
assistant.on('transcription', async (text) => {
    const response = await assistant.ask(text);
    console.log('AI ответил:', response);
});

await assistant.startListening();
```

#### Сценарий 4: Полный (голос -> голос)
```typescript
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' },
    stt: { model: 'whisper' },
    tts: { voice: 'ru-RU' }
});

// Автоматический цикл
assistant.on('transcription', async (text) => {
    const response = await assistant.ask(text);
    await assistant.speak(response);
});

await assistant.startListening();

// Или встроенный хелпер
await assistant.startVoiceLoop(); // Делает все автоматически
```

#### Сценарий 5: Кастомная логика
```typescript
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' },
    stt: { model: 'whisper' },
    tts: { voice: 'ru-RU' }
});

// Пользователь полностью контролирует поток
assistant.on('transcription', async (text) => {
    // Своя логика фильтрации
    if (text.includes('алиса')) {
        const command = text.replace('алиса', '').trim();
        
        // Своя логика обработки
        if (command.includes('тихо')) {
            const response = await assistant.ask(command);
            console.log(response); // Не озвучиваем
        } else {
            const response = await assistant.ask(command);
            await assistant.speak(response); // Озвучиваем
        }
    }
});

await assistant.startListening();
```

**Преимущества:**
- ✅ Максимальная гибкость
- ✅ Пользователь сам решает что и когда вызывать
- ✅ Можно комбинировать как угодно
- ✅ Меньше кода в библиотеке
- ✅ Проще понять что происходит
- ✅ Легче тестировать

---

## 💡 Правильная архитектура

### Принцип: "Предоставь инструменты, а не режимы"

```typescript
class VoiceAssistant {
    // Базовые методы - всегда доступны
    async ask(text: string): Promise<string>
    
    // Опциональные методы - доступны если компонент настроен
    async startListening(): Promise<void>  // Если есть STT
    async stopListening(): Promise<void>   // Если есть STT
    async speak(text: string): Promise<void>  // Если есть TTS
    async stopSpeaking(): Promise<void>    // Если есть TTS
    
    // Хелперы для удобства
    async askAndSpeak(text: string): Promise<string>  // Если есть TTS
    async startVoiceLoop(): Promise<void>  // Если есть STT + TTS
    
    // События
    on('transcription', (text: string) => void)
    on('response', (text: string) => void)
    on('speaking', (text: string) => void)
    on('error', (error: Error) => void)
}
```

### Валидация на уровне методов

```typescript
class VoiceAssistant {
    async startListening(): Promise<void> {
        if (!this.stt) {
            throw new Error(
                'STT module not configured. ' +
                'Add stt config when creating assistant: ' +
                'VoiceAssistant.create({ stt: { model: "whisper" } })'
            );
        }
        
        await this.orchestrator.startListening();
    }
    
    async speak(text: string): Promise<void> {
        if (!this.tts) {
            throw new Error(
                'TTS module not configured. ' +
                'Add tts config when creating assistant: ' +
                'VoiceAssistant.create({ tts: { voice: "ru-RU" } })'
            );
        }
        
        await this.orchestrator.speak(text);
    }
}
```

**Преимущества:**
- ✅ Явные ошибки с подсказками
- ✅ Пользователь сразу понимает что не так
- ✅ Нет скрытой магии
- ✅ TypeScript может помочь с типами

---

## 🎯 Улучшенная конфигурация

### Минималистичная конфигурация

```typescript
interface VoiceAssistantConfig {
    // Обязательно - AI всегда нужен
    ai: AIConfig | AIModule;
    
    // Опционально - добавляем только если нужно
    stt?: STTConfig | STTModule;
    tts?: TTSConfig | TTSModule;
    
    // Дополнительные настройки
    devices?: {
        input?: string;
        output?: string;
    };
    keyword?: string;  // Для автоматической активации
    systemPrompt?: string;
}
```

### Примеры использования

#### Минимальный (только AI)
```typescript
const assistant = await VoiceAssistant.create({
    ai: {}  // Дефолтная модель и ключ из env
});

const response = await assistant.ask('Привет');
```

#### С одним компонентом
```typescript
const assistant = await VoiceAssistant.create({
    ai: {},
    tts: {}  // Добавили TTS
});

const response = await assistant.ask('Привет');
await assistant.speak(response);  // Теперь можем озвучить
```

#### Полная конфигурация
```typescript
const assistant = await VoiceAssistant.create({
    ai: {
        model: 'deepseek/deepseek-chat-v3-0324:free',
        apiKey: process.env.OPENROUTER_API_KEY
    },
    stt: {
        model: 'base',
        language: 'ru'
    },
    tts: {
        voice: 'ru-RU-female'
    },
    devices: {
        input: 'USB Microphone',
        output: 'Bluetooth Speaker'
    },
    keyword: 'алиса'
});
```

---

## 🔄 Сравнение подходов

### С режимами (❌ Отказываемся)

```typescript
// Жестко заданный режим
const assistant = await VoiceAssistant.create({
    mode: 'text-to-speech'  // ❌ Ограничивает
});

// Нельзя просто получить текст без озвучки
const response = await assistant.ask('Привет');
// Автоматически озвучивается - нет контроля!
```

**Проблемы:**
- Нет гибкости
- Нельзя изменить поведение на лету
- Сложная логика в библиотеке
- Больше кода для поддержки

---

### Без режимов (✅ Принимаем)

```typescript
// Гибкая конфигурация компонентов
const assistant = await VoiceAssistant.create({
    ai: {},
    tts: {}  // Просто добавили TTS
});

// Полный контроль
const response = await assistant.ask('Привет');

// Решаем сами - озвучивать или нет
if (shouldSpeak) {
    await assistant.speak(response);
} else {
    console.log(response);
}
```

**Преимущества:**
- Полный контроль
- Можно менять поведение
- Меньше кода в библиотеке
- Проще понять

---

## 📊 Итоговое решение

### ✅ Что делаем:

1. **Убираем режимы полностью**
   - Нет `mode: 'text-only' | 'text-to-speech' | ...`
   - Нет логики переключения режимов

2. **Делаем методы независимыми**
   - `ask()` - всегда доступен
   - `speak()` - доступен если есть TTS
   - `startListening()` - доступен если есть STT

3. **Добавляем хелперы для удобства**
   - `askAndSpeak()` - для частого случая
   - `startVoiceLoop()` - для автоматического режима

4. **Валидация на уровне методов**
   - Явные ошибки с подсказками
   - Нет молчаливых отказов

### 🎯 Итоговый API

```typescript
// Создание
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/...' },
    stt?: { model: 'whisper' },  // Опционально
    tts?: { voice: 'ru-RU' }     // Опционально
});

// Базовые методы
await assistant.ask(text)           // Promise<string>
await assistant.speak(text)         // Promise<void> - если есть TTS
await assistant.startListening()    // Promise<void> - если есть STT
await assistant.stopListening()     // Promise<void>
await assistant.stopSpeaking()      // Promise<void>

// Хелперы
await assistant.askAndSpeak(text)   // Promise<string> - если есть TTS
await assistant.startVoiceLoop()    // Promise<void> - если есть STT+TTS

// События
assistant.on('transcription', (text) => {})
assistant.on('response', (text) => {})
assistant.on('speaking', (text) => {})
assistant.on('error', (error) => {})

// Очистка
await assistant.destroy()
```

### 📝 Примеры композиции

```typescript
// 1. Текст -> Текст
const r = await assistant.ask('Привет');

// 2. Текст -> Голос
const r = await assistant.ask('Привет');
await assistant.speak(r);
// или
await assistant.askAndSpeak('Привет');

// 3. Голос -> Текст
assistant.on('transcription', async (text) => {
    const r = await assistant.ask(text);
    console.log(r);
});
await assistant.startListening();

// 4. Голос -> Голос (автоматически)
await assistant.startVoiceLoop();

// 5. Голос -> Голос (с контролем)
assistant.on('transcription', async (text) => {
    const r = await assistant.ask(text);
    await assistant.speak(r);
});
await assistant.startListening();

// 6. Кастомная логика
assistant.on('transcription', async (text) => {
    if (text.includes('тихо')) {
        const r = await assistant.ask(text);
        console.log(r); // Не озвучиваем
    } else {
        await assistant.askAndSpeak(text);
    }
});
await assistant.startListening();
```

---

## ✨ Вывод

**Режимы - это лишняя абстракция!**

Вместо этого:
- ✅ Предоставляем независимые методы
- ✅ Пользователь сам комбинирует как нужно
- ✅ Добавляем хелперы для частых случаев
- ✅ Валидация на уровне методов с понятными ошибками

**Результат:**
- Меньше кода в библиотеке
- Больше гибкости для пользователя
- Проще понять и использовать
- Легче тестировать

---

**Решение: Убираем режимы из плана, оставляем композицию методов** ✅
