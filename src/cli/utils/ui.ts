import boxen from "boxen";
import chalk from "chalk";
import gradient from "gradient-string";
import ora, { type Ora } from "ora";
import type { Clip } from "../../types/index.js";
import { buildBox } from "./table.js";

export function printBanner(): void {
    const asciiArt = [
        "████████╗██╗██╗  ██╗ ██████╗██╗     ██╗██████╗ ██████╗ ███████╗██████╗",
        "╚══██╔══╝██║██║ ██╔╝██╔════╝██║     ██║██╔══██╗██╔══██╗██╔════╝██╔══██╗",
        "   ██║   ██║█████╔╝ ██║     ██║     ██║██████╔╝██████╔╝█████╗  ██████╔╝",
        "   ██║   ██║██╔═██╗ ██║     ██║     ██║██╔═══╝ ██╔═══╝ ██╔══╝  ██╔══██╗",
        "   ██║   ██║██║  ██╗╚██████╗███████╗██║██║     ██║     ███████╗██║  ██║",
        "   ╚═╝   ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝╚═╝     ╚═╝     ╚══════╝╚═╝  ╚═╝",
    ].join("\n");

    const tikTokGradient = gradient(["#FF0050", "#ffffff", "#00f2ea"]);

    console.log("");
    console.log(tikTokGradient.multiline(asciiArt));
    console.log(
        chalk.gray(
            " ──────────────────────────────────────────────────────────────────────────",
        ),
    );

    const conteudo = [
        `${chalk.bold.cyan("TikClipper")} ${chalk.dim("•")} ${chalk.white("Cortes automáticos para TikTok, Shorts e Reels")}`,
        "",
        `${chalk.gray("Repositório:")} ${chalk.underline.blueBright("https://github.com/pedro-henrique1/tikClipper")}`,
    ].join("\n");

    const boxOptions = {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: "round" as const,
        borderColor: "#00f2ea",
        title: "🚀 Informações",
        titleAlignment: "center" as const,
    };

    console.log(boxen(conteudo, boxOptions));

    console.log("");
}

export interface Spinner {
    succeed(text?: string): void;
    fail(text?: string): void;
    update(text: string): void;
    raw: Ora;
}

export function startSpinner(text: string): Spinner {
    const spinner = ora({ text, color: "cyan" }).start();
    return {
        succeed: (t) => {
            spinner.succeed(t ?? spinner.text);
        },
        fail: (t) => {
            spinner.fail(t ?? spinner.text);
        },
        update: (t) => {
            spinner.text = t;
        },
        raw: spinner,
    };
}

export interface PipelineStats {
    videoDuration: number;
    transcriptSegments: number;
    clipsDetected: number;
    totalClipTime: number;
    outputDir: string;
    elapsedMs: number;
    windowsAnalyzed?: number;
    tokensUsed?: number;
    tokensSaved?: number;
    earlyStop?: boolean;
}

function fmtTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0)
        return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
    if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
    return `${s}s`;
}

function fmtDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function printStatsTable(stats: PipelineStats): void {
    const avgClipTime =
        stats.clipsDetected > 0 ? stats.totalClipTime / stats.clipsDetected : 0;

    const rows: { label: string; value: string }[] = [
        {
            label: "📹 Duration",
            value: fmtDuration(stats.videoDuration),
        },
        {
            label: "📝 Segments transcribed",
            value: stats.transcriptSegments.toString(),
        },
        {
            label: "🎯 Clips detected",
            value: stats.clipsDetected.toString(),
        },
        {
            label: "⏱  Total clip time",
            value: `${fmtDuration(stats.totalClipTime)}  (avg ${fmtDuration(avgClipTime)} each)`,
        },
    ];

    if (stats.windowsAnalyzed !== undefined) {
        rows.push({
            label: "🪟 Windows analyzed",
            value: stats.windowsAnalyzed.toString(),
        });
    }

    if (stats.tokensUsed !== undefined) {
        rows.push({
            label: "🧠 Tokens used",
            value: stats.tokensUsed.toLocaleString(),
        });
    }

    if (stats.tokensSaved !== undefined) {
        rows.push({
            label: "💡 Tokens saved",
            value: stats.tokensSaved.toLocaleString(),
        });
    }

    if (stats.earlyStop !== undefined) {
        rows.push({
            label: "⚡ Early stop",
            value: stats.earlyStop ? "✅ Yes" : "No",
        });
    }

    rows.push(
        { label: "💾 Output", value: stats.outputDir },
        {
            label: "🕐 Processing time",
            value: fmtTime(stats.elapsedMs / 1000),
        },
    );

    const box = buildBox("📊 Analysis Summary", rows);
    console.log("\n" + box.map((l) => chalk.cyan(l)).join("\n") + "\n");
}

export function printClipsTable(clips: Clip[]): void {
    if (clips.length === 0) return;

    const COL = {
        idx: 4,
        start: 8,
        end: 8,
        dur: 7,
        score: 6,
        caption: 40,
    };

    const header =
        chalk.bold.cyan(" #   ") +
        chalk.bold.cyan("Start    ") +
        chalk.bold.cyan("End      ") +
        chalk.bold.cyan("Dur    ") +
        chalk.bold.cyan("Score  ") +
        chalk.bold.cyan("Caption");

    const divider = chalk.gray(
        "─".repeat(
            COL.idx +
                COL.start +
                COL.end +
                COL.dur +
                COL.score +
                COL.caption +
                6,
        ),
    );

    console.log(divider);
    console.log(header);
    console.log(divider);

    clips.forEach((clip, i) => {
        const dur = clip.endTime - clip.startTime;
        const caption = clip.caption
            ? clip.caption.length > COL.caption - 3
                ? clip.caption.slice(0, COL.caption - 3) + "…"
                : clip.caption
            : chalk.gray("—");

        const scoreColor =
            clip.score >= 8
                ? chalk.greenBright
                : clip.score >= 5
                  ? chalk.yellow
                  : chalk.gray;

        console.log(
            chalk.white(` ${(i + 1).toString().padEnd(3)} `) +
                chalk.gray(fmtDuration(clip.startTime).padEnd(9)) +
                chalk.gray(fmtDuration(clip.endTime).padEnd(9)) +
                chalk.white(fmtDuration(dur).padEnd(7)) +
                scoreColor(clip.score.toFixed(1).padEnd(7)) +
                chalk.white(caption),
        );
    });

    console.log(divider);
}
