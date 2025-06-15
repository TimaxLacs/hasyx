import AudioDeviceManager from './voice-device';
import { AskHasyx, ensureOpenRouterApiKey } from 'hasyx/lib/ask-hasyx';
import AdmZip from 'adm-zip';
import path from 'path';
// @ts-ignore
import * as vosk from 'vosk';
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
    private wakeWord: string;
    private silenceThreshold: number;
    
    constructor(
        apikey: string, 
        model?: string, 
        temperature?: number, 
        max_tokens?: number, 
        system_prompt?: string,
        defaultInputDevice?: any,
        defaultOutputDevice?: any,
        devices?: any[],
        wakeWord: string = 'алиса',
        silenceThreshold: number = 2000
    ) {
        this.apikey = apikey;
        this.model = model;
        this.temperature = temperature;
        this.max_tokens = max_tokens;
        this.system_prompt = system_prompt;
        this.output_handlers = {};
        this.defaultInputDevice = defaultInputDevice;
        this.defaultOutputDevice = defaultOutputDevice;
        this.devices = devices || [];
        this.wakeWord = wakeWord.toLowerCase();
        this.silenceThreshold = silenceThreshold;
        
        // Автоматически запускаем все необходимые функции
        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            // Инициализация устройств
            await this.device();
            
            // Проверка и загрузка модели
            await this.modelSTT();
            
            // Запуск голосового ассистента
            await this.transcribe();

            // await this.ask('выведи мне точный курс доллара на сегодня');
        } catch (error) {
            console.error('❌ Ошибка при инициализации:', error);
        }
    }

    public async device(): Promise<void> {
        const manager = new AudioDeviceManager();
        await manager.initialize();
        
        const { defaultInputDevice, defaultOutputDevice } = manager.findDefaultDevices();
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
        try {
            await ensureOpenRouterApiKey();
            
            const options: any = {
                stream: true // Включаем режим стриминга
            };
            if (this.model) options.model = this.model;
            if (this.temperature) options.temperature = this.temperature;
            if (this.max_tokens) options.max_tokens = this.max_tokens;
            
            const ask = new AskHasyx(
                this.apikey,
                { command },
                options
            );

            console.log('\n🤖 Отправляю запрос к нейросети...');
            
            let fullResponse = '';
            const stream = await ask.askStream(command);
            
            return new Promise((resolve, reject) => {
                stream.subscribe({
                    next: (chunk: string) => {
                        process.stdout.write(chunk);
                        fullResponse += chunk;
                    },
                    error: (error: any) => {
                        console.error('\n❌ Ошибка при получении ответа:', error);
                        reject(error);
                    },
                    complete: () => {
                        console.log('\n✅ Ответ нейросети получен');
                        resolve(fullResponse);
                    }
                });
            });
        } catch (error) {
            console.error('❌ Ошибка при обращении к нейросети:', error);
            return 'Произошла ошибка при обращении к нейросети';
        }
    }

    public async transcribe(): Promise<void> {
        console.log('🎤 Начинаю работу голосового ассистента...');
        console.log(`🔑 Ключевое слово: "${this.wakeWord}"`);
    
        if (!fs.existsSync(MODEL_PATH)) {
            console.error(`❌ Модель не найдена по пути: ${MODEL_PATH}`);
            console.error('Пожалуйста, убедитесь, что модель загружена. Попробую загрузить...');
            await this.modelSTT();
            if (!fs.existsSync(MODEL_PATH)) {
                console.error('❌ Не удалось загрузить модель. Выход.');
                return;
            }
        }
    
        vosk.setLogLevel(-1);
        const model = new vosk.Model(MODEL_PATH);
        const recognizer = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE });
    
        if (!this.defaultInputDevice) {
            console.warn('⚠️ Устройство ввода по умолчанию не найдено. Попытка определить...');
            await this.device();
            if (!this.defaultInputDevice) {
                console.error('❌ Не удалось определить устройство ввода. Выход.');
                recognizer.free();
                model.free();
                return;
            }
        }
    
        console.log(`🎧 Использую устройство ввода: ${this.defaultInputDevice.name}`);
    
        const arecord = spawn('arecord', [
            '-D', 'plug:default',
            '-f', 'S16_LE',
            '-r', String(SAMPLE_RATE),
            '-c', '1',
            '-t', 'raw'
        ]);

        let lastPartialResult = '';
        let commandBuffer: string[] = [];
        let isListening = false;
        let lastSpeechTime = Date.now();
        let isProcessing = false;

        const checkSilence = async () => {
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
                        console.error('❌ Ошибка при обработке команды:', error);
                    }
                    
                    isProcessing = false;
                    console.log('\n👂 Ожидание ключевого слова...');
                }
            }
        };

        const silenceCheckInterval = setInterval(checkSilence, 100);
    
        arecord.stdout.on('data', (data) => {
            if (recognizer.acceptWaveform(data)) {
                const result = recognizer.result();
                if (result.text) {
                    const text = result.text.toLowerCase();
                    lastSpeechTime = Date.now();

                    if (!isListening && text.includes(this.wakeWord)) {
                        isListening = true;
                        console.log(`\n🎯 Ключевое слово обнаружено! Слушаю команду...`);
                        commandBuffer.push(result.text);
                        console.log(`🎤 Команда: ${result.text}`);
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
                if (partialResult.partial && isListening && partialResult.partial !== lastPartialResult) {
                    console.log(`🎤 Команда: ${partialResult.partial}`);
                    lastPartialResult = partialResult.partial;
                }
            }
        });
    
        arecord.stderr.on('data', (data) => {
            console.error(`❌ Ошибка arecord: ${data}`);
        });
    
        const cleanup = () => {
            console.log('\nВыполняю очистку и завершаю работу...');
            clearInterval(silenceCheckInterval);
            arecord.kill();
            recognizer.free();
            model.free();
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
}

// Пример использования - теперь достаточно просто создать экземпляр
const voice = new Voice(
    process.env.OPENROUTER_API_KEY!,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'алиса', // ключевое слово
    2000    // порог тишины в миллисекундах
);
