import type { TranscriptSegment } from '../types/index.js';

/**
 * Serviço de transcrição de áudio/vídeo.
 * Implementação futura: Whisper API, whisper.cpp, ou outro provedor.
 */
export class TranscriptionService {
  /**
   * Transcreve o áudio do vídeo e retorna segmentos com timestamps
   */
  async transcribe(inputPath: string): Promise<TranscriptSegment[]> {
    // TODO: Integrar Whisper API ou whisper.cpp
    // Por enquanto retorna array vazio para o pipeline funcionar
    console.log(`[Transcription] Transcrevendo: ${inputPath}`);
    return [];
  }
}
