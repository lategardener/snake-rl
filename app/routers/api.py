import asyncio
import uuid

import torch
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional, Any
import os
import json
import numpy as np
from huggingface_hub import HfApi, hf_hub_download
from stable_baselines3 import PPO
from dotenv import load_dotenv
from prometheus_client import Counter
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.src.agent.training.train import train_snake, training_manager

load_dotenv()

# --- MÉTRIQUES ---
MODELE_LOADED_COUNTER = Counter(
    'snake_model_loaded_total',
    'Nombre total de modèle chargé',
    ['grid_size']
)

GAMES_STARTED_COUNTER = Counter(
    'snake_games_started_total',
    'Nombre total de parties lancées',
    ['grid_size']
)


# --- MODÈLES DE DONNÉES ---

class GameState(BaseModel):
    grid: List[List[int]]


class ModelInfo(BaseModel):
    uuid: str
    grid_size: int
    algorithm: str
    date: str
    reward: Optional[float]
    game_mode: str | None = None


class LoadModelRequest(BaseModel):
    uuid: str
    grid_size: int


class StartGameRequest(BaseModel):
    grid_size: int


class TrainRequest(BaseModel):
    base_uuid: str | None = None
    grid_size: int = 10
    timesteps: int = 50_000
    n_envs: int = 4
    game_mode: str = "classic"


class TrainingResponse(BaseModel):
    run_id: str
    status: str


# --- GESTIONNAIRE D'ÉTAT ---
class ModelManager:
    def __init__(self):
        self.current_agent = None
        self.current_uuid = None
        self.grid_size = None

    def load_model(self, uuid: str, grid_size: int):
        token = os.getenv("HF_HUB_TOKEN")
        repo_id = "snakeRL/snake-rl-models"

        try:
            print(f"Chargement du modèle {uuid}...")
            model_path = hf_hub_download(
                repo_id=repo_id,
                filename=f"{grid_size}x{grid_size}/{uuid}/model.zip",
                token=token
            )

            self.current_agent = PPO.load(model_path)
            self.current_uuid = uuid
            self.grid_size = grid_size
            return True
        except Exception as e:
            print(f"Erreur chargement: {e}")
            return False


manager = ModelManager()
router = APIRouter()


# --- ROUTES API ---

@router.get("/models", response_model=List[ModelInfo])
def list_models():
    """Scanne Hugging Face et renvoie la liste des modèles avec leur mode de jeu."""
    repo_id = "snakeRL/snake-rl-models"
    token = os.getenv("HF_HUB_TOKEN")
    api = HfApi(token=token)

    try:
        files = api.list_repo_files(repo_id=repo_id, repo_type="model")
        models = []

        for f in files:
            if f.endswith("metadata.json"):
                local_path = hf_hub_download(repo_id=repo_id, filename=f, token=token, force_download=True)
                with open(local_path, "r") as json_file:
                    data = json.load(json_file)

                models.append(ModelInfo(
                    uuid=data.get("uuid"),
                    grid_size=data.get("grid_size"),
                    algorithm=data.get("algorithm", "PPO"),
                    date=data.get("date", "N/A"),
                    reward=data.get("final_mean_reward"),
                    game_mode=data.get("game_mode", "classic")
                ))

        # Tri par reward décroissant
        models.sort(key=lambda x: x.reward if x.reward else -999, reverse=True)
        return models
    except Exception as e:
        print(f"Erreur scan models: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/load")
def load_model_endpoint(req: LoadModelRequest):
    success = manager.load_model(req.uuid, req.grid_size)
    if not success:
        raise HTTPException(status_code=404, detail="Modèle introuvable ou erreur de chargement")

    MODELE_LOADED_COUNTER.labels(grid_size=str(req.grid_size)).inc()
    return {"status": "loaded", "uuid": req.uuid}


@router.post("/start")
async def start_game_metric(req: StartGameRequest):
    GAMES_STARTED_COUNTER.labels(grid_size=str(req.grid_size)).inc()
    return {"status": "metric_updated"}


@router.post("/predict")
def predict_move(state: GameState):
    """
    Prédit le prochain mouvement ET renvoie les probabilités corrigées.
    """
    if not manager.current_agent:
        return {"action": 0, "probabilities": [0.0, 0.0, 0.0, 0.0]}

    # Conversion en float32 
    observation = np.array(state.grid, dtype=np.float32)

    # Prédiction de l'action
    action, _ = manager.current_agent.predict(observation, deterministic=True)

    # Calcul des Probabilités
    probs = [0.0, 0.0, 0.0, 0.0]
    try:
        with torch.no_grad():
            # Il faut s'assurer que l'observation a bien la dimension de batch [1, Grid, Grid]
            # Sinon obs_to_tensor peut mal interpréter une grille 10x10 comme 10 environnements de taille 10.
            if observation.ndim == 2:
                obs_for_tensor = np.expand_dims(observation, axis=0)
            else:
                obs_for_tensor = observation

            # Conversion SB3
            obs_tensor = manager.current_agent.policy.obs_to_tensor(obs_for_tensor)[0]

            # Récupération de la distribution
            distribution = manager.current_agent.policy.get_distribution(obs_tensor)

            # Extraction
            probs = distribution.distribution.probs.cpu().numpy()[0].tolist()

    except Exception as e:
        print(f"Erreur calcul probabilités: {e}")
        # En cas d'erreur, on garde les 0.0, mais l'erreur s'affichera dans les logs serveur

    return {
        "action": int(action),
        "probabilities": probs
    }


@router.post("/train/start", response_model=TrainingResponse)
def start_training_job(req: TrainRequest, background_tasks: BackgroundTasks):
    """
    Lance un job d'entraînement en arrière-plan (Background Task).
    Renvoie un run_id pour se connecter au WebSocket.
    """
    run_id = str(uuid.uuid4())

    # Lancement asynchrone
    background_tasks.add_task(
        train_snake,
        run_id=run_id,
        timesteps=req.timesteps,
        grid_size=req.grid_size,
        n_envs=req.n_envs,
        game_mode=req.game_mode,
        base_uuid=req.base_uuid
    )

    return {"run_id": run_id, "status": "started"}


@router.get("/train/active")
def list_active_jobs():
    """Liste les IDs des entraînements en cours."""
    return list(training_manager.active_trainings.keys())


@router.websocket("/ws/training/{run_id}")
async def websocket_endpoint(websocket: WebSocket, run_id: str):
    """
    Canal temps réel simplifié : envoie uniquement la progression et les stats.
    """
    await websocket.accept()
    try:
        while True:
            data = training_manager.get_status(run_id)

            if data:
                # On crée un objet léger sans les grilles pour économiser la bande passante
                payload = {
                    "progress": data.get("progress", 0),
                    "stats": data.get("stats", {}),
                    "timestamp": data.get("timestamp")
                }
                await websocket.send_json(payload)
            else:
                await websocket.send_json({"status": "finished"})
                break

            # On peut ralentir à 1 FPS (1 seconde) car une barre de progression
            # n'a pas besoin de 10 mises à jour par seconde.
            await asyncio.sleep(1.0)

    except WebSocketDisconnect:
        print(f"🔌 Client déconnecté du stream {run_id}")