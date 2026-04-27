"""UFC LLM Pipeline - local FastAPI service. /healthz only at this stage."""
from fastapi import FastAPI

app = FastAPI(title="UFC LLM Pipeline", version="0.1.0")


@app.get("/healthz")
def healthz():
    return {"status": "ok", "service": "ufc-llm-pipeline"}
