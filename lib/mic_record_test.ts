import AudioDeviceManager from './voice-device';
import path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

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
    
    // Добавляем поля для управления TTS
    private ttsQueue: Array<{ text: string; abortController: AbortController }> = [];
    private currentTTS?: { text: string; abortController: AbortController };
    private isTTSActive: boolean = false;

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
    }

    public async initialize(): Promise<void> {
        try {
            console.log('🧪 Запуск');
            await this.device();
            const durationSec = Number(process.env.DURATION || process.argv[2] || 5);
            console.log(`⏺️ Пробуем транскрибировать микрофон за ${durationSec} сек...`);
            const text = await this.transcribe(durationSec);
            console.log(`✅ Транскрипция: ${text || '(пусто)'}`);
        } catch (error) {
            console.error('❌ Ошибка при инициализации:', error);
        }
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

    public async recordMic(durationSeconds: number = 5, outFile?: string): Promise<string> {
        if (!this.defaultInputDevice) {
            throw new Error('Входное устройство не установлено. Сначала вызовите device().');
        }

        const outPath = path.resolve(__dirname, outFile || `mic_test_${Date.now()}.wav`);
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true }).catch(() => {});

        const manager = new AudioDeviceManager();
        await manager.initialize();

        if (process.platform === 'linux') {
            return new Promise<string>((resolve, reject) => {
                try {
                    const cmd = manager.getRecordCommand(this.defaultInputDevice, SAMPLE_RATE);
                    const prog = cmd[0];
                    const args = cmd.slice(1);

                    // Меняем тип вывода на WAV и ограничиваем длительность
                    const tIndex = args.findIndex(v => v === '-t');
                    if (tIndex >= 0 && args[tIndex + 1]) {
                        args[tIndex + 1] = 'wav';
                    } else {
                        args.push('-t', 'wav');
                    }
                    args.push('-d', String(durationSeconds));
                    args.push(outPath);

                    console.log(`🔧 Команда записи: ${prog} ${args.join(' ')}`);
                    const child = spawn(prog, args);
                    let stderr = '';
                    child.stdout.on('data', d => process.stdout.write(d.toString()));
                    child.stderr.on('data', d => { const s = d.toString(); stderr += s; process.stderr.write(s); });
                    child.on('error', err => reject(err));
                    child.on('close', code => {
                        if (code === 0 && fs.existsSync(outPath)) resolve(outPath);
                        else reject(new Error(`arecord завершился с кодом ${code}. ${stderr}`));
                    });
                } catch (e) {
                    reject(e as Error);
                }
            });
        }

        // Windows/macOS — RtAudio через testRecord
        const saved = await manager.testRecord(this.defaultInputDevice, durationSeconds, outPath);
        return saved;
    }

    // Объединённый метод транскрибации: запись + сбор WAV + Whisper
    public async transcribe(durationSeconds: number = 5): Promise<string> {
        if (!this.defaultInputDevice) {
            throw new Error('Входное устройство не установлено. Сначала вызовите device().');
        }

        // ensureWhisper
        const ensureWhisper = async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                require('nodejs-whisper');
            } catch {
                console.log('📦 Устанавливаю nodejs-whisper...');
                await new Promise<void>((resolve, reject) => {
                    const cwd = path.resolve(__dirname, '..');
                    const child = spawn('npm', ['i', '--no-audit', '--no-fund', 'nodejs-whisper'], { cwd });
                    let err = '';
                    child.stderr.on('data', d => { err += d.toString(); });
                    child.on('error', reject);
                    child.on('close', code => code === 0 ? resolve() : reject(new Error(err || 'npm install failed')));
                });
            }
        };

        // helper: run Whisper on WAV buffer
        const runWhisper = async (wavBuffer: Buffer): Promise<string> => {
            await ensureWhisper();
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = (() => { try { return require('nodejs-whisper'); } catch { return undefined as any; } })();
            if (!mod || !('nodewhisper' in mod)) {
                throw new Error('nodejs-whisper недоступен');
            }
            const { nodewhisper } = mod as any;
            const tempWavPath = path.resolve(__dirname, `utt_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
            try {
                await fs.promises.writeFile(tempWavPath, wavBuffer);
                const result = await nodewhisper(tempWavPath, {
                    modelName: 'small',
                    autoDownloadModelName: 'small',
                    removeWavFileAfterTranscription: true,
                    whisperOptions: { outputInText: false, language: 'ru' }
                });
                return result?.text ? String(result.text).trim() : '';
            } finally {
                await fs.promises.unlink(tempWavPath).catch(() => {});
            }
        };

        const manager = new AudioDeviceManager();
        await manager.initialize();

        if (process.platform === 'linux') {
            // arecord → WAV в stdout → Whisper
            const cmd = manager.getRecordCommand(this.defaultInputDevice, SAMPLE_RATE);
            const prog = cmd[0];
            const args = cmd.slice(1);
            const tIndex = args.findIndex(v => v === '-t');
            if (tIndex >= 0 && args[tIndex + 1]) {
                args[tIndex + 1] = 'wav';
            } else {
                args.push('-t', 'wav');
            }
            args.push('-d', String(durationSeconds));
            args.push('-'); // stdout

            console.log(`🔧 Команда записи (stdout): ${prog} ${args.join(' ')}`);
            const wavBuffer: Buffer = await new Promise((resolve, reject) => {
                const child = spawn(prog, args);
                const chunks: Buffer[] = [];
                let stderr = '';
                child.stdout.on('data', d => chunks.push(Buffer.from(d)));
                child.stderr.on('data', d => { const s = d.toString(); stderr += s; process.stderr.write(s); });
                child.on('error', reject);
                child.on('close', code => {
                    if (code !== 0) return reject(new Error(`arecord code=${code}. ${stderr}`));
                    resolve(Buffer.concat(chunks));
                });
            });
            return await runWhisper(wavBuffer);
        }

        // Windows/macOS: RtAudio → PCM → собираем WAV → Whisper
        const audioStream = await manager.recordAudioStream(this.defaultInputDevice, SAMPLE_RATE, 1);
        const chunks: Buffer[] = [];
        return await new Promise<string>((resolve, reject) => {
            const onData = (d: Buffer) => chunks.push(Buffer.from(d));
            audioStream.on('data', onData);
            const timer = setTimeout(async () => {
                try {
                    manager.stopAudioStream();
                    audioStream.off('data', onData);
                    const pcm = Buffer.concat(chunks);
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    const { WaveFile: WaveFileOriginal } = require('wavefile');
                    const wav = new WaveFileOriginal();
                    wav.fromScratch(1, SAMPLE_RATE, '16', pcm);
                    const wavBuffer = Buffer.from(wav.toBuffer());
                    const text = await runWhisper(wavBuffer);
                    resolve(text);
                } catch (e) {
                    reject(e as Error);
                } finally {
                    clearTimeout(timer);
                }
            }, durationSeconds * 1000);
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
voice.initialize();
