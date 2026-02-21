export interface Clip {
    id: string;
    startTime: number;
    endTime: number;
    score: number;
    reason?: string;
    transcript?: string;
}

export interface TranscriptSegment {
    start: number;
    end: number;
    text: string;
}

export interface ScoredSegment {
    startTime: number;
    endTime: number;
    score: number;
    reason: string;
}

export interface ExportConfig {
    width: number;
    height: number;
    fps?: number;
    format: "mp4";
    aspectRatio: "9:16";
}

export interface PipelineConfig {
    inputPath: string;
    outputDir: string;
    minClipDuration: number;
    maxClipDuration: number;
    targetClips: number;
    exportConfig: ExportConfig;
}

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface ProcessingJob {
    id: string;
    status: JobStatus;
    inputPath: string;
    clips: Clip[];
    error?: string;
    createdAt: Date;
    completedAt?: Date;
}

export interface ScoringStrategy {
    scoreSegments(transcript: TranscriptSegment[]): Promise<ScoredSegment[]>;
}
