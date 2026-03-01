import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { mkdir } from "fs/promises";
import path from "path";
import type { Clip, ExportConfig } from "../types/index.js";

ffmpeg.setFfmpegPath(ffmpegStatic ?? "");

export class VideoService {
    async extractClip(
        inputPath: string,
        outputPath: string,
        clip: Clip,
        config: ExportConfig,
        subtitlesPath?: string,
    ): Promise<string> {
        await mkdir(path.dirname(outputPath), { recursive: true });

        return new Promise((resolve, reject) => {
            const duration = clip.endTime - clip.startTime;
            let command = ffmpeg()
                .input(inputPath)
                .setStartTime(clip.startTime)
                .setDuration(duration)
                .outputOptions([
                    "-c:v libx264",
                    "-preset ultrafast",
                    "-crf 23",
                    "-c:a aac",
                    "-b:a 128k",
                    "-threads 0",
                ])
                .size(`${config.width}x${config.height}`)
                .autopad();

            if (subtitlesPath) {
                const escaped = subtitlesPath.replace(/'/g, "\\'");
                const isAss = subtitlesPath.toLowerCase().endsWith(".ass");

                if (isAss) {
                    // For ASS files, we let the embedded styles (including karaoke) handle the look
                    command = command.videoFilter(`subtitles='${escaped}'`);
                } else {
                    const style =
                        "force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,MarginV=20'";
                    command = command.videoFilter(
                        `subtitles='${escaped}':${style}`,
                    );
                }
            }

            command
                .output(outputPath)
                .on("start", (cmd) => {
                    console.log(
                        `[Video] Iniciando extração: ${path.basename(outputPath)}`,
                    );
                })
                .on("progress", (progress) => {
                    if (progress.percent) {
                        process.stdout.write(
                            `\r[Video] ${path.basename(outputPath)}: ${Math.round(progress.percent)}%  `,
                        );
                    }
                })
                .on("end", () => {
                    process.stdout.write("\n");
                    resolve(outputPath);
                })
                .on("error", (err) => {
                    process.stdout.write("\n");
                    reject(err);
                })
                .run();
        });
    }

    async extractAudioToWav(
        inputPath: string,
        outputPath: string,
    ): Promise<string> {
        await mkdir(path.dirname(outputPath), { recursive: true });

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .noVideo()
                .audioCodec("pcm_s16le")
                .audioFrequency(16000)
                .audioChannels(1)
                .addOption("-threads 0")
                .addOption("-map 0:a:0")
                .output(outputPath)
                .on("end", () => resolve(outputPath))
                .on("error", reject)
                .run();
        });
    }

    async getMetadata(inputPath: string): Promise<{
        duration: number;
        width: number;
        height: number;
    }> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(inputPath, (err, metadata) => {
                if (err) return reject(err);
                const video = metadata.streams.find(
                    (s) => s.codec_type === "video",
                );
                resolve({
                    duration: metadata.format.duration ?? 0,
                    width: video?.width ?? 0,
                    height: video?.height ?? 0,
                });
            });
        });
    }
}
