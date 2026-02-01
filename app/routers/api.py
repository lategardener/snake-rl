import asyncio
import uuid
import torch
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Optional
import os
import json
import numpy as np
from huggingface_hub import HfApi, hf_hub_download
from stable_baselines3 import PPO
from dotenv import load_dotenv
from prometheus_client import Counter, REGISTRY
from starlette.websockets import WebSocket, WebSocketDisconnect

# Import du manager mis à jour
from app.src.agent.training.train import train_snake, training_manager

load_dotenv()

MODELE_LOADED_COUNTER = Counter('snake_model_loaded_total', 'Modèles chargés', ['grid_size'], registry=REGISTRY)
GAMES_STARTED_COUNTER = Counter('snake_games_started_total', 'Parties lancées', ['grid_size'], registry=REGISTRY)


class GameState(BaseModel): grid: List[List[int]]


class ModelInfo(BaseModel):
    uuid: str
    grid_size: int
    algorithm: str
    date: str
    final_mean_reward: Optional[float] = 0.0
    game_mode: str | None = "classic"
    n_envs: int | None = 4


class LoadModelRequest(BaseModel): uuid: str; grid_size: int


class StartGameRequest(BaseModel): grid_size: int


class TrainRequest(BaseModel):
    base_uuid: str | None = None
    grid_size: int = 10
    timesteps: int = 50_000
    n_envs: int = 4
    game_mode: str = "classic"


class TrainingResponse(BaseModel): run_id: str; status: str


class ModelManager:
    def __init__(self):
        self.current_agent = None
        self.current_uuid = None

    def load_model(self, uuid: str, grid_size: int):
        try:
            path = hf_hub_download(repo_id="snakeRL/snake-rl-models",
                                   filename=f"{grid_size}x{grid_size}/{uuid}/model.zip",
                                   token=os.getenv("HF_HUB_TOKEN"))
            self.current_agent = PPO.load(path)
            self.current_uuid = uuid
            return True
        except Exception as e:
            print(f"Load error: {e}")
            return False


manager = ModelManager()
router = APIRouter()


@router.get("/models", response_model=List[ModelInfo])
def list_models():
    api = HfApi(token=os.getenv("HF_HUB_TOKEN"))
    try:
        files = api.list_repo_files(repo_id="snakeRL/snake-rl-models", repo_type="model")
        models = []
        for f in files:
            if f.endswith("metadata.json"):
                path = hf_hub_download(repo_id="snakeRL/snake-rl-models", filename=f, force_download=True,
                                       token=os.getenv("HF_HUB_TOKEN"))
                with open(path, "r") as j: data = json.load(j)
                models.append(ModelInfo(
                    uuid=data.get("uuid"), grid_size=data.get("grid_size"), algorithm=data.get("algorithm", "PPO"),
                    date=data.get("date", "N/A"), final_mean_reward=data.get("final_mean_reward", 0.0),
                    game_mode=data.get("game_mode", "classic"), n_envs=data.get("n_envs", 4)
                ))
        return sorted(models, key=lambda x: (x.grid_size, -(x.final_mean_reward or -999)))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/load")
def load_model(req: LoadModelRequest):
    if manager.load_model(req.uuid, req.grid_size):
        MODELE_LOADED_COUNTER.labels(grid_size=str(req.grid_size)).inc()
        return {"status": "loaded", "uuid": req.uuid}
    raise HTTPException(404, "Model not found")


@router.post("/start")
async def start_game(req: StartGameRequest):
    GAMES_STARTED_COUNTER.labels(grid_size=str(req.grid_size)).inc()
    return {"status": "ok"}


@router.post("/predict")
def predict(state: GameState):
    if not manager.current_agent: return {"action": 0, "probabilities": [0] * 4}
    obs = np.array(state.grid, dtype=np.float32)
    action, _ = manager.current_agent.predict(obs, deterministic=True)
    probs = [0.0] * 4
    try:
        with torch.no_grad():
            t_obs = manager.current_agent.policy.obs_to_tensor(obs if obs.ndim > 2 else np.expand_dims(obs, 0))[0]
            probs = manager.current_agent.policy.get_distribution(t_obs).distribution.probs.cpu().numpy()[0].tolist()
    except:
        pass
    return {"action": int(action), "probabilities": probs}


@router.post("/train/start", response_model=TrainingResponse)
def start_train(req: TrainRequest, bg: BackgroundTasks):
    run_id = str(uuid.uuid4())
    bg.add_task(train_snake, run_id=run_id, timesteps=req.timesteps, grid_size=req.grid_size, n_envs=req.n_envs,
                game_mode=req.game_mode, base_uuid=req.base_uuid)
    return {"run_id": run_id, "status": "started"}


# --- NOUVEAU : Endpoint STOP ---
@router.delete("/train/stop/{run_id}")
def stop_train(run_id: str):
    # Appel de la méthode qu'on a ajoutée dans train.py
    training_manager.cancel_job(run_id)
    return {"status": "stop_requested"}


@router.get("/train/active")
def list_active(): return list(training_manager.active_trainings.keys())


# --- MODIFIÉ : WebSocket avec données précises ---
@router.websocket("/ws/training/{run_id}")
async def ws_endpoint(websocket: WebSocket, run_id: str):
    await websocket.accept()
    try:
        while True:
            data = training_manager.get_status(run_id)

            if data:
                # Si annulé, on prévient le front
                if data.get("status") == "cancelled":
                    await websocket.send_json({"status": "cancelled"})
                    break

                # Envoi des données complètes pour le graph et la barre
                await websocket.send_json({
                    "progress": data.get("progress", 0),
                    "current_step": data.get("timesteps", 0),
                    "total_steps": data.get("total_timesteps", 1),
                    "stats": data.get("stats", {})
                })
            else:
                await websocket.send_json({"status": "finished"})
                break
            await asyncio.sleep(0.5)  # Mise à jour plus rapide (0.5s)
    except WebSocketDisconnect:
        pass