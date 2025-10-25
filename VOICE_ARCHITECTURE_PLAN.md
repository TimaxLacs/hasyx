# Voice API - План архитектурных улучшений

> **Цель:** Создать интуитивный, гибкий и производительный API для голосового ассистента, который будет удобен для пользователей и оптимален с точки зрения архитектуры.

---

## 📋 Содержание

1. [Анализ текущих проблем](#анализ-текущих-проблем)
2. [Принципы проектирования](#принципы-проектирования)
3. [Архитектурные решения](#архитектурные-решения)
4. [Детальный план улучшений](#детальный-план-улучшений)
5. [Примеры нового API](#примеры-нового-api)
6. [План миграции](#план-миграции)

---

## 🔍 Анализ текущих проблем

### Проблема 1: Смешение ответственности
**Текущее состояние:**
```typescript
class Voice {
    // Управление состоянием
    private state: VoiceState;
    
    // Аудио компоненты
    private transcriber: ITranscriber;
    private tts: ITextToSpeech;
    private audioDeviceManager: AudioDeviceManager;
    
    // AI компоненты
    private dialog?: Dialog;
    private aiProvider?: AIProvider;
    
    // Бизнес-логика
    private commandBuffer: string[];
    private lastSpeechTime: number;
}
```

**Проблемы:**
- Один класс отвечает за STT, TTS, AI, управление состоянием, буферизацию команд
- Нарушение Single Responsibility Principle
- Сложно тестировать отдельные части
- Сложно расширять функциональность

**Решение:** Разделить на отдельные модули с четкими границами ответственности.

---

### Проблема 2: Жесткая связанность компонентов
**Текущее состояние:**
```typescript
constructor(options: VoiceOptions = {}) {
    this.transcriber = this.options.transcriber || new WhisperTranscriber();
    this.tts = this.options.tts || new ZonosTTSEngine(this.audioDeviceManager);
}
```

**Проблемы:**
- Дефолтные реализации жестко зашиты в конструктор
- Невозможно легко заменить компоненты
- Сложно добавить новые типы компонентов

**Решение:** Dependency Injection через фабрики или конфигурационные объекты.

---

### Проблема 3: Неочевидный жизненный цикл
**Текущее состояние:**
```typescript
// Пользователь должен знать о состояниях
await voice.initialize();      // IDLE -> LISTENING_FOR_KEYWORD
await voice.startListening();  // Работает только в LISTENING_FOR_KEYWORD
await voice.ask("...");        // Работает только в определенных состояниях
```

**Проблемы:**
- Пользователь должен понимать внутренние состояния
- Методы могут молча не работать
- Нет явных ошибок при неправильном использовании

**Решение:** Упростить API до интуитивных методов, скрыть управление состоянием.

---

### Проблема 4: Отсутствие способа получить результат
**Текущее состояние:**
```typescript
await voice.ask("Привет");  // Promise<void>
// Как получить ответ? Только через внутренние события!
```

**Проблемы:**
- Невозможно получить результат напрямую
- Нет способа подписаться на события извне
- Результат только логируется в консоль

**Решение:** Возвращать результат или предоставить EventEmitter API.

---

### Проблема 5: Автозапуск при импорте
**Текущее состояние:**
```typescript
// В конце файла voice.ts
(async () => {
    const voice = new Voice();
    await voice.initialize();
    await voice.startListening();
})();
```

**Проблемы:**
- Запускается автоматически при импорте модуля
- Невозможно использовать модуль как библиотеку
- Конфликтует с другими экземплярами

**Решение:** Удалить автозапуск, сделать отдельный CLI файл.

---

### Проблема 6: Нет гибкости в выборе устройств
**Текущее состояние:**
```typescript
// Устройства выбираются автоматически внутри компонентов
// Нет способа передать выбранное устройство
```

**Проблемы:**
- Невозможно выбрать конкретный микрофон/динамик
- AudioDeviceManager создается в нескольких местах
- Нет централизованного управления устройствами

**Решение:** Вынести управление устройствами на уровень конфигурации.

---

## 🎯 Принципы проектирования

### 1. **Простота использования (Simplicity)**
```typescript
// Плохо: Пользователь должен знать о состояниях
await voice.initialize();
await voice.startListening();

// Хорошо: Один метод для запуска
await voice.start();
```

**Правило:** API должен быть интуитивным для 80% случаев использования.

---

### 2. **Гибкость (Flexibility)**
```typescript
// Плохо: Жестко зашитые компоненты
const voice = new Voice();

// Хорошо: Композиция компонентов
const voice = new Voice({
    stt: new WhisperSTT(),
    tts: new ZonosTTS(),
    ai: new OpenRouterAI()
});
```

**Правило:** Каждый компонент должен быть заменяемым.

---

### 3. **Разделение ответственности (Separation of Concerns)**
```typescript
// Плохо: Все в одном классе
class Voice {
    // STT + TTS + AI + State + Buffer + ...
}

// Хорошо: Отдельные модули
class VoiceAssistant {
    private stt: STTModule;
    private tts: TTSModule;
    private ai: AIModule;
    private orchestrator: Orchestrator;
}
```

**Правило:** Один класс = одна ответственность.

---

### 4. **Предсказуемость (Predictability)**
```typescript
// Плохо: Метод может молча не сработать
await voice.ask("test");  // Ничего не происходит если state != LISTENING

// Хорошо: Явные ошибки или всегда работает
await voice.ask("test");  // Либо работает, либо выбрасывает ошибку
```

**Правило:** Методы должны либо работать, либо выбрасывать понятную ошибку.

---

### 5. **Композируемость (Composability)**
```typescript
// Плохо: Монолитный класс
const voice = new Voice({ enableSTT: true, enableTTS: false });

// Хорошо: Композиция модулей
const assistant = new VoiceAssistant()
    .withSTT(new WhisperSTT())
    .withAI(new OpenRouterAI())
    .build();
```

**Правило:** Пользователь должен собирать только нужные компоненты.

---

## 🏗️ Архитектурные решения

### Решение 1: Модульная архитектура

```
┌─────────────────────────────────────────────────────────┐
│                   VoiceAssistant                        │
│  (Главный фасад, упрощенный API для пользователя)      │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │   Orchestrator   │  (Управление потоком данных)
        └────────┬────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│  STT  │   │  AI   │   │  TTS  │  (Независимые модули)
│Module │   │Module │   │Module │
└───────┘   └───────┘   └───────┘
    │            │            │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│Device │   │Dialog │   │Device │  (Низкоуровневые компоненты)
│Manager│   │System │   │Manager│
└───────┘   └───────┘   └───────┘
```

**Преимущества:**
- Каждый модуль независим и тестируем
- Легко заменить любой компонент
- Orchestrator управляет потоком данных
- VoiceAssistant предоставляет простой API

---

### Решение 2: Builder Pattern для конфигурации

```typescript
// Простой случай (с дефолтами)
const assistant = await VoiceAssistant.create();

// Средний случай (выборочная настройка)
const assistant = await VoiceAssistant.create({
    ai: { model: 'deepseek/deepseek-chat-v3-0324:free' }
});

// Продвинутый случай (полный контроль)
const assistant = new VoiceAssistantBuilder()
    .withSTT(new WhisperSTT({ model: 'base' }))
    .withTTS(new ZonosTTS({ voice: 'ru-RU' }))
    .withAI(new OpenRouterAI({ model: 'gpt-4o-mini' }))
    .withDevices({ input: 'mic-1', output: 'speaker-2' })
    .build();
```

**Преимущества:**
- Простой API для начинающих
- Гибкость для продвинутых пользователей
- Явная конфигурация
- Валидация на этапе сборки

---

### Решение 3: Event-Driven Architecture

```typescript
// Подписка на события
assistant.on('transcription', (text) => {
    console.log('Распознано:', text);
});

assistant.on('ai-response', (response) => {
    console.log('AI ответил:', response);
});

assistant.on('speaking', (text) => {
    console.log('Озвучивается:', text);
});

assistant.on('error', (error) => {
    console.error('Ошибка:', error);
});

// Или Promise-based API
const response = await assistant.ask('Привет!');
console.log('Ответ:', response);
```

**Преимущества:**
- Пользователь может подписаться на любое событие
- Не блокирует основной поток
- Легко интегрировать с UI
- Поддержка как событий, так и промисов

---

### Решение 4: Стратегия для режимов работы

```typescript
// Режим 1: Только AI (текст -> текст)
const assistant = await VoiceAssistant.create({
    mode: 'text-only'
});
const response = await assistant.ask('Привет');

// Режим 2: AI + TTS (текст -> голос)
const assistant = await VoiceAssistant.create({
    mode: 'text-to-speech'
});
await assistant.ask('Привет');  // Ответ будет озвучен

// Режим 3: STT + AI (голос -> текст)
const assistant = await VoiceAssistant.create({
    mode: 'speech-to-text'
});
await assistant.startListening();

// Режим 4: Полный (голос -> голос)
const assistant = await VoiceAssistant.create({
    mode: 'full-voice'
});
await assistant.startListening();
```

**Преимущества:**
- Явное указание режима работы
- Автоматическая настройка компонентов
- Невозможно создать некорректную конфигурацию
- Оптимизация ресурсов

---

## 📝 Детальный план улучшений

### Фаза 1: Рефакторинг ядра (2-3 дня)

#### 1.1 Создать базовые интерфейсы модулей

```typescript
// lib/voice/interfaces.ts

export interface STTModule {
    initialize(config: STTConfig): Promise<void>;
    start(onTranscription: (text: string) => void): Promise<void>;
    stop(): Promise<void>;
    destroy(): Promise<void>;
}

export interface TTSModule {
    initialize(config: TTSConfig): Promise<void>;
    speak(text: string): Promise<void>;
    stop(): Promise<void>;
    destroy(): Promise<void>;
}

export interface AIModule {
    initialize(config: AIConfig): Promise<void>;
    ask(message: string): Promise<string>;
    stream(message: string): AsyncGenerator<string>;
    destroy(): Promise<void>;
}

export interface DeviceManager {
    listInputDevices(): AudioDevice[];
    listOutputDevices(): AudioDevice[];
    selectInput(deviceId: string): void;
    selectOutput(deviceId: string): void;
}
```

**Почему:**
- Четкие контракты для каждого модуля
- Независимость модулей друг от друга
- Легко создавать моки для тестов
- Простая замена реализаций

---

#### 1.2 Создать Orchestrator для управления потоком

```typescript
// lib/voice/orchestrator.ts

export class VoiceOrchestrator extends EventEmitter {
    private stt?: STTModule;
    private tts?: TTSModule;
    private ai: AIModule;
    private state: 'idle' | 'listening' | 'processing' | 'speaking';

    constructor(config: OrchestratorConfig) {
        this.stt = config.stt;
        this.tts = config.tts;
        this.ai = config.ai;
        this.state = 'idle';
    }

    async ask(text: string): Promise<string> {
        this.state = 'processing';
        this.emit('processing', text);
        
        try {
            const response = await this.ai.ask(text);
            this.emit('response', response);
            
            if (this.tts) {
                this.state = 'speaking';
                await this.tts.speak(response);
                this.emit('spoken', response);
            }
            
            this.state = 'idle';
            return response;
        } catch (error) {
            this.emit('error', error);
            this.state = 'idle';
            throw error;
        }
    }

    async startListening(): Promise<void> {
        if (!this.stt) {
            throw new Error('STT module not configured');
        }
        
        this.state = 'listening';
        await this.stt.start(async (text) => {
            this.emit('transcription', text);
            
            if (this.shouldProcessCommand(text)) {
                await this.ask(text);
            }
        });
    }

    private shouldProcessCommand(text: string): boolean {
        // Логика определения команды (ключевое слово, тишина и т.д.)
        return true;
    }
}
```

**Почему:**
- Централизованное управление потоком данных
- Четкое управление состоянием
- События для всех важных действий
- Легко тестировать логику оркестрации

---

#### 1.3 Создать фасад VoiceAssistant

```typescript
// lib/voice/assistant.ts

export class VoiceAssistant extends EventEmitter {
    private orchestrator: VoiceOrchestrator;
    private config: VoiceAssistantConfig;

    private constructor(orchestrator: VoiceOrchestrator, config: VoiceAssistantConfig) {
        super();
        this.orchestrator = orchestrator;
        this.config = config;
        
        // Проксируем события от оркестратора
        this.orchestrator.on('transcription', (text) => this.emit('transcription', text));
        this.orchestrator.on('response', (text) => this.emit('response', text));
        this.orchestrator.on('error', (error) => this.emit('error', error));
    }

    /**
     * Создать ассистента с дефолтными настройками
     */
    static async create(config?: Partial<VoiceAssistantConfig>): Promise<VoiceAssistant> {
        const fullConfig = await this.buildConfig(config);
        const orchestrator = await this.buildOrchestrator(fullConfig);
        return new VoiceAssistant(orchestrator, fullConfig);
    }

    /**
     * Отправить текстовую команду и получить ответ
     */
    async ask(text: string): Promise<string> {
        return await this.orchestrator.ask(text);
    }

    /**
     * Запустить прослушивание (для режимов с STT)
     */
    async startListening(): Promise<void> {
        if (this.config.mode === 'text-only') {
            throw new Error('Cannot start listening in text-only mode');
        }
        await this.orchestrator.startListening();
    }

    /**
     * Остановить прослушивание
     */
    async stopListening(): Promise<void> {
        await this.orchestrator.stopListening();
    }

    /**
     * Освободить все ресурсы
     */
    async destroy(): Promise<void> {
        await this.orchestrator.destroy();
        this.removeAllListeners();
    }

    private static async buildConfig(partial?: Partial<VoiceAssistantConfig>): Promise<VoiceAssistantConfig> {
        // Построение полной конфигурации с дефолтами
        return {
            mode: partial?.mode || 'text-only',
            ai: {
                provider: 'openrouter',
                model: 'deepseek/deepseek-chat-v3-0324:free',
                apiKey: process.env.OPENROUTER_API_KEY,
                ...partial?.ai
            },
            stt: partial?.mode?.includes('speech') ? {
                engine: 'whisper',
                model: 'tiny',
                ...partial?.stt
            } : undefined,
            tts: partial?.mode?.includes('speech') || partial?.mode === 'text-to-speech' ? {
                engine: 'zonos',
                ...partial?.tts
            } : undefined
        };
    }

    private static async buildOrchestrator(config: VoiceAssistantConfig): Promise<VoiceOrchestrator> {
        // Создание и инициализация модулей
        const ai = await this.createAIModule(config.ai);
        const stt = config.stt ? await this.createSTTModule(config.stt) : undefined;
        const tts = config.tts ? await this.createTTSModule(config.tts) : undefined;

        return new VoiceOrchestrator({ ai, stt, tts });
    }
}
```

**Почему:**
- Простой API для пользователя
- Скрывает сложность оркестрации
- Валидация конфигурации
- Автоматическое создание модулей

---

### Фаза 2: Реализация модулей (3-4 дня)

#### 2.1 STT Module (Whisper)

```typescript
// lib/voice/modules/stt/whisper-stt.ts

export class WhisperSTT implements STTModule {
    private config: WhisperSTTConfig;
    private deviceManager: DeviceManager;
    private transcriber?: WhisperTranscriber;
    private isListening: boolean = false;

    constructor(config: WhisperSTTConfig, deviceManager: DeviceManager) {
        this.config = config;
        this.deviceManager = deviceManager;
    }

    async initialize(): Promise<void> {
        this.transcriber = new WhisperTranscriber({
            model: this.config.model,
            language: this.config.language || 'ru',
            device: this.deviceManager.getSelectedInput()
        });
        await this.transcriber.initialize();
    }

    async start(onTranscription: (text: string) => void): Promise<void> {
        if (!this.transcriber) {
            throw new Error('WhisperSTT not initialized');
        }
        if (this.isListening) {
            throw new Error('Already listening');
        }

        this.isListening = true;
        await this.transcriber.start(onTranscription);
    }

    async stop(): Promise<void> {
        if (!this.isListening) return;
        
        this.isListening = false;
        await this.transcriber?.stop();
    }

    async destroy(): Promise<void> {
        await this.stop();
        await this.transcriber?.destroy();
    }
}
```

**Почему:**
- Инкапсулирует всю логику Whisper
- Четкое управление состоянием
- Использует внешний DeviceManager
- Явные ошибки при неправильном использовании

---

#### 2.2 TTS Module (Zonos)

```typescript
// lib/voice/modules/tts/zonos-tts.ts

export class ZonosTTS implements TTSModule {
    private config: ZonosTTSConfig;
    private deviceManager: DeviceManager;
    private server?: ZonosServer;
    private isSpeaking: boolean = false;

    constructor(config: ZonosTTSConfig, deviceManager: DeviceManager) {
        this.config = config;
        this.deviceManager = deviceManager;
    }

    async initialize(): Promise<void> {
        this.server = new ZonosServer({
            voice: this.config.voice,
            device: this.deviceManager.getSelectedOutput()
        });
        await this.server.start();
    }

    async speak(text: string): Promise<void> {
        if (!this.server) {
            throw new Error('ZonosTTS not initialized');
        }
        if (this.isSpeaking) {
            await this.stop();
        }

        this.isSpeaking = true;
        try {
            await this.server.synthesize(text);
        } finally {
            this.isSpeaking = false;
        }
    }

    async stop(): Promise<void> {
        if (!this.isSpeaking) return;
        
        await this.server?.interrupt();
        this.isSpeaking = false;
    }

    async destroy(): Promise<void> {
        await this.stop();
        await this.server?.shutdown();
    }
}
```

**Почему:**
- Инкапсулирует всю логику Zonos
- Управление состоянием воспроизведения
- Возможность прерывания
- Использует внешний DeviceManager

---

#### 2.3 AI Module (OpenRouter)

```typescript
// lib/voice/modules/ai/openrouter-ai.ts

export class OpenRouterAI implements AIModule {
    private config: OpenRouterAIConfig;
    private dialog: Dialog;
    private tools: Tool[];

    constructor(config: OpenRouterAIConfig) {
        this.config = config;
        this.tools = [
            new ExecJSTool(),
            new TerminalTool({ timeout: 30000 })
        ];
    }

    async initialize(): Promise<void> {
        const provider = new OpenRouterProvider({
            token: this.config.apiKey,
            model: this.config.model
        });

        this.dialog = new Dialog({
            provider,
            tools: this.tools,
            systemPrompt: this.config.systemPrompt || this.createDefaultPrompt()
        });
    }

    async ask(message: string): Promise<string> {
        if (!this.dialog) {
            throw new Error('OpenRouterAI not initialized');
        }

        return new Promise((resolve, reject) => {
            let fullResponse = '';

            this.dialog.onChange((event: DialogEvent) => {
                switch (event.type) {
                    case 'ai_chunk':
                        fullResponse += event.content;
                        break;
                    case 'done':
                        resolve(fullResponse);
                        break;
                    case 'error':
                        reject(new Error(event.error));
                        break;
                }
            });

            this.dialog.ask({ role: 'user', content: message });
        });
    }

    async *stream(message: string): AsyncGenerator<string> {
        // Стриминг реализация
        // ...
    }

    async destroy(): Promise<void> {
        // Очистка ресурсов
    }

    private createDefaultPrompt(): string {
        return createSystemPrompt({
            name: 'Assistant',
            tools: this.tools
        });
    }
}
```

**Почему:**
- Инкапсулирует всю логику Dialog
- Преобразует события в Promise
- Поддержка стриминга
- Конфигурируемые инструменты

---

### Фаза 3: Builder и конфигурация (1-2 дня)

#### 3.1 VoiceAssistantBuilder

```typescript
// lib/voice/builder.ts

export class VoiceAssistantBuilder {
    private config: Partial<VoiceAssistantConfig> = {};

    withMode(mode: 'text-only' | 'text-to-speech' | 'speech-to-text' | 'full-voice'): this {
        this.config.mode = mode;
        return this;
    }

    withAI(ai: AIModule | AIConfig): this {
        if ('ask' in ai) {
            this.config.aiModule = ai;
        } else {
            this.config.ai = ai;
        }
        return this;
    }

    withSTT(stt: STTModule | STTConfig): this {
        if ('start' in stt) {
            this.config.sttModule = stt;
        } else {
            this.config.stt = stt;
        }
        return this;
    }

    withTTS(tts: TTSModule | TTSConfig): this {
        if ('speak' in tts) {
            this.config.ttsModule = tts;
        } else {
            this.config.tts = tts;
        }
        return this;
    }

    withDevices(devices: { input?: string; output?: string }): this {
        this.config.devices = devices;
        return this;
    }

    withKeyword(keyword: string): this {
        this.config.keyword = keyword;
        return this;
    }

    async build(): Promise<VoiceAssistant> {
        this.validate();
        return await VoiceAssistant.create(this.config);
    }

    private validate(): void {
        // Валидация конфигурации
        if (!this.config.mode) {
            throw new Error('Mode is required');
        }
        
        if (this.config.mode.includes('speech') && !this.config.stt && !this.config.sttModule) {
            throw new Error('STT is required for speech modes');
        }
        
        // ... другие проверки
    }
}
```

**Почему:**
- Fluent API для конфигурации
- Валидация на этапе сборки
- Поддержка как модулей, так и конфигов
- Явные ошибки при неправильной конфигурации

---

### Фаза 4: Управление устройствами (1 день)

#### 4.1 Централизованный DeviceManager

```typescript
// lib/voice/device-manager.ts

export class VoiceDeviceManager implements DeviceManager {
    private audioManager: AudioDeviceManager;
    private selectedInput?: string;
    private selectedOutput?: string;

    constructor() {
        this.audioManager = new AudioDeviceManager();
    }

    async initialize(): Promise<void> {
        await this.audioManager.initialize();
        
        // Автоматический выбор лучших устройств
        const bestInput = await this.audioManager.getBestInputDevice();
        const bestOutput = await this.audioManager.getBestOutputDevice();
        
        this.selectedInput = bestInput?.id;
        this.selectedOutput = bestOutput?.id;
    }

    listInputDevices(): AudioDevice[] {
        return this.audioManager.listInputDevices();
    }

    listOutputDevices(): AudioDevice[] {
        return this.audioManager.listOutputDevices();
    }

    selectInput(deviceId: string): void {
        const devices = this.listInputDevices();
        if (!devices.find(d => d.id === deviceId)) {
            throw new Error(`Input device ${deviceId} not found`);
        }
        this.selectedInput = deviceId;
    }

    selectOutput(deviceId: string): void {
        const devices = this.listOutputDevices();
        if (!devices.find(d => d.id === deviceId)) {
            throw new Error(`Output device ${deviceId} not found`);
        }
        this.selectedOutput = deviceId;
    }

    getSelectedInput(): AudioDevice | undefined {
        return this.listInputDevices().find(d => d.id === this.selectedInput);
    }

    getSelectedOutput(): AudioDevice | undefined {
        return this.listOutputDevices().find(d => d.id === this.selectedOutput);
    }
}
```

**Почему:**
- Централизованное управление устройствами
- Автоматический выбор лучших устройств
- Валидация выбранных устройств
- Единый источник правды для всех модулей

---

### Фаза 5: Тестирование и документация (2-3 дня)

#### 5.1 Unit тесты для каждого модуля

```typescript
// lib/voice/modules/ai/__tests__/openrouter-ai.test.ts

describe('OpenRouterAI', () => {
    let ai: OpenRouterAI;
    let mockProvider: jest.Mocked<OpenRouterProvider>;

    beforeEach(() => {
        mockProvider = createMockProvider();
        ai = new OpenRouterAI({
            apiKey: 'test-key',
            model: 'test-model'
        });
    });

    it('should initialize correctly', async () => {
        await ai.initialize();
        expect(ai).toBeDefined();
    });

    it('should return response from ask', async () => {
        mockProvider.query.mockResolvedValue({
            role: 'assistant',
            content: 'Test response'
        });

        const response = await ai.ask('Test question');
        expect(response).toBe('Test response');
    });

    it('should throw error if not initialized', async () => {
        await expect(ai.ask('test')).rejects.toThrow('not initialized');
    });
});
```

---

#### 5.2 Integration тесты

```typescript
// lib/voice/__tests__/integration.test.ts

describe('VoiceAssistant Integration', () => {
    it('should work in text-only mode', async () => {
        const assistant = await VoiceAssistant.create({
            mode: 'text-only',
            ai: {
                provider: 'mock',
                responses: ['Hello!']
            }
        });

        const response = await assistant.ask('Hi');
        expect(response).toBe('Hello!');
        
        await assistant.destroy();
    });

    it('should emit events correctly', async () => {
        const assistant = await VoiceAssistant.create({
            mode: 'text-only'
        });

        const events: string[] = [];
        assistant.on('response', () => events.push('response'));

        await assistant.ask('Test');
        expect(events).toContain('response');
        
        await assistant.destroy();
    });
});
```

---

#### 5.3 Обновленная документация

```markdown
# VoiceAssistant API v2.0

## Quick Start

### Simple text assistant
```typescript
const assistant = await VoiceAssistant.create();
const response = await assistant.ask('Hello!');
console.log(response);
```

### Full voice assistant
```typescript
const assistant = await VoiceAssistant.create({
    mode: 'full-voice',
    keyword: 'алиса'
});

assistant.on('transcription', (text) => {
    console.log('Heard:', text);
});

assistant.on('response', (text) => {
    console.log('AI:', text);
});

await assistant.startListening();
```

### Advanced configuration
```typescript
const assistant = await new VoiceAssistantBuilder()
    .withMode('full-voice')
    .withAI({
        model: 'gpt-4o-mini',
        apiKey: process.env.OPENAI_KEY
    })
    .withSTT({
        engine: 'whisper',
        model: 'base',
        language: 'ru'
    })
    .withTTS({
        engine: 'zonos',
        voice: 'ru-RU-female'
    })
    .withDevices({
        input: 'mic-1',
        output: 'speaker-2'
    })
    .build();
```
```

---

## 📊 Сравнение: До и После

### Пример 1: Простое использование

**До:**
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

**После:**
```typescript
const assistant = await VoiceAssistant.create();
const response = await assistant.ask("Привет");  // Promise<string>
console.log(response);
await assistant.destroy();
```

**Улучшения:**
- ✅ Меньше кода
- ✅ Возвращает результат
- ✅ Дефолтные настройки работают из коробки

---

### Пример 2: Выбор устройств

**До:**
```typescript
// Невозможно! Нужно создавать кастомный транскрибер
```

**После:**
```typescript
const assistant = await new VoiceAssistantBuilder()
    .withMode('full-voice')
    .withDevices({
        input: 'USB Microphone',
        output: 'Bluetooth Speaker'
    })
    .build();
```

**Улучшения:**
- ✅ Простой выбор устройств
- ✅ Валидация устройств
- ✅ Не нужно создавать кастомные компоненты

---

### Пример 3: Получение результата

**До:**
```typescript
await voice.ask("Привет");
// Результат только в консоли, нет способа получить программно
```

**После:**
```typescript
// Вариант 1: Promise
const response = await assistant.ask("Привет");
console.log(response);

// Вариант 2: Events
assistant.on('response', (text) => {
    console.log('AI ответил:', text);
});
await assistant.ask("Привет");
```

**Улучшения:**
- ✅ Два способа получить результат
- ✅ Не блокирует UI
- ✅ Можно подписаться на события

---

### Пример 4: Кастомные компоненты

**До:**
```typescript
class MySTT implements ITranscriber {
    // Реализация...
}

const voice = new Voice({
    transcriber: new MySTT(),
    enableTranscription: true
});
```

**После:**
```typescript
class MySTT implements STTModule {
    // Реализация...
}

const assistant = await new VoiceAssistantBuilder()
    .withSTT(new MySTT())
    .build();
```

**Улучшения:**
- ✅ Более четкий интерфейс
- ✅ Валидация конфигурации
- ✅ Fluent API

---

## 🎯 Метрики успеха

### Простота использования
- **До:** 5-7 строк кода для минимального примера
- **После:** 2-3 строки кода
- **Улучшение:** 60% меньше кода

### Гибкость
- **До:** 2 способа кастомизации (конструктор, кастомные компоненты)
- **После:** 3 способа (простой конфиг, builder, кастомные модули)
- **Улучшение:** +50% гибкости

### Предсказуемость
- **До:** Методы могут молча не работать
- **После:** Явные ошибки или всегда работает
- **Улучшение:** 100% предсказуемость

### Тестируемость
- **До:** Монолитный класс, сложно тестировать
- **После:** Модульная архитектура, каждый модуль тестируется отдельно
- **Улучшение:** 10x проще тестировать

---

## 🚀 План миграции

### Этап 1: Создание новой архитектуры (параллельно)
- Создать новые модули в `lib/voice/v2/`
- Не трогать старый код
- Написать тесты для новых модулей

### Этап 2: Адаптер для обратной совместимости
```typescript
// lib/voice/legacy-adapter.ts
export class LegacyVoice {
    private assistant: VoiceAssistant;

    constructor(options: OldVoiceOptions) {
        // Преобразование старых опций в новые
        const newConfig = this.convertOptions(options);
        this.assistant = await VoiceAssistant.create(newConfig);
    }

    // Старые методы делегируют новым
    async initialize() {
        // Ничего не делаем, уже инициализировано
    }

    async ask(text: string): Promise<void> {
        await this.assistant.ask(text);
    }
}
```

### Этап 3: Постепенная миграция
1. Обновить документацию с пометкой "deprecated" для старого API
2. Добавить warnings в старый код
3. Мигрировать внутренние использования
4. Через 2-3 релиза удалить старый код

---

## 📋 Чеклист реализации

### Фаза 1: Ядро ✅
- [ ] Создать интерфейсы модулей
- [ ] Реализовать Orchestrator
- [ ] Реализовать VoiceAssistant фасад
- [ ] Написать unit тесты

### Фаза 2: Модули ✅
- [ ] Реализовать WhisperSTT
- [ ] Реализовать ZonosTTS
- [ ] Реализовать OpenRouterAI
- [ ] Написать unit тесты для каждого

### Фаза 3: Builder ✅
- [ ] Реализовать VoiceAssistantBuilder
- [ ] Реализовать валидацию конфигурации
- [ ] Добавить preset конфигурации
- [ ] Написать тесты

### Фаза 4: Устройства ✅
- [ ] Реализовать VoiceDeviceManager
- [ ] Интегрировать с модулями
- [ ] Добавить автовыбор устройств
- [ ] Написать тесты

### Фаза 5: Документация ✅
- [ ] Обновить README
- [ ] Обновить VOICE_API.md
- [ ] Добавить примеры
- [ ] Добавить migration guide

### Фаза 6: Миграция ✅
- [ ] Создать legacy adapter
- [ ] Добавить deprecation warnings
- [ ] Мигрировать внутренний код
- [ ] Удалить старый код (через N релизов)

---

## 🎓 Выводы

### Ключевые принципы новой архитектуры:

1. **Модульность** - каждый компонент независим и заменяем
2. **Простота** - 80% случаев решаются 2-3 строками кода
3. **Гибкость** - продвинутые пользователи имеют полный контроль
4. **Предсказуемость** - явные ошибки вместо молчаливых отказов
5. **Тестируемость** - каждый модуль легко тестировать изолированно

### Преимущества для пользователей:

- ✅ Меньше кода для простых случаев
- ✅ Больше контроля для сложных случаев
- ✅ Понятные ошибки
- ✅ Возможность получить результат
- ✅ События для интеграции с UI
- ✅ Выбор устройств из коробки

### Преимущества для разработчиков:

- ✅ Легко добавлять новые модули
- ✅ Легко тестировать
- ✅ Четкие границы ответственности
- ✅ Возможность оптимизировать отдельные части
- ✅ Простая поддержка

---

**Время реализации:** 10-15 дней  
**Приоритет:** Высокий  
**Сложность:** Средняя  
**Влияние:** Критическое

---

*Документ создан: 2025-10-25*  
*Версия: 1.0*  
*Статус: Готов к реализации*
