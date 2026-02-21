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
        config: PipelineConfig,
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
                    `${baseName}_clip_${i + 1}.${exportConfig.format}`,
                );

                const clipSegments = this.buildSegmentsForClip(
                    clip,
                    transcript,
                );
                let subtitlePath: string | undefined;

                if (clipSegments.length > 0) {
                    const hasWords = clipSegments.some(
                        (s) => s.words && s.words.length > 0,
                    );
                    if (hasWords) {
                        const assContent = this.buildAss(clipSegments);
                        subtitlePath = path.join(tempDir, `clip_${i + 1}.ass`);
                        await writeFile(subtitlePath, assContent, "utf-8");
                    } else {
                        const srtContent = this.buildSrt(clipSegments);
                        subtitlePath = path.join(tempDir, `clip_${i + 1}.srt`);
                        await writeFile(subtitlePath, srtContent, "utf-8");
                    }
                }

                await this.videoService.extractClip(
                    inputPath,
                    outputPath,
                    clip,
                    exportConfig,
                    subtitlePath,
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
        transcript: TranscriptSegment[],
    ): TranscriptSegment[] {
        const { startTime, endTime } = clip;

        return transcript
            .filter((seg) => seg.end > startTime && seg.start < endTime)
            .map((seg) => {
                const start = Math.max(seg.start, startTime) - startTime;
                const end = Math.min(seg.end, endTime) - startTime;

                const segment: TranscriptSegment = {
                    start: Math.max(0, start),
                    end: Math.max(start + 0.01, end),
                    text: seg.text,
                };

                if (seg.words) {
                    segment.words = seg.words
                        .filter((w) => w.end > startTime && w.start < endTime)
                        .map((w) => {
                            const wStart =
                                Math.max(w.start, startTime) - startTime;
                            const wEnd = Math.min(w.end, endTime) - startTime;
                            return {
                                word: w.word,
                                start: Math.max(0, wStart),
                                end: Math.max(wStart + 0.01, wEnd),
                            };
                        });
                }

                return segment;
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

    private buildAss(segments: TranscriptSegment[]): string {
        const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,100,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,1,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

        const HIGHLIGHT_COLOR = "&H00FFFF&"; // Yellow

        const events = segments
            .flatMap((seg) => {
                if (seg.words && seg.words.length > 0) {
                    return seg.words.map((w, currentIdx) => {
                        const start = this.formatAssTime(w.start);
                        const end = this.formatAssTime(w.end);

                        // Construct the full sentence, highlighting only the current word
                        const text = seg
                            .words!.map((wordObj, idx) => {
                                if (idx === currentIdx) {
                                    return `{\\c${HIGHLIGHT_COLOR}}${wordObj.word}{\\r}`;
                                }
                                return wordObj.word;
                            })
                            .join(" ");

                        return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
                    });
                } else {
                    const start = this.formatAssTime(seg.start);
                    const end = this.formatAssTime(seg.end);
                    return [
                        `Dialogue: 0,${start},${end},Default,,0,0,0,,${seg.text}`,
                    ];
                }
            })
            .join("\n");

        return header + events;
    }

    private formatAssTime(seconds: number): string {
        const totalMs = Math.max(0, Math.round(seconds * 1000));
        const ms = Math.floor((totalMs % 1000) / 10); // ASS uses centiseconds
        const totalSeconds = Math.floor(totalMs / 1000);
        const s = totalSeconds % 60;
        const totalMinutes = Math.floor(totalSeconds / 60);
        const m = totalMinutes % 60;
        const h = Math.floor(totalMinutes / 60);

        const pad = (n: number, size = 2) => n.toString().padStart(size, "0");

        return `${h}:${pad(m)}:${pad(s)}.${pad(ms)}`;
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

        return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
    }
}
