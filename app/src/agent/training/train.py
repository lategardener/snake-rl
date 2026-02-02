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

# ⚡ DÉTECTION AUTOMATIQUE DE L'ENVIRONNEMENT
IS_CLOUD = os.getenv("RENDER") is not None or os.getenv("RAILWAY_ENVIRONMENT") is not None


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
# 2. CALLBACK OPTIMISÉ CLOUD
# =============================================================================
class StreamCallback(BaseCallback):
    def __init__(self, run_id, target_session_timesteps, update_frequency=100, verbose=0):
        super().__init__(verbose)
        self.run_id = run_id
        self.target_session_timesteps = target_session_timesteps
        self.initial_steps = None
        self.update_frequency = update_frequency
        self.last_update_step = 0
        self.start_time = None
        self.last_log_time = None

    def _on_step(self) -> bool:
        # Démarrage du chrono
        if self.start_time is None:
            self.start_time = time.time()
            self.last_log_time = time.time()

        # Capture du compteur initial
        if self.initial_steps is None:
            self.initial_steps = self.num_timesteps
            self.last_update_step = self.num_timesteps

        # Vérification d'arrêt (ultra léger)
        if training_manager.should_stop(self.run_id):
            return False

        # Mise à jour périodique
        current_total = self.num_timesteps
        if current_total - self.last_update_step >= self.update_frequency:
            self._update_progress()
            self.last_update_step = current_total

            # Log périodique pour monitoring
            now = time.time()
            if now - self.last_log_time >= 10.0:  # Toutes les 10s
                elapsed = now - self.start_time
                session_steps = current_total - self.initial_steps
                steps_per_sec = session_steps / elapsed if elapsed > 0 else 0
                eta_seconds = (self.target_session_timesteps - session_steps) / steps_per_sec if steps_per_sec > 0 else 0
                print(f"📊 {session_steps:,}/{self.target_session_timesteps:,} steps | "
                      f"{steps_per_sec:.0f} steps/s | "
                      f"ETA: {eta_seconds/60:.1f}min")
                self.last_log_time = now

        return True

    def _on_rollout_end(self) -> None:
        self._update_progress()

    def _update_progress(self):
        try:
            current_total = self.num_timesteps
            session_steps_done = current_total - (self.initial_steps or 0)
            progress = min(session_steps_done / self.target_session_timesteps, 1.0)

            stats = {}
            if len(self.model.ep_info_buffer) > 0:
                stats['mean_reward'] = safe_mean([ep['r'] for ep in self.model.ep_info_buffer])

            training_manager.update(
                run_id=self.run_id,
                progress=progress,
                grids=[],
                stats=stats,
                timesteps=session_steps_done,
                total_timesteps=self.target_session_timesteps
            )
        except Exception:
            pass


# =============================================================================
# 3. FONCTION PRINCIPALE AVEC AUTO-OPTIMISATION
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
    if not hf_token:
        print("❌ HF_HUB_TOKEN manquant")
        return

    # ⚡ AUTO-OPTIMISATION POUR LE CLOUD
    original_n_envs = n_envs
    if IS_CLOUD:
        # Force 1 seul env sur le cloud pour performance optimale
        n_envs = 1
        if n_envs != original_n_envs:
            print(f"☁️ Mode Cloud : n_envs forcé à 1 (demandé: {original_n_envs})")

    print(f"\n{'='*60}")
    print(f"🚀 CONFIGURATION DE L'ENTRAÎNEMENT")
    print(f"{'='*60}")
    print(f"📋 Paramètres:")
    print(f"   → Environnement: {'☁️ CLOUD' if IS_CLOUD else '💻 LOCAL'}")
    print(f"   → Run ID: {run_id}")
    print(f"   → Timesteps: {timesteps:,}")
    print(f"   → Grid: {grid_size}x{grid_size}")
    print(f"   → N envs: {n_envs}")
    print(f"   → Mode: {game_mode}")
    print(f"   → Base: {base_uuid[:8] if base_uuid else 'Nouveau'}")

    training_manager.update(run_id, 0, [], {"status": "initializing"}, 0, timesteps)

    now = datetime.now()
    readable_date = now.strftime("%d/%m/%Y %H:%M:%S")
    date_str = now.strftime("%Y%m%d_%H%M%S")
    new_agent_uuid = str(uuid.uuid4())

    agent = None
    is_finetuning = False

    try:
        # ============= CHARGEMENT MODÈLE =============
        if base_uuid:
            print(f"\n📥 Chargement du modèle {base_uuid[:8]}...")
            load_start = time.time()
            agent, loaded_grid_size = load_snake_model_data(base_uuid, hf_repo_id, show_logs)
            if agent is None:
                raise ValueError("Modèle introuvable")
            grid_size = loaded_grid_size
            is_finetuning = True
            print(f"✅ Chargé en {time.time() - load_start:.1f}s")

            # Récupérer les params originaux
            try:
                meta_path = hf_hub_download(
                    repo_id=hf_repo_id,
                    filename=f"{grid_size}x{grid_size}/{base_uuid}/metadata.json"
                )
                with open(meta_path, 'r') as f:
                    old_meta = json.load(f)
                # On garde n_envs optimisé pour le cloud, pas celui du parent
                game_mode = old_meta.get("game_mode", game_mode)
            except:
                pass
        else:
            if grid_size is None:
                raise ValueError("Grid Size manquant")

        # ============= MLFLOW =============
        print(f"\n🔬 Configuration MLflow...")
        mlflow.set_experiment(f"Snake_{grid_size}x{grid_size}")
        run_name = f"{'FT' if is_finetuning else 'NEW'}_{date_str}_{new_agent_uuid[:8]}"

        with mlflow.start_run(run_name=run_name) as run:
            # ============= ENVIRONNEMENTS =============
            print(f"\n🎮 Création de {n_envs} environnement(s)...")
            env_start = time.time()
            env = make_vec_env(
                lambda: Monitor(SnakeEnv(grid_size=grid_size, render_mode=None, game_mode=game_mode)),
                n_envs=n_envs
            )
            print(f"✅ Prêt en {time.time() - env_start:.1f}s")

            # ============= AGENT =============
            if is_finetuning:
                print(f"\n🔄 Configuration agent existant...")
                agent.set_env(env)
            else:
                print(f"\n🧠 Création nouvel agent PPO...")
                agent = PPO("MlpPolicy", env, verbose=0)

            # ============= CALLBACKS =============
            callbacks = [
                MLflowLoggingCallback(),
                StreamCallback(run_id, timesteps, update_frequency=100)
            ]

            # ============= APPRENTISSAGE =============
            print(f"\n{'='*60}")
            print(f"🚀 DÉBUT APPRENTISSAGE ({timesteps:,} timesteps)")
            print(f"{'='*60}\n")

            learn_start = time.time()
            agent.learn(
                total_timesteps=timesteps,
                callback=callbacks,
                reset_num_timesteps=not is_finetuning
            )
            learn_duration = time.time() - learn_start

            # Vérification annulation
            if training_manager.should_stop(run_id):
                print(f"\n🛑 Entraînement annulé")
                training_manager.update(run_id, 0, [], {"status": "cancelled"}, 0, timesteps, status="cancelled")
                return

            print(f"\n{'='*60}")
            print(f"✅ APPRENTISSAGE TERMINÉ")
            print(f"   → Durée: {learn_duration/60:.1f}min")
            print(f"   → Vitesse: {timesteps/learn_duration:.0f} steps/s")
            print(f"{'='*60}\n")

            # ============= SAUVEGARDE =============
            print(f"💾 Sauvegarde sur HuggingFace...")
            save_start = time.time()

            with tempfile.TemporaryDirectory() as temp_dir_str:
                temp_dir = Path(temp_dir_str)
                agent.save(temp_dir / "model.zip")

                final_reward = safe_mean([ep["r"] for ep in agent.ep_info_buffer]) if agent.ep_info_buffer else 0.0

                metadata = {
                    "uuid": new_agent_uuid,
                    "type": "finetuned" if is_finetuning else "fresh",
                    "parent_uuid": base_uuid,
                    "grid_size": grid_size, "n_envs": original_n_envs,
                    "game_mode": game_mode,
                    "algorithm": algorithm,
                    "date": readable_date,
                    "final_mean_reward": final_reward,
                    "hf_folder": f"{grid_size}x{grid_size}/{new_agent_uuid}",
                    "mlflow_run_id": run.info.run_id
                }

                with open(temp_dir / "metadata.json", "w") as f:
                    json.dump(metadata, f, indent=4)

                api = HfApi(token=hf_token)
                api.upload_folder(
                    folder_path=str(temp_dir),
                    path_in_repo=f"{grid_size}x{grid_size}/{new_agent_uuid}",
                    repo_id=hf_repo_id
                )

            print(f"✅ Sauvegardé en {time.time() - save_start:.1f}s")

            # ============= RÉSUMÉ =============
            print(f"\n{'='*60}")
            print(f"🎉 ENTRAÎNEMENT COMPLÉTÉ")
            print(f"{'='*60}")
            print(f"   → UUID: {new_agent_uuid}")
            print(f"   → Reward: {final_reward:.2f}")
            print(f"   → Durée: {learn_duration/60:.1f}min")
            print(f"   → Vitesse: {timesteps/learn_duration:.0f} steps/s")
            print(f"{'='*60}\n")

            # Mise à jour finale
            training_manager.update(
                run_id,
                1.0,
                [],
                {"status": "completed", "mean_reward": final_reward},
                timesteps,
                timesteps,
                status="completed"
            )

    except Exception as e:
        print(f"\n❌ ERREUR: {e}")
        import traceback
        traceback.print_exc()
        training_manager.update(
            run_id,
            0,
            [],
            {"status": "error", "message": str(e)},
            status="error"
        )
        time.sleep(2)

    finally:
        pass