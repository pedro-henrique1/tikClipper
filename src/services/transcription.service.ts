import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { TranscriptSegment } from "../types/index.js";
import { VideoService } from "./video.service.js";

const WHISPER_CPP_PATH =
    process.env.WHISPER_CPP_PATH ??
    path.join(process.cwd(), "..", "whisper.cpp");

const WHISPER_BINARY =
    process.env.WHISPER_BINARY ??
    path.join(WHISPER_CPP_PATH, "build", "bin", "whisper-cli");

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "models/ggml-base.bin";

function parseWhisperTime(time: string): number {
    // Formato: HH:MM:SS.mmm
    const match = time.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export class TranscriptionService {
    private videoService = new VideoService();

    async transcribe(inputPath: string): Promise<TranscriptSegment[]> {
        const tempDir = await mkdtemp(path.join(tmpdir(), "tikclipper-"));
        const audioPath = path.join(tempDir, "audio.wav");

        try {
            // 1. Extrair áudio do vídeo (16kHz mono para Whisper)
            await this.videoService.extractAudioToWav(inputPath, audioPath);

            // 2. Transcrever com whisper.cpp
            const segments = await this.runWhisper(audioPath);
            return segments;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }

    private async runWhisper(audioPath: string): Promise<TranscriptSegment[]> {
        const modelPath = path.isAbsolute(WHISPER_MODEL)
            ? WHISPER_MODEL
            : path.join(WHISPER_CPP_PATH, WHISPER_MODEL);

        if (!existsSync(WHISPER_BINARY)) {
            console.warn(
                `[Transcription] Binário whisper.cpp não encontrado em ${WHISPER_BINARY}. ` +
                    "Defina WHISPER_CPP_PATH ou WHISPER_BINARY apontando para o executável (ex.: build/bin/whisper-cli)."
            );
            return [];
        }

        if (!existsSync(modelPath)) {
            console.warn(
                `[Transcription] Modelo não encontrado em ${modelPath}. ` +
                    "Baixe com ./models/download-ggml-model.sh base"
            );
            return [];
        }

        const segments = await new Promise<TranscriptSegment[]>(
            (resolve, reject) => {
                const proc = spawn(
                    WHISPER_BINARY,
                    ["-m", modelPath, "-f", audioPath, "-l", "pt"],
                    { cwd: WHISPER_CPP_PATH }
                );

                let stdout = "";
                let stderr = "";

                proc.stdout.on("data", (data) => (stdout += data.toString()));
                proc.stderr.on("data", (data) => (stderr += data.toString()));

                proc.on("close", (code) => {
                    if (code !== 0) {
                        reject(
                            new Error(`whisper.cpp exit ${code}: ${stderr}`)
                        );
                        return;
                    }

                    try {
                        const lines = stdout.split(/\r?\n/);
                        const parsed: TranscriptSegment[] = [];

                        for (const line of lines) {
                            const match = line.match(
                                /\[(\d+:\d+:\d+[.,]\d+)\s+-->\s+(\d+:\d+:\d+[.,]\d+)\]\s+(.*)/
                            );
                            if (!match) continue;

                            const [, startStr, endStr, textRaw] = match;
                            const text = textRaw.trim();
                            if (!text) continue;

                            const start = parseWhisperTime(startStr);
                            const end = parseWhisperTime(endStr);

                            parsed.push({ start, end, text });
                        }

                        resolve(parsed);
                    } catch (err) {
                        reject(
                            err instanceof Error ? err : new Error(String(err))
                        );
                    }
                });

                proc.on("error", reject);
            }
        );

        return segments;
    }
}
