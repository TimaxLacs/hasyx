import AudioDeviceManager from './voice-device';
import { AskHasyx, ensureOpenRouterApiKey } from 'hasyx/lib/ask-hasyx';
import AdmZip from 'adm-zip';
import path from 'path';
// @ts-ignore
// import * as vosk from 'vosk'; // ВРЕМЕННО ЗАКОММЕНТИРОВАНО - проблемы с ffi-napi
import * as fs from 'fs';
import * as https from 'https';
import { spawn } from 'child_process';

const DEFAULT_MODEL_STT = 'vosk-model-small-ru-0.22';
const MODEL_PATH = path.resolve(__dirname, './models', DEFAULT_MODEL_STT);
const SAMPLE_RATE = 16000;


class Voice{
    private apikey: string;
    private model?: string;
    private temperature?: number;
    private max_tokens?: number;
    private system_prompt?: string;
    private output_handlers: any;
    private defaultInputDevice: any;
    private defaultOutputDevice: any;
    private devices: any[];
    private name: string;
    private silenceThreshold: number;
    private isProcessing: boolean = false;
    private currentAbortController?: AbortController;
    private askInstance?: AskHasyx;
    
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
        
        this.output_handlers = {};
        this.defaultInputDevice = defaultInputDevice;
        this.defaultOutputDevice = defaultOutputDevice;
        this.devices = devices || [];
        this.name = name.toLowerCase();
        this.silenceThreshold = silenceThreshold;
        
        // Автоматически запускаем все необходимые функции
    }

    public async initialize(): Promise<void> {
        try {
            // Инициализация устройств
            await this.device();
            
            // Проверка и загрузка модели
            await this.modelSTT();
            
            // Инициализируем единый экземпляр AskHasyx для сохранения истории
            await this.initializeAskInstance();
            
            // Запуск голосового ассистента
            // await this.transcribe(); // ВРЕМЕННО ЗАКОММЕНТИРОВАНО - проблемы с vosk
            console.log('✅ Инициализация завершена (без transcribe)');

            // await this.ask('выведи мне точный курс доллара на сегодня');
        } catch (error) {
            console.error('❌ Ошибка при инициализации:', error);
        }
    }

    public async initializeAskInstance(): Promise<void> {
        await ensureOpenRouterApiKey();
        
        const options: any = {
            stream: true,
            system_prompt: this.system_prompt
        };
        if (this.model) options.model = this.model;
        if (this.temperature) options.temperature = this.temperature;
        if (this.max_tokens) options.max_tokens = this.max_tokens;
        
        const askOptions = {
            exec: true,      // JavaScript выполнение
            execTs: true,    // TypeScript выполнение  
            terminal: true   // Выполнение команд терминала
        };

        // Создаем единый экземпляр для сохранения истории
        this.askInstance = new AskHasyx(
            this.apikey,
            {},
            options,
            this.system_prompt,
            askOptions
        );
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

    public async modelSTT(): Promise<void> {
        if (fs.existsSync(path.resolve(__dirname, './models', DEFAULT_MODEL_STT))) {
            console.log(`✅ Модель ${DEFAULT_MODEL_STT} найдена.`);
            return;
        }

        const modelUrl = 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip';
        const zipPath = path.resolve(__dirname, './models/vosk-model.zip');
        
        if (fs.existsSync(zipPath)) {
            console.log('🗑️ Удаляю старый zip-файл модели...');
            fs.unlinkSync(zipPath);
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
            
            console.log('📦 Перемещение распакованных файлов...');
            fs.renameSync(path.resolve(modelsDir, rootDir), MODEL_PATH);
            
            console.log('✅ Базовая модель успешно установлена.');
        } catch (err) {
            console.error('❌ Ошибка при установке модели:', err);
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
                console.log('🗑️ Поврежденный zip-файл удален.');
            }
            throw err;
        } finally {
            if (fs.existsSync(MODEL_PATH) && fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
                console.log('🗑️ Временный zip-файл удален.');
            }
        }
    }

    public async ask(command: string): Promise<string> {
        // Прерываем предыдущий процесс
        this.interruptCurrentProcess();
        
        this.isProcessing = true;
        this.currentAbortController = new AbortController();
        
        try {
            // Проверяем, что экземпляр инициализирован
            if (!this.askInstance) {
                await this.initializeAskInstance();
            }
            
            console.log('\n🤖 Отправляю запрос к нейросети...');
            
            let fullResponse = '';
            let currentVoiceText = '';
            let isInsideVoiceTag = false;
            
            // Используем единый экземпляр для сохранения истории
            const stream = await this.askInstance!.askStream(command);
            
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
                stream.subscribe({
                    next: async (chunk: string) => {
                        // Проверяем прерывание
                        if (this.currentAbortController?.signal.aborted) {
                            reject(new Error('Прервано пользователем'));
                            return;
                        }
                        
                        process.stdout.write(chunk);
                        fullResponse += chunk;
                        
                        // Обрабатываем чанк посимвольно для корректной обработки тегов
                        for (let i = 0; i < chunk.length; i++) {
                            const char = chunk[i];
                            
                            // Проверяем начало тега
                            if (chunk.slice(i, i + 7) === '<VOICE>') {
                                isInsideVoiceTag = true;
                                i += 6; // Пропускаем длину тега
                                continue;
                            }
                            
                            // Проверяем конец тега
                            if (chunk.slice(i, i + 8) === '</VOICE>') {
                                isInsideVoiceTag = false;
                                i += 7; // Пропускаем длину тега
                                
                                // Обрабатываем накопленный текст
                                if (currentVoiceText.trim()) {
                                    await processAccumulatedText(currentVoiceText);
                                    currentVoiceText = '';
                                }
                                continue;
                            }
                            
                            // Если мы внутри тега, добавляем символ к накопленному тексту
                            if (isInsideVoiceTag) {
                                currentVoiceText += char;
                                
                                // Проверяем, не закончилось ли предложение
                                if (['.', '!', '?'].includes(char)) {
                                    const sentences = splitIntoSentences(currentVoiceText);
                                    if (sentences.length > 1) {
                                        // Обрабатываем все предложения кроме последнего
                                        for (let j = 0; j < sentences.length - 1; j++) {
                                            if (!this.currentAbortController?.signal.aborted) {
                                                await this.TTS(sentences[j].trim());
                                            }
                                        }
                                        // Оставляем последнее предложение в буфере
                                        currentVoiceText = sentences[sentences.length - 1];
                                    }
                                }
                            }
                        }
                    },
                    error: (error: any) => {
                        if (error.message && error.message.includes('Прервано пользователем')) {
                            // Тихо обрабатываем прерывание пользователем
                            reject(error);
                        } else {
                            console.error('\n❌ Ошибка при получении ответа:', error);
                            reject(error);
                        }
                    },
                    complete: async () => {
                        // Обрабатываем оставшийся текст при завершении
                        if (currentVoiceText.trim() && !this.currentAbortController?.signal.aborted) {
                            await processAccumulatedText(currentVoiceText);
                        }
                        console.log('\n✅ Ответ нейросети получен');
                        resolve(fullResponse);
                    }
                });
            });
        } catch (error) {
            console.error('❌ Ошибка при обращении к нейросети:', error);
            return 'Произошла ошибка при обращении к нейросети';
        } finally {
            this.isProcessing = false;
        }
    }

    public async transcribe(): Promise<void> {
        console.log('🎤 Начинаю работу голосового ассистента...');
        console.log(`🔑 Ключевое слово: "${this.name}"`);
    
        if (!fs.existsSync(MODEL_PATH)) {
            console.error(`❌ Модель не найдена по пути: ${MODEL_PATH}`);
            console.error('Пожалуйста, убедитесь, что модель загружена. Попробую загрузить...');
            await this.modelSTT();
            if (!fs.existsSync(MODEL_PATH)) {
                console.error('❌ Не удалось загрузить модель. Выход.');
                return;
            }
        }
    
        // vosk.setLogLevel(-1);
        // const model = new vosk.Model(MODEL_PATH);
        // const recognizer = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE });
    
        // Создаем AudioDeviceManager для динамического управления устройствами
        const deviceManager = new AudioDeviceManager();
        await deviceManager.initialize();
        
        // Получаем лучшее доступное устройство
        const bestInputDevice = await deviceManager.getBestInputDevice();
        
        if (!bestInputDevice) {
            console.error('❌ Не удалось определить устройство ввода. Выход.');
            // recognizer.free();
            // model.free();
            return;
        }
        
        console.log(`🎧 Использую устройство ввода: ${bestInputDevice.name} (ID: ${bestInputDevice.id})`);
    
        // Кроссплатформенная инициализация записи
        let arecord: any;
        let audioStream: NodeJS.ReadableStream | null = null;
        
        if (deviceManager.requiresRtAudio()) {
            // Windows/macOS: используем RtAudio напрямую
            try {
                console.log('🔧 Использую RtAudio для Windows/macOS');
                audioStream = await deviceManager.recordAudioStream(bestInputDevice, SAMPLE_RATE, 1);
                
                // Создаем псевдо-процесс для совместимости
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
                // recognizer.free();
                // model.free();
                return;
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

        let lastPartialResult = '';
        let commandBuffer: string[] = [];
        let isListening = false;
        let lastSpeechTime = Date.now();
        let isProcessing = false;
        let currentInputDevice = bestInputDevice;

        const checkSilence = async (л) => {
            if (isListening && !isProcessing && (Date.now() - lastSpeechTime) > this.silenceThreshold) {
                if (commandBuffer.length > 0) {
                    const fullCommand = commandBuffer.join(' ');
                    console.log('\n📝 Полная команда:', fullCommand);
                    
                    // Сброс до отправки
                    commandBuffer = [];
                    isListening = false;
                    isProcessing = true;
                    
                    try {
                        await this.ask(fullCommand);
                    } catch (error) {
                        if (error instanceof Error && error.message.includes('Прервано пользователем')) {
                            // Тихо обрабатываем прерывание - это нормальное поведение
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
        const deviceCheckInterval = setInterval(checkDeviceChanges, 5000); // Проверяем каждые 5 секунд
    
        arecord.stdout.on('data', (data) => {
            // ВРЕМЕННО ЗАКОММЕНТИРОВАНО - проблемы с vosk
            /*
            if (recognizer.acceptWaveform(data)) {
                const result = recognizer.result();
                if (result.text) {
                    const text = result.text.toLowerCase();
                    console.log(`\n🔍 Распознано: "${text}"`);
                    lastSpeechTime = Date.now();

                    if (!isListening && text.includes(this.name)) {
                        // МГНОВЕННО прерываем все текущие процессы при активации
                        this.interruptCurrentProcess();
                        
                        isListening = true;
                        console.log(`\n🎯 Ключевое слово "${this.name}" обнаружено! Слушаю команду...`);
                        commandBuffer.push(result.text);
                        console.log(`🎤 Команда: ${result.text}`);
                        lastPartialResult = '';
                        return;
                    }
                    
                    // Также проверяем прерывание во время слушания команды
                    if (isListening && text.includes(this.name) && commandBuffer.length > 0) {
                        // Если во время слушания команды снова услышали имя - начинаем новую команду
                        console.log(`\n🔄 Новое обращение "${this.name}" во время команды - перезапускаю...`);
                        this.interruptCurrentProcess();
                        commandBuffer = [result.text];
                        console.log(`🎤 Новая команда: ${result.text}`);
                        lastPartialResult = '';
                        return;
                    }

                    if (isListening) {
                        const lastBuffer = commandBuffer[commandBuffer.length - 1] || '';
                        if (!lastBuffer.includes(text) && !text.includes(lastBuffer)) {
                            commandBuffer.push(result.text);
                            console.log(`🎤 Команда: ${result.text}`);
                        }
                        lastPartialResult = '';
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
                    
                    // console.log(`\n🔄 Частично распознано: "${partialResult.partial}"`);
                    if (isListening && partialResult.partial !== lastPartialResult) {
                        console.log(`🎤 Команда: ${partialResult.partial}`);
                        lastPartialResult = partialResult.partial;
                    }
                }
            }
            */
            
            // ВРЕМЕННАЯ ЗАГЛУШКА - просто логируем, что получили аудиоданные
            console.log(`📡 Получены аудиоданные: ${data.length} байт`);
        });
    
        arecord.stderr.on('data', (data) => {
            console.error(`❌ Ошибка arecord: ${data}`);
        });
    
        const cleanup = () => {
            console.log('\nВыполняю очистку и завершаю работу...');
            clearInterval(silenceCheckInterval);
            clearInterval(deviceCheckInterval);
            arecord.kill();
            if (deviceManager.requiresRtAudio()) {
                deviceManager.stopAudioStream();
            }
            // recognizer.free();
            // model.free();
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
    
        console.log('✅ Микрофон запущен. Говорите... (Для остановки нажмите Ctrl+C)');
        console.log('👂 Ожидание ключевого слова...');
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

