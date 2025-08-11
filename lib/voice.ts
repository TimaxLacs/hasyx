import AudioDeviceManager from './voice-device';
import { OpenRouterProvider } from './ai/providers/openrouter';
import type { AIMessage } from './ai/ai';
import path from 'path';
// @ts-ignore
// import * as vosk from 'vosk'; // ВРЕМЕННО ЗАКОММЕНТИРОВАНО - проблемы с ffi-napi
import * as fs from 'fs';
// import * as https from 'https'; // больше не требуется
import { spawn } from 'child_process';

const SAMPLE_RATE = 16000;


class Voice{
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
        silenceThreshold: number = 2000
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
        
        // Автоматически запускаем все необходимые функции
    }

    public async initialize(): Promise<void> {
        try {

            console.log('🧪 Запуск');
            await this.device();

            console.log('🧪 Тест транскрибации (Whisper/base)...');
            const transcriptionResult = await this.transcribe();
            console.log('📝 Результат транскрибации:', transcriptionResult);
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

    // Удалено: установка и распаковка Vosk модели (не используется)

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

    public async transcribe(): Promise<string> {
        console.log('🎤 Начинаю работу голосового ассистента...');
        console.log(`🔑 Ключевое слово: "${this.name}"`);

        // ===== Whisper: локальные помощники (в пределах функции) =====
        const spawnAsync = (cmd: string, args: string[], options: any = {}): Promise<void> => {
            return new Promise((resolve, reject) => {
                const p = spawn(cmd, args, options);
                let stderr = '';
                p.stderr.on('data', d => { stderr += d.toString(); });
                p.on('error', reject);
                p.on('close', code => {
                    if (code === 0) resolve();
                    else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}: ${stderr}`));
                });
            });
        };

        const ensureWhisper = async () => {
            try {
                // динамический импорт без типизации
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                require('nodejs-whisper');
            } catch {
                console.log('📦 Устанавливаю nodejs-whisper...');
                // Ставим пакет в корне проекта
                const cwd = path.resolve(__dirname, '..');
                try {
                    await spawnAsync('npm', ['i', '--no-audit', '--no-fund', 'nodejs-whisper'], { cwd });
                } catch (e) {
                    console.error('❌ Не удалось установить nodejs-whisper:', e);
                    throw e;
                }
            }
        };

        const convertPcmToWav = async (rawPcmPath: string): Promise<void> => {
            const wavPath = rawPcmPath.replace('.pcm', '.wav');
            const args = ['-y', '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', rawPcmPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wavPath];
            await spawnAsync('ffmpeg', args);
        };

        const whisperTranscribe = async (audioBuffer: Buffer): Promise<string> => {
            await ensureWhisper();
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const mod = (() => { try { return require('nodejs-whisper'); } catch { return undefined as any; } })();
                if (!mod || !('nodewhisper' in mod)) {
                    throw new Error('nodejs-whisper недоступен');
                }
                const { nodewhisper } = mod as any;
                
                // Создаем временные файлы для обработки
                const tempPcmPath = path.resolve(__dirname, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}.pcm`);
                const tempWavPath = tempPcmPath.replace('.pcm', '.wav');
                
                try {
                    // Записываем PCM данные во временный файл
                    await fs.promises.writeFile(tempPcmPath, audioBuffer);
                    
                    // Конвертируем PCM в WAV для Whisper
                    await convertPcmToWav(tempPcmPath);
                    
                    const result = await nodewhisper(tempWavPath, {
                        modelName: 'base',
                        autoDownloadModelName: 'base',
                        removeWavFileAfterTranscription: true,
                        whisperOptions: { outputInText: true, language: 'ru' }
                    });
                    
                    if (result?.text) return String(result.text).trim();
                    return '';
                } finally {
                    // Очищаем временные файлы
                    await fs.promises.unlink(tempPcmPath).catch(() => {});
                    await fs.promises.unlink(tempWavPath).catch(() => {});
                }
            } catch (e) {
                console.error('❌ Ошибка транскрипции Whisper:', e);
                return '';
            }
        };

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Transform } = require('stream');
        const silenceMs = this.silenceThreshold;
        const createVAD = () => {
            let silenceTimer: NodeJS.Timeout | null = null;
            let baselineEnergy = 0.0003;
            const alpha = 0.99;
            const voiceRatioThreshold = 3.0;
            const hangoverMs = Math.min(400, Math.max(200, Math.floor(silenceMs * 0.2)));
            let lastVoiceAt = 0;

            const vad = new Transform({
                transform(chunk: Buffer, _enc, cb) {
                    let sumAbs = 0;
                    const samples = Math.floor(chunk.length / 2);
                    for (let i = 0; i < chunk.length; i += 2) {
                        sumAbs += Math.abs(chunk.readInt16LE(i));
                    }
                    let energy = (sumAbs / samples) / 32767;

                    const isLikelyVoice = energy > baselineEnergy * voiceRatioThreshold;
                    if (!isLikelyVoice) {
                        baselineEnergy = alpha * baselineEnergy + (1 - alpha) * energy;
                    }
                    const now = Date.now();
                    if (isLikelyVoice) {
                        (vad as any).emit('voice');
                        lastVoiceAt = now;
                        if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
                        silenceTimer = setTimeout(() => (vad as any).emit('silence'), Math.max(1, silenceMs));
                    } else {
                        if (!silenceTimer && now - lastVoiceAt > hangoverMs) {
                            silenceTimer = setTimeout(() => (vad as any).emit('silence'), Math.max(1, silenceMs));
                        }
                    }
                    this.push(chunk);
                    cb();
                }
            });
            return vad as any;
        };

        // Создаем AudioDeviceManager для динамического управления устройствами
        const deviceManager = new AudioDeviceManager();
        await deviceManager.initialize();

        // Получаем лучшее доступное устройство
        const bestInputDevice = await deviceManager.getBestInputDevice();

        if (!bestInputDevice) {
            console.error('❌ Не удалось определить устройство ввода. Выход.');
            return 'Ошибка: не удалось определить устройство ввода';
        }

        console.log(`🎧 Использую устройство ввода: ${bestInputDevice.name} (ID: ${bestInputDevice.id})`);

        // Кроссплатформенная инициализация записи
        let arecord: any;
        let audioStream: NodeJS.ReadableStream | null = null;

        if (deviceManager.requiresRtAudio()) {
            try {
                console.log('🔧 Использую RtAudio для Windows/macOS');
                audioStream = await deviceManager.recordAudioStream(bestInputDevice, SAMPLE_RATE, 1);
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
                return 'Ошибка: не удалось инициализировать RtAudio';
            }
        } else {
            // Linux: используем arecord
            try {
                const recordCommand = deviceManager.getRecordCommand(bestInputDevice, SAMPLE_RATE);
                console.log(`🔧 Команда записи: ${recordCommand.join(' ')}`);
                arecord = spawn(recordCommand[0], recordCommand.slice(1));
            } catch (error) {
                console.warn('⚠️ Ошибка при получении команды записи, использую fallback:', error);
                const recordCommand = deviceManager.getRecordCommand(bestInputDevice, SAMPLE_RATE);
                console.log(`🔧 Используется команда записи: ${recordCommand.join(' ')}`);
                arecord = spawn(recordCommand[0], recordCommand.slice(1));
            }
        }

        let commandBuffer: string[] = [];
        let isListening = false;
        let lastSpeechTime = Date.now();
        let isProcessing = false;
        let currentInputDevice = bestInputDevice;
        let transcriptionResult = '';

        const vad = createVAD();
        const utteranceChunks: Buffer[] = [];
        let queue: Buffer[] = [];
        let queueActive = false;

        const processQueue = async () => {
            if (queueActive) return;
            queueActive = true;
            try {
                while (queue.length > 0) {
                    const buf = queue.shift() as Buffer;
                    const textRaw = await whisperTranscribe(buf);
                    const text = (textRaw || '').trim().toLowerCase();
                    if (!text) continue;

                    console.log(`\n🔍 Распознано (Whisper): "${text}"`);
                    lastSpeechTime = Date.now();

                    if (!isListening && text.includes(this.name)) {
                        this.interruptCurrentProcess();
                        isListening = true;
                        console.log(`\n🎯 Ключевое слово "${this.name}" обнаружено! Слушаю команду...`);
                        commandBuffer.push(textRaw.trim());
                        console.log(`🎤 Команда: ${textRaw.trim()}`);
                        continue;
                    }

                    if (isListening && text.includes(this.name) && commandBuffer.length > 0) {
                        console.log(`\n🔄 Новое обращение "${this.name}" во время команды - перезапускаю...`);
                        this.interruptCurrentProcess();
                        commandBuffer = [textRaw.trim()];
                        console.log(`🎤 Новая команда: ${textRaw.trim()}`);
                        continue;
                    }

                    if (isListening) {
                        const lastBufText = commandBuffer[commandBuffer.length - 1] || '';
                        const currentText = textRaw.trim();
                        if (lastBufText && (lastBufText.includes(currentText) || currentText.includes(lastBufText))) {
                            // пропускаем дубликат
                        } else {
                            commandBuffer.push(currentText);
                            console.log(`🎤 Команда: ${currentText}`);
                        }
                    }
                }
            } finally {
                queueActive = false;
            }
        };

        const finalizeUtterance = () => {
            if (utteranceChunks.length === 0) return;
            const buf = Buffer.concat(utteranceChunks.splice(0));
            queue.push(buf);
            void processQueue();
        };

        vad.on('voice', () => {
            lastSpeechTime = Date.now();
        });
        vad.on('silence', () => {
            finalizeUtterance();
        });

        // Проверка тишины для отправки команды
        const checkSilence = async () => {
            if (isListening && !isProcessing && (Date.now() - lastSpeechTime) > this.silenceThreshold) {
                if (commandBuffer.length > 0) {
                    const fullCommand = commandBuffer.join(' ');
                    console.log('\n📝 Полная команда:', fullCommand);
                    transcriptionResult = fullCommand;

                    commandBuffer = [];
                    isListening = false;
                    isProcessing = true;

                    try {
                        await this.ask(fullCommand);
                    } catch (error) {
                        if (error instanceof Error && error.message.includes('Прервано пользователем')) {
                            // молча
                        } else {
                            console.error('❌ Ошибка при обработке команды:', error);
                        }
                    }

                    isProcessing = false;
                    console.log('\n👂 Ожидание ключевого слова...');
                }
            }
        };

        // Проверка на изменения устройств (для Bluetooth)
        const checkDeviceChanges = async () => {
            if (!isProcessing) {
                try {
                    const newBestDevice = await deviceManager.getBestInputDevice();
                    if (newBestDevice && newBestDevice.id !== currentInputDevice?.id) {
                        console.log(`\n🔄 Обнаружено новое лучшее устройство: ${newBestDevice.name}`);
                        console.log('⚠️ Для переключения устройства потребуется перезапуск...');
                        currentInputDevice = newBestDevice;
                    }
                } catch (error) {
                    console.warn('⚠️ Ошибка при проверке устройств:', error);
                }
            }
        };

        const silenceCheckInterval = setInterval(checkSilence, 100);
        const deviceCheckInterval = setInterval(checkDeviceChanges, 5000);

        // Подписка на аудио поток
        arecord.stdout.on('data', (data: Buffer) => {
            // Кладем в текущую реплику и в VAD
            utteranceChunks.push(Buffer.from(data));
            (vad as any).write(data);
        });

        arecord.stderr.on('data', (data: Buffer) => {
            console.error(`❌ Ошибка arecord: ${data}`);
        });

        const cleanup = () => {
            console.log('\nВыполняю очистку и завершаю работу...');
            clearInterval(silenceCheckInterval);
            clearInterval(deviceCheckInterval);
            try { finalizeUtterance(); } catch {}
            try { arecord.kill(); } catch {}
            if (deviceManager.requiresRtAudio()) {
                deviceManager.stopAudioStream();
            }
        };

        process.on('SIGINT', () => {
            cleanup();
            process.exit(0);
        });

        arecord.on('close', (code: number) => {
            if (code !== 0 && code !== null) {
                console.log(`arecord процесс завершился с кодом ${code}`);
            }
            cleanup();
        });

        console.log('✅ Микрофон запущен. Говорите... (Для остановки нажмите Ctrl+C)');
        console.log('👂 Ожидание ключевого слова...');

        // Возвращаем результат транскрибации
        return transcriptionResult;
    }

    public async TTS(text: string): Promise<void> {
        // Создаем AbortController для этой конкретной TTS
        const ttsAbortController = new AbortController();
        
        // Добавляем в очередь
        const ttsItem = { text, abortController: ttsAbortController };
        this.ttsQueue.push(ttsItem);
        
        // Если TTS не активна, запускаем обработку очереди
        if (!this.isTTSActive) {
            await this.processTTSQueue();
        }
    }
    
    public async processTTSQueue(): Promise<void> {
        if (this.isTTSActive || this.ttsQueue.length === 0) {
            return;
        }
        
        this.isTTSActive = true;
        
        while (this.ttsQueue.length > 0) {
            // Проверяем глобальное прерывание
            if (this.currentAbortController?.signal.aborted) {
                console.log('🛑 Обработка TTS прервана глобально');
                break;
            }
            
            const ttsItem = this.ttsQueue.shift();
            if (!ttsItem) continue;
            
            this.currentTTS = ttsItem;
            
            try {
                await this.executeTTS(ttsItem.text, ttsItem.abortController);
            } catch (error) {
                if (error instanceof Error && (error.message.includes('TTS прервана') || error.name === 'AbortError')) {
                    // Тихо обрабатываем прерывание TTS - это нормальное поведение
                } else {
                    console.error('❌ Ошибка TTS:', error);
                }
            }
            
            this.currentTTS = undefined;
            
            // Если была прервана, тихо очищаем оставшуюся очередь
            if (ttsItem.abortController.signal.aborted) {
                this.ttsQueue.forEach(item => item.abortController.abort());
                this.ttsQueue = [];
                break;
            }
        }
        
        this.isTTSActive = false;
    }
    
    public async executeTTS(text: string, abortController: AbortController): Promise<void> {
        return new Promise((resolve, reject) => {
            // Проверяем прерывание перед началом
            if (abortController.signal.aborted) {
                reject(new Error('TTS прервана до начала'));
                return;
            }
            
            console.log(`📝 Озвучиваю: "${text}"`);
            
            // Имитируем TTS с возможностью прерывания
            const startTime = Date.now();
            const duration = Math.min(text.length * 50, 3000); // Примерная длительность
            
            const checkInterval = setInterval(() => {
                if (abortController.signal.aborted) {
                    clearInterval(checkInterval);
                    console.log('🛑 TTS прервана во время выполнения');
                    reject(new Error('TTS прервана'));
                    return;
                }
                
                if (Date.now() - startTime >= duration) {
                    clearInterval(checkInterval);
                    console.log('✅ Озвучка завершена');
                    resolve();
                }
            }, 100);
            
            // Обработчик прерывания
            abortController.signal.addEventListener('abort', () => {
                clearInterval(checkInterval);
                reject(new Error('TTS прервана'));
            });
        });
    }
}

export default Voice;


// Пример создания экземпляра класса Voice

const voice = new Voice(
    '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',      // apikey
    'deepseek/deepseek-chat-v3-0324:free',     // model
    undefined,           // system_prompt
    'алиса',             // name
    0.7,                 // temperature
    512,                 // max_tokens
    undefined,           // defaultInputDevice
    undefined,           // defaultOutputDevice
    [],                  // devices
    2000                 // silenceThreshold
);
voice.initialize()
