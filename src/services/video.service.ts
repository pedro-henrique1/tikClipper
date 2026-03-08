import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { mkdir } from "fs/promises";
import path from "path";
import type { Clip, ExportConfig } from "../types/index.js";

ffmpeg.setFfmpegPath((ffmpegStatic as unknown as string) ?? "");

export class VideoService {
    async extractClip(
        inputPath: string,
        outputPath: string,
        clip: Clip,
        config: ExportConfig,
        subtitlesPath?: string,
        onProgress?: (percent: number) => void,
    ): Promise<string> {
        await mkdir(path.dirname(outputPath), { recursive: true });

        return new Promise((resolve, reject) => {
            const duration = clip.endTime - clip.startTime;

            // Build the filter_complex graph.
            // All filters must go in complexFilter so named pads [bg]/[fg]
            // are valid.  .videoFilters([...]) with labels generates invalid -vf.
            const filters: ffmpeg.FilterSpecification[] = [
                // Background: upscale to fill 1080x1920 and blur
                {
                    filter: "scale",
                    options: "1080:1920:force_original_aspect_ratio=increase",
                    inputs: "0:v",
                    outputs: "scaled_bg",
                },
                {
                    filter: "crop",
                    options: "1080:1920",
                    inputs: "scaled_bg",
                    outputs: "cropped_bg",
                },
                {
                    filter: "boxblur",
                    options: "20:10",
                    inputs: "cropped_bg",
                    outputs: "bg",
                },
                // Foreground: fit within 1080 width (even height required by libx264)
                {
                    filter: "scale",
                    options: "1080:trunc(ow/a/2)*2",
                    inputs: "0:v",
                    outputs: "fg",
                },
                // Overlay fg centred on bg
                {
                    filter: "overlay",
                    options: "(W-w)/2:(H-h)/2",
                    inputs: ["bg", "fg"],
                    outputs: subtitlesPath ? "overlaid" : "out",
                },
            ];

            // If we have subtitles, append as the last filter in the graph
            if (subtitlesPath) {
                const escaped = subtitlesPath
                    .replace(/\\/g, "\\\\")
                    .replace(/'/g, "\\'")
                    .replace(/:/g, "\\:");
                const isAss = subtitlesPath.toLowerCase().endsWith(".ass");
                filters.push({
                    filter: isAss ? "subtitles" : "subtitles",
                    options: isAss
                        ? `'${escaped}'`
                        : `'${escaped}':force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=2,Shadow=1,MarginV=20'`,
                    inputs: "overlaid",
                    outputs: "out",
                });
            }

            ffmpeg()
                .input(inputPath)
                .setStartTime(clip.startTime)
                .setDuration(duration)
                .complexFilter(filters, "out")
                .outputOptions([
                    "-c:v libx264",
                    "-preset ultrafast",
                    "-crf 23",
                    "-c:a aac",
                    "-b:a 128k",
                    "-threads 0",
                ])
                .output(outputPath)
                .on("start", () => {
                    console.log(
                        `[Video] Iniciando extração: ${path.basename(outputPath)}`,
                    );
                })
                .on("progress", (progress) => {
                    if (progress.percent !== undefined && onProgress) {
                        onProgress(
                            Math.max(0, Math.min(100, progress.percent)),
                        );
                    }
                })
                .on("end", () => resolve(outputPath))
                .on("error", (err, stdout, stderr) => {
                    console.error(`[Video] Erro ffmpeg:`, err.message);
                    if (stderr)
                        console.error(`[Video] stderr:`, stderr.slice(-500));
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
