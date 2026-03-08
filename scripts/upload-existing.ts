import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { UploadService } from "../src/services/upload.service.js";

async function main() {
    const args = process.argv.slice(2);
    const directory = args[0];
    const cookiesPath =
        args.find((_, i) => args[i - 1] === "--cookies") || "./cookies.json";
    const caption = args.find((_, i) => args[i - 1] === "--caption");

    if (!directory) {
        console.error(
            "Uso: npx tsx scripts/upload-existing.ts <diretorio-dos-videos> --cookies <path> [--caption <caption>]",
        );
        process.exit(1);
    }

    const absDirectory = path.resolve(process.cwd(), directory);
    const uploadService = new UploadService();

    try {
        const stats = await fs.stat(absDirectory);
        let videoFiles: string[] = [];
        let baseDir = "";

        if (stats.isDirectory()) {
            const files = await fs.readdir(absDirectory);
            videoFiles = files.filter((f) => f.endsWith(".mp4")).sort();
            baseDir = absDirectory;
        } else if (stats.isFile() && absDirectory.endsWith(".mp4")) {
            videoFiles = [path.basename(absDirectory)];
            baseDir = path.dirname(absDirectory);
        }

        if (videoFiles.length === 0) {
            console.error("Nenhum arquivo .mp4 encontrado.");
            process.exit(1);
        }

        console.log(
            `Encontrados ${videoFiles.length} vídeo(s). Iniciando uploads...`,
        );

        for (const file of videoFiles) {
            const videoPath = path.join(baseDir, file);
            console.log(`\n--- Enviando: ${file} ---`);
            await uploadService.uploadToTikTok(videoPath, cookiesPath, caption);
        }

        console.log("\nTodos os uploads concluídos!");
    } catch (err) {
        console.error("Erro fatal durante o upload:", err);
        process.exit(1);
    }
}

main();
