declare module 'audify';
declare module 'wavefile';

import audify from 'audify';
// Используем any для обхода проблем с типизацией
const RtAudio = audify.RtAudio as any;
import * as fs from 'fs';
// Импортируем WaveFile напрямую с другим именем
import { WaveFile as WaveFileOriginal } from 'wavefile';
// Для совместимости с предыдущим кодом
const WaveFileLib = WaveFileOriginal;
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

interface AudioDevice {
    id: number;
    name: string;
    inputChannels: number;
    outputChannels: number;
    isDefaultInput: boolean;
    isDefaultOutput: boolean;
}


interface RtAudioDeviceInfo {
    id: number;
    name: string;
    inputChannels: number;
    outputChannels: number;
    isDefaultInput: number;
    isDefaultOutput: number;
}

interface WaveFileFormat {
    sampleRate: number;
    numChannels: number;
}

interface WaveFile {
    fmt: WaveFileFormat;
    getSamples(asFloat: boolean, type: typeof Int16Array): Int16Array;
    toBuffer(): Buffer;
}

class AudioDeviceManager {
    private rtAudio: any;
    private currentInputDevice: AudioDevice | null;
    private currentOutputDevice: AudioDevice | null;
    private devices: AudioDevice[];
    private isLinux: boolean;
    private isWindows: boolean;
    private isMacOS: boolean;

    constructor() {
        this.rtAudio = new RtAudio();
        this.currentInputDevice = null;
        this.currentOutputDevice = null;
        this.devices = [];
        this.isLinux = process.platform === 'linux';
        this.isWindows = process.platform === 'win32';
        this.isMacOS = process.platform === 'darwin';
    }

    private convertRtAudioDeviceToAudioDevice(device: RtAudioDeviceInfo): AudioDevice {
        return {
            id: device.id,
            name: device.name,
            inputChannels: device.inputChannels,
            outputChannels: device.outputChannels,
            isDefaultInput: device.isDefaultInput === 1,
            isDefaultOutput: device.isDefaultOutput === 1
        };
    }

    async initialize(): Promise<this> {
        this.rtAudio = new RtAudio();
        const rtDevices = this.rtAudio.getDevices();
        this.devices = rtDevices.map((device: any) => this.convertRtAudioDeviceToAudioDevice(device));
        return this;
    }

    getDevices(): AudioDevice[] {
        const rtDevices = this.rtAudio.getDevices() || [];
        this.devices = rtDevices.map((device: any) => this.convertRtAudioDeviceToAudioDevice(device));
        return this.devices;
    }

    findDefaultDevices(): { defaultInputDevice: AudioDevice | null, defaultOutputDevice: AudioDevice | null } {
        const devices = this.getDevices();
        
        if (!devices || devices.length === 0) {
            return { defaultInputDevice: null, defaultOutputDevice: null };
        }

        const inputDevices = devices.filter(d => d.inputChannels > 0);
        const outputDevices = devices.filter(d => d.outputChannels > 0);

        const getDeviceScore = (device: AudioDevice, type: string): number => {
            if (!device || !device.name) return 0;
            const name = device.name.toLowerCase();
            let score = 0;

            if (name.includes('headset') || name.includes('наушники') || name.includes('garniture')) score += 50;
            if (name.includes('usb')) score += 20;
            if (name.includes('bluetooth')) score += 20;
            if (name.includes('hdmi') && type === 'output') score += 15;
            if (name.includes('external') || name.includes('внешний')) score += 15;
            if (name.includes('dmic')) score += 10;
            if (name.includes('internal') || name.includes('встроенный') || name.includes('built-in')) score += 5;
            if (name.includes('speaker') || name.includes('динамик')) score += 5;
            if (type === 'input' && device.isDefaultInput) score += 1;
            if (type === 'output' && device.isDefaultOutput) score += 1;

            return score;
        };

        const findBestDevice = (deviceList: AudioDevice[], type: string): AudioDevice | null => {
            if (!deviceList || deviceList.length === 0) return null;
            const scoredDevices = deviceList.map(device => ({ device, score: getDeviceScore(device, type) }));
            return scoredDevices.sort((a, b) => b.score - a.score)[0].device;
        };

        const defaultInputDevice = findBestDevice(inputDevices, 'input');
        const defaultOutputDevice = findBestDevice(outputDevices, 'output');

        return { defaultInputDevice, defaultOutputDevice };
    }

    private deviceToString(device: AudioDevice | null): string {
        if (!device) return 'Не выбрано';
        return `${device.name} (ID: ${device.id})`;
    }

    setCurrentDevices(inputDevice: AudioDevice | null, outputDevice: AudioDevice | null): void {
        this.currentInputDevice = inputDevice;
        this.currentOutputDevice = outputDevice;
    }

    async testRecord(deviceInfo: AudioDevice | null, durationSeconds: number, filePath: string): Promise<string> {
        if (this.isLinux) {
            try {
                const command = `arecord -f S16_LE -r 16000 -c 2 -d ${durationSeconds} "${filePath}"`;
                await execAsync(command);
                return filePath;
            } catch (error: unknown) {
                throw error;
            }
        }

        return new Promise((resolve, reject) => {
            if (!deviceInfo) {
                return reject(new Error("Устройство для записи не предоставлено."));
            }

            const sampleRate = 16000;
            const channels = 1;
            if (deviceInfo.inputChannels < channels) {
                return reject(new Error(`Устройство не поддерживает ${channels} канал(а) для записи.`));
            }

            const recordedData: Buffer[] = [];

            try {
                this.rtAudio.openStream(
                    null,
                    {
                        deviceId: deviceInfo.id,
                        nChannels: channels,
                        firstChannel: 0,
                    },
                    16,
                    sampleRate,
                    1024,
                    'record-stream',
                    (inputBuffer: Buffer) => {
                        recordedData.push(Buffer.from(inputBuffer));
                    },
                    null,
                    undefined
                );

                this.rtAudio.start();

                setTimeout(() => {
                    if (this.rtAudio.isStreamOpen()) {
                        this.rtAudio.stop();
                        this.rtAudio.closeStream();
                    }
                    
                    if (recordedData.length === 0) {
                        return reject(new Error('Не было записано ни одного аудио-семпла.'));
                    }

                    const audioBuffer = Buffer.concat(recordedData);
                    const wav = new WaveFileLib();
                    wav.fromScratch(channels, sampleRate, '16', audioBuffer);
                    fs.writeFileSync(filePath, wav.toBuffer());
                    resolve(filePath);
                }, durationSeconds * 1000);

            } catch (error: unknown) {
                if (this.rtAudio.isStreamOpen()) {
                    this.rtAudio.closeStream();
                }
                reject(error);
            }
        });
    }

    async testPlayback(deviceInfo: AudioDevice | null, filePath: string): Promise<void> {
        if (this.isLinux) {
            try {
                if (!fs.existsSync(filePath)) {
                    throw new Error(`Аудиофайл не найден: ${filePath}`);
                }
                const command = `paplay "${filePath}"`;
                await execAsync(command);
                return;
            } catch (error: unknown) {
                throw error;
            }
        }

        return new Promise((resolve, reject) => {
            if (!deviceInfo) {
                return reject(new Error("Устройство для воспроизведения не предоставлено."));
            }
            if (!fs.existsSync(filePath)) {
                return reject(new Error(`Аудиофайл не найден: ${filePath}`));
            }

            try {
                const buffer = fs.readFileSync(filePath);
                const wav = new WaveFileLib(buffer);
                const sampleRate = (wav as any).fmt.sampleRate;
                const channels = (wav as any).fmt.numChannels;
                const audioData = wav.getSamples(true, Int16Array);

                let dataIndex = 0;

                this.rtAudio.openStream(
                    {
                        deviceId: deviceInfo.id,
                        nChannels: channels,
                        firstChannel: 0,
                    },
                    null,
                    16,
                    sampleRate,
                    1024,
                    'playback-stream',
                    (outputBuffer: Buffer) => {
                        const frameSize = outputBuffer.length / 2;
                        for (let i = 0; i < frameSize; i++) {
                            if (dataIndex < audioData.length) {
                                outputBuffer.writeInt16LE(audioData[dataIndex++], i * 2);
                            } else {
                                outputBuffer.writeInt16LE(0, i * 2);
                            }
                        }
                        if (dataIndex >= audioData.length) {
                             if (this.rtAudio.isStreamOpen()) {
                                this.rtAudio.stop();
                                this.rtAudio.closeStream();
                                resolve();
                            }
                        }
                    },
                    null,
                    undefined
                );

                this.rtAudio.start();
            } catch (error: unknown) {
                if (this.rtAudio.isStreamOpen()) {
                    this.rtAudio.closeStream();
                }
                reject(error);
            }
        });
    }

    listDevices(): void {
        setTimeout(() => {
            const devices = this.getDevices();
            if (!devices || devices.length === 0) {
                return;
            }
            const inputDevices = devices.filter(d => d.inputChannels > 0);
            const outputDevices = devices.filter(d => d.outputChannels > 0);
        }, 500);
    }

    /**
     * Получает команду для записи аудио с конкретного устройства
     */
    getRecordCommand(device: AudioDevice | null, sampleRate: number = 16000): string[] {
        if (this.isLinux) {
            if (!device) {
                // Fallback к лучшему доступному устройству
                return ['arecord', '-D', 'default', '-f', 'S16_LE', '-r', String(sampleRate), '-c', '1', '-t', 'raw'];
            }
            
            const deviceName = this.getLinuxDeviceName(device);
            
            // Добавляем verbose информацию для отладки
            console.log(`🔍 Маппинг устройства: ${device.name} (RtAudio ID: ${device.id}) -> ALSA: ${deviceName}`);
            
            return ['arecord', '-D', deviceName, '-f', 'S16_LE', '-r', String(sampleRate), '-c', '1', '-t', 'raw'];
        }
        
        // Для Windows/macOS будем использовать RtAudio через Node.js
        throw new Error('getRecordCommand для Windows/macOS должен использовать RtAudio напрямую');
    }

    /**
     * Преобразует AudioDevice в имя устройства для Linux
     */
    private getLinuxDeviceName(device: AudioDevice): string {
        // Для Bluetooth устройств
        if (device.name.includes('bluetooth') || device.name.includes('Bluetooth')) {
            return 'plug:bluez_sink.monitor';
        }
        
        // Для Linux нужно использовать PulseAudio или правильный ALSA маппинг
        // RtAudio ID не соответствуют ALSA card ID
        if (device.name.includes('DMIC')) {
            // Для встроенного цифрового микрофона используем plughw для автоконвертации
            return 'plughw:0,6';
        } else if (device.name.includes('HDA Analog') || device.name.includes('Analog')) {
            // Для аналогового входа используем устройство 0
            return 'plughw:0,0';
        }
        
        // Fallback: попробуем использовать PulseAudio напрямую
        return 'default';
    }

    /**
     * Получает лучшее доступное входное устройство
     */
    async getBestInputDevice(): Promise<AudioDevice | null> {
        // Обновляем список устройств
        const devices = this.getDevices();
        const { defaultInputDevice } = this.findDefaultDevices();
        return defaultInputDevice;
    }

    /**
     * Отслеживает изменения в устройствах (для Bluetooth и USB)
     */
    async refreshDevices(): Promise<{ defaultInputDevice: AudioDevice | null, defaultOutputDevice: AudioDevice | null }> {
        if (this.isLinux) {
            // В Linux можем использовать pactl для обновления
            try {
                await this.refreshLinuxDevices();
            } catch (error) {
                console.warn('Не удалось обновить устройства через pactl:', error);
            }
        }
        
        // Обновляем через RtAudio
        const rtDevices = this.rtAudio.getDevices();
        this.devices = rtDevices.map((device: any) => this.convertRtAudioDeviceToAudioDevice(device));
        
        return this.findDefaultDevices();
    }

    /**
     * Обновляет устройства в Linux через PulseAudio
     */
    private async refreshLinuxDevices(): Promise<void> {
        try {
            const { stdout } = await execAsync('pactl list sources short');
            // Здесь можно добавить логику парсинга PulseAudio устройств
            console.log('Обновлены устройства PulseAudio');
        } catch (error) {
            console.warn('Ошибка при обновлении PulseAudio устройств:', error);
        }
    }

    /**
     * Кроссплатформенная запись аудио для Windows/macOS
     */
    async recordAudioStream(device: AudioDevice, sampleRate: number = 16000, channels: number = 1): Promise<NodeJS.ReadableStream> {
        if (this.isLinux) {
            throw new Error('Используйте getRecordCommand() для Linux');
        }

        return new Promise((resolve, reject) => {
            if (!device) {
                return reject(new Error("Устройство для записи не предоставлено."));
            }

            if (device.inputChannels < channels) {
                return reject(new Error(`Устройство не поддерживает ${channels} канал(а) для записи.`));
            }

            try {
                const { PassThrough } = require('stream');
                const audioStream = new PassThrough();

                this.rtAudio.openStream(
                    null, // No output
                    {
                        deviceId: device.id,
                        nChannels: channels,
                        firstChannel: 0,
                    },
                    16, // 16-bit
                    sampleRate,
                    1024, // frames per buffer
                    'voice-input-stream',
                    (inputBuffer: Buffer) => {
                        audioStream.write(inputBuffer);
                    },
                    null,
                    undefined
                );

                this.rtAudio.start();
                resolve(audioStream);

            } catch (error: unknown) {
                if (this.rtAudio.isStreamOpen()) {
                    this.rtAudio.closeStream();
                }
                reject(error);
            }
        });
    }

    /**
     * Останавливает запись аудио для Windows/macOS
     */
    stopAudioStream(): void {
        if (this.rtAudio.isStreamOpen()) {
            this.rtAudio.stop();
            this.rtAudio.closeStream();
        }
    }

    /**
     * Проверяет, является ли платформа кроссплатформенной (не Linux)
     */
    requiresRtAudio(): boolean {
        return this.isWindows || this.isMacOS;
    }
}

// Экспортируем класс
export default AudioDeviceManager;