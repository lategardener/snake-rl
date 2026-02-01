import os
import uuid
import json
import time
import mlflow
import tempfile
from datetime import datetime
from pathlib import Path

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


# =============================================================================
# 1. GESTIONNAIRE D'ÉTAT
# =============================================================================
class TrainingStateManager:
    def __init__(self):
        self.active_trainings = {}
        self.cancel_flags = set()

    def update(self, run_id, progress, grids, stats=None, timesteps=0, total_timesteps=1, status="running"):
        self.active_trainings[run_id] = {
            "progress": progress,
            "timesteps": timesteps,
            "total_timesteps": total_timesteps,
            "grids": grids,
            "stats": stats,
            "timestamp": time.time(),
            "status": status
        }

    def get_status(self, run_id):
        if run_id in self.cancel_flags:
            data = self.active_trainings.get(run_id, {})
            data["status"] = "cancelled"
            return data
        return self.active_trainings.get(run_id, None)

    def cancel_job(self, run_id):
        print(f"🛑 Demande d'arrêt reçue pour {run_id}")
        self.cancel_flags.add(run_id)

    def should_stop(self, run_id):
        return run_id in self.cancel_flags

    def stop_training(self, run_id):
        if run_id in self.active_trainings:
            del self.active_trainings[run_id]
        if run_id in self.cancel_flags:
            self.cancel_flags.remove(run_id)


training_manager = TrainingStateManager()


# =============================================================================
# 2. CALLBACK PERFORMANCE (MISE À JOUR PAR "CHUNKS")
# =============================================================================
class StreamCallback(BaseCallback):
    def __init__(self, run_id, target_session_timesteps, verbose=0):
        super().__init__(verbose)
        self.run_id = run_id
        self.target_session_timesteps = target_session_timesteps
        self.initial_steps = None

    def _on_step(self) -> bool:
        """
        Appelé à CHAQUE step. Doit être ultra rapide.
        On vérifie juste si on doit STOPPER. On ne calcule rien d'autre.
        """
        if training_manager.should_stop(self.run_id):
            return False  # Arrêt immédiat

        # On capture juste le step de départ au tout premier passage
        if self.initial_steps is None:
            self.initial_steps = self.num_timesteps

        return True

    def _on_rollout_end(self) -> None:
        """
        Appelé à la fin d'une collecte de données (avant l'optimisation).
        C'est ici que PPO fait une 'pause' pour apprendre.
        C'est le moment idéal pour envoyer les stats sans ralentir le jeu.
        """
        try:
            # Calcul des steps faits durant cette session
            session_steps_done = self.num_timesteps - (self.initial_steps or 0)

            # Progression
            progress = session_steps_done / self.target_session_timesteps
            progress = min(progress, 1.0)

            stats = {}
            # Récupération des infos (Reward) depuis le buffer
            if len(self.model.ep_info_buffer) > 0:
                stats['mean_reward'] = safe_mean([ep['r'] for ep in self.model.ep_info_buffer])

            # Envoi au manager (ce qui mettra à jour le graphique)
            training_manager.update(
                run_id=self.run_id,
                progress=progress,
                grids=[],
                stats=stats,
                timesteps=session_steps_done,
                total_timesteps=self.target_session_timesteps
            )
        except Exception as e:
            print(f"Erreur update callback: {e}")


# =============================================================================
# 3. FONCTION PRINCIPALE
# =============================================================================
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
    if not hf_token: return

    # Init
    training_manager.update(run_id, 0, [], {"status": "initializing"}, 0, timesteps)

    now = datetime.now()
    readable_date = now.strftime("%d/%m/%Y %H:%M:%S")
    date_str = now.strftime("%Y%m%d_%H%M%S")
    new_agent_uuid = str(uuid.uuid4())

    print(f"🚀 Lancement entraînement {run_id}")

    agent = None
    is_finetuning = False

    try:
        if base_uuid:
            agent, loaded_grid_size = load_snake_model_data(base_uuid, hf_repo_id, show_logs)
            if agent is None: raise ValueError("Modèle introuvable")
            grid_size = loaded_grid_size
            is_finetuning = True

            try:
                meta_path = hf_hub_download(repo_id=hf_repo_id,
                                            filename=f"{grid_size}x{grid_size}/{base_uuid}/metadata.json")
                with open(meta_path, 'r') as f:
                    old_meta = json.load(f)
                n_envs = old_meta.get("n_envs", n_envs)
                game_mode = old_meta.get("game_mode", game_mode)
            except:
                pass
        else:
            if grid_size is None: raise ValueError("Grid Size manquant")

        mlflow.set_experiment(f"Snake_{grid_size}x{grid_size}")
        run_name = f"{'FINE-TUNING' if is_finetuning else 'NEW'}_{date_str}_{new_agent_uuid[:8]}"

        with mlflow.start_run(run_name=run_name) as run:
            env = make_vec_env(
                lambda: Monitor(SnakeEnv(grid_size=grid_size, render_mode=None, game_mode=game_mode)),
                n_envs=n_envs
            )

            if is_finetuning:
                agent.set_env(env)
            else:
                agent = PPO("MlpPolicy", env, verbose=0)

            # Utilisation du nouveau StreamCallback optimisé
            callbacks = [MLflowLoggingCallback(), StreamCallback(run_id, timesteps)]

            agent.learn(total_timesteps=timesteps, callback=callbacks, reset_num_timesteps=not is_finetuning)

            if training_manager.should_stop(run_id):
                training_manager.update(run_id, 0, [], {"status": "cancelled"}, 0, timesteps, status="cancelled")
                return

            # Sauvegarde
            with tempfile.TemporaryDirectory() as temp_dir_str:
                temp_dir = Path(temp_dir_str)
                agent.save(temp_dir / "model.zip")

                final_reward = safe_mean([ep["r"] for ep in agent.ep_info_buffer]) if agent.ep_info_buffer else 0.0

                metadata = {
                    "uuid": new_agent_uuid, "type": "finetuned" if is_finetuning else "fresh",
                    "parent_uuid": base_uuid, "grid_size": grid_size, "n_envs": n_envs,
                    "game_mode": game_mode, "algorithm": algorithm, "date": readable_date,
                    "final_mean_reward": final_reward, "hf_folder": f"{grid_size}x{grid_size}/{new_agent_uuid}",
                    "mlflow_run_id": run.info.run_id
                }

                with open(temp_dir / "metadata.json", "w") as f: json.dump(metadata, f, indent=4)

                api = HfApi(token=hf_token)
                api.upload_folder(folder_path=str(temp_dir), path_in_repo=f"{grid_size}x{grid_size}/{new_agent_uuid}",
                                  repo_id=hf_repo_id)

    except Exception as e:
        print(f"❌ Erreur: {e}")
        training_manager.update(run_id, 0, [], {"status": "error", "message": str(e)}, status="error")
        time.sleep(2)

    finally:
        pass