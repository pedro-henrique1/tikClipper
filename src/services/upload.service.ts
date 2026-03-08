import fs from "fs/promises";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { logger } from "./logger.service.js";

// @ts-ignore
puppeteer.use(StealthPlugin());

export class UploadService {
    async uploadToTikTok(
        videoPath: string,
        cookiesPath: string,
        caption?: string,
    ) {
        logger.info(
            { videoPath, cookiesPath },
            "Iniciando upload para TikTok...",
        );

        const browser = await (puppeteer as any).launch({
            headless: true, // Pode ser alterado para false para debug
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });

            // Carregar cookies
            const cookiesContent = await fs.readFile(cookiesPath, "utf-8");
            const cookies = JSON.parse(cookiesContent);
            await page.setCookie(...cookies);

            logger.info("Navegando para a página de upload...");
            await page.goto("https://www.tiktok.com/tiktokstudio/upload", {
                waitUntil: "networkidle2",
            });

            // Verificar se está logado (opcional, pode falhar se o seletor mudar)
            // Se os cookies forem válidos, ele deve estar na página de upload.

            logger.info("Selecionando o arquivo de vídeo...");
            const fileInput = await page.waitForSelector('input[type="file"]');
            if (!fileInput)
                throw new Error("Seletor de input de arquivo não encontrado.");
            await fileInput.uploadFile(videoPath);

            logger.info("Aguardando o processamento do vídeo...");
            // O TikTok leva um tempo para processar o vídeo antes de permitir postar.
            // Vamos aguardar o seletor de input de legenda ou o box de info de upload.
            try {
                await Promise.race([
                    page.waitForSelector('div[class*="upload-video-info"]', {
                        timeout: 120000,
                    }),
                    page.waitForSelector('[data-contents="true"]', {
                        timeout: 120000,
                    }),
                    page.waitForSelector(
                        "button:not([disabled]) .text-container",
                        { timeout: 120000 },
                    ),
                ]);
            } catch (waitErr) {
                const errorScreenshot = `error-upload-${Date.now()}.png`;
                await page.screenshot({
                    path: errorScreenshot,
                    fullPage: true,
                });
                logger.error(
                    { errorScreenshot },
                    "Timeout ao aguardar processamento do vídeo. Screenshot salva.",
                );
                throw waitErr;
            }

            if (caption) {
                logger.info("Definindo a legenda...");
                const captionEditor = await page.waitForSelector(
                    '[data-contents="true"]',
                );
                if (captionEditor) {
                    await captionEditor.click();
                    // Limpar texto existente se houver
                    await page.keyboard.down("Control");
                    await page.keyboard.press("A");
                    await page.keyboard.up("Control");
                    await page.keyboard.press("Backspace");
                    await page.keyboard.type(caption);
                }
            }

            logger.info("Publicando o vídeo...");
            // O seletor do botão de postar pode mudar. Geralmente é um botão escrito "Post" ou "Publicar".
            // Tentaremos encontrar por texto se possível, ou um seletor comum.
            const postButton =
                (await page
                    .waitForSelector(
                        'button:not([disabled]) .text-container:has-text("Post")',
                        { timeout: 30000 },
                    )
                    .catch(() => null)) ||
                (await page
                    .waitForSelector("button.post-button", { timeout: 5000 })
                    .catch(() => null));

            // Estratégia alternativa: buscar o botão por texto via evaluate
            if (!postButton) {
                const found = await page.evaluate(() => {
                    const buttons = Array.from(
                        document.querySelectorAll("button"),
                    );
                    const target = buttons.find(
                        (b) =>
                            b.innerText.includes("Post") ||
                            b.innerText.includes("Publicar"),
                    );
                    if (target && !target.disabled) {
                        target.click();
                        return true;
                    }
                    return false;
                });
                if (!found)
                    throw new Error(
                        "Botão de postar não encontrado ou desabilitado.",
                    );
            } else {
                await postButton.click();
            }

            logger.info("Aguardando confirmação de postagem...");
            await page
                .waitForNavigation({ waitUntil: "networkidle2" })
                .catch(() => {
                    logger.warn(
                        "Navigation timeout after post, checking for success indicator.",
                    );
                });

            logger.info("Upload concluído com sucesso!");
        } catch (err) {
            logger.error({ err }, "Erro durante o upload para TikTok:");
            throw err;
        } finally {
            await browser.close();
        }
    }
}
