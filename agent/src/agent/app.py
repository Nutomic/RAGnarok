from fastapi import FastAPI

app = FastAPI(title="RAGnarok agent")

@app.get("/health")
def health():
    return {"status":"ok"}