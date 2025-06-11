// Импорты
import AudioDeviceManager from './voice-device';
// @ts-ignore
import * as vosk from 'vosk';
import * as fs from 'fs';
import { Readable } from 'stream';
// @ts-ignore
import * as wav from 'wav';
import { spawn } from 'child_process';
import * as os from 'os';
import * as https from 'https';
import AdmZip from 'adm-zip';
import path from 'path';

// --- НАСТРОЙКИ --- //
const MODEL_PATH = 'vosk-model-small-ru-0.22';
const SAMPLE_RATE = 16000;
const DEBUG_FILE = 'debug_audio.wav';
const SILENCE_THRESHOLD = 500; // Порог тишины (0-32767)
const CONTEXT_BUFFER_SIZE = SAMPLE_RATE * 5; // 5 секунд контекста
const PROCESSING_BUFFER_SIZE = SAMPLE_RATE * 0.5 * 2; // 0.5 секунды для обработки

// Состояния программы
enum State {
    LISTENING,    // Ожидание команды активации
    PROCESSING    // Обработка команды после активации
}

/**
 * Функция для тестирования аудио устройств.
 * Обнаруживает все доступные устройства и выводит информацию о них в консоль.
 */
async function testAudioDevices() {
    console.log('=== Анализ аудио устройств системы ===');
    
    try {
        const manager = new AudioDeviceManager();
        await manager.initialize();
        
        const { defaultInputDevice, defaultOutputDevice } = manager.findDefaultDevices();
        const devices = manager.getDevices();
        
        console.log('\n=== Устройства по умолчанию ===');
        
        if (defaultInputDevice) {
            console.log('\nМикрофон по умолчанию:');
            console.log(`  ID: ${defaultInputDevice.id}`);
            console.log(`  Название: ${defaultInputDevice.name}`);
            console.log(`  Каналов: ${defaultInputDevice.inputChannels}`);
            console.log(defaultOutputDevice);
        } else {
            console.log('\nМикрофон по умолчанию не найден');
        }
        
        if (defaultOutputDevice) {
            console.log('\nДинамик по умолчанию:');
            console.log(`  ID: ${defaultOutputDevice.id}`);
            console.log(`  Название: ${defaultOutputDevice.name}`);
            console.log(`  Каналов: ${defaultOutputDevice.outputChannels}`);
        } else {
            console.log('\nДинамик по умолчанию не найден');
        }
        
        console.log('\n=== Завершение анализа аудио устройств ===');
    } catch (error) {
        console.error('Произошла ошибка при анализе аудио устройств:', error);
    }
}
testAudioDevices();
/**
 * Функция для загрузки и распаковки модели
 */
async function ensureModelExists() {
    if (fs.existsSync(MODEL_PATH)) {
        console.log('✅ Модель Vosk уже существует.');
        return;
    }

    console.log('⏳ Модель не найдена. Начинаю загрузку...');
    const modelUrl = 'https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip';
    const zipPath = path.resolve(__dirname, '../vosk-model.zip');
    
    await new Promise<void>((resolve, reject) => {
        const file = fs.createWriteStream(zipPath);
        https.get(modelUrl, (response) => {
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
        console.log(' unpacking model...');
        const zip = new AdmZip(zipPath);
        const zipEntries = zip.getEntries();
        const rootDir = zipEntries[0].entryName.split('/')[0];
        
        zip.extractAllTo(path.resolve(__dirname, '../'), true);
        fs.renameSync(path.resolve(__dirname, '../', rootDir), path.resolve(__dirname, '../', MODEL_PATH));
        
        console.log('✅ Модель успешно распакована.');
    } catch (err) {
        console.error('❌ Ошибка при распаковке модели:', err);
    } finally {
        fs.unlinkSync(zipPath);
        console.log('🗑️ Временный zip-файл удален.');
    }
}

/**
 * Основная функция программы
 */
async function main() {
    await ensureModelExists();

    const model = new vosk.Model(MODEL_PATH);
    const recognizer = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE });
    
    const fileWriter = new wav.Writer({
        channels: 1,
        sampleRate: SAMPLE_RATE,
        bitDepth: 16
    });
    const fileStream = fs.createWriteStream(DEBUG_FILE);
    fileWriter.pipe(fileStream);

    // Инициализируем менеджер аудио устройств
    const audioManager = new AudioDeviceManager();
    await audioManager.initialize();
    const { defaultInputDevice } = audioManager.findDefaultDevices();

    if (!defaultInputDevice) {
        throw new Error('Не найдено устройство ввода по умолчанию');
    }

    console.log(`Используется устройство ввода: ${defaultInputDevice.name} (ID: ${defaultInputDevice.id})`);

    const arecord = spawn('arecord', [
        '-D', 'plug:default',
        '-f', 'S16_LE',
        '-c', '1', // моно
        '-r', SAMPLE_RATE.toString(),
        '-t', 'raw'
    ]);

    let currentState = State.LISTENING;
    let contextBuffer: Buffer[] = [];
    let processingBuffer: Buffer[] = [];
    let lastCommandTime = Date.now();
    let isCommandActive = false;

    function isSilence(audioData: Buffer): boolean {
        let sum = 0;
        for (let i = 0; i < audioData.length; i += 2) {
            sum += Math.abs(audioData.readInt16LE(i));
        }
        return (sum / (audioData.length / 2)) < SILENCE_THRESHOLD;
    }

    function updateContextBuffer(data: Buffer) {
        contextBuffer.push(data);
        let totalSize = contextBuffer.reduce((acc, buf) => acc + buf.length, 0);
        
        while (totalSize > CONTEXT_BUFFER_SIZE) {
            const oldestBuffer = contextBuffer.shift();
            if (oldestBuffer) {
                totalSize -= oldestBuffer.length;
            }
        }
    }

    function getLastAudioData(seconds: number): Buffer {
        const targetSize = SAMPLE_RATE * seconds * 2;
        let result: Buffer[] = [];
        let totalSize = 0;
        
        for (let i = contextBuffer.length - 1; i >= 0; i--) {
            const buffer = contextBuffer[i];
            result.unshift(buffer);
            totalSize += buffer.length;
            if (totalSize >= targetSize) break;
        }
        
        return Buffer.concat(result);
    }

    function processCommand(audioData: Buffer) {
        if (recognizer.acceptWaveform(audioData)) {
            const result = recognizer.result();
            if (result.text && result.text.toLowerCase().includes('алиса')) {
                console.log('🎯 Обнаружена команда активации!');
                console.log('Распознано:', result.text);

                isCommandActive = true;
                lastCommandTime = Date.now();
                currentState = State.PROCESSING;
            }
        }
    }

    function updateStatus() {
        const status = currentState === State.LISTENING ? '👂 Ожидание команды' : '🎤 Обработка команды';
        const timeSinceLastCommand = Math.floor((Date.now() - lastCommandTime) / 1000);
        process.stdout.write(`\r${status} (${timeSinceLastCommand}с) `);
    }

    function cleanup() {
        try {
            arecord.kill();
            fileWriter.end();
            recognizer.free();
            model.free();
        } catch (err) {
            console.error('Ошибка при очистке ресурсов:', err);
        }
    }

    arecord.stdout.on('data', (data: Buffer) => {
        fileWriter.write(data);
        updateContextBuffer(data);
        processingBuffer.push(data);
        
        const totalSize = processingBuffer.reduce((acc, buf) => acc + buf.length, 0);
        if (totalSize >= PROCESSING_BUFFER_SIZE) {
            const audioData = Buffer.concat(processingBuffer);
            processingBuffer = [];
            
            const silence = isSilence(audioData);
            processCommand(audioData);
            
            if (currentState === State.PROCESSING && silence) {
                const silenceDuration = (Date.now() - lastCommandTime) / 1000;
                if (silenceDuration > 1) { // Если тишина длится больше 1 секунды
                    console.log('\n🔍 Команда завершена');
                    currentState = State.LISTENING;
                    isCommandActive = false;
                }
            }
            
            // Обновляем статус
            updateStatus();
        }
    });

    // Обработка ошибок
    arecord.stderr.on('data', (data: Buffer) => {
        console.error('Ошибка записи:', data.toString());
    });

    arecord.on('error', (err: Error) => {
        console.error('Ошибка процесса:', err);
        cleanup();
    });


    // Обработка сигналов завершения
    process.on('SIGINT', () => {
        console.log('\nОстановка записи...');
        cleanup();
        process.exit(0);
    });

    console.log('Микрофон запущен. Говорите...');
    console.log(`Отладочный файл записывается в: ${DEBUG_FILE}`);
    console.log('Для активации скажите "алиса"');
}

main().catch(console.error); 