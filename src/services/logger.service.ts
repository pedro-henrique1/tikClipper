import pino from "pino";

// Level is controlled via the LOG_LEVEL env var.
// cut.command.ts sets process.env.LOG_LEVEL = "debug" before importing services
// so this module always picks up the correct level at initialisation time.
export const logger = pino({
    level: process.env.LOG_LEVEL ?? "silent",
    transport: {
        target: "pino-pretty",
        options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
        },
    },
});
