import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

import type {
    ScoredSegment,
    ScoringStrategy,
    TranscriptSegment,
} from "../types/index.js";
import { logger } from "./logger.service.js";

export class GeminiScoringStrategy implements ScoringStrategy {
    private ai: GoogleGenAI;
    private modelName = "gemini-2.0-flash-lite";

    constructor(apiKey: string) {
        this.ai = new GoogleGenAI({
            apiKey,
        });
    }

    async scoreSegments(
        transcript: TranscriptSegment[],
    ): Promise<ScoredSegment[]> {
        const simplifiedTranscript = transcript.map((t) => ({
            s: t.start,
            e: t.end,
            t: t.text,
        }));

        const prompt = `
Você é um editor de vídeo especialista em criar cortes virais para TikTok e Reels.

Analise a seguinte transcrição.

Identifique de 3 a 5 momentos com alto potencial de engajamento.

Critérios:
- Humor
- Polêmica
- Lição forte
- Curiosidade

REGRAS:
- Clipes entre 0 e 90 segundos
- Use timestamps exatos
- Retorne APENAS JSON válido

Formato:
[
 { "startTime": number, "endTime": number, "score": number, "reason": "string" }
]

Transcrição:
${JSON.stringify(simplifiedTranscript)}
`;

        try {
            const response: GenerateContentResponse =
                await this.ai.models.generateContent({
                    model: this.modelName,

                    contents: prompt,

                    config: {
                        responseMimeType: "application/json",
                        temperature: 0.2,
                    },
                });

            const text = response.text;

            if (!text) return [];

            const highlights = JSON.parse(text) as ScoredSegment[];

            return highlights;
        } catch (error) {
            logger.error({ err: error }, "Erro ao processar IA:");

            return [];
        }
    }
}
