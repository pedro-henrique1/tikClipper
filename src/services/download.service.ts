import fs from "fs";
import path from "path";
import youtubeDl from "youtube-dl-exec";

export class DownloadService {


    async downloadVideo(url: string, outputDir: string): Promise<void> {
        const now = new Date();

        const formattedDate = now.toISOString()
            .replace(/:/g, '-')
            .split('.')[0];

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const outputTemplate = path.join(outputDir, `${formattedDate}.%(ext)s`);

        const dl = (youtubeDl as any).default || youtubeDl;

        await dl(url, {
            output: outputTemplate,
            noCheckCertificates: true,
            noWarnings: true,
            format: "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        });
    }
}
