/**
 * TikClipper - Cortes automáticos para TikTok, Shorts e Reels
 *
 * Pipeline: Vídeo longo → Transcrição → Detecção de momentos → Export 9:16
 */

export { Pipeline } from './pipeline/index.js';
export { VideoService } from './services/video.service.js';
export { TranscriptionService } from './services/transcription.service.js';
export { DetectionService } from './services/detection.service.js';
export { ExportService } from './services/export.service.js';
export * from './types/index.js';
export * from './config/index.js';
