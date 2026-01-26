import torch
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any
import os
import json
import numpy as np
from huggingface_hub import HfApi, hf_hub_download
from stable_baselines3 import PPO
from dotenv import load_dotenv
from prometheus_client import Counter

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