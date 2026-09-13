import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { logger } from "./logger.service.js";

export class CaptionService {
    private openRouterClient?: OpenAI;
    private geminiClient?: GoogleGenerativeAI;
    private modelName: string;

    constructor() {
        const openRouterKey = process.env.OPEN_ROUTE;

        this.modelName = process.env.CAPTION_MODEL || "gemini-2.0-flash-lite";

        if (this.modelName.includes("/") || openRouterKey) {
            this.openRouterClient = new OpenAI({
                apiKey: openRouterKey || "",
                baseURL: "https://openrouter.ai/api/v1",
                defaultHeaders: {
                    "HTTP-Referer":
                        "https://github.com/pedro-henrique1/tikClipper",
                    "X-Title": "TikClipper",
                },
            });
        } else if (process.env.GEMINI_API_KEY) {
            this.geminiClient = new GoogleGenerativeAI(
                process.env.GEMINI_API_KEY,
            );
        }
    }

    async generateCaption(transcriptText: string): Promise<string> {
        const prompt = `
Você é um especialista em retenção de audiência e copywriting para vídeos curtos (TikTok, Reels, Shorts).

Dada a transcrição abaixo de um clipe de vídeo, gere um título/legenda viral e curto que:
1. Capture a curiosidade imediatamente (Clickbait ético).
2. Seja curto (máximo 10 palavras).
3. Inclua de 1 a 2 emojis relevantes.
4. Inclua de 2 a 3 hashtags virais no final.

Transcrição do clipe:
"${transcriptText}"

Retorne APENAS o texto da legenda, sem explicações.
`;

        try {
            if (this.openRouterClient) {
                const response =
                    await this.openRouterClient.chat.completions.create({
                        model: this.modelName,
                        messages: [{ role: "user", content: prompt }],
                        temperature: 0.7,
                        max_tokens: 100,
                    });
                return response.choices[0].message.content?.trim() || "";
            } else if (this.geminiClient) {
                const response = await (
                    this.geminiClient as any
                ).models.generateContent({
                    model: this.modelName,
                    contents: prompt,
                });
                return response.text;
            }
            throw new Error("Nenhum cliente de IA configurado para legendas.");
        } catch (error) {
            logger.error(
                { err: error, model: this.modelName },
                "Erro ao gerar legenda com AI:",
            );
            return "Confira esse corte incrível! 🔥 #clips #viral";
        }
    }
}
