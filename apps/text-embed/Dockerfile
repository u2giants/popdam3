# PopDAM SigLIP2 text-embed service (query-time only)
# CPU is sufficient: one short query → 768 floats.
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# CPU-only torch keeps the image small; the VPS has no GPU.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Bake the model into the image so a restart never depends on Hugging Face.
ENV HF_HOME=/opt/hf
RUN python -c "from transformers import AutoModel, AutoProcessor; m='google/siglip2-base-patch16-naflex'; AutoProcessor.from_pretrained(m); AutoModel.from_pretrained(m)"
RUN python -c "from transformers import AutoModel, AutoTokenizer; m='Qwen/Qwen3-Embedding-0.6B'; r='97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3'; AutoTokenizer.from_pretrained(m, revision=r); AutoModel.from_pretrained(m, revision=r)"
ENV HF_HUB_OFFLINE=1

COPY main.py test_main.py ./

ENV PORT=8090
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD curl -fsS http://127.0.0.1:8090/health || exit 1

# Two bounded workers so two concurrent embed requests (search queries from
# different users) run forward passes in parallel instead of queueing on one
# process (#804). Four torch threads each: the Qwen3 text-meaning model (#1037)
# runs beside SigLIP2 per request; 4 threads cut its p95 from ~690 to ~500 ms
# on the 8-core host (2 threads each kept total CPU at four cores before).
ENV OMP_NUM_THREADS=4 MKL_NUM_THREADS=4
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "2"]
