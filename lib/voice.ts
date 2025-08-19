import AudioDeviceManager from './voice-device';
import { OpenRouterProvider } from './ai/providers/openrouter';
import type { AIMessage } from './ai/ai';
import path from 'path';
import * as fs from 'fs';
import { WaveFile as WaveFileOriginal } from 'wavefile';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawnSync } from 'child_process';
import AdmZip from 'adm-zip';
import * as vosk from 'vosk';
import * as https from 'https';

const DEFAULT_MODEL_STT = 'vosk-model-small-ru-0.22';
const MODEL_PATH = path.resolve(__dirname, './models', DEFAULT_MODEL_STT);
const SAMPLE_RATE = 16000;

class Voice {
    private apikey: string;
    private model?: string;
    private temperature?: number;
    private max_tokens?: number;
    private system_prompt?: string;
    private defaultInputDevice: any;
    private defaultOutputDevice: any;
    private devices: any[];
    private name: string;
    private silenceThreshold: number;
    private isProcessing: boolean = false;
    private currentAbortController?: AbortController;
    private aiProvider?: OpenRouterProvider;
    
    // Добавляем поля для управления TTS
    private ttsQueue: Array<{ text: string; abortController: AbortController }> = [];
    private currentTTS?: { text: string; abortController: AbortController };
    private isTTSActive: boolean = false;

    // Восстанавливаем поля для активации по ключевому слову
    private isListening: boolean = false;
    private commandBuffer: string[] = [];
    private lastSpeechTime: number = 0;
    private lastPartialResult: string = '';
    private currentInputDevice: any;

    // Фоновый слушатель и ожидатели результатов
    private listeningStarted: boolean = false;
    private pendingResolvers: Array<(text: string) => void> = [];
    private arecordProcess?: any;
    private audioInputStream?: NodeJS.ReadableStream;
    private vadInstance?: any;
    private utteranceChunks: Buffer[] = [];
    private isAwaitingCommand: boolean = false;
    private commandParts: string[] = [];
    private silenceTimer: NodeJS.Timeout | null = null;
    private zonosProjectDir: string;
    private defaultReferencePath: string;
    private resultsQueue: Array<{ id: number; text: string; ts: number }> = [];
    private lastFinalResult: string = '';
    private utteranceCounter: number = 0;
    private resultWatcherInterval?: NodeJS.Timeout;

    // Таймеры для проверки тишины и изменений устройств
    private silenceCheckInterval?: NodeJS.Timeout;
    private deviceCheckInterval?: NodeJS.Timeout;

    
    constructor(
        apikey?: string, 
        model?: string, 
        system_prompt?: string,
        name: string = 'алиса',
        temperature?: number, 
        max_tokens?: number, 
        defaultInputDevice?: any,
        defaultOutputDevice?: any,
        devices?: any[],
        silenceThreshold: number = 2000,

    ) {
        this.apikey = apikey || process.env.OPENROUTER_API_KEY || '';
        this.model = model;
        this.temperature = temperature;
        this.max_tokens = max_tokens;
        
        this.system_prompt = system_prompt || `You are a voice assistant named "${name}". The user addresses you by this name.

We are working together on this project. When we need to execute code, analyze data, or perform operations, we work as a team.

**Communication Guidelines:**
- Always use "we" when referring to our work together ("we implemented", "we will try", "we observed", "we succeeded", "we agree", "we made a mistake")
- Execute code ONLY when calculations, demonstrations, or verification are actually needed
- For simple questions, conversations, or general knowledge - respond directly without code execution
- Use proper error handling and provide helpful explanations
- Keep responses focused and practical
- Since this is a voice interface, keep responses concise and easy to listen to and hear.

**IMPORTANT CODE EXECUTION RULES:**
- When you need to execute JavaScript, you MUST use the exact format: > 😈<uuid>/do/exec/js followed by \`\`\`js
- When you need to execute TypeScript, you MUST use the exact format: > 😈<uuid>/do/exec/tsx followed by \`\`\`tsx
- When you need to execute terminal commands, you MUST use the exact format: > 😈<uuid>/do/terminal/bash followed by \`\`\`bash
- NEVER use \`\`\`javascript or \`\`\`typescript or \`\`\`terminal - always use the exact formats above
- Always generate a unique UUID for each operation (use crypto.randomUUID() pattern)
- Only execute code when it's actually necessary to answer the question

**Examples:**
> 😈calc-123e4567-e89b-12d3-a456-426614174000/do/exec/js
\`\`\`js
2 + 2
\`\`\`

> 😈types-123e4567-e89b-12d3-a456-426614174001/do/exec/tsx
\`\`\`tsx
interface User { id: number; name: string }
const user: User = { id: 1, name: "John" };
user
\`\`\`

> 😈cmd-123e4567-e89b-12d3-a456-426614174002/do/terminal/bash
\`\`\`bash
echo "Hello World"
\`\`\`

**Voice Interface Rules:**
- The user will not see all of your text that you write.
- The user will only hear your text in this format: <VOICE>TEXT_FOR_VOICE</VOICE>
- Your answer in this format should be concise, understandable, and easy to listen to and hear.

**Important:** Don't separate yourself from the user - we are working together as a team. Only execute code when it's actually necessary to answer the question.`;
        
        this.defaultInputDevice = defaultInputDevice;
        this.defaultOutputDevice = defaultOutputDevice;
        this.devices = devices || [];
        this.name = name.toLowerCase();
        this.silenceThreshold = silenceThreshold;
        this.zonosProjectDir = '/home/timax/projects/zonosjs-test';
        this.defaultReferencePath = '/home/timax/projects/zonosjs-test/reference.wav';
    }

    public async initialize(): Promise<void> {
        try {
            await this.device();
            void this.transcribe();
            
            // Обработчик результатов только для команд, прошедших через активацию
            if (this.resultWatcherInterval) clearInterval(this.resultWatcherInterval);
            this.resultWatcherInterval = setInterval(async () => {
                while (this.resultsQueue.length > 0) {
                    const item = this.resultsQueue.shift();
                    if (!item) break;
                    
                    console.log('🔔 Обрабатываю команду:', item.text);
                    try {
                        const resultAsk = await this.ask(item.text);
                        console.log('🔔 Ответ нейросети:', resultAsk);
                    } catch (error) {
                        if (error instanceof Error && error.message.includes('Прервано пользователем')) {
                            console.log('🛑 Команда прервана пользователем');
                        } else {
                            console.error('❌ Ошибка при обработке команды:', error);
                        }
                    }
                }
            }, 100);
        } catch (error) {
            console.error('❌ Ошибка при инициализации:', error);
        }
    }

    public async initializeProvider(): Promise<void> {
        const token = this.apikey || process.env.OPENROUTER_API_KEY || '';
        if (!token) {
            throw new Error('OPENROUTER_API_KEY отсутствует. Установите переменную окружения или передайте ключ в конструктор Voice.');
        }
        this.aiProvider = new OpenRouterProvider({
            token,
            model: this.model || 'deepseek/deepseek-chat-v3-0324:free',
            temperature: this.temperature ?? 0.7,
            max_tokens: this.max_tokens,
            timeout: 120000
        });
    }

    public interruptCurrentProcess(): void {
        console.log('🛑 Прерываю все текущие процессы...');
        
        // Отменяем генерацию ИИ
        if (this.currentAbortController) {
            this.currentAbortController.abort();
        }
        
        // Прерываем текущую TTS
        if (this.currentTTS) {
            this.currentTTS.abortController.abort();
            this.currentTTS = undefined;
        }
        
        // Очищаем очередь TTS
        if (this.ttsQueue.length > 0) {
            this.ttsQueue.forEach(tts => tts.abortController.abort());
            this.ttsQueue = [];
        }
        
        this.isProcessing = false;
        this.isTTSActive = false;
    }

    public async device(inputDevice?: any, outputDevice?: any): Promise<void> {
        const manager = new AudioDeviceManager();
        await manager.initialize();
        
        const { defaultInputDevice, defaultOutputDevice } = manager.findDefaultDevices(inputDevice, outputDevice);
        const devices = manager.getDevices();
        
        this.defaultInputDevice = defaultInputDevice;
        this.defaultOutputDevice = defaultOutputDevice;
        this.devices = devices;

        console.log('Найдены устройства:');
        console.log('Микрофон:', this.defaultInputDevice?.name || 'не найден');
        console.log('Динамики:', this.defaultOutputDevice?.name || 'не найдены');
    }


    public async transcribe(): Promise<void> {
        console.log('🎤 Запуск транскрибатора (микрофон + Vosk)...');
        if (!fs.existsSync(MODEL_PATH)) {
            console.log('ℹ️ Модель отсутствует, запускаю установку...');
            const modelUrl = 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip';
            const zipPath = path.resolve(__dirname, './models/vosk-model.zip');

            if (fs.existsSync(zipPath)) {
                try { fs.unlinkSync(zipPath); } catch {}
            }

            console.log('⏳ Начинаю загрузку модели...');
            console.log(`📥 Загрузка модели с ${modelUrl}`);
            await new Promise<void>((resolve, reject) => {
                const file = fs.createWriteStream(zipPath);
                let downloadedBytes = 0;
                let totalBytes = 0;

                https.get(modelUrl, (response) => {
                    totalBytes = parseInt(response.headers['content-length'] || '0', 10);
                    console.log(`📦 Общий размер файла: ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
                    response.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        const progress = (downloadedBytes / totalBytes * 100).toFixed(2);
                        process.stdout.write(`\r📥 Загрузка: ${progress}% (${(downloadedBytes / 1024 / 1024).toFixed(2)}MB)`);
                    });
                    response.on('end', () => {
                        process.stdout.write('\n');
                        file.end();
                    });
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        console.log('✅ Загрузка модели завершена.');
                        resolve();
                    });
                }).on('error', (err) => {
                    fs.unlink(zipPath, () => {});
                    console.error('❌ Ошибка при загрузке модели:', err);
                    reject(err);
                });
            });

            try {
                console.log('📦 Начинаю распаковку модели...');
                const zip = new AdmZip(zipPath);
                const zipEntries = zip.getEntries();
                const rootDir = zipEntries[0].entryName.split('/')[0];
                console.log(`📂 Распаковка ${zipEntries.length} файлов...`);
                const modelsDir = path.resolve(__dirname, './models');
                if (!fs.existsSync(modelsDir)) {
                    fs.mkdirSync(modelsDir, { recursive: true });
                }
                zip.extractAllTo(modelsDir, true);
                console.log(`📂 Распаковка завершена: ${zipEntries.length} файлов`);
                fs.renameSync(path.resolve(modelsDir, rootDir), MODEL_PATH);
                console.log('✅ Базовая модель успешно установлена.');
            } catch (err) {
                console.error('❌ Ошибка при установке модели:', err);
                throw err;
            } finally {
                const zipPath = path.resolve(__dirname, './models/vosk-model.zip');
                if (fs.existsSync(MODEL_PATH) && fs.existsSync(zipPath)) {
                    try { fs.unlinkSync(zipPath); } catch {}
                    console.log('🗑️ Временный zip-файл удален.');
                }
            }
        }

        // Инициализация Vosk
        vosk.setLogLevel(-1);
        const model = new vosk.Model(MODEL_PATH);
        const recognizer = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE });

        // Запуск устройства захвата звука
        const deviceManager = new AudioDeviceManager();
        await deviceManager.initialize();
        let selectedInputDevice = this.defaultInputDevice;
        if (!selectedInputDevice) {
            selectedInputDevice = await deviceManager.getBestInputDevice();
        }
        if (!selectedInputDevice) {
            console.error('❌ Не удалось определить устройство ввода. Выход.');
            try { recognizer.free(); } catch {}
            try { model.free(); } catch {}
            return;
        }
        
        // Инициализируем текущее устройство для отслеживания изменений
        this.currentInputDevice = selectedInputDevice;
        console.log(`🎧 Использую устройство ввода: ${selectedInputDevice.name} (ID: ${selectedInputDevice.id})`);

        let arecord: any;
        let audioStream: NodeJS.ReadableStream | null = null;
        if (deviceManager.requiresRtAudio()) {
            try {
                console.log('🔧 Использую RtAudio для Windows/macOS');
                audioStream = await deviceManager.recordAudioStream(selectedInputDevice, SAMPLE_RATE, 1);
                arecord = {
                    stdout: audioStream,
                    stderr: { on: () => {} },
                    on: (event: string, callback: Function) => {
                        if (event === 'close') {
                            audioStream?.on('end', () => callback(0));
                        }
                    },
                    kill: () => {
                        deviceManager.stopAudioStream();
                        if (audioStream && 'destroy' in audioStream) {
                            (audioStream as any).destroy();
                        }
                    }
                };
            } catch (error) {
                console.error('❌ Ошибка инициализации RtAudio:', error);
                try { recognizer.free(); } catch {}
                try { model.free(); } catch {}
                return;
            }
        } else {
            try {
                const recordCommand = deviceManager.getRecordCommand(selectedInputDevice, SAMPLE_RATE);
                console.log(`🔧 Команда записи: ${recordCommand.join(' ')}`);
                arecord = spawn(recordCommand[0], recordCommand.slice(1));
            } catch (error) {
                console.warn('⚠️ Ошибка при получении команды записи, использую fallback:', error);
                const recordCommand = deviceManager.getRecordCommand(selectedInputDevice, SAMPLE_RATE);
                console.log(`🔧 Используется команда записи: ${recordCommand.join(' ')}`);
                arecord = spawn(recordCommand[0], recordCommand.slice(1));
            }
        }

        // Обработка аудиопотока: активация по ключевому слову и сбор команды
        arecord.stdout.on('data', (data) => {
            try {
                if (recognizer.acceptWaveform(data)) {
                    const result = recognizer.result();
                    if (result && result.text) {
                        const text = result.text.toLowerCase();
                        console.log(`🟩 Итог: ${result.text}`);
                        this.lastSpeechTime = Date.now();

                        // Проверяем активацию по ключевому слову
                        if (!this.isListening && text.includes(this.name)) {
                            // МГНОВЕННО прерываем все текущие процессы при активации
                            this.interruptCurrentProcess();
                            
                            this.isListening = true;
                            console.log(`\n🎯 Ключевое слово "${this.name}" обнаружено! Слушаю команду...`);
                            this.commandBuffer.push(result.text);
                            console.log(`🎤 Команда: ${result.text}`);
                            this.lastPartialResult = '';
                            return;
                        }
                        
                        // Также проверяем прерывание во время слушания команды
                        if (this.isListening && text.includes(this.name) && this.commandBuffer.length > 0) {
                            // Если во время слушания команды снова услышали имя - начинаем новую команду
                            console.log(`\n🔄 Новое обращение "${this.name}" во время команды - перезапускаю...`);
                            this.interruptCurrentProcess();
                            this.commandBuffer = [result.text];
                            console.log(`🎤 Новая команда: ${result.text}`);
                            this.lastPartialResult = '';
                            return;
                        }

                        if (this.isListening) {
                            const lastBuffer = this.commandBuffer[this.commandBuffer.length - 1] || '';
                            if (!lastBuffer.includes(text) && !text.includes(lastBuffer)) {
                                this.commandBuffer.push(result.text);
                                console.log(`🎤 Команда: ${result.text}`);
                            }
                            this.lastPartialResult = '';
                        }
                    }
                } else {
                    const partialResult = recognizer.partialResult();
                    if (partialResult.partial) {
                        const partialText = partialResult.partial.toLowerCase();
                        
                        // Проверяем прерывание даже в частичных результатах для быстрого реагирования
                        if (partialText.includes(this.name)) {
                            // Если услышали имя в частичном результате во время обработки - прерываем
                            if (this.isProcessing || this.isTTSActive) {
                                console.log(`\n⚡ Быстрое прерывание по частичному результату: "${partialText}"`);
                                this.interruptCurrentProcess();
                            }
                        }
                        
                        if (this.isListening && partialResult.partial !== this.lastPartialResult) {
                            console.log(`🎤 Команда: ${partialResult.partial}`);
                            this.lastPartialResult = partialResult.partial;
                        }
                    }
                }
            } catch (e) {
                console.error('❌ Ошибка распознавания:', e);
            }
        });

        arecord.stderr.on('data', (data) => {
            console.error(`❌ Ошибка arecord: ${data}`);
        });

        const cleanup = () => {
            console.log('\nВыполняю очистку и завершаю работу...');
            
            // Очищаем все таймеры
            if (this.silenceCheckInterval) {
                clearInterval(this.silenceCheckInterval);
                this.silenceCheckInterval = undefined;
            }
            if (this.deviceCheckInterval) {
                clearInterval(this.deviceCheckInterval);
                this.deviceCheckInterval = undefined;
            }
            if (this.resultWatcherInterval) {
                clearInterval(this.resultWatcherInterval);
                this.resultWatcherInterval = undefined;
            }
            
            // Сбрасываем состояние
            this.isListening = false;
            this.commandBuffer = [];
            this.isProcessing = false;
            
            arecord.kill();
            if (deviceManager.requiresRtAudio()) {
                deviceManager.stopAudioStream();
            }
            try { recognizer.free(); } catch {}
            try { model.free(); } catch {}
        };
        
        process.on('SIGINT', () => {
            cleanup();
            process.exit(0);
        });
        
        arecord.on('close', (code) => {
            if (code !== 0 && code !== null) { 
                 console.log(`arecord процесс завершился с кодом ${code}`);
            }
            cleanup();
        });
    
        // Логика проверки тишины и завершения команды
        const checkSilence = async () => {
            if (this.isListening && !this.isProcessing && (Date.now() - this.lastSpeechTime) > this.silenceThreshold) {
                if (this.commandBuffer.length > 0) {
                    const fullCommand = this.commandBuffer.join(' ');
                    console.log('\n📝 Полная команда:', fullCommand);
                    
                    // Сброс до отправки
                    this.commandBuffer = [];
                    this.isListening = false;
                    this.isProcessing = true;
                    
                    try {
                        // Добавляем команду в очередь результатов для обработки
                        this.resultsQueue.push({ 
                            id: ++this.utteranceCounter, 
                            text: fullCommand, 
                            ts: Date.now() 
                        });
                        console.log('✅ Команда добавлена в очередь для обработки');
                    } catch (error) {
                        console.error('❌ Ошибка при добавлении команды в очередь:', error);
                    }
                    
                    this.isProcessing = false;
                    console.log('\n👂 Ожидание ключевого слова...');
                }
            }
        };

        // Проверка на изменения устройств (для Bluetooth)
        const checkDeviceChanges = async () => {
            if (!this.isProcessing) {
                try {
                    const newBestDevice = await deviceManager.getBestInputDevice();
                    if (newBestDevice && newBestDevice.id !== this.currentInputDevice?.id) {
                        console.log(`\n🔄 Обнаружено новое лучшее устройство: ${newBestDevice.name}`);
                        console.log('⚠️ Для переключения устройства потребуется перезапуск...');
                        this.currentInputDevice = newBestDevice;
                    }
                } catch (error) {
                    console.warn('⚠️ Ошибка при проверке устройств:', error);
                }
            }
        };

        // Запускаем таймеры проверки
        this.silenceCheckInterval = setInterval(checkSilence, 100);
        this.deviceCheckInterval = setInterval(checkDeviceChanges, 5000); // Проверяем каждые 5 секунд

        console.log('✅ Микрофон запущен. Говорите... (Ctrl+C для остановки)');
        console.log('👂 Ожидание ключевого слова...');
    }

    public async ask(command: string): Promise<string> {
        // Прерываем предыдущий процесс
        this.interruptCurrentProcess();
        
        this.isProcessing = true;
        this.currentAbortController = new AbortController();
        
        try {
            
            console.log('\n🤖 Отправляю запрос к нейросети...');
            
            let fullResponse = '';
            let currentVoiceText = '';
            let isInsideVoiceTag = false;
            
            // Инициализируем провайдера при первом вызове
            if (!this.aiProvider) {
                await this.initializeProvider();
            }

            // Формируем сообщения для модели
            const messages: AIMessage[] = [];
            if (this.system_prompt) {
                messages.push({ role: 'system', content: this.system_prompt });
            }
            messages.push({ role: 'user', content: command });

            // Получаем поток строки от провайдера
            const stream = await this.aiProvider!.stream(messages);
            
            // Функция для разбиения текста на предложения
            const splitIntoSentences = (text: string): string[] => {
                return text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
            };

            // Функция для обработки накопленного текста
            const processAccumulatedText = async (text: string) => {
                // Проверяем прерывание перед TTS
                if (this.currentAbortController?.signal.aborted) return;
                
                const sentences = splitIntoSentences(text);
                for (const sentence of sentences) {
                    if (sentence.trim() && !this.currentAbortController?.signal.aborted) {
                        await this.TTS(sentence.trim());
                    }
                }
            };
            
            return new Promise((resolve, reject) => {
                const reader = stream.getReader();
                const readNext = async (): Promise<void> => {
                    try {
                        if (this.currentAbortController?.signal.aborted) {
                            reject(new Error('Прервано пользователем'));
                            return;
                        }
                        const { done, value } = await reader.read();
                        if (done) {
                            if (currentVoiceText.trim() && !this.currentAbortController?.signal.aborted) {
                                await processAccumulatedText(currentVoiceText);
                            }
                            console.log('\n✅ Ответ нейросети получен');
                            resolve(fullResponse);
                            return;
                        }
                        const chunk = value as string;
                        process.stdout.write(chunk);
                        fullResponse += chunk;
                        for (let i = 0; i < chunk.length; i++) {
                            const char = chunk[i];
                            if (chunk.slice(i, i + 7) === '<VOICE>') { isInsideVoiceTag = true; i += 6; continue; }
                            if (chunk.slice(i, i + 8) === '</VOICE>') {
                                isInsideVoiceTag = false; i += 7;
                                if (currentVoiceText.trim()) {
                                    await processAccumulatedText(currentVoiceText);
                                    currentVoiceText = '';
                                }
                                continue;
                            }
                            if (isInsideVoiceTag) {
                                currentVoiceText += char;
                                if (['.', '!', '?'].includes(char)) {
                                    const sentences = splitIntoSentences(currentVoiceText);
                                    if (sentences.length > 1) {
                                        for (let j = 0; j < sentences.length - 1; j++) {
                                            if (!this.currentAbortController?.signal.aborted) {
                                                await this.TTS(sentences[j].trim());
                                            }
                                        }
                                        currentVoiceText = sentences[sentences.length - 1];
                                    }
                                }
                            }
                        }
                        await readNext();
                    } catch (error: any) {
                        if (error.message && error.message.includes('Прервано пользователем')) {
                            reject(error);
                        } else {
                            console.error('\n❌ Ошибка при получении ответа:', error);
                            reject(error);
                        }
                    }
                };
                void readNext();
            });
        } catch (error) {
            console.error('❌ Ошибка при обращении к нейросети:', error);
            return 'Произошла ошибка при обращении к нейросети';
        } finally {
            this.isProcessing = false;
        }
    }



    public async TTS(text?: string): Promise<void> {
        const ttsText = text?.trim().length ? text.trim() : 'Привет мир.';
        const port = 5000;

        // Если сервер уже доступен — перезапускаем
        const isUp = await new Promise<boolean>((resolve) => {
            const req = http.get({ hostname: 'localhost', port, path: '/', timeout: 2000 }, (res) => {
                resolve(res.statusCode === 200);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
        });
        if (isUp) {
            console.log(`Обнаружен уже запущенный zonosjs на http://localhost:${port}/ — перезапускаю.`);
            try { spawnSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' }); } catch {}
            try { spawnSync('bash', ['-lc', `lsof -ti :${port} | xargs -r kill -9`], { stdio: 'ignore' }); } catch {}
            const downStart = Date.now();
            while (Date.now() - downStart < 60_000) {
                const stillUp = await new Promise<boolean>((resolve) => {
                    const req2 = http.get({ hostname: 'localhost', port, path: '/', timeout: 1000 }, (res) => {
                        res.resume();
                        resolve(true);
                    });
                    req2.on('error', () => resolve(false));
                    req2.on('timeout', () => { req2.destroy(); resolve(true); });
                });
                if (!stillUp) break;
                await new Promise(r => setTimeout(r, 500));
            }
        }

        // Запуск сервера
        const localBin = path.join(this.zonosProjectDir, 'node_modules', '.bin', 'zonosjs');
        console.log(`Запуск сервера zonosjs на порту: ${port}...`);
        const server = spawn(localBin, ['serve', '--port', port.toString()], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: this.zonosProjectDir
        });
        server.stdout.on('data', (data: Buffer) => console.log(`[${new Date().toISOString()}] STDOUT: ${data.toString()}`));
        server.stderr.on('data', (data: Buffer) => console.error(`[${new Date().toISOString()}] STDERR: ${data.toString()}`));

        // Ожидание готовности сервера
        const startTime = Date.now();
        const timeoutMs = 10 * 60 * 1000;
        await new Promise<void>((resolve, reject) => {
            const tryPing = () => {
                const req3 = http.get({ hostname: 'localhost', port, path: '/', timeout: 5000 }, (res) => {
                    if (res.statusCode === 200) resolve(); else { res.resume(); scheduleNext(); }
                });
                req3.on('error', scheduleNext);
                req3.on('timeout', () => { req3.destroy(); scheduleNext(); });
                function scheduleNext() {
                    if (Date.now() - startTime > timeoutMs) {
                        reject(new Error('Таймаут ожидания запуска сервера ZonosJS'));
                        return;
                    }
                    setTimeout(tryPing, 3000);
                }
            };
            tryPing();
        });
        console.log(`Сервер готов на http://localhost:${port}/`);

        // Импорт клиента ZonosJS и генерация
        const moduleUrl = 'file:///home/timax/projects/zonosjs-test/node_modules/zonosjs/index.js';
        const mod = await import(moduleUrl);
        const ZonosJS = (mod as any).default;
        const client = new ZonosJS(`http://localhost:${port}`);

        let referencePathToUse: string | null = null;
        try {
            if (fs.existsSync(this.defaultReferencePath)) {
                const stat = fs.statSync(this.defaultReferencePath);
                if (stat.isFile() && stat.size > 0) referencePathToUse = this.defaultReferencePath;
            }
        } catch {}
        if (!referencePathToUse) {
            console.warn('reference.wav не найден или пуст — генерация без референса. Рекомендуется WAV 10–30 секунд.');
        } else {
            console.log(`Используется референсное аудио: ${referencePathToUse}`);
        }

        console.log(`Генерируем речь для текста: "${ttsText}"`);
        const audioBuffer: Buffer = await client.generateSpeech(ttsText, referencePathToUse, 'ru');
        if (!audioBuffer || audioBuffer.length < 100) {
            throw new Error(`Сгенерированный аудиобуфер пуст или слишком мал (${audioBuffer ? audioBuffer.length : 0} байт). Проверьте референсное аудио или логи сервера.`);
        }

        const __filename = fileURLToPath(import.meta.url);
        const __dirnameLocal = path.dirname(__filename);
        const outPath = path.resolve(__dirnameLocal, 'output_zonos.wav');
        fs.writeFileSync(outPath, audioBuffer);
        console.log(`Аудио сохранено в ${outPath}`);
    }
}

export default Voice;



