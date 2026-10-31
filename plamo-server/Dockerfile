FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server code
COPY server.py .

# trust_remote_code runs code from the model repo, so pin the exact commit
ENV PLAMO_REVISION=51507f82e5884f7a9f2306038cfd4104b56748de

# Download model at build time (faster startup)
RUN python -c "from transformers import AutoModel, AutoTokenizer; \
    AutoTokenizer.from_pretrained('pfnet/plamo-embedding-1b', revision='$PLAMO_REVISION', trust_remote_code=True); \
    AutoModel.from_pretrained('pfnet/plamo-embedding-1b', revision='$PLAMO_REVISION', trust_remote_code=True)"

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
