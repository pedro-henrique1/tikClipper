import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type {
    Clip,
    PipelineConfig,
    TranscriptSegment,
} from "../types/index.js";
import { VideoService } from "./video.service.js";


export class ExportService {
    private videoService = new VideoService();

    async exportClips(
        inputPath: string,
        clips: Clip[],
        transcript: TranscriptSegment[],
        config: PipelineConfig
    ): Promise<string[]> {
        const { outputDir, exportConfig } = config;
        await mkdir(outputDir, { recursive: true });

        const tempDir = await mkdtemp(path.join(tmpdir(), "tikclipper-srt-"));
        const outputPaths: string[] = [];
        const baseName = path.basename(inputPath, path.extname(inputPath));

        try {
            for (let i = 0; i < clips.length; i++) {
                const clip = clips[i];
                const outputPath = path.join(
                    outputDir,
                    `${baseName}_clip_${i + 1}.${exportConfig.format}`
                );

                const clipSegments = this.buildSegmentsForClip(clip, transcript);
                let srtPath: string | undefined;

                if (clipSegments.length > 0) {
                    const srtContent = this.buildSrt(clipSegments);
                    srtPath = path.join(tempDir, `clip_${i + 1}.srt`);
                    await writeFile(srtPath, srtContent, "utf-8");
                }

                await this.videoService.extractClip(
                    inputPath,
                    outputPath,
                    clip,
                    exportConfig,
                    srtPath
                );
                outputPaths.push(outputPath);
            }

            return outputPaths;
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    }


    private buildSegmentsForClip(
        clip: Clip,
        transcript: TranscriptSegment[]
    ): TranscriptSegment[] {
        const { startTime, endTime } = clip;

        return transcript
            .filter((seg) => seg.end > startTime && seg.start < endTime)
            .map((seg) => {
                const start = Math.max(seg.start, startTime) - startTime;
                const end = Math.min(seg.end, endTime) - startTime;
                return {
                    start: Math.max(0, start),
                    end: Math.max(start + 0.01, end),
                    text: seg.text,
                };
            });
    }

   
    private buildSrt(segments: TranscriptSegment[]): string {
        return segments
            .map((seg, idx) => {
                const start = this.formatSrtTime(seg.start);
                const end = this.formatSrtTime(seg.end);
                return `${idx + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`;
            })
            .join("\n");
    }

    private formatSrtTime(seconds: number): string {
        const totalMs = Math.max(0, Math.round(seconds * 1000));
        const ms = totalMs % 1000;
        const totalSeconds = (totalMs - ms) / 1000;
        const s = totalSeconds % 60;
        const totalMinutes = (totalSeconds - s) / 60;
        const m = totalMinutes % 60;
        const h = (totalMinutes - m) / 60;

        const pad = (n: number, size = 2) => n.toString().padStart(size, "0");

        return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
    }
}
