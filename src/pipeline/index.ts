import path from 'path';
import { TranscriptionService } from '../services/transcription.service.js';
import { DetectionService } from '../services/detection.service.js';
import { ExportService } from '../services/export.service.js';
import { VideoService } from '../services/video.service.js';
import {
  DEFAULT_EXPORT_CONFIG,
  DEFAULT_CLIP_CONFIG,
  OUTPUT_DIR,
} from '../config/index.js';
import type { PipelineConfig } from '../types/index.js';

/**
 * Pipeline principal: vídeo → transcrição → detecção → exportação
 */
export class Pipeline {
  private transcription = new TranscriptionService();
  private detection = new DetectionService();
  private export = new ExportService();
  private video = new VideoService();

  async run(inputPath: string, options?: Partial<PipelineConfig>): Promise<string[]> {
    const config: PipelineConfig = {
      inputPath,
      outputDir: path.join(OUTPUT_DIR, path.basename(inputPath, path.extname(inputPath))),
      minClipDuration: DEFAULT_CLIP_CONFIG.minDuration,
      maxClipDuration: DEFAULT_CLIP_CONFIG.maxDuration,
      targetClips: DEFAULT_CLIP_CONFIG.targetClips,
      exportConfig: DEFAULT_EXPORT_CONFIG,
      ...options,
    };

    // 1. Transcrição
    const transcript = await this.transcription.transcribe(inputPath);

    // 2. Metadados do vídeo (para duração)
    const { duration } = await this.video.getMetadata(inputPath);

    // 3. Detecção de momentos
    const clips = await this.detection.detectClips(transcript, duration, {
      minDuration: config.minClipDuration,
      maxDuration: config.maxClipDuration,
      targetClips: config.targetClips,
    });

    if (clips.length === 0) {
      throw new Error('Nenhum clip detectado. Verifique o vídeo de entrada.');
    }

    // 4. Exportação
    return this.export.exportClips(inputPath, clips, config);
  }
}
