# 노트북 vLLM 임베딩 실험 가이드

RTX 4060 (8GB VRAM) 노트북에서 naia-memory 임베딩 벤치마크를 실행하는 가이드.

## 사전 준비

### 1. 저장소 동기화

```bash
cd ~/alpha-adk
git pull
cd projects/naia-memory
git pull
```

### 2. vLLM 설치 (미설치 시)

```bash
pip install vllm
# 또는 vllm-omni 사용 시:
# cd ~/alpha-adk/projects/vllm-omni-fork-stable && pip install -e .
```

### 3. 의존성 설치

```bash
cd ~/alpha-adk/projects/naia-memory
pnpm install
```

## GPU VRAM 예산 (RTX 4060 8GB)

| 모델 | VRAM | 벤치 Score | 권장 |
|------|------|:----------:|:----:|
| Qwen3-Embedding-0.6B (BF16) | ~1.2GB | 31% | 안정 |
| Qwen3-Embedding-0.6B (FP32) | ~2.4GB | 31% | 안정 |
| Qwen3-Embedding-8B (int4) | ~7GB | 39% | 실험적 (OOM 가능) |

## 실험 A: 0.6B (안정, 권장)

### 터미널 1: 임베딩 서버 시작

```bash
vllm serve Qwen/Qwen3-Embedding-0.6B \
  --task embed \
  --port 8001 \
  --trust-remote-code
```

서버가 준비되면 `Uvicorn running on http://0.0.0.0:8001` 메시지가 나옴.

### 터미널 2: 벤치마크 실행

```bash
cd ~/alpha-adk/projects/naia-memory

# keyword judge (API 불필요, 빠름)
VLLM_EMBED_BASE=http://localhost:8001 \
GEMINI_API_KEY=xxx \
pnpm exec tsx src/benchmark/comparison/run-comparison.ts \
  --adapters=naia-local \
  --embedder=qwen3-emb \
  --judge=keyword \
  --lang=ko

# V2 템플릿 사용 시
VLLM_EMBED_BASE=http://localhost:8001 \
GEMINI_API_KEY=xxx \
pnpm exec tsx src/benchmark/comparison/run-comparison.ts \
  --adapters=naia-local \
  --embedder=qwen3-emb \
  --judge=keyword \
  --lang=ko \
  --v2
```

## 실험 B: 8B int4 (고성능, 실험적)

```bash
vllm serve Qwen/Qwen3-Embedding-8B \
  --task embed \
  --port 8001 \
  --trust-remote-code \
  --quantization awq
```

> **주의**: 8GB VRAM에서 7GB 사용. OOM 발생 시 0.6B로 폴백.
> OOM 시 `--gpu-memory-utilization 0.85` 추가 시도.

벤치마크 명령은 같으나 `--embedder=qwen3-emb-8b` 사용:

```bash
VLLM_EMBED_BASE=http://localhost:8001 \
GEMINI_API_KEY=xxx \
pnpm exec tsx src/benchmark/comparison/run-comparison.ts \
  --adapters=naia-local \
  --embedder=qwen3-emb-8b \
  --judge=keyword \
  --lang=ko \
  --v2
```

## 비교용: Gemini API (기준선, GPU 불필요)

```bash
GEMINI_API_KEY=xxx \
pnpm exec tsx src/benchmark/comparison/run-comparison.ts \
  --adapters=naia-local \
  --embedder=gemini \
  --judge=keyword \
  --lang=ko \
  --v2
```

## 결과 해석

| Score | 등급 | 의미 |
|:-----:|:----:|------|
| 49% | 기준 | gemini-embedding-001 (API, V2 KO kw) |
| 39% | 목표 | qwen3-embedding:8b (Ollama rrf) |
| 31% | 최소 | qwen3-embedding:0.6b (Ollama rrf) |

**주의**: Ollama 시절과 vLLM은 같은 모델이지만 서빙 프레임워크가 다름.
결과가 ±2pp 차이날 수 있음. 큰 차이(>5pp)면 이슈로 조사.

## 결과 파일 위치

```
reports/runs/run-{timestamp}/report-naia-local.json
reports/summary-run-{timestamp}.json
```

## 서버 환경변수 (naia-memory API 서버)

```bash
VLLM_EMBED_BASE=http://localhost:8001 \
VLLM_EMBED_MODEL=Qwen/Qwen3-Embedding-0.6B \
VLLM_EMBED_DIM=1024 \
GEMINI_API_KEY=xxx \
pnpm exec tsx src/server/naia-memory-api.ts
```

## 문제 해결

| 증상 | 해결 |
|------|------|
| `Connection refused localhost:8001` | vLLM 서버가 아직 준비 안 됨. 로그에서 "Uvicorn running" 대기 |
| `CUDA out of memory` | 8B 대신 0.6B 사용, 또는 `--gpu-memory-utilization 0.8` |
| 모델 다운로드 느림 | 최초 실행 시 HuggingFace에서 다운로드. 캐시됨 |
| `model not found` | `huggingface-cli download Qwen/Qwen3-Embedding-0.6B` 사전 다운로드 |
