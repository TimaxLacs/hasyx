import AudioDeviceManager from './voice-device';
import { OpenRouterProvider } from './ai/providers/openrouter';
import type { AIMessage } from './ai/ai';
import path from 'path';
import * as fs from 'fs';
import { spawn, spawnSync, ChildProcessWithoutNullStreams } from 'child_process';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import { Dialog, DialogEvent } from './ai/dialog';
import { AIProvider } from './ai/ai';
import { ExecJSTool } from './ai/tools/exec-js-tool';
import { TerminalTool } from './ai/tools/terminal-tool';
import { createSystemPrompt } from './ai/core-prompts';
import { Tool } from './ai/tool';
import chalk from 'chalk';
import { whisper as nodewhisper } from 'whisper-node';
import { EventEmitter } from 'events';

// ==================================================================================
// INTERFACES: МОДУЛЬНАЯ АРХИТЕКТУРА
// ==================================================================================

/**
 * Интерфейс для модуля распознавания речи (Speech-to-Text).
 */
export interface STTModule {
    /** Начинает прослушивание, вызывая колбэк при получении результата. */
    start(onTranscription: (text: string) => void): Promise<void>;
    /** Останавливает текущее прослушивание. */
    stop(): Promise<void>;
    /** Освобождает все ресурсы. */
    destroy(): Promise<void>;
}

/**
 * Интерфейс для модуля синтеза речи (Text-to-Speech).
 */
export interface TTSModule {
    /** Синтезирует и воспроизводит речь. */
    speak(text: string): Promise<void>;
    /** Прерывает текущее воспроизведение. */
    stop(): Promise<void>;
    /** Освобождает все ресурсы. */
    destroy(): Promise<void>;
}

/**
 * Интерфейс для модуля AI.
 */
export interface AIModule {
    /** Отправляет сообщение и возвращает полный ответ. */
    ask(message: string): Promise<string>;
    /** Освобождает все ресурсы. */
    destroy(): Promise<void>;
}

/**
 * Конфигурация для STT модуля.
 */
export interface STTConfig {
    /** Модель Whisper (tiny, base, small, medium, large). */
    model?: string;
    /** Язык распознавания. */
    language?: string;
    /** Длительность аудиочанка в миллисекундах. */
    chunkDuration?: number;
}

/**
 * Конфигурация для TTS модуля.
 */
export interface TTSConfig {
    /** Путь к reference audio файлу. */
    referenceAudio?: string;
    /** Порт для ZonosJS сервера. */
    port?: number;
}

/**
 * Конфигурация для AI модуля.
 */
export interface AIConfig {
    /** API ключ. */
    apiKey?: string;
    /** Модель AI. */
    model?: string;
    /** Системный промпт. */
    systemPrompt?: string;
    /** Использовать ли тэги <VOICE> для извлечения текста для озвучивания. */
    useVoiceTags?: boolean;
}

/**
 * Конфигурация устройств ввода/вывода.
 */
export interface DeviceConfig {
    /** ID или имя устройства ввода (микрофон). */
    input?: string;
    /** ID или имя устройства вывода (динамик). */
    output?: string;
}

/**
 * Полная конфигурация голосового ассистента.
 */
export interface VoiceAssistantConfig {
    /** Конфигурация AI (обязательно). */
    ai: AIConfig;
    /** Конфигурация STT (опционально). */
    stt?: STTConfig;
    /** Конфигурация TTS (опционально). */
    tts?: TTSConfig;
    /** Конфигурация устройств (опционально). */
    devices?: DeviceConfig;
    /** Ключевое слово для активации (опционально). */
    keyword?: string;
    /** Порог тишины в миллисекундах для определения конца команды. */
    silenceThreshold?: number;
}

// ==================================================================================
// STT MODULE: WHISPER IMPLEMENTATION
// ==================================================================================

const SAMPLE_RATE = 16000;
const DEFAULT_WHISPER_MODEL = 'tiny';
const MODEL_PATH = path.resolve(__dirname, '../node_modules/whisper-node/lib/whisper.cpp/models');
const DEFAULT_CHUNK_DURATION_MS = 2000;
const CALIBRATION_SAMPLES = 3;
const SILENCE_MULTIPLIER = 1.3;
const ADAPTATION_WEIGHT = 0.1;

/**
 * Реализация STTModule с использованием Whisper для локального распознавания речи.
 */
export class WhisperSTT implements STTModule {
    private audioDeviceManager: AudioDeviceManager;
    private recordProcess?: ChildProcessWithoutNullStreams | any;
    private onTranscriptionCallback?: (text: string) => void;
    private whisper?: any;
    private audioChunks: Buffer[] = [];
    private chunkStartTime: number = 0;
    private isProcessing: boolean = false;
    private tempAudioPath: string = path.join(__dirname, 'temp_chunk.wav');
    
    // Динамическая калибровка тишины
    private calibrationSamples: number[] = [];
    private isCalibrated: boolean = false;
    private averageNoiseLevel: number = 0;
    private silenceThreshold: number = 500;
    
    private config: Required<STTConfig>;

    constructor(config: STTConfig, audioDeviceManager: AudioDeviceManager) {
        this.config = {
            model: config.model || DEFAULT_WHISPER_MODEL,
            language: config.language || 'ru',
            chunkDuration: config.chunkDuration || DEFAULT_CHUNK_DURATION_MS
        };
        this.audioDeviceManager = audioDeviceManager;
        
        // Инициализация Whisper
        if (!fs.existsSync(MODEL_PATH)) {
            fs.mkdirSync(MODEL_PATH, { recursive: true });
        }
        this.whisper = nodewhisper;
    }

    async start(onTranscription: (text: string) => void): Promise<void> {
        this.onTranscriptionCallback = onTranscription;
        
        let selectedInputDevice = await this.audioDeviceManager.getBestInputDevice();
        if (!selectedInputDevice) {
            throw new Error("Не удалось определить устройство ввода.");
        }
        
        console.log(`🎧 Использую устройство ввода: ${selectedInputDevice.name} (ID: ${selectedInputDevice.id})`);

        if (this.audioDeviceManager.requiresRtAudio()) {
            const audioStream = await this.audioDeviceManager.recordAudioStream(selectedInputDevice, SAMPLE_RATE, 1);
            this.recordProcess = {
                stdout: audioStream,
                stderr: { on: () => {} },
                on: (event: string, callback: Function) => {
                    if (event === 'close') audioStream?.on('end', () => callback(0));
                },
                kill: () => this.audioDeviceManager.stopAudioStream(),
            };
        } else {
            const recordCommand = this.audioDeviceManager.getRecordCommand(selectedInputDevice, SAMPLE_RATE);
            this.recordProcess = spawn(recordCommand[0], recordCommand.slice(1));
        }

        this.chunkStartTime = Date.now();

        this.recordProcess.stdout.on('data', (data: Buffer) => {
            this.audioChunks.push(data);
            
            const elapsedTime = Date.now() - this.chunkStartTime;
            if (elapsedTime >= this.config.chunkDuration && !this.isProcessing) {
                this.processAudioChunk();
            }
        });

        this.recordProcess.stderr.on('data', (data: Buffer) => {
            console.error(`❌ Ошибка записи: ${data}`);
        });

        this.recordProcess.on('close', (code: number) => {
            if (code !== 0 && code !== null) {
                console.warn(`Процесс записи завершился с кодом ${code}`);
            }
        });
    }

    private calculateRMS(buffer: Buffer): number {
        const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }

    private async processAudioChunk(): Promise<void> {
        if (this.audioChunks.length === 0 || this.isProcessing) return;
        
        this.isProcessing = true;
        const audioData = Buffer.concat(this.audioChunks);
        this.audioChunks = [];
        this.chunkStartTime = Date.now();

        const rmsLevel = this.calculateRMS(audioData);
        
        // Фаза калибровки
        if (!this.isCalibrated) {
            this.calibrationSamples.push(rmsLevel);
            console.log(chalk.cyan(`🔧 Калибровка... (${this.calibrationSamples.length}/${CALIBRATION_SAMPLES}) Уровень: ${rmsLevel.toFixed(0)}`));
            
            if (this.calibrationSamples.length >= CALIBRATION_SAMPLES) {
                this.averageNoiseLevel = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
                this.silenceThreshold = this.averageNoiseLevel * SILENCE_MULTIPLIER;
                this.isCalibrated = true;
                console.log(chalk.green(`✅ Калибровка завершена! Средний шум: ${this.averageNoiseLevel.toFixed(0)}, Порог тишины: ${this.silenceThreshold.toFixed(0)}`));
            }
            
            this.isProcessing = false;
            return;
        }
        
        // Адаптивное обновление среднего уровня шума
        if (rmsLevel < this.silenceThreshold) {
            this.averageNoiseLevel = this.averageNoiseLevel * (1 - ADAPTATION_WEIGHT) + rmsLevel * ADAPTATION_WEIGHT;
            this.silenceThreshold = this.averageNoiseLevel * SILENCE_MULTIPLIER;
        }
        
        const isSilent = rmsLevel < this.silenceThreshold;
        
        console.log(chalk.gray(`📊 Уровень: ${rmsLevel.toFixed(0)} | Порог: ${this.silenceThreshold.toFixed(0)} | Шум: ${this.averageNoiseLevel.toFixed(0)} ${isSilent ? '🔇' : '🔊'}`));

        if (isSilent) {
            this.isProcessing = false;
            return;
        }

        try {
            await this.saveWavFile(audioData, this.tempAudioPath);
            
            console.log(chalk.blue(`🎙️ Отправка на распознавание...`));
            
            const result = await this.whisper(this.tempAudioPath, {
                modelPath: path.join(MODEL_PATH, `ggml-${this.config.model}.bin`),
                whisperOptions: {
                    language: this.config.language,
                    gen_file_txt: false,
                    gen_file_subtitle: false,
                    gen_file_vtt: false,
                    word_timestamps: false
                }
            });
            
            if (result && result.length > 0) {
                const text = result[0]?.speech?.trim();
                if (text) {
                    console.log(chalk.yellow(`📝 Распознано: "${text}"`));
                    if (this.onTranscriptionCallback) {
                        this.onTranscriptionCallback(text);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Ошибка распознавания:', error);
        } finally {
            this.isProcessing = false;
            if (fs.existsSync(this.tempAudioPath)) {
                fs.unlinkSync(this.tempAudioPath);
            }
        }
    }

    private async saveWavFile(audioData: Buffer, filePath: string): Promise<void> {
        const wavHeader = Buffer.alloc(44);
        const dataSize = audioData.length;
        const fileSize = dataSize + 36;

        wavHeader.write('RIFF', 0);
        wavHeader.writeUInt32LE(fileSize, 4);
        wavHeader.write('WAVE', 8);
        wavHeader.write('fmt ', 12);
        wavHeader.writeUInt32LE(16, 16);
        wavHeader.writeUInt16LE(1, 20);
        wavHeader.writeUInt16LE(1, 22);
        wavHeader.writeUInt32LE(SAMPLE_RATE, 24);
        wavHeader.writeUInt32LE(SAMPLE_RATE * 2, 28);
        wavHeader.writeUInt16LE(2, 32);
        wavHeader.writeUInt16LE(16, 34);
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(dataSize, 40);

        const wavFile = Buffer.concat([wavHeader, audioData]);
        fs.writeFileSync(filePath, wavFile);
    }

    async stop(): Promise<void> {
        if (this.audioChunks.length > 0 && !this.isProcessing) {
            await this.processAudioChunk();
        }
        
        this.recordProcess?.kill();
        this.recordProcess = undefined;
    }

    async destroy(): Promise<void> {
        await this.stop();
        this.whisper = undefined;
        
        if (fs.existsSync(this.tempAudioPath)) {
            fs.unlinkSync(this.tempAudioPath);
        }
    }
}

// ==================================================================================
// TTS MODULE: ZONOS IMPLEMENTATION
// ==================================================================================

const DEFAULT_ZONOS_PORT = 5000;
const DEFAULT_PROJECT_DIR = '/home/timax/projects/zonosjs-test';

/**
 * Реализация TTSModule с использованием ZonosJS для локального синтеза речи.
 */
export class ZonosTTS implements TTSModule {
    private audioDeviceManager: AudioDeviceManager;
    private serverProcess?: ChildProcessWithoutNullStreams;
    private config: Required<TTSConfig>;
    private isSpeaking: boolean = false;

    constructor(config: TTSConfig, audioDeviceManager: AudioDeviceManager) {
        this.audioDeviceManager = audioDeviceManager;
        this.config = {
            port: config.port || DEFAULT_ZONOS_PORT,
            referenceAudio: config.referenceAudio || path.join(DEFAULT_PROJECT_DIR, 'reference.wav')
        };
        
        // Инициализация сервера
        this.initializeServer();
    }

    private async initializeServer(): Promise<void> {
        const isUp = await this.isServerUp();
        if (isUp) {
            console.log(`Обнаружен уже запущенный zonosjs на порту ${this.config.port} — перезапускаю.`);
            try { spawnSync('fuser', ['-k', `${this.config.port}/tcp`], { stdio: 'ignore' }); } catch {}
        }

        const localBin = path.join(DEFAULT_PROJECT_DIR, 'node_modules', '.bin', 'zonosjs');
        this.serverProcess = spawn(localBin, ['serve', '--port', this.config.port.toString()], {
            cwd: DEFAULT_PROJECT_DIR,
        });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Таймаут ожидания запуска сервера ZonosJS')), 60000);
            
            const tryPing = () => {
                http.get(`http://localhost:${this.config.port}`, (res) => {
                    if (res.statusCode === 200) {
                        clearTimeout(timer);
                        console.log(`✅ Сервер ZonosJS готов на http://localhost:${this.config.port}/`);
                        resolve();
                    }
                }).on('error', () => setTimeout(tryPing, 1000));
            };
            
            tryPing();
        });
    }
    
    async speak(text: string): Promise<void> {
        if (this.isSpeaking) {
            await this.stop();
        }
        
        this.isSpeaking = true;
        
        try {
            const moduleUrl = path.join(DEFAULT_PROJECT_DIR, 'node_modules/zonosjs/index.js').replace(/\\/g, '/');
            const { default: ZonosJS } = await import(`file://${moduleUrl}`);
            const client = new ZonosJS(`http://localhost:${this.config.port}`);
            
            console.log(`Генерируем речь для текста: "${text}"`);
            const audioBuffer: Buffer = await client.generateSpeech(text, this.config.referenceAudio, 'ru');
            
            await this.audioDeviceManager.playAudio(audioBuffer);
        } finally {
            this.isSpeaking = false;
        }
    }

    async stop(): Promise<void> {
        if (!this.isSpeaking) return;
        // TODO: Implement playback interruption in AudioDeviceManager
        this.isSpeaking = false;
    }

    async destroy(): Promise<void> {
        await this.stop();
        this.serverProcess?.kill();
        this.serverProcess = undefined;
    }

    private isServerUp(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get({ hostname: 'localhost', port: this.config.port, path: '/', timeout: 1000 });
            req.on('response', () => resolve(true));
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    }
}

// ==================================================================================
// AI MODULE: OPENROUTER IMPLEMENTATION
// ==================================================================================

/**
 * Реализация AIModule с использованием OpenRouter через Dialog.
 */
export class OpenRouterAI implements AIModule {
    private config: Required<AIConfig>;
    private dialog: Dialog;
    private tools: Tool[];
    private currentPromiseResolvers: { resolve: (value: string) => void; reject: (error: Error) => void } | null = null;
    private accumulatedResponse: string = '';

    constructor(config: AIConfig) {
        this.config = {
            apiKey: config.apiKey || process.env.OPENROUTER_API_KEY || '',
            model: config.model || 'deepseek/deepseek-chat-v3-0324:free',
            systemPrompt: config.systemPrompt || '',
            useVoiceTags: config.useVoiceTags !== undefined ? config.useVoiceTags : true
        };

        if (!this.config.apiKey) {
            throw new Error('API ключ не предоставлен. Установите OPENROUTER_API_KEY или передайте apiKey в конфиге.');
        }

        // Инициализация инструментов
        this.tools = [
            new ExecJSTool(),
            new TerminalTool({ timeout: 30000 })
        ];

        // Создание системного промпта
        if (!this.config.systemPrompt) {
            this.config.systemPrompt = this.createDefaultPrompt();
        }

        // Инициализация Dialog
        const provider = new OpenRouterProvider({
            token: this.config.apiKey,
            model: this.config.model
        });

        this.dialog = new Dialog({
            provider,
            tools: this.tools,
            systemPrompt: this.config.systemPrompt,
            onChange: this.handleDialogEvent.bind(this)
        });
    }

    private handleDialogEvent(event: DialogEvent): void {
        if (!this.currentPromiseResolvers) return;

        switch (event.type) {
            case 'ai_chunk':
                this.accumulatedResponse += event.chunk;
                break;
            case 'ai_response':
                this.accumulatedResponse = event.content;
                break;
            case 'done':
                this.currentPromiseResolvers.resolve(this.accumulatedResponse);
                this.currentPromiseResolvers = null;
                this.accumulatedResponse = '';
                break;
            case 'error':
                this.currentPromiseResolvers.reject(new Error(event.error));
                this.currentPromiseResolvers = null;
                this.accumulatedResponse = '';
                break;
        }
    }

    async ask(message: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.currentPromiseResolvers = { resolve, reject };
            this.accumulatedResponse = '';
            this.dialog.ask({ role: 'user', content: message });
        });
    }

    async destroy(): Promise<void> {
        // Очистка ресурсов Dialog
        this.dialog = null as any;
        this.currentPromiseResolvers = null;
    }

    private createDefaultPrompt(): string {
        const appContext = this.config.useVoiceTags 
            ? `You are a voice assistant. Your full response will be read aloud. Use <VOICE>TEXT_FOR_VOICE</VOICE> tags to specify exactly what needs to be spoken. The text inside the tags should be concise and clear for voice playback.`
            : `You are a voice assistant. Your full response will be read aloud. Keep your responses concise and clear.`;
        
        const toolDescriptions = this.tools.map(tool => tool.contextPreprompt);
        return createSystemPrompt(appContext, toolDescriptions);
    }

    /**
     * Извлекает текст из тэгов <VOICE> или возвращает весь текст.
     */
    parseVoiceResponse(text: string): string | null {
        if (!this.config.useVoiceTags) {
            return text;
        }
        
        const match = text.match(/<VOICE>([\s\S]*?)<\/VOICE>/);
        return match ? match[1].trim() : null;
    }
}

// ==================================================================================
// COMMAND MANAGER: УПРАВЛЕНИЕ ПОТОКОМ КОМАНД
// ==================================================================================

/**
 * Менеджер команд - отвечает за обработку потока команд от STT.
 */
class CommandManager {
    private commandBuffer: string[] = [];
    private lastSpeechTime: number = 0;
    private silenceCheckInterval?: NodeJS.Timeout;
    private onCommandReady?: (command: string) => void;
    private onKeywordDetected?: () => void;
    private keywordName: string;
    private silenceThreshold: number;
    private isRecording: boolean = false;

    constructor(keywordName: string, silenceThreshold: number) {
        this.keywordName = keywordName.toLowerCase();
        this.silenceThreshold = silenceThreshold;
    }

    /**
     * Начать слушать команды с проверкой тишины.
     */
    startCommandSession(onCommandReady: (command: string) => void, onKeywordDetected?: () => void): void {
        this.onCommandReady = onCommandReady;
        this.onKeywordDetected = onKeywordDetected;
        this.isRecording = false;
        
        this.silenceCheckInterval = setInterval(() => {
            if (this.isRecording && (Date.now() - this.lastSpeechTime) > this.silenceThreshold) {
                const fullCommand = this.commandBuffer.join(' ').replace(this.keywordName, '').trim();
                this.commandBuffer = [];
                this.isRecording = false;
                
                if (fullCommand && this.onCommandReady) {
                    this.onCommandReady(fullCommand);
                }
            }
        }, 200);
    }

    /**
     * Остановить сессию команд.
     */
    stopCommandSession(): void {
        if (this.silenceCheckInterval) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = undefined;
        }
        this.commandBuffer = [];
        this.isRecording = false;
    }

    /**
     * Обработать текст от транскрибера.
     */
    processTranscription(text: string): void {
        const lowerText = text.toLowerCase();
        if (!lowerText.trim()) return;

        this.lastSpeechTime = Date.now();

        if (!this.isRecording && lowerText.includes(this.keywordName)) {
            console.log(`\n🎯 Ключевое слово "${this.keywordName}" обнаружено! Слушаю команду...`);
            this.isRecording = true;
            this.commandBuffer = [text];
            if (this.onKeywordDetected) {
                this.onKeywordDetected();
            }
        } else if (this.isRecording) {
            process.stdout.write(`🎤 ... ${text}\n`);
            this.commandBuffer.push(text);
        }
    }

    /**
     * Очистить все ресурсы.
     */
    destroy(): void {
        this.stopCommandSession();
    }
}

// ==================================================================================
// VOICE ASSISTANT: ГЛАВНЫЙ ФАСАД
// ==================================================================================

/**
 * События, которые генерирует VoiceAssistant.
 */
export interface VoiceAssistantEvents {
    /** Распознан текст из речи. */
    transcription: (text: string) => void;
    /** Обнаружено ключевое слово. */
    keyword: () => void;
    /** Получена команда от пользователя (после тишины). */
    command: (command: string) => void;
    /** AI начал обрабатывать запрос. */
    processing: (command: string) => void;
    /** Получен ответ от AI. */
    response: (text: string) => void;
    /** Начато озвучивание. */
    speaking: (text: string) => void;
    /** Озвучивание завершено. */
    spoken: () => void;
    /** Произошла ошибка. */
    error: (error: Error) => void;
}

/**
 * Главный класс голосового ассистента.
 * Предоставляет простой API и управляет всеми модулями.
 */
export class VoiceAssistant extends EventEmitter {
    private config: VoiceAssistantConfig;
    private audioDeviceManager: AudioDeviceManager;
    private sttModule?: STTModule;
    private ttsModule?: TTSModule;
    private aiModule: AIModule;
    private commandManager?: CommandManager;
    private isListening: boolean = false;

    private constructor(config: VoiceAssistantConfig, modules: {
        audio: AudioDeviceManager;
        stt?: STTModule;
        tts?: TTSModule;
        ai: AIModule;
    }) {
        super();
        this.config = config;
        this.audioDeviceManager = modules.audio;
        this.sttModule = modules.stt;
        this.ttsModule = modules.tts;
        this.aiModule = modules.ai;

        if (config.keyword && this.sttModule) {
            this.commandManager = new CommandManager(
                config.keyword,
                config.silenceThreshold || 2000
            );
        }
    }

    /**
     * Создать экземпляр VoiceAssistant.
     * Это единственный способ создания - инициализация происходит автоматически.
     */
    static async create(config: Partial<VoiceAssistantConfig>): Promise<VoiceAssistant> {
        // Заполняем дефолтными значениями
        const fullConfig: VoiceAssistantConfig = {
            ai: {
                apiKey: config.ai?.apiKey || process.env.OPENROUTER_API_KEY,
                model: config.ai?.model || 'deepseek/deepseek-chat-v3-0324:free',
                systemPrompt: config.ai?.systemPrompt,
                useVoiceTags: config.ai?.useVoiceTags !== undefined ? config.ai.useVoiceTags : true,
                ...config.ai
            },
            stt: config.stt,
            tts: config.tts,
            devices: config.devices,
            keyword: config.keyword,
            silenceThreshold: config.silenceThreshold || 2000
        };

        // Инициализация AudioDeviceManager
        const audioManager = new AudioDeviceManager();
        await audioManager.initialize();

        // Создание модулей
        const aiModule = new OpenRouterAI(fullConfig.ai);

        const sttModule = fullConfig.stt 
            ? new WhisperSTT(fullConfig.stt, audioManager)
            : undefined;

        const ttsModule = fullConfig.tts 
            ? new ZonosTTS(fullConfig.tts, audioManager)
            : undefined;

        console.log('✅ VoiceAssistant инициализирован');
        
        return new VoiceAssistant(fullConfig, {
            audio: audioManager,
            stt: sttModule,
            tts: ttsModule,
            ai: aiModule
        });
    }

    /**
     * Отправить текстовую команду AI и получить ответ.
     * @param text - Текст команды
     * @returns Полный ответ от AI
     */
    async ask(text: string): Promise<string> {
        this.emit('processing', text);
        
        try {
            console.log(`🤖 Отправляю команду в AI: "${text}"`);
            const response = await this.aiModule.ask(text);
            
            console.log(chalk.green(`\n🤖 Ответ AI: ${response}`));
            this.emit('response', response);

            // Если TTS доступен, озвучиваем ответ
            if (this.ttsModule) {
                const textToSpeak = (this.aiModule as OpenRouterAI).parseVoiceResponse(response);
                if (textToSpeak) {
                    console.log(chalk.cyan(`\n🔊 Для озвучивания: "${textToSpeak}"`));
                    this.emit('speaking', textToSpeak);
                    await this.ttsModule.speak(textToSpeak);
                    this.emit('spoken');
                }
            }

            return response;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            console.error(chalk.red(`\n❌ Ошибка: ${err.message}`));
            this.emit('error', err);
            throw err;
        }
    }

    /**
     * Запустить прослушивание микрофона.
     * Работает только если STT модуль был настроен.
     */
    async startListening(): Promise<void> {
        if (!this.sttModule) {
            throw new Error('STT модуль не настроен. Добавьте конфигурацию stt при создании.');
        }

        if (this.isListening) {
            console.warn('Прослушивание уже запущено.');
            return;
        }

        console.log(`👂 Начинаю прослушивание${this.config.keyword ? ` (ключевое слово: "${this.config.keyword}")` : ''}...`);
        
        this.isListening = true;

        if (this.commandManager) {
            // Режим с ключевым словом
            this.commandManager.startCommandSession(
                async (command) => {
                    this.emit('command', command);
                    await this.ask(command);
                },
                () => {
                    this.emit('keyword');
                }
            );

            await this.sttModule.start((text) => {
                this.emit('transcription', text);
                this.commandManager!.processTranscription(text);
            });
        } else {
            // Режим без ключевого слова - обрабатываем все транскрипции
            await this.sttModule.start(async (text) => {
                this.emit('transcription', text);
                this.emit('command', text);
                await this.ask(text);
            });
        }
    }

    /**
     * Остановить прослушивание микрофона.
     */
    async stopListening(): Promise<void> {
        if (!this.isListening) return;
        
        console.log('🛑 Останавливаю прослушивание...');
        
        if (this.commandManager) {
            this.commandManager.stopCommandSession();
        }
        
        await this.sttModule?.stop();
        this.isListening = false;
    }

    /**
     * Освободить все ресурсы.
     */
    async destroy(): Promise<void> {
        console.log('Освобождение ресурсов...');
        
        await this.stopListening();
        
        if (this.commandManager) {
            this.commandManager.destroy();
        }
        
        await this.sttModule?.destroy();
        await this.ttsModule?.destroy();
        await this.aiModule?.destroy();
        
        this.removeAllListeners();
        
        console.log('✅ Ресурсы освобождены.');
    }
}

// ==================================================================================
// EXPORT DEFAULT
// ==================================================================================

export default VoiceAssistant;

