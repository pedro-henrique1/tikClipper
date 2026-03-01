# Stage 1: Build whisper.cpp
FROM debian:bookworm-slim AS whisper-builder
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /whisper.cpp
RUN git clone https://github.com/ggerganov/whisper.cpp.git .
RUN mkdir build && cd build && cmake .. && make -j$(nproc) whisper-cli

# Stage 2: Node application
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy whisper binary
COPY --from=whisper-builder /whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
# Create models directory
RUN mkdir -p /app/whisper.cpp/models

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build
COPY . .
RUN npm run build

# Default environment variables
ENV WHISPER_BINARY=/usr/local/bin/whisper-cli
ENV WHISPER_CPP_PATH=/app/whisper.cpp
ENV WHISPER_MODEL=models/ggml-base.bin

# Ensure we have a volume for input/output
VOLUME ["/app/output"]

CMD ["npm", "run", "start"]
