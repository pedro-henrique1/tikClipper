import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { TranscriptSegment } from "../types/index.js";
import { logger } from "./logger.service.js";
import { VideoService } from "./video.service.js";

const WHISPER_CPP_PATH =
    process.env.WHISPER_CPP_PATH ??
    path.join(process.cwd(), "..", "whisper.cpp");

const WHISPER_BINARY =
    process.env.WHISPER_BINARY ??
    path.join(WHISPER_CPP_PATH, "build", "bin", "whisper-cli");

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "models/ggml-base.bin";

function parseWhisperTime(time: string): number {
    const match = time.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export class TranscriptionService {
    private videoService = new VideoService();

    async transcribe(
        inputPath: string,
        wordTimestamps = false,
    ): Promise<TranscriptSegment[]> {
        const tempDir = await mkdtemp(path.join(tmpdir(), "tikclipper-"));
        const audioPath = path.join(tempDir, "audio.wav");

        try {
            await this.videoService.extractAudioToWav(inputPath, audioPath);

            const segments = await this.runWhisper(audioPath, wordTimestamps);
            return segments;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }

    private async runWhisper(
        audioPath: string,
        wordTimestamps = false,
    ): Promise<TranscriptSegment[]> {
        const modelPath = path.isAbsolute(WHISPER_MODEL)
            ? WHISPER_MODEL
            : path.join(WHISPER_CPP_PATH, WHISPER_MODEL);

        if (!existsSync(WHISPER_BINARY)) {
            logger.warn(
                `[Transcription] Binário whisper.cpp não encontrado em ${WHISPER_BINARY}. ` +
                    "Defina WHISPER_CPP_PATH ou WHISPER_BINARY apontando para o executável (ex.: build/bin/whisper-cli).",
            );
            return [];
        }

        if (!existsSync(modelPath)) {
            logger.warn(
                `[Transcription] Modelo não encontrado em ${modelPath}. ` +
                    "Baixe com ./models/download-ggml-model.sh base",
            );
            return [];
        }

        const args = ["-m", modelPath, "-f", audioPath, "-l", "pt"];
        if (wordTimestamps) {
            // -ml 1 forces one word per line (mostly) which makes parsing word timestamps easier
            args.push("-ml", "1");
        }

        const segments = await new Promise<TranscriptSegment[]>(
            (resolve, reject) => {
                const proc = spawn(WHISPER_BINARY, args, {
                    cwd: WHISPER_CPP_PATH,
                });

                let stdout = "";
                let stderr = "";

                proc.stdout.on("data", (data) => (stdout += data.toString()));
                proc.stderr.on("data", (data) => (stderr += data.toString()));

                proc.on("close", (code) => {
                    if (code !== 0) {
                        reject(
                            new Error(`whisper.cpp exit ${code}: ${stderr}`),
                        );
                        return;
                    }

                    try {
                        const lines = stdout.split(/\r?\n/);
                        const parsed: TranscriptSegment[] = [];

                        // Temporary words for current segment being built
                        let currentWords: {
                            word: string;
                            start: number;
                            end: number;
                        }[] = [];

                        for (const line of lines) {
                            const match = line.match(
                                /\[(\d+:\d+:\d+[.,]\d+)\s+-->\s+(\d+:\d+:\d+[.,]\d+)\]\s+(.*)/,
                            );
                            if (!match) continue;

                            const [, startStr, endStr, textRaw] = match;
                            const text = textRaw.trim();
                            if (!text) continue;

                            const start = parseWhisperTime(startStr);
                            const end = parseWhisperTime(endStr);

                            if (wordTimestamps) {
                                currentWords.push({ word: text, start, end });

                                // Group words into segments of ~6 words for readability
                                if (
                                    currentWords.length >= 6 ||
                                    text.match(/[.!?]$/)
                                ) {
                                    parsed.push({
                                        start: currentWords[0].start,
                                        end: currentWords[
                                            currentWords.length - 1
                                        ].end,
                                        text: currentWords
                                            .map((w) => w.word)
                                            .join(" "),
                                        words: [...currentWords],
                                    });
                                    currentWords = [];
                                }
                            } else {
                                parsed.push({ start, end, text });
                            }
                        }

                        // Push remaining words if any
                        if (currentWords.length > 0) {
                            parsed.push({
                                start: currentWords[0].start,
                                end: currentWords[currentWords.length - 1].end,
                                text: currentWords.map((w) => w.word).join(" "),
                                words: [...currentWords],
                            });
                        }

                        resolve(parsed);
                    } catch (err) {
                        reject(
                            err instanceof Error ? err : new Error(String(err)),
                        );
                    }
                });

                proc.on("error", reject);
            },
        );

        return segments;
    }
}
