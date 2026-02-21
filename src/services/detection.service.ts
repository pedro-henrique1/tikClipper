import { randomUUID } from "crypto";
import type {
    Clip,
    ScoringStrategy,
    TranscriptSegment,
} from "../types/index.js";

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

        try {
            const scored = await this.scoringStrategy.scoreSegments(transcript);

            const valid = scored
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
                    const isValid =
                        duration >= config.minDuration &&
                        duration <= config.maxDuration;

                    if (!isValid) {
                        console.log(
                            `[Detection] Segmento ignorado: duracao ${duration.toFixed(1)}s (esperado ${config.minDuration}-${config.maxDuration}s)`,
                        );
                    }

                    return isValid;
                })
                .sort((a, b) => b.score - a.score);

            console.log(
                `[Detection] ${valid.length} segmento(s) valido(s) apos filtro (duracao ${config.minDuration}-${config.maxDuration}s).`,
            );

            return valid.map((s) => {
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
            console.warn(
                "[Detection] Falha no scoring IA. Usando fallback.",
                error,
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
