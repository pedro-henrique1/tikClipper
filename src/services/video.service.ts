import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import path from 'path';
import { mkdir } from 'fs/promises';
import type { Clip, ExportConfig } from '../types/index.js';

ffmpeg.setFfmpegPath(ffmpegStatic ?? '');

export class VideoService {
  /**
   * Extrai um trecho do vídeo e converte para 9:16
   */
  async extractClip(
    inputPath: string,
    outputPath: string,
    clip: Clip,
    config: ExportConfig
  ): Promise<string> {
    await mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(clip.startTime)
        .setDuration(clip.endTime - clip.startTime)
        .outputOptions([
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 128k',
        ])
        .size(`${config.width}x${config.height}`)
        .autopad()
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  /**
   * Retorna metadados do vídeo (duração, resolução, etc.)
   */
  async getMetadata(inputPath: string): Promise<{
    duration: number;
    width: number;
    height: number;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) return reject(err);
        const video = metadata.streams.find((s) => s.codec_type === 'video');
        resolve({
          duration: metadata.format.duration ?? 0,
          width: video?.width ?? 0,
          height: video?.height ?? 0,
        });
      });
    });
  }
}
