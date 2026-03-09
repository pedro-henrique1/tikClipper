import OpenAI from "openai";

import type {
    ScoredSegment,
    ScoringStrategy,
    TranscriptSegment,
} from "../types/index.js";
import { logger } from "./logger.service.js";

export class OpenRouterScoringStrategy implements ScoringStrategy {
    private client: OpenAI;
    private modelName =
        process.env.OPEN_ROUTE_MODEL || "mistralai/mistral-7b-instruct";

    constructor(apiKey: string) {
        this.client = new OpenAI({
            apiKey,
            baseURL: "https://openrouter.ai/api/v1",
            defaultHeaders: {
                "HTTP-Referer": "https://github.com/pedro-henrique1/tikClipper",
                "X-Title": "TikClipper",
            },
        });
    }

    async scoreSegments(
        transcript: TranscriptSegment[],
    ): Promise<ScoredSegment[]> {
        const compactTranscript = transcript
            .map(
                (t) =>
                    `${t.start.toFixed(1)}-${t.end.toFixed(1)}: ${t.text.trim()}`,
            )
            .join("\n");

        const firstTs = transcript[0]?.start.toFixed(1) ?? "0";
        const lastTs = transcript[transcript.length - 1]?.end.toFixed(1) ?? "0";

        const prompt = `Os timestamps abaixo são tempos ABSOLUTOS do vídeo (em segundos). Use-os EXATAMENTE como aparecem.

Selecione 1 a 3 trechos virais entre ${firstTs}s e ${lastTs}s.
Critérios: impacto emocional, abertura forte, conflito/surpresa, independente de contexto.
Cada trecho deve ter entre 45s e 90s de duração.
Se não houver momentos fortes, retorne o melhor disponível.

RETORNE APENAS JSON (sem texto extra):
{
  "segments": [
    { "startTime": number, "endTime": number, "score": number (0-1), "reason": "string" }
  ]
}

Segmentos:
${compactTranscript}
`;

        logger.debug(
            `[OpenRouter] Usando modelo: ${this.modelName} | ${transcript.length} segmento(s)`,
        );

        try {
            const response = await this.client.chat.completions.create({
                model: this.modelName,
                messages: [
                    {
                        role: "system",
                        content:
                            "Você é um editor de vídeo especialista em criar cortes virais. Retorne sempre um objeto JSON com a chave 'segments'.",
                    },
                    { role: "user", content: prompt },
                ],

                temperature: 0.2,
                max_tokens: 600,
            });

            const choice = response.choices[0];
            logger.debug(
                `[OpenRouter] finish_reason: ${choice.finish_reason} | content length: ${choice.message.content?.length ?? "null"}`,
            );
            const content = choice.message.content;
            logger.debug(`[OpenRouter] Resposta bruta da IA: ${content}`);

            if (!content) {
                logger.warn("[OpenRouter] IA retornou conteúdo vazio.");
                return [];
            }

            const jsonMatch =
                content.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                content.match(/(\{[\s\S]*\})/);
            const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

            let parsed;
            try {
                parsed = JSON.parse(jsonStr);
            } catch (err) {
                logger.error(
                    { jsonStr },
                    "[OpenRouter] Falha ao dar parse no JSON",
                );
                throw err;
            }

            const highlights =
                parsed.segments ||
                (Array.isArray(parsed)
                    ? parsed
                    : parsed.highlights || parsed.clips || []);

            logger.debug(
                { highlights },
                `[OpenRouter] ${highlights.length} segmento(s) retornado(s) pela IA`,
            );

            return highlights as ScoredSegment[];
        } catch (error) {
            if (
                typeof error === "object" &&
                error !== null &&
                "status" in error &&
                (error as { status: number }).status === 401
            ) {
                throw error;
            }
            logger.error({ err: error }, "[OpenRouter] Erro ao chamar a API");
            return [];
        }
    }
}
