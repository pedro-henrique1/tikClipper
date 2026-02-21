import { randomUUID } from "crypto";
import type {
    Clip,
    ScoredSegment,
    ScoringStrategy,
    TranscriptSegment,
} from "../types/index.js";
import { logger } from "./logger.service.js";

interface DetectionConfig {
    minDuration: number;
    maxDuration: number;
    targetClips: number;
}

export class DetectionService {
    constructor(private scoringStrategy?: ScoringStrategy) {}

    async detectClips(
        transcript: TranscriptSegment[],
        videoDuration: number,
        config: DetectionConfig,
    ): Promise<Clip[]> {
        const aiClips = await this.buildAiClips(
            transcript,
            videoDuration,
            config,
        );

        return aiClips.slice(0, config.targetClips);
    }

    private async buildAiClips(
        transcript: TranscriptSegment[],
        videoDuration: number,
        config: DetectionConfig,
    ): Promise<Clip[]> {
        if (!this.scoringStrategy) {
            return [];
        }

        const WINDOW_SIZE = 420; // 7 minutes
        const OVERLAP = 60; // 1 minute
        const STEP = WINDOW_SIZE - OVERLAP;

        const allScored: ScoredSegment[] = [];

        try {
            // If video is short, just process once
            if (videoDuration <= WINDOW_SIZE + OVERLAP) {
                const scored =
                    await this.scoringStrategy.scoreSegments(transcript);
                allScored.push(...scored);
            } else {
                // Windowing loop
                for (let start = 0; start < videoDuration; start += STEP) {
                    const end = Math.min(start + WINDOW_SIZE, videoDuration);
                    console.log(
                        `[Detection] Analisando bloco: ${start}s - ${end}s`,
                    );

                    const windowTranscript = transcript.filter(
                        (s) => s.end > start && s.start < end,
                    );

                    if (windowTranscript.length === 0) continue;

                    const scored =
                        await this.scoringStrategy.scoreSegments(
                            windowTranscript,
                        );
                    allScored.push(...scored);

                    if (end >= videoDuration) break;
                }
            }

            // Filter and Deduplicate
            const valid = allScored
                .filter(
                    (s) =>
                        Number.isFinite(s.startTime) &&
                        Number.isFinite(s.endTime) &&
                        s.startTime >= 0 &&
                        s.endTime > s.startTime &&
                        s.endTime <= videoDuration,
                )
                .filter((s) => {
                    const duration = s.endTime - s.startTime;
                    return (
                        duration >= config.minDuration &&
                        duration <= config.maxDuration
                    );
                });

            // Deduplicate: remove segments starting within 5s of each other (keep highest score)
            const deduplicated: ScoredSegment[] = [];
            valid.sort((a, b) => b.score - a.score);

            for (const segment of valid) {
                const isDuplicate = deduplicated.some(
                    (d) => Math.abs(d.startTime - segment.startTime) < 5,
                );
                if (!isDuplicate) {
                    deduplicated.push(segment);
                }
            }

            logger.info(
                `[Detection] ${deduplicated.length} segmento(s) único(s) encontrado(s).`,
            );

            return deduplicated.map((s) => {
                const transcriptText = this.buildTranscriptText(
                    transcript,
                    s.startTime,
                    s.endTime,
                );

                return {
                    id: randomUUID(),
                    startTime: s.startTime,
                    endTime: s.endTime,
                    score: s.score,
                    reason: s.reason,
                    transcript: transcriptText,
                };
            });
        } catch (error) {
            logger.warn(
                { err: error },
                "[Detection] Falha no scoring IA. Usando fallback.",
            );
            return [];
        }
    }

    private buildTranscriptText(
        transcript: TranscriptSegment[],
        startTime: number,
        endTime: number,
    ): string | undefined {
        const text = transcript
            .filter((s) => s.end >= startTime && s.start <= endTime)
            .map((s) => s.text.trim())
            .filter(Boolean)
            .join(" ");

        return text.length > 0 ? text : undefined;
    }
}
