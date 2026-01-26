from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator 

from app.routers import api
import os

app = FastAPI(title="Snake AI Web App")

Instrumentator().instrument(app).expose(app)  

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # "*" signifie "tout le monde". Pour la prod, tu mettras l'URL de ton GitHub
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montage des fichiers statiques (JS/CSS)
app.mount("/static", StaticFiles(directory="web/static"), name="static")

# Configuration des templates HTML
templates = Jinja2Templates(directory="web/templates")

# Inclusion du router API
app.include_router(api.router, prefix="/api")

@app.get("/")
async def read_root(request: Request):
    """Affiche la page d'accueil du jeu"""
    return templates.TemplateResponse("index.html", {"request": request})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)