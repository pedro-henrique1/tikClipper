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
        const transcriptText = transcript
            .map(
                (t) =>
                    `[${t.start.toFixed(2)} - ${t.end.toFixed(2)}] ${t.text}`,
            )
            .join("\n");
        const prompt = `
Você é especialista em retenção extrema para vídeos curtos.

OBJETIVO:
Selecionar os 3 melhores trechos que:
- Funcionem isoladamente
- Comecem com frase impactante
- Tenham conflito, surpresa ou opinião forte
- Não dependam de contexto anterior
- Não comecem com "então", "tipo", "como eu estava dizendo"

PROCESSO:
1. Analise o fluxo emocional.
2. Identifique pontos de pico emocional.
3. Agrupe segmentos consecutivos até atingir entre 45 e 90 segundos.
4. Ajuste o início para começar na frase mais forte possível.
5. Nunca corte no meio de raciocínio.

RETORNE APENAS:

{
  "segments": [
    {
      "startTime": number,
      "endTime": number,
      "score": number,
      "reason": "Por que isso viraliza?"
    }
  ]
}

Transcrição:
${transcriptText}`;

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
                temperature: 0.1,
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
