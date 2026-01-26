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

# Définition du compteur avec un label pour la largeur du plateau (grid_size)
MODELE_LOADED_COUNTER = Counter(
    'snake_model_loaded_total', 
    'Nombre total de modèle chargé', 
    ['grid_size']
)

# Définition de la métrique (si pas déjà fait)
GAMES_STARTED_COUNTER = Counter(
    'snake_games_started_total', 
    'Nombre total de parties lancées', 
    ['grid_size']
)

class GameState(BaseModel):
    grid: List[List[int]]


class ModelInfo(BaseModel):
    uuid: str
    grid_size: int
    algorithm: str
    date: str
    reward: Optional[float]


class LoadModelRequest(BaseModel):
    uuid: str
    grid_size: int

# Modèle pour la requête de début de partie
class StartGameRequest(BaseModel):
    grid_size: int


# --- Gestionnaire d'État Global ---
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
            # 1. Trouver le fichier metadata pour confirmer (optionnel mais propre)
            # 2. Télécharger le model.zip
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


# Instance globale
manager = ModelManager()
router = APIRouter()


# --- Routes API ---

@router.get("/models", response_model=List[ModelInfo])
def list_models():
    """Scanne Hugging Face et renvoie la liste des modèles."""
    repo_id = "snakeRL/snake-rl-models"
    token = os.getenv("HF_HUB_TOKEN")
    api = HfApi(token=token)

    try:
        files = api.list_repo_files(repo_id=repo_id, repo_type="model")
        models = []

        # On cherche tous les fichiers metadata.json
        for f in files:
            if f.endswith("metadata.json"):
                # Téléchargement rapide du JSON pour lire les infos
                local_path = hf_hub_download(repo_id=repo_id, filename=f, token=token)
                with open(local_path, "r") as json_file:
                    data = json.load(json_file)

                models.append(ModelInfo(
                    uuid=data.get("uuid"),
                    grid_size=data.get("grid_size"),
                    algorithm=data.get("algorithm", "PPO"),
                    date=data.get("date", "N/A"),
                    reward=data.get("final_mean_reward")
                ))

        # Tri par date (plus récent en haut)
        # Note: Idéalement il faudrait parser la date, ici on fait simple
        return models
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/load")
def load_model_endpoint(req: LoadModelRequest):
    """Charge un modèle spécifique en mémoire côté serveur."""
    success = manager.load_model(req.uuid, req.grid_size)
    if not success:
        raise HTTPException(status_code=404, detail="Modèle introuvable ou erreur de chargement")
    
    # --- AJOUT DE LA MÉTRIQUE ---
    # On convertit grid_size en string car les labels Prometheus sont toujours des chaînes
    MODELE_LOADED_COUNTER.labels(grid_size=str(req.grid_size)).inc()
    
    return {"status": "loaded", "uuid": req.uuid}

@router.post("/start")
async def start_game_metric(req: StartGameRequest):
    """Incrémente le compteur de parties lancées."""
    GAMES_STARTED_COUNTER.labels(grid_size=str(req.grid_size)).inc()
    return {"status": "metric_updated"}


@router.post("/predict")
def predict_move(state: GameState):
    """
    Prédit le prochain mouvement ET renvoie les probabilités.
    """
    if not manager.current_agent:
        # Si pas d'agent, on renvoie une action par défaut (ex: Haut)
        return {"action": 0, "probabilities": [0.25, 0.25, 0.25, 0.25]}

    # 1. Conversion de la grille reçue du JS
    observation = np.array(state.grid)

    # 2. Prédiction de l'action (Déterministe pour le jeu)
    action, _ = manager.current_agent.predict(observation, deterministic=True)

    # 3. Calcul des Probabilités (Pour la visualisation "Cerveau")
    # On doit utiliser PyTorch directement pour extraire la distribution interne
    probs = []
    try:
        with torch.no_grad():
            obs_tensor = manager.current_agent.policy.obs_to_tensor(observation)[0]
            distribution = manager.current_agent.policy.get_distribution(obs_tensor)
            probs = distribution.distribution.probs.cpu().numpy()[0].tolist()
    except Exception as e:
        print(f"Erreur calcul probabilités: {e}")
        probs = [0.0, 0.0, 0.0, 0.0]  # Fallback si erreur

    return {
        "action": int(action),
        "probabilities": probs
    }