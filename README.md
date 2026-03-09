<div align="center">

# 🎬 TikClipper

**Cortes automáticos de vídeos longos para TikTok, Shorts e Reels.**

Transcreve com Whisper, detecta os melhores momentos com IA e exporta clips verticais 9:16 com legendas automáticas.

</div>

---

## ⚙️ Como funciona

```
Vídeo longo  →  Transcrição (Whisper)  →  Scoring IA  →  Clips 9:16 + Legendas
```

---

## 🛠 Pré-requisitos

| Dependência | Versão                  |
| ----------- | ----------------------- |
| Node.js     | 18+                     |
| FFmpeg      | qualquer versão recente |
| whisper.cpp | compilado localmente    |

**Instalar whisper.cpp:**

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make
./models/download-ggml-model.sh base
```

> Por padrão, o TikClipper procura o whisper.cpp em `../whisper.cpp`.
> Mude com a variável `WHISPER_CPP_PATH`.

**Instalar dependências do projeto:**

```bash
npm install
```

---

## 🚀 Uso — CLI

### Subcomandos

| Comando           | O que faz                                                   |
| ----------------- | ----------------------------------------------------------- |
| `cut <video>`     | **Pipeline completo** — transcreve → detecta → exporta      |
| `analyze <video>` | Transcreve + scoring IA → salva `clips.json` (sem exportar) |
| `render <video>`  | Exporta clips de um `clips.json` já existente (pula IA)     |
| `stats <video>`   | Exibe estatísticas de um `clips.json` existente             |

### Flags

| Flag               | Descrição                                              |
| ------------------ | ------------------------------------------------------ |
| `--karaoke`        | Timestamps por palavra (karaoke word-by-word)          |
| `--debug`          | Exibe logs internos detalhados (paths, timings…)       |
| `--quiet`          | Suprime todo output; exibe apenas o resultado final    |
| `--upload`         | Faz upload automático para o TikTok após exportar      |
| `--cookies <path>` | Caminho para o `cookies.json` (requerido com --upload) |
| `--caption <text>` | Legenda customizada para o upload                      |

### Exemplos

```bash
# Pipeline completo
npm run cli -- cut ./meu-podcast.mp4

# Com legendas karaoke (destaque palavra por palavra)
npm run cli -- cut ./meu-podcast.mp4 --karaoke

# Logs internos detalhados (paths, tempos, whisper output)
npm run cli -- cut ./meu-podcast.mp4 --debug

# Modo silencioso — só exibe o resumo final
npm run cli -- cut ./meu-podcast.mp4 --quiet

# Só análise IA (gera clips.json, sem renderizar)
npm run cli -- analyze ./meu-podcast.mp4

# Re-exportar a partir de uma análise já feita (muito mais rápido)
npm run cli -- render ./meu-podcast.mp4

# Ver estatísticas dos clips detectados
npm run cli -- stats ./meu-podcast.mp4

# Upload automático para o TikTok após exportar
npm run cli -- cut ./meu-podcast.mp4 --upload --cookies ./cookies.json

# Upload com legenda customizada
npm run cli -- cut ./meu-podcast.mp4 --upload --cookies ./cookies.json --caption "🔥 Esse momento foi surreal"

# Ajuda
npm run cli -- --help
npm run cli -- cut --help
```

### Saída esperada

```
🎬 Processing: meu-podcast.mp4

🎧 Extracting audio...
  Transcribing ▓▓▓▓▓▓▓░░░ 45% | ETA: 7m10s
🎙 Transcription done — 142 segment(s)

✔ 🧠 Analyzing best moments with AI…
✅ 3 clip(s) detected

✂  Exporting 3 clip(s)...
  Exporting  ▓▓▓▓▓░░░░░ 100% | clip 3/3

╔══════════════════════════════════╗
║        📊 Analysis Summary       ║
╠══════════════════════════════════╣
║ 📹 Duration         18m32s       ║
║ 📝 Segments         142          ║
║ 🎯 Clips            3            ║
║ ⏱  Total clip time  02:45       ║
║ 🪟 Windows analyzed  1           ║
║ 💾 Output           output/…     ║
║ 🕐 Processing time  42s          ║
╚══════════════════════════════════╝

✅ 3 clip(s) exported:
  • clip-001.mp4
  • clip-002.mp4
  • clip-003.mp4

⏱  Total time: 42.3s
```

---

## 🐳 Docker

A forma mais simples de rodar com todas as dependências já configuradas:

```bash
# 1. Crie as pastas necessárias
mkdir -p inputs output models

# 2. Baixe o modelo Whisper
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -P ./models

# 3. Suba o container
docker-compose up -d --build

# 4. Execute
docker-compose run --rm tikclipper npm run cli -- cut ./inputs/seu-video.mp4 --karaoke
```

---

## 🔑 Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
OPEN_ROUTE=sua_chave_openrouter      # IA para scoring dos melhores momentos
WHISPER_CPP_PATH=../whisper.cpp      # Caminho para o whisper.cpp
WHISPER_MODEL=models/ggml-base.bin  # Modelo GGML a usar
OUTPUT_DIR=./output                  # Diretório de saída dos clips
```

---

## 📁 Estrutura do Projeto

```
src/
├── cli/
│   ├── index.ts                # Entry point (Commander + banner)
│   ├── commands/
│   │   ├── analyze.command.ts  # Transcrição + scoring
│   │   ├── cut.command.ts      # Pipeline completo
│   │   ├── render.command.ts   # Exportar de clips.json
│   │   └── stats.command.ts    # Estatísticas
│   └── utils/
│       ├── ui.ts               # Banner, spinners, tabelas, métricas
│       └── table.ts            # Renderizador ASCII box
├── config/                     # Configurações padrão
├── pipeline/                   # Orquestrador do fluxo
├── services/                   # Vídeo, transcrição, detecção, export, upload
└── types/                      # Tipos TypeScript
```

---

## 📋 Roadmap

- [x] Transcrição local com **whisper.cpp**
- [x] Scoring com **IA** para detectar melhores momentos
- [x] **Legendas karaoke** (word-by-word)
- [x] CLI com subcomandos, spinners e barras de progresso por clip
- [x] Upload automático para **TikTok** via Puppeteer
- [x] Flags `--debug` e `--quiet` para controle de verbosidade
- [x] Métricas de análise no resumo final
- [ ] Fila de processamento com **BullMQ**
- [ ] Suporte a múltiplas fontes (URL, YouTube, etc.)

---

## 📄 Licença

MIT
