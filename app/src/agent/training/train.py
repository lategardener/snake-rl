import os
import uuid
import json
import time
import mlflow
import tempfile
from datetime import datetime
from pathlib import Path
import textwrap

from dotenv import load_dotenv
from huggingface_hub import HfApi, hf_hub_download
from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.utils import safe_mean
from stable_baselines3.common.callbacks import BaseCallback

# Imports locaux
from app.src.env.snake_env import SnakeEnv
from app.src.agent.utils.mlflow_wrapper import SnakeHFModel
from app.src.agent.utils.callbacks import MLflowLoggingCallback
from app.src.agent.utils.loading import load_snake_model_data

os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

load_dotenv()
hf_token = os.getenv("HF_HUB_TOKEN")


# --- GESTIONNAIRE D'ÉTAT GLOBAL ---
class TrainingStateManager:
    def __init__(self):
        self.active_trainings = {}
        self.cancel_flags = set() # Stocke les IDs des runs à arrêter

    # Ajout des champs timesteps et total_timesteps
    def update(self, run_id, progress, grids, stats=None, timesteps=0, total_timesteps=1):
        self.active_trainings[run_id] = {
            "progress": progress,
            "timesteps": timesteps,       # NOUVEAU: Steps actuels
            "total_timesteps": total_timesteps, # NOUVEAU: Objectif
            "grids": grids,
            "stats": stats,
            "timestamp": time.time(),
            "status": "running"
        }

    def get_status(self, run_id):
        # Si annulé, on renvoie un statut spécial
        if run_id in self.cancel_flags:
            return {"status": "cancelled"}
        return self.active_trainings.get(run_id, None)

    # Méthode appelée par l'API pour demander l'arrêt
    def cancel_job(self, run_id):
        print(f"🛑 Demande d'arrêt reçue pour {run_id}")
        self.cancel_flags.add(run_id)

    # Vérifie si on doit arrêter
    def should_stop(self, run_id):
        return run_id in self.cancel_flags

    def stop_training(self, run_id):
        if run_id in self.active_trainings:
            del self.active_trainings[run_id]
        if run_id in self.cancel_flags:
            self.cancel_flags.remove(run_id)


training_manager = TrainingStateManager()


# --- CALLBACK OPTIMISÉ (PLUS DE GRILLES + LOGIQUE STOP) ---
class StreamCallback(BaseCallback):
    def __init__(self, run_id, total_timesteps, verbose=0):
        super().__init__(verbose)
        self.run_id = run_id
        self.total_timesteps = total_timesteps
        self.last_update = 0

    def _on_step(self) -> bool:
        # 1. Vérification d'arrêt (STOP)
        if training_manager.should_stop(self.run_id):
            print(f"🛑 Arrêt immédiat de l'entraînement {self.run_id} via Callback")
            return False # Retourner False arrête l'entraînement SB3

        # 2. Mise à jour toutes les 0.5 secondes pour fluidité
        if time.time() - self.last_update > 0.5:
            try:
                # Calcul précis
                current_steps = self.num_timesteps
                progress = current_steps / self.total_timesteps

                stats = {}
                if len(self.model.ep_info_buffer) > 0:
                    stats['mean_reward'] = safe_mean([ep['r'] for ep in self.model.ep_info_buffer])

                # Envoi des données précises au manager
                training_manager.update(
                    run_id=self.run_id,
                    progress=progress,
                    grids=[],
                    stats=stats,
                    timesteps=current_steps,      # Donnée brute
                    total_timesteps=self.total_timesteps # Objectif
                )
                self.last_update = time.time()
            except Exception:
                pass
        return True


def train_snake(
        run_id: str,
        timesteps: int = 100_000,
        grid_size: int = None,
        n_envs: int = 4,
        game_mode: str = "classic",
        algorithm: str = "PPO",
        hf_repo_id: str = "snakeRL/snake-rl-models",
        base_uuid: str = None,
        show_logs: bool = False
):
    if not hf_token:
        print("⚠️ Token HF manquant")
        return

    print(f"🚀 Initialisation du run {run_id}...")
    training_manager.update(run_id, 0, [], {"status": "initializing"}, 0, timesteps)

    now = datetime.now()
    readable_date = now.strftime("%d/%m/%Y %H:%M:%S")
    date_str = now.strftime("%Y%m%d_%H%M%S")
    new_agent_uuid = str(uuid.uuid4())

    print(f"🚀 Lancement entraînement {run_id} (Background)...")

    agent = None
    is_finetuning = False
    sb3_verbose = 1 if show_logs else 0

    try:
        if base_uuid:
            agent, loaded_grid_size = load_snake_model_data(base_uuid, hf_repo_id, show_logs)
            if agent is None: raise ValueError(f"Modèle parent {base_uuid} introuvable")
            grid_size = loaded_grid_size
            is_finetuning = True
            mode_label = "FINE-TUNING"

            try:
                model_folder = f"{grid_size}x{grid_size}/{base_uuid}"
                meta_path = hf_hub_download(repo_id=hf_repo_id, filename=f"{model_folder}/metadata.json")
                with open(meta_path, 'r') as f:
                    old_meta = json.load(f)
                if "n_envs" in old_meta: n_envs = old_meta["n_envs"]
                if "game_mode" in old_meta: game_mode = old_meta["game_mode"]
            except Exception:
                pass
        else:
            if grid_size is None: raise ValueError("Grid Size manquant")
            mode_label = "NEW_TRAINING"

        run_name = f"{mode_label}_{date_str}_{new_agent_uuid[:8]}"
        mlflow.set_experiment(f"Snake_{grid_size}x{grid_size}")

        with mlflow.start_run(run_name=run_name) as run:
            mlflow.set_tag("agent_uuid", new_agent_uuid)
            mlflow.set_tag("game_mode", game_mode)

            env = make_vec_env(
                lambda: Monitor(SnakeEnv(grid_size=grid_size, render_mode=None, game_mode=game_mode)),
                n_envs=n_envs
            )

            if is_finetuning:
                agent.set_env(env)
            else:
                agent = PPO("MlpPolicy", env, verbose=sb3_verbose)

            # Ajout du callback de stream qui gère l'arrêt
            callbacks = [MLflowLoggingCallback(), StreamCallback(run_id, timesteps)]

            # Lancement de l'apprentissage
            agent.learn(total_timesteps=timesteps, callback=callbacks, reset_num_timesteps=not is_finetuning)

            # VÉRIFICATION APRÈS BOUCLE : Est-ce qu'on a fini ou est-ce qu'on a été annulé ?
            if training_manager.should_stop(run_id):
                print(f"❌ Entraînement {run_id} annulé par l'utilisateur. Pas de sauvegarde.")
                return # On quitte sans sauvegarder

            print("\nSauvegarde...")
            with tempfile.TemporaryDirectory() as temp_dir_str:
                temp_dir = Path(temp_dir_str)
                agent.save(temp_dir / "model.zip")

                hf_folder = f"{grid_size}x{grid_size}/{new_agent_uuid}"
                final_reward = safe_mean([ep["r"] for ep in agent.ep_info_buffer]) if agent.ep_info_buffer else None

                metadata = {
                    "uuid": new_agent_uuid,
                    "type": "finetuned" if is_finetuning else "fresh",
                    "parent_uuid": base_uuid,
                    "grid_size": grid_size,
                    "n_envs": n_envs,
                    "game_mode": game_mode,
                    "algorithm": algorithm,
                    "date": readable_date,
                    "final_mean_reward": final_reward,
                    "hf_folder": hf_folder,
                    "mlflow_run_id": run.info.run_id
                }

                with open(temp_dir / "metadata.json", "w") as f: json.dump(metadata, f, indent=4)

                api = HfApi(token=hf_token)
                api.create_repo(repo_id=hf_repo_id, repo_type="model", exist_ok=True, private=True)
                api.upload_folder(folder_path=str(temp_dir), path_in_repo=hf_folder, repo_id=hf_repo_id)

                print(f"Terminé ! Modèle {game_mode} dispo : {new_agent_uuid}")

    except Exception as e:
        print(f"❌ Erreur fatale training: {e}")
        training_manager.update(run_id, 0, [], {"status": "error", "message": str(e)})
        time.sleep(3)

    finally:
        print(f"Fin du processus pour {run_id}")
        # On ne supprime pas immédiatement si c'est fini, pour laisser le front afficher "Terminé"
        # Mais on nettoie les flags
        if run_id in training_manager.cancel_flags:
            training_manager.cancel_flags.remove(run_id)
        # Le nettoyage final se fera quand le websocket se fermera ou via un timeout côté API