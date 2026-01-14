from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import numpy as np
from stable_baselines3 import PPO
from prometheus_client import Counter, Gauge, generate_latest, CONTENT_TYPE_LATEST
from fastapi.responses import Response
import os

router = APIRouter()

# --- MÉTRIQUES MLOPS ---
PREDICTIONS_COUNTER = Counter('snake_predictions_total', 'Nombre total de mouvements décidés par l IA')
AI_DECISION_TIME = Gauge('snake_decision_latency', 'Temps de réponse de l IA')
# -----------------------

model_path = "saved_agents/5x5/agent_f9f82fc7-9464-4801-99e7-7c0198b5e33a.zip"
model = PPO.load(model_path)

class GameState(BaseModel):
    grid: list

@router.get("/metrics")
async def metrics():
    """Endpoint pour que Prometheus récupère les données"""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

@router.post("/predict")
async def predict(state: GameState):
    PREDICTIONS_COUNTER.inc() # On incrémente le compteur
    try:
        obs = np.array(state.grid, dtype=np.int8)
        action, _ = model.predict(obs, deterministic=True)
        return {"action": int(action)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@router.get("/models")
async def list_models():
    """Liste tous les agents entraînés disponibles"""
    agents = []
    root_dir = "saved_agents"
    for root, dirs, files in os.walk(root_dir):
        for file in files:
            if file.endswith(".zip"):
                agents.append(os.path.join(root, file))
    return {"models": agents}
