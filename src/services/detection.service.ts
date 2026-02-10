import { randomUUID } from "crypto";
import type { Clip, TranscriptSegment } from "../types/index.js";

interface DetectionConfig {
    minDuration: number;
    maxDuration: number;
    targetClips: number;
}

/**
 * Detecta os melhores momentos do vídeo.
 * Usa transcrição + heurísticas; pode ser estendido com IA para scoring.
 */
export class DetectionService {
    /**
     * Analisa segmentos e retorna os melhores momentos para cortar
     */
    async detectClips(
        transcript: TranscriptSegment[],
        videoDuration: number,
        config: DetectionConfig
    ): Promise<Clip[]> {
        // Estratégia simples: divide o vídeo em chunks de tamanho ideal
        // TODO: Integrar scoring com IA (picos de emoção, palavras-chave, etc.)
        const clipDuration = Math.min(
            config.maxDuration,
            Math.max(config.minDuration, videoDuration / config.targetClips)
        );
        const clips: Clip[] = [];
        let currentTime = 0;

        while (
            currentTime < videoDuration &&
            clips.length < config.targetClips
        ) {
            const endTime = Math.min(currentTime + clipDuration, videoDuration);
            const segment = transcript.find(
                (s) => s.start >= currentTime && s.end <= endTime
            );

            clips.push({
                id: randomUUID(),
                startTime: currentTime,
                endTime,
                score: segment ? 0.8 : 0.5,
                reason: segment
                    ? "Possível momento destacado"
                    : "Segmento automático",
                transcript: segment?.text,
            });

            currentTime = endTime;
        }

        return clips
            .sort((a, b) => b.score - a.score)
            .slice(0, config.targetClips);
    }
}
