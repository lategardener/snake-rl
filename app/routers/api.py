from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any
import os
import json
import numpy as np
from huggingface_hub import HfApi, hf_hub_download
from stable_baselines3 import PPO


# --- Modèles de données (Pydantic) ---
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


# --- Gestionnaire d'État Global ---
class ModelManager:
    def __init__(self):
        self.current_agent = None
        self.current_uuid = None
        self.grid_size = None

    def load_model(self, uuid: str, grid_size: int):
        token = os.getenv("HF_HUB_TOKEN")
        repo_id = "snakeRL/snake-rl-modelss"

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
    repo_id = "snakeRL/snake-rl-modelss"
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
    return {"status": "loaded", "uuid": req.uuid}


@router.post("/predict")
def predict_move(state: GameState):
    """Prédit le prochain mouvement basé sur la grille envoyée par le JS."""
    if not manager.current_agent:
        raise HTTPException(status_code=400, detail="Aucun modèle chargé. Veuillez en sélectionner un.")

    # Conversion de la grille JS (List[List]) en Array NumPy compatible
    # Attention: Il faut que la shape corresponde à ce que le modèle attend
    # Pour un CNNPolicy ou MlpPolicy, il faut souvent adapter la shape
    observation = np.array(state.grid)

    # Prédiction
    action, _ = manager.current_agent.predict(observation, deterministic=True)

    # On renvoie l'action (int)
    return {"action": int(action)}