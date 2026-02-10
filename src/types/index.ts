/**
 * Trecho de vídeo identificado como "melhor momento"
 */
export interface Clip {
  id: string;
  startTime: number; // segundos
  endTime: number;
  score: number;
  reason?: string;
  transcript?: string;
}

/**
 * Resultado da transcrição do vídeo
 */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Configuração para exportação
 */
export interface ExportConfig {
  width: number;
  height: number;
  fps?: number;
  format: 'mp4';
  aspectRatio: '9:16';
}

/**
 * Configuração do pipeline
 */
export interface PipelineConfig {
  inputPath: string;
  outputDir: string;
  minClipDuration: number; // segundos
  maxClipDuration: number;
  targetClips: number;
  exportConfig: ExportConfig;
}

/**
 * Estado do job de processamento
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProcessingJob {
  id: string;
  status: JobStatus;
  inputPath: string;
  clips: Clip[];
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}
