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


// ==================================================================================
// PHASE 1, TASK 1.1: DEFINE INTERFACES AND STATES
// ==================================================================================

/**
 * Перечисление состояний голосового ассистента для управления через конечный автомат.
 */
export enum VoiceState {
    IDLE,                  // Ресурсы не захвачены
    INITIALIZING,          // Идет инициализация
    LISTENING_FOR_KEYWORD, // Ожидание ключевого слова
    RECORDING_COMMAND,     // Идет запись команды
    AWAITING_AI_RESPONSE,  // Ожидание ответа от Dialog
    SPEAKING,              // Синтез и воспроизведение речи
    DESTROYING,            // Освобождение ресурсов
}

/**
 * Интерфейс для движка распознавания речи (Speech-to-Text).
 */
export interface ITranscriber {
    /** Инициализирует модель и ресурсы. */
    initialize(): Promise<void>;
    /** Начинает прослушивание, вызывая колбэк при получении результата. */
    start(onResult: (text: string) => void): Promise<void>;
    /** Останавливает текущее прослушивание. */
    stop(): Promise<void>;
    /** Освобождает все ресурсы. */
    destroy(): Promise<void>;
}

/**
 * Интерфейс для движка синтеза речи (Text-to-Speech).
 */
export interface ITextToSpeech {
    /** Инициализирует сервер и ресурсы. */
    initialize(): Promise<void>;
    /** Синтезирует и воспроизводит речь. */
    speak(text: string): Promise<void>;
    /** Прерывает текущее воспроизведение. */
    stop(): Promise<void>;
    /** Освобождает все ресурсы. */
    destroy(): Promise<void>;
}

// ==================================================================================
// PHASE 1, TASK 1.3: CREATE DEFAULT IMPLEMENTATION CLASSES
// ==================================================================================

const SAMPLE_RATE = 16000;
const WHISPER_MODEL = 'tiny'; // Более точная модель (~140MB), лучше для русского языка
const MODEL_PATH = path.resolve(__dirname, '../node_modules/whisper-node/lib/whisper.cpp/models');
const CHUNK_DURATION_MS = 2000; // Длительность аудиочанка для распознавания (3 секунды)
const CALIBRATION_SAMPLES = 3; // Количество сэмплов для начальной калибровки
const SILENCE_MULTIPLIER = 1.3; // Множитель для определения порога тишины (среднее * 1.5)
const ADAPTATION_WEIGHT = 0.1; // Вес новых значений при адаптации (10%)

/**
 * Реализация ITranscriber с использованием Whisper для локального распознавания речи.
 */
class WhisperTranscriber implements ITranscriber {
    private audioDeviceManager: AudioDeviceManager;
    private recordProcess?: ChildProcessWithoutNullStreams | any;
    private onResultCallback?: (text: string) => void;
    private whisper?: any;
    private audioChunks: Buffer[] = [];
    private chunkStartTime: number = 0;
    private isProcessing: boolean = false;
    private tempAudioPath: string = path.join(__dirname, 'temp_chunk.wav');
    
    // Динамическая калибровка тишины
    private calibrationSamples: number[] = [];
    private isCalibrated: boolean = false;
    private averageNoiseLevel: number = 0;
    private silenceThreshold: number = 500; // Начальное значение

    constructor() {
        this.audioDeviceManager = new AudioDeviceManager();
    }

    async initialize(): Promise<void> {
        await this.audioDeviceManager.initialize();
        
        // Инициализация Whisper
        if (!fs.existsSync(MODEL_PATH)) {
            fs.mkdirSync(MODEL_PATH, { recursive: true });
        }

        console.log('🔧 Инициализация Whisper...');
        // whisper-node использует функцию напрямую, а не конструктор
        // Мы просто сохраняем ссылку на функцию для последующего использования
        this.whisper = nodewhisper;
        console.log('✅ Whisper готов к работе.');
    }
    
    async start(onResult: (text: string) => void): Promise<void> {
        this.onResultCallback = onResult;
        
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
            
            // Проверяем, накопилось ли достаточно данных для распознавания
            const elapsedTime = Date.now() - this.chunkStartTime;
            if (elapsedTime >= CHUNK_DURATION_MS && !this.isProcessing) {
                this.processAudioChunk();
            }
        });

        this.recordProcess.stderr.on('data', (data: Buffer) => {
            console.error(`❌ Ошибка arecord: ${data}`);
        });

        this.recordProcess.on('close', (code: number) => {
            if (code !== 0 && code !== null) {
                console.warn(`Процесс записи завершился с кодом ${code}`);
            }
        });
    }

    private calculateRMS(buffer: Buffer): number {
        // Вычисляем RMS (Root Mean Square) для определения громкости
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

        // Вычисляем уровень громкости
        const rmsLevel = this.calculateRMS(audioData);
        
        // Фаза калибровки
        if (!this.isCalibrated) {
            this.calibrationSamples.push(rmsLevel);
            console.log(chalk.cyan(`🔧 Калибровка... (${this.calibrationSamples.length}/${CALIBRATION_SAMPLES}) Уровень: ${rmsLevel.toFixed(0)}`));
            
            if (this.calibrationSamples.length >= CALIBRATION_SAMPLES) {
                // Вычисляем средний уровень шума
                this.averageNoiseLevel = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
                // Устанавливаем порог тишины как среднее * множитель
                this.silenceThreshold = this.averageNoiseLevel * SILENCE_MULTIPLIER;
                this.isCalibrated = true;
                console.log(chalk.green(`✅ Калибровка завершена! Средний шум: ${this.averageNoiseLevel.toFixed(0)}, Порог тишины: ${this.silenceThreshold.toFixed(0)}`));
            }
            
            this.isProcessing = false;
            return;
        }
        
        // Адаптивное обновление среднего уровня шума (только для тихих сэмплов)
        if (rmsLevel < this.silenceThreshold) {
            this.averageNoiseLevel = this.averageNoiseLevel * (1 - ADAPTATION_WEIGHT) + rmsLevel * ADAPTATION_WEIGHT;
            this.silenceThreshold = this.averageNoiseLevel * SILENCE_MULTIPLIER;
        }
        
        const isSilent = rmsLevel < this.silenceThreshold;
        
        console.log(chalk.gray(`📊 Уровень: ${rmsLevel.toFixed(0)} | Порог: ${this.silenceThreshold.toFixed(0)} | Шум: ${this.averageNoiseLevel.toFixed(0)} ${isSilent ? '🔇' : '🔊'}`));

        // Пропускаем обработку если это тишина
        if (isSilent) {
            this.isProcessing = false;
            return;
        }

        try {
            // Сохраняем аудио во временный файл
            await this.saveWavFile(audioData, this.tempAudioPath);
            
            console.log(chalk.blue(`🎙️ Отправка на распознавание...`));
            
            // Распознаем речь
            const result = await this.whisper(this.tempAudioPath, {
                modelPath: path.join(MODEL_PATH, `ggml-${WHISPER_MODEL}.bin`),
                whisperOptions: {
                    language: 'ru',
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
                    if (this.onResultCallback) {
                        this.onResultCallback(text);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Ошибка распознавания:', error);
        } finally {
            this.isProcessing = false;
            // Удаляем временный файл
            if (fs.existsSync(this.tempAudioPath)) {
                fs.unlinkSync(this.tempAudioPath);
            }
        }
    }

    private async saveWavFile(audioData: Buffer, filePath: string): Promise<void> {
        // Создаем WAV заголовок
        const wavHeader = Buffer.alloc(44);
        const dataSize = audioData.length;
        const fileSize = dataSize + 36;

        // RIFF chunk descriptor
        wavHeader.write('RIFF', 0);
        wavHeader.writeUInt32LE(fileSize, 4);
        wavHeader.write('WAVE', 8);

        // fmt sub-chunk
        wavHeader.write('fmt ', 12);
        wavHeader.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        wavHeader.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
        wavHeader.writeUInt16LE(1, 22); // NumChannels (1 for mono)
        wavHeader.writeUInt32LE(SAMPLE_RATE, 24); // SampleRate
        wavHeader.writeUInt32LE(SAMPLE_RATE * 2, 28); // ByteRate
        wavHeader.writeUInt16LE(2, 32); // BlockAlign
        wavHeader.writeUInt16LE(16, 34); // BitsPerSample

        // data sub-chunk
        wavHeader.write('data', 36);
        wavHeader.writeUInt32LE(dataSize, 40);

        // Записываем файл
        const wavFile = Buffer.concat([wavHeader, audioData]);
        fs.writeFileSync(filePath, wavFile);
    }

    async stop(): Promise<void> {
        // Обрабатываем оставшиеся данные перед остановкой
        if (this.audioChunks.length > 0 && !this.isProcessing) {
            await this.processAudioChunk();
        }
        
        this.recordProcess?.kill();
        this.recordProcess = undefined;
    }

    async destroy(): Promise<void> {
        await this.stop();
        this.whisper = undefined;
        
        // Очистка временных файлов
        if (fs.existsSync(this.tempAudioPath)) {
            fs.unlinkSync(this.tempAudioPath);
        }
    }
}

/**
 * Реализация ITextToSpeech с использованием ZonosJS для локального синтеза речи.
 */
class ZonosTTSEngine implements ITextToSpeech {
    private audioDeviceManager: AudioDeviceManager;
    private serverProcess?: ChildProcessWithoutNullStreams;
    private readonly port = 5000;
    private readonly projectDir: string = '/home/timax/projects/zonosjs-test';
    private readonly referenceAudio: string = path.join(this.projectDir, 'reference.wav');

    constructor(audioDeviceManager: AudioDeviceManager) {
        this.audioDeviceManager = audioDeviceManager;
    }

    async initialize(): Promise<void> {
        const isUp = await this.isServerUp();
        if (isUp) {
            console.log(`Обнаружен уже запущенный zonosjs на порту ${this.port} — перезапускаю.`);
            try { spawnSync('fuser', ['-k', `${this.port}/tcp`], { stdio: 'ignore' }); } catch {}
        }

        const localBin = path.join(this.projectDir, 'node_modules', '.bin', 'zonosjs');
        this.serverProcess = spawn(localBin, ['serve', '--port', this.port.toString()], {
            cwd: this.projectDir,
        });

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Таймаут ожидания запуска сервера ZonosJS')), 60000);
            
            const tryPing = () => {
                http.get(`http://localhost:${this.port}`, (res) => {
                    if (res.statusCode === 200) {
                        clearTimeout(timer);
                        console.log(`✅ Сервер ZonosJS готов на http://localhost:${this.port}/`);
                        resolve();
                    }
                }).on('error', () => setTimeout(tryPing, 1000));
            };
            
            tryPing();
        });
    }
    
    async speak(text: string): Promise<void> {
        const moduleUrl = path.join(this.projectDir, 'node_modules/zonosjs/index.js').replace(/\\/g, '/');
        const { default: ZonosJS } = await import(`file://${moduleUrl}`);
        const client = new ZonosJS(`http://localhost:${this.port}`);
        
        console.log(`Генерируем речь для текста: "${text}"`);
        const audioBuffer: Buffer = await client.generateSpeech(text, this.referenceAudio, 'ru');
        
        await this.audioDeviceManager.playAudio(audioBuffer);
    }

    async stop(): Promise<void> {
        // TODO: Implement playback interruption in AudioDeviceManager
    }

    async destroy(): Promise<void> {
        this.serverProcess?.kill();
        this.serverProcess = undefined;
    }

    private isServerUp(): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get({ hostname: 'localhost', port: this.port, path: '/', timeout: 1000 });
            req.on('response', () => resolve(true));
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
    }
}

// ==================================================================================
// PHASE 1, TASK 1.2 & 1.4: REFACTOR VOICE CLASS
// ==================================================================================

/**
 * Опции для конфигурации экземпляра Voice.
 */
interface VoiceOptions {
    /** API ключ для провайдера нейросети (например, OpenRouter). */
    apikey?: string;
    /** Идентификатор модели нейросети. */
    model?: string;
    /** Системный промпт для AI. */
    system_prompt?: string;
    /** Имя-активатор для ассистента. */
    name?: string;
    /** Порог тишины в миллисекундах для определения конца команды. */
    silenceThreshold?: number;
    /** Кастомная реализация движка распознавания речи. */
    transcriber?: ITranscriber;
    /** Кастомная реализация движка синтеза речи. */
    tts?: ITextToSpeech;
    /** Включить ли функцию распознавания речи. По умолчанию true. */
    enableTranscription?: boolean;
    /** Включить ли функцию синтеза речи. По умолчанию true. */
    enableTTS?: boolean;
    /** Использовать ли второй AI для генерации кратких ответов. По умолчанию false. */
    useAnnouncerAI?: boolean;
}

/**
 * Главный класс голосового ассистента.
 * Управляет жизненным циклом, взаимодействием с AI, STT и TTS.
 */
class Voice {
    private state: VoiceState = VoiceState.IDLE;
    private options: VoiceOptions;
    private transcriber: ITranscriber;
    private tts: ITextToSpeech;
    private audioDeviceManager: AudioDeviceManager;
    private dialog?: Dialog;
    private aiProvider?: AIProvider;
    private commandBuffer: string[] = [];
    private lastSpeechTime: number = 0;
    private silenceCheckInterval?: NodeJS.Timeout;

    constructor(options: VoiceOptions = {}) {
        this.options = {
            name: 'алиса',
            silenceThreshold: 2000,
            enableTranscription: true,
            enableTTS: false, // Временно отключено для тестирования
            useAnnouncerAI: false,
            ...options
        };

        this.audioDeviceManager = new AudioDeviceManager();

        this.transcriber = this.options.transcriber || new WhisperTranscriber();
        this.tts = this.options.tts || new ZonosTTSEngine(this.audioDeviceManager);

        if (!this.options.apikey && !process.env.OPENROUTER_API_KEY) {
            console.warn("API ключ не предоставлен. AI-функции будут недоступны.");
        } else {
            this.aiProvider = new OpenRouterProvider({
                token: this.options.apikey || process.env.OPENROUTER_API_KEY || '',
                model: this.options.model || 'google/gemini-flash-1.5',
            });
        }
    }

    /**
     * Инициализирует все необходимые ресурсы и сервисы (STT, TTS, AI).
     * Переводит ассистент в рабочее состояние.
     */
    public async initialize(): Promise<void> {
        if (this.state !== VoiceState.IDLE) {
            console.warn(`Попытка инициализации в состоянии ${this.state}. Игнорируется.`);
            return;
        }

        console.log("Инициализация голосового ассистента...");
        this.state = VoiceState.INITIALIZING;

        try {
            await this.audioDeviceManager.initialize();

            if (this.options.enableTranscription) {
                await this.transcriber.initialize();
            }
            if (this.options.enableTTS) {
                await this.tts.initialize();
            }
            
            this.initializeDialog();

            this.state = VoiceState.LISTENING_FOR_KEYWORD;
            console.log("✅ Ассистент инициализирован и готов к работе.");
        } catch (error) {
            console.error("❌ Ошибка при инициализации:", error);
            this.state = VoiceState.IDLE;
        }
    }

    /**
     * Запускает основной цикл прослушивания микрофона.
     */
    public async startListening(): Promise<void> {
        if (this.state !== VoiceState.LISTENING_FOR_KEYWORD) {
            console.warn(`Нельзя начать прослушивание в состоянии ${this.state}.`);
                            return;
                        }
        if (!this.options.enableTranscription) {
            console.log("Распознавание речи отключено. Прослушивание невозможно.");
                            return;
                        }

        console.log(`👂 Ожидание ключевого слова "${this.options.name}"...`);
        this.transcriber.start(this.handleTranscriptionResult.bind(this));

        this.silenceCheckInterval = setInterval(async () => {
            if (this.state === VoiceState.RECORDING_COMMAND && (Date.now() - this.lastSpeechTime) > (this.options.silenceThreshold || 2000)) {
                const fullCommand = this.commandBuffer.join(' ').replace(this.options.name || 'алиса', '').trim();
                this.commandBuffer = [];
                
                if (fullCommand) {
                    await this.ask(fullCommand);
                } else {
                    console.log("Команда не распознана, возврат в режим ожидания.");
                    this.state = VoiceState.LISTENING_FOR_KEYWORD;
                }
            }
        }, 200);
    }

    /**
     * Останавливает все процессы и освобождает захваченные ресурсы.
     */
    public async destroy(): Promise<void> {
        if (this.state === VoiceState.IDLE) return;
        
        if (this.silenceCheckInterval) {
            clearInterval(this.silenceCheckInterval);
            this.silenceCheckInterval = undefined;
        }
        
        console.log("Освобождение ресурсов...");
        this.state = VoiceState.DESTROYING;

        await this.transcriber.destroy();
        await this.tts.destroy();
        this.dialog = undefined;
        
        this.state = VoiceState.IDLE;
        console.log("✅ Ресурсы освобождены.");
    }

    /**
     * Отправляет текстовую команду AI на обработку.
     * @param command - Текстовая команда.
     */
    public async ask(command: string): Promise<void> {
        if (!this.dialog) {
            console.error("Dialog не инициализирован. Вызовите initialize() сначала.");
            return;
        }
        if (this.state !== VoiceState.LISTENING_FOR_KEYWORD && this.state !== VoiceState.RECORDING_COMMAND) {
            console.warn(`Вызов ask в состоянии ${this.state}. Может привести к неожиданному поведению.`);
        }

        this.state = VoiceState.AWAITING_AI_RESPONSE;
        console.log(`🤖 Отправляю команду в Dialog: "${command}"`);
        this.dialog.ask({ role: 'user', content: command });
    }

    private initializeDialog(): void {
        if (!this.aiProvider) {
            console.error("AI Provider не инициализирован. Невозможно создать Dialog.");
            return;
        }

        const tools = [
            new ExecJSTool(),
            new TerminalTool({ timeout: 30000 })
        ];

        const systemPrompt = this.options.system_prompt || this.createSystemPrompt(tools);

        this.dialog = new Dialog({
            provider: this.aiProvider,
            tools: tools,
            systemPrompt: systemPrompt,
            onChange: this.handleDialogEvent.bind(this),
        });
    }

    private createSystemPrompt(tools: Tool[]): string {
        const appContext = `You are a voice assistant named "${this.options.name || 'Assistant'}".
        Communication Guidelines: Always use "we" when referring to our work together.
        ${this.options.useAnnouncerAI 
            ? "Your full, detailed response will be processed by a secondary AI to create a concise summary for voice playback. Focus on providing the best and most complete answer."
            : "Your full response will be read aloud. Use <VOICE>TEXT_FOR_VOICE</VOICE> tags to specify exactly what needs to be spoken. The text inside the tags should be concise and clear for voice playback."
        }`;
        
        const toolDescriptions = tools.map(tool => tool.contextPreprompt);
        return createSystemPrompt(appContext, toolDescriptions);
    }

    private async handleDialogEvent(event: DialogEvent): Promise<void> {
        console.log(`[Dialog Event] ${event.type}`); // Basic logging
        switch (event.type) {
            case 'ai_response':
                this.state = VoiceState.SPEAKING;
                let textToSpeak: string | null = null;
                if (this.options.useAnnouncerAI) {
                    // textToSpeak = await this.getSpeakableResponse(event.content);
                    console.warn("Режим Announcer AI еще не реализован.");
                    textToSpeak = "Задача выполнена."; // Placeholder
                } else {
                    textToSpeak = this.parseVoiceTags(event.content);
                }

                // Выводим ответ в консоль
                console.log(chalk.green(`\n🤖 Ответ AI: ${event.content}`));
                if (textToSpeak) {
                    console.log(chalk.cyan(`\n🔊 Для озвучивания: "${textToSpeak}"`));
                    
                    // Озвучиваем только если TTS включен
                    if (this.options.enableTTS) {
                        await this.tts.speak(textToSpeak);
                    }
                }
                this.state = VoiceState.LISTENING_FOR_KEYWORD;
                break;
            
            case 'done':
                if (this.state !== VoiceState.SPEAKING) {
                    this.state = VoiceState.LISTENING_FOR_KEYWORD;
                }
                console.log("✅ Обработка команды завершена.");
                break;

            case 'error':
                console.error(chalk.red(`\n❌ Ошибка в диалоге: ${event.error}`));
                this.state = VoiceState.SPEAKING;
                
                // Озвучиваем ошибку только если TTS включен
                if (this.options.enableTTS) {
                    await this.tts.speak("Произошла ошибка. Пожалуйста, попробуйте еще раз.");
                }
                
                this.state = VoiceState.LISTENING_FOR_KEYWORD;
                break;
        }
    }

    private parseVoiceTags(text: string): string | null {
        const match = text.match(/<VOICE>([\s\S]*?)<\/VOICE>/);
        return match ? match[1].trim() : null;
    }

    private handleTranscriptionResult(text: string): void {
        const lowerText = text.toLowerCase();
        
        if (!lowerText.trim()) return;

        this.lastSpeechTime = Date.now();

        if (this.state === VoiceState.LISTENING_FOR_KEYWORD && lowerText.includes(this.options.name || 'алиса')) {
            console.log(`\n🎯 Ключевое слово "${this.options.name}" обнаружено! Слушаю команду...`);
            this.state = VoiceState.RECORDING_COMMAND;
            this.commandBuffer = [text];
        } else if (this.state === VoiceState.RECORDING_COMMAND) {
            process.stdout.write(`🎤 ... ${text}\n`);
            this.commandBuffer.push(text);
        }
    }
}

export default Voice;

console.log('[DEBUG] Файл lib/voice.ts загружен. Запуск основного блока...');

const voice = new Voice();

// Self-execution block for running with `npx tsx lib/voice.ts`
(async () => {
    console.log("[DEBUG] Внутри async блока. Запуск голосового ассистента...");
    
    await voice.initialize();
    console.log("[DEBUG] voice.initialize() завершен.");
    
    await voice.startListening();
    console.log("[DEBUG] voice.startListening() запущен.");

    console.log("Ассистент запущен. Нажмите Ctrl+C для выхода.");

    process.on('SIGINT', async () => {
        console.log("\nПолучен сигнал SIGINT. Завершение работы...");
        await voice.destroy();
        process.exit(0);
    });
})().catch(error => {
    console.error("[DEBUG] КРИТИЧЕСКАЯ ОШИБКА:", error);
    process.exit(1);
});

