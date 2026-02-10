import ffmpegStatic from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import { mkdir } from 'fs/promises';
import path from 'path';
import type { Clip, ExportConfig } from '../types/index.js';

ffmpeg.setFfmpegPath(ffmpegStatic ?? '');

export class VideoService {
  async extractClip(
    inputPath: string,
    outputPath: string,
    clip: Clip,
    config: ExportConfig,
    subtitlesPath?: string
  ): Promise<string> {
    await mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
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
        .autopad();

      if (subtitlesPath) {
        const escaped = subtitlesPath.replace(/'/g, "\\'");
        const style =
          "force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,MarginV=20'";
        command = command.videoFilter(`subtitles='${escaped}':${style}`);
      }

      command
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }

  async extractAudioToWav(inputPath: string, outputPath: string): Promise<string> {
    await mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', reject)
        .run();
    });
  }


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
