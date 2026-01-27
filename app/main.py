from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator 

from app.routers import api
import os

app = FastAPI(title="Snake AI Web App")

# Monitoring Prometheus
Instrumentator().instrument(app).expose(app)

# Configuration CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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

# --- ROUTES DES PAGES HTML ---

@app.get("/")
async def read_root(request: Request):
    """Page d'accueil (Portail)"""
    return templates.TemplateResponse("home.html", {"request": request})

@app.get("/game")
async def read_game(request: Request):
    """Page du Jeu (Player Zone)"""
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/admin")
async def read_admin(request: Request):
    """Page d'Administration (Dashboard)"""
    return templates.TemplateResponse("admin.html", {"request": request})

if __name__ == "__main__":
    import uvicorn
    # Note : En prod (Docker), c'est le CMD du Dockerfile qui lance uvicorn, pas ce bloc.
    uvicorn.run(app, host="0.0.0.0", port=5000)