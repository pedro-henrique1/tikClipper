import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { existsSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { cpus, tmpdir } from "os";
import path from "path";
import type { TranscriptSegment } from "../types/index.js";
import { logger } from "./logger.service.js";
import { VideoService } from "./video.service.js";

const FFMPEG_BIN = (ffmpegStatic as unknown as string) ?? "ffmpeg";

const WHISPER_CPP_PATH =
    process.env.WHISPER_CPP_PATH ??
    path.join(process.cwd(), "..", "whisper.cpp");

const WHISPER_BINARY =
    process.env.WHISPER_BINARY ??
    path.join(WHISPER_CPP_PATH, "build", "bin", "whisper-cli");

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "models/ggml-base.bin";

const PARALLEL_CHUNKS = Math.min(cpus().length, 4);

const CHUNK_OVERLAP = 2;

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
        onProgress?: (currentSeconds: number) => void,
    ): Promise<TranscriptSegment[]> {
        const tempDir = await mkdtemp(path.join(tmpdir(), "tikclipper-"));

        try {
            const { duration } = await this.videoService.getMetadata(inputPath);

            const useSingleChunk = duration <= 120 || PARALLEL_CHUNKS <= 1;

            if (useSingleChunk) {
                const audioPath = path.join(tempDir, "audio.wav");
                await this.videoService.extractAudioToWav(inputPath, audioPath);
                return await this.runWhisper(
                    audioPath,
                    wordTimestamps,
                    0,
                    onProgress,
                );
            }

            const chunkDuration = duration / PARALLEL_CHUNKS;
            console.log(
                `[Transcription] Dividindo ${duration.toFixed(0)}s em ${PARALLEL_CHUNKS} chunks de ~${chunkDuration.toFixed(0)}s cada`,
            );

            const chunkPaths: string[] = [];
            const chunkOffsets: number[] = [];

            await Promise.all(
                Array.from({ length: PARALLEL_CHUNKS }, async (_, i) => {
                    const start = Math.max(
                        0,
                        i * chunkDuration - CHUNK_OVERLAP,
                    );
                    const end = Math.min(
                        duration,
                        (i + 1) * chunkDuration + CHUNK_OVERLAP,
                    );
                    const chunkPath = path.join(tempDir, `chunk_${i}.wav`);
                    chunkPaths[i] = chunkPath;
                    chunkOffsets[i] = start;

                    await this.extractAudioChunk(
                        inputPath,
                        chunkPath,
                        start,
                        end - start,
                    );
                }),
            );

            console.log(
                `[Transcription] ${PARALLEL_CHUNKS} chunks extraídos — iniciando whisper em paralelo...`,
            );

            const chunkProgress = new Array(PARALLEL_CHUNKS).fill(0);

            const chunkResults = await Promise.all(
                chunkPaths.map((chunkPath, i) =>
                    this.runWhisper(
                        chunkPath,
                        wordTimestamps,
                        chunkOffsets[i],
                        (current) => {
                            if (!onProgress) return;

                            chunkProgress[i] = chunkOffsets[i] + current;

                            onProgress(Math.min(...chunkProgress));
                        },
                    ),
                ),
            );

            const merged: TranscriptSegment[] = [];

            for (let i = 0; i < chunkResults.length; i++) {
                const primaryEnd =
                    i < PARALLEL_CHUNKS - 1
                        ? (i + 1) * chunkDuration
                        : Infinity;

                for (const seg of chunkResults[i]) {
                    if (seg.start < primaryEnd) {
                        merged.push(seg);
                    }
                }
            }

            merged.sort((a, b) => a.start - b.start);

            const deduped = merged.filter(
                (seg, idx) =>
                    idx === 0 ||
                    Math.abs(seg.start - merged[idx - 1].start) > 0.5,
            );

            console.log(
                `[Transcription] ${deduped.length} segmento(s) após merge dos ${PARALLEL_CHUNKS} chunks`,
            );

            return deduped;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }

    /** Extract a time slice of audio using ffmpeg */
    private extractAudioChunk(
        inputPath: string,
        outputPath: string,
        startSec: number,
        durationSec: number,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = [
                "-y",
                "-ss",
                startSec.toFixed(3),
                "-i",
                inputPath,
                "-t",
                durationSec.toFixed(3),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "16000",
                "-ac",
                "1",
                "-threads",
                "2",
                outputPath,
            ];

            const proc = spawn(FFMPEG_BIN, args, {
                stdio: ["ignore", "ignore", "pipe"],
            });
            let stderr = "";
            proc.stderr?.on("data", (d) => (stderr += d.toString()));
            proc.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg chunk exit ${code}: ${stderr}`));
            });
            proc.on("error", reject);
        });
    }

    private async runWhisper(
        audioPath: string,
        wordTimestamps = false,
        timeOffset = 0,
        onProgress?: (currentSeconds: number) => void,
    ): Promise<TranscriptSegment[]> {
        const modelPath = path.isAbsolute(WHISPER_MODEL)
            ? WHISPER_MODEL
            : path.join(WHISPER_CPP_PATH, WHISPER_MODEL);

        if (!existsSync(WHISPER_BINARY)) {
            logger.debug(
                `[Transcription] whisper.cpp binary not found at ${WHISPER_BINARY}. ` +
                    "Defina WHISPER_CPP_PATH ou WHISPER_BINARY apontando para o executável (ex.: build/bin/whisper-cli).",
            );
            return [];
        }

        if (!existsSync(modelPath)) {
            logger.debug(
                `[Transcription] Model not found at ${modelPath}. ` +
                    "Baixe com ./models/download-ggml-model.sh base",
            );
            return [];
        }

        const threadsPerChunk = Math.max(
            1,
            Math.floor(cpus().length / PARALLEL_CHUNKS),
        );

        const args = [
            "-m",
            modelPath,
            "-f",
            audioPath,
            "-l",
            "pt",
            "-t",
            threadsPerChunk.toString(),
            "--beam-size",
            "1",
            "--best-of",
            "1",
        ];
        if (wordTimestamps) {
            args.push("--split-on-word", "-ml", "1");
        }

        const segments = await new Promise<TranscriptSegment[]>(
            (resolve, reject) => {
                const proc = spawn(WHISPER_BINARY, args, {
                    cwd: WHISPER_CPP_PATH,
                });

                let stdout = "";
                let stderr = "";

                proc.stdout.on("data", (data) => {
                    const chunk = data.toString();
                    stdout += chunk;

                    if (onProgress) {
                        const segRegex =
                            /\[\d+:\d+:\d+[.,]\d+\s+-->\s+(\d+:\d+:\d+[.,]\d+)\]/g;
                        let m: RegExpExecArray | null;
                        while ((m = segRegex.exec(chunk)) !== null) {
                            onProgress(parseWhisperTime(m[1]));
                        }
                    }
                });
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
                            const text = textRaw.trim().replace(/^\[.*\] /, "");
                            if (!text) continue;

                            const start =
                                parseWhisperTime(startStr) + timeOffset;
                            const end = parseWhisperTime(endStr) + timeOffset;

                            if (wordTimestamps) {
                                currentWords.push({ word: text, start, end });

                                if (
                                    currentWords.length >= 4 ||
                                    text.match(/[.!?]$/)
                                ) {
                                    parsed.push({
                                        start: currentWords[0].start,
                                        end: currentWords[
                                            currentWords.length - 1
                                        ].end,
                                        text: currentWords
                                            .map((w) => w.word)
                                            .join(" ")
                                            .replace(/\s+([,.!?])/g, "$1"),
                                        words: [...currentWords],
                                    });
                                    currentWords = [];
                                }
                            } else {
                                parsed.push({
                                    start,
                                    end,
                                    text: text.replace(/\s+([,.!?])/g, "$1"),
                                });
                            }
                        }

                        if (currentWords.length > 0) {
                            parsed.push({
                                start: currentWords[0].start,
                                end: currentWords[currentWords.length - 1].end,
                                text: currentWords
                                    .map((w) => w.word)
                                    .join(" ")
                                    .replace(/\s+([,.!?])/g, "$1"),
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
