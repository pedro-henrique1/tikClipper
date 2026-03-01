# TikClipper

Cortes automáticos de vídeos longos (podcast, live, gameplay) para TikTok, Shorts e Reels.

## Fluxo

```
[Vídeo longo] → [Transcrição] → [Detecção de momentos] → [Export 9:16]
```

## Pré-requisitos

- **Node.js** 18+
- **FFmpeg** (instalado no sistema ou via `ffmpeg-static`)
- **whisper.cpp** para transcrição (local, gratuito):
    ```bash
    git clone https://github.com/ggerganov/whisper.cpp
    cd whisper.cpp && make
    ./models/download-ggml-model.sh base
    ```
    Defina `WHISPER_CPP_PATH` se estiver em outro diretório (padrão: `../whisper.cpp`).

```bash
npm install
```

## Docker (Recomendado)

A forma mais fácil de rodar o projeto com todas as dependências (FFmpeg e Whisper) é usando Docker:

1. **Prepare os arquivos**:
   Crie as pastas `inputs`, `output` e `models` na raiz do projeto.
2. **Baixe o modelo do Whisper**:
    ```bash
    wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -P ./models
    ```
3. **Configure o `.env`**:
   Garanta que seu `.env` tenha as chaves de API necessárias.
4. **Suba o container**:
    ```bash
    docker-compose up -d --build
    ```
5. **Execute a CLI via Docker**:
    ```bash
    docker-compose run --rm tikclipper npm run cli -- ./inputs/seu-video.mp4 --karaoke
    ```

## Uso

### CLI

```bash
npm run cli -- ./caminho/para/video.mp4
```

### IA (melhores cortes)

Para ativar o scoring com IA (Gemini), defina a variável de ambiente:

```bash
export GEMINI_API_KEY="sua_chave_aqui"
```

Com isso, o pipeline vai priorizar os trechos sugeridos pela IA e usar fallback automático caso não haja retorno.

### Programático

```typescript
import { Pipeline } from "tikclipper";

const pipeline = new Pipeline();
const outputPaths = await pipeline.run("./meu-podcast.mp4");
console.log("Clips exportados:", outputPaths);
```

## Estrutura do Projeto

```
src/
├── config/          # Configurações
├── pipeline/        # Orquestrador do fluxo
├── services/        # Vídeo, transcrição, detecção, export
├── types/           # Tipos TypeScript
├── cli.ts           # Interface de linha de comando
└── index.ts         # Entry point
```

## Próximos passos

- [x] Integrar **whisper.cpp** para transcrição
- [x] Scoring com **IA** (GPT/embedding) para detectar melhores momentos
- [x] **Legendas karaoke** (word-by-word) – legenda que acompanha palavra por palavra o que a pessoa fala
- [ ] Fila com **BullMQ** para processamento em background
- [ ] API REST ou interface web
- [ ] Suporte a múltiplas fontes (URL, YouTube, etc.)

## Licença

MIT
