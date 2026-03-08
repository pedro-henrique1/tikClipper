import pino from "pino";

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
