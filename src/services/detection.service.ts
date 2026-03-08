import { randomUUID } from "crypto";
import type {
    Clip,
    DetectionMeta,
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

export interface DetectionResult {
    clips: Clip[];
    meta: DetectionMeta;
}

const HIGH_IMPACT_WORDS = [
    // PT
    "incrível",
    "impossível",
    "surpreendente",
    "nunca",
    "jamais",
    "absurdo",
    "impressionante",
    "demais",
    "melhor",
    "pior",
    "maior",
    "menor",
    "mais rápido",
    "não acredito",
    "que isso",
    "meu deus",
    "cara",
    "mano",
    "gente",
    "olha",
    "escuta",
    "sério",
    "verdade",
    "mentira",
    "errado",
    "certo",
    "por quê",
    "como assim",
    "peraí",
    "espera",
    "olha só",
    "imagina",
    "veja",
    "atenção",
    "cuidado",
    "perigo",
    "erro",
    "falha",
    "sucesso",
    "vitória",
    "derrota",
    // EN
    "never",
    "impossible",
    "incredible",
    "unbelievable",
    "insane",
    "crazy",
    "amazing",
    "horrible",
    "best",
    "worst",
    "fastest",
    "oh my",
    "wait",
    "actually",
    "literally",
    "seriously",
    "honestly",
    "watch",
    "look",
    "secret",
    "truth",
    "lie",
    "wrong",
    "right",
    "dangerous",
];

function heuristicScore(seg: TranscriptSegment): number {
    const text = seg.text.toLowerCase();
    const duration = Math.max(seg.end - seg.start, 0.1);
    const words = text.split(/\s+/).filter(Boolean);

    const hits = Math.min(
        HIGH_IMPACT_WORDS.filter((w) => text.includes(w)).length,
        3,
    );
    const keywordScore = hits / 3;

    const hasEmotional = /[?!]/.test(seg.text) ? 0.3 : 0;

    const wps = words.length / duration;
    const densityScore = Math.min(wps / 4, 1) * 0.2;

    return Math.min(keywordScore * 0.5 + hasEmotional + densityScore, 1);
}

function extractCandidates(
    transcript: TranscriptSegment[],
    config: DetectionConfig,
    maxCandidates = 10,
): { segments: TranscriptSegment[]; hScore: number }[] {
    if (transcript.length === 0) return [];

    const scored = transcript.map((seg) => ({
        seg,
        score: heuristicScore(seg),
        idx: 0,
    }));
    scored.forEach((s, i) => (s.idx = i));

    const scores = scored.map((s) => s.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    logger.debug(
        `[Heuristic] Scores: min=${min.toFixed(2)} max=${max.toFixed(2)} avg=${avg.toFixed(2)} | ${transcript.length} segmento(s)`,
    );

    const byScore = [...scored].sort((a, b) => b.score - a.score);

    const windows: { start: number; end: number; score: number }[] = [];

    for (const peak of byScore) {
        if (windows.length >= maxCandidates * 3) break;

        let lo = peak.idx;
        let hi = peak.idx;
        let duration = peak.seg.end - peak.seg.start;

        while (duration < config.maxDuration && hi + 1 < transcript.length) {
            hi++;
            duration = transcript[hi].end - transcript[lo].start;
        }
        while (duration < config.minDuration && lo > 0) {
            lo--;
            duration = transcript[hi].end - transcript[lo].start;
        }

        if (duration < config.minDuration) continue;

        windows.push({
            start: transcript[lo].start,
            end: transcript[hi].end,
            score: peak.score,
        });
    }

    if (windows.length === 0) {
        logger.debug(
            "[Heuristic] Nenhum candidato. Usando transcript completo.",
        );
        return [{ segments: transcript, hScore: 0 }];
    }

    windows.sort((a, b) => b.score - a.score);
    const kept: typeof windows = [];
    for (const w of windows) {
        const overlaps = kept.some((k) => w.start < k.end && w.end > k.start);
        if (!overlaps) kept.push(w);
        if (kept.length >= maxCandidates) break;
    }

    kept.sort((a, b) => a.start - b.start);
    logger.debug(`[Heuristic] ${kept.length} candidato(s) selecionado(s):`);
    kept.forEach((c, i) =>
        logger.debug(
            `[Heuristic]   #${i + 1} → ${c.start.toFixed(1)}s–${c.end.toFixed(1)}s (score: ${c.score.toFixed(3)})`,
        ),
    );

    return kept.map((c) => ({
        segments: transcript.filter((s) => s.end > c.start && s.start < c.end),
        hScore: c.score,
    }));
}

export class DetectionService {
    constructor(private scoringStrategy?: ScoringStrategy) {}

    async detectClips(
        transcript: TranscriptSegment[],
        videoDuration: number,
        config: DetectionConfig,
    ): Promise<DetectionResult> {
        const { clips, meta } = await this.buildAiClips(
            transcript,
            videoDuration,
            config,
        );

        return { clips: clips.slice(0, config.targetClips), meta };
    }

    private async buildAiClips(
        transcript: TranscriptSegment[],
        videoDuration: number,
        config: DetectionConfig,
    ): Promise<DetectionResult> {
        logger.debug(
            `[Detection] Config — minDuration: ${config.minDuration}s, maxDuration: ${config.maxDuration}s, targetClips: ${config.targetClips}`,
        );
        logger.debug(
            `[Detection] videoDuration: ${videoDuration.toFixed(2)}s | transcript segments: ${transcript.length}`,
        );

        if (!this.scoringStrategy) {
            logger.warn(
                "[Detection] Nenhuma estratégia de scoring configurada (OPEN_ROUTE não definido?).",
            );
            return { clips: [], meta: { windowsAnalyzed: 0 } };
        }

        logger.debug("[Detection] Etapa 1: Análise heurística");
        const candidates = extractCandidates(
            transcript,
            config,
            config.targetClips * 4,
        );
        logger.debug(
            `[Detection] ${candidates.length} candidato(s) passando para a IA`,
        );

        if (candidates.length === 0) {
            return { clips: [], meta: { windowsAnalyzed: 0 } };
        }

        logger.debug("[Detection] Etapa 2: Ranking pela IA");

        const allScored: ScoredSegment[] = [];
        let windowsAnalyzed = 0;

        try {
            const combined = candidates
                .flatMap((c) => c.segments)
                .sort((a, b) => a.start - b.start)

                .filter(
                    (seg, i, arr) => i === 0 || seg.start !== arr[i - 1].start,
                );

            logger.debug(
                `[Detection] Enviando ${combined.length} segmento(s) para a IA (1 chamada)`,
            );

            if (combined.length > 0) {
                windowsAnalyzed = 1;

                const scored =
                    await this.scoringStrategy!.scoreSegments(combined);
                allScored.push(...scored);
            }

            logger.debug(
                `[Detection] Total de segmentos brutos da IA: ${allScored.length}`,
            );

            const boundsFiltered = allScored.filter(
                (s) =>
                    Number.isFinite(s.startTime) &&
                    Number.isFinite(s.endTime) &&
                    s.startTime >= 0 &&
                    s.endTime > s.startTime &&
                    s.endTime <= videoDuration,
            );
            logger.debug(
                `[Detection] Após filtro de bounds: ${boundsFiltered.length} segmento(s)`,
            );

            const valid = boundsFiltered.filter((s) => {
                const duration = s.endTime - s.startTime;
                const ok =
                    duration >= config.minDuration &&
                    duration <= config.maxDuration;
                if (!ok) {
                    logger.debug(
                        `[Detection] ✗ Fora do range de duração: ${s.startTime.toFixed(1)}s–${s.endTime.toFixed(1)}s (${duration.toFixed(1)}s)`,
                    );
                }
                return ok;
            });
            logger.debug(
                `[Detection] Após filtro de duração: ${valid.length} segmento(s)`,
            );

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

            logger.debug(
                `[Detection] ${deduplicated.length} segmento(s) único(s) encontrado(s).`,
            );

            const clips = deduplicated.map((s) => {
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

            return { clips, meta: { windowsAnalyzed } };
        } catch (error) {
            if (
                typeof error === "object" &&
                error !== null &&
                "status" in error &&
                (error as { status: number }).status === 401
            ) {
                throw error;
            }
            logger.warn(
                { err: error },
                "[Detection] Falha no scoring IA. Usando fallback.",
            );
            return { clips: [], meta: { windowsAnalyzed } };
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
