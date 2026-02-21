import OpenAI from "openai";

import type {
    ScoredSegment,
    ScoringStrategy,
    TranscriptSegment,
} from "../types/index.js";

export class OpenRouterScoringStrategy implements ScoringStrategy {
    private client: OpenAI;
    private modelName = "deepseek/deepseek-chat";

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
- Retorne APENAS JSON válido com a estrutura: { "segments": [ { "startTime": number, "endTime": number, "score": number, "reason": "string" } ] }

Transcrição:
${JSON.stringify(simplifiedTranscript)}
`;

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
                response_format: { type: "json_object" },
                temperature: 0.2,
                max_tokens: 600,
            });

            const content = response.choices[0].message.content;

            if (!content) return [];

            const parsed = JSON.parse(content);
            const highlights =
                parsed.segments ||
                (Array.isArray(parsed)
                    ? parsed
                    : parsed.highlights || parsed.clips || []);

            return highlights as ScoredSegment[];
        } catch (error) {
            console.error("Erro ao processar OpenRouter IA:", error);
            return [];
        }
    }
}
