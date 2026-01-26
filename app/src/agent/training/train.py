import os
import uuid
import json
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

# Imports locaux (Assure-toi que les chemins sont bons)
from app.src.env.snake_env import SnakeEnv
from app.src.agent.utils.mlflow_wrapper import SnakeHFModel
from app.src.agent.utils.callbacks import MLflowLoggingCallback
from app.src.agent.utils.loading import load_snake_model_data

os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"

load_dotenv()
hf_token = os.getenv("HF_HUB_TOKEN")
if not hf_token:
    raise ValueError("⚠️ Variable HF_HUB_TOKEN manquante.")


def train_snake(
        timesteps: int = 100_000,
        grid_size: int = None,
        n_envs: int = 4,
        game_mode: str = "classic",
        algorithm: str = "PPO",
        hf_repo_id: str = "snakeRL/snake-rl-models",
        base_uuid: str = None
):
    # Initialisation
    now = datetime.now()
    readable_date = now.strftime("%d/%m/%Y %H:%M:%S")
    date_str = now.strftime("%Y%m%d_%H%M%S")
    new_agent_uuid = str(uuid.uuid4())

    if algorithm != "PPO":
        raise ValueError("⚠️ Seul l'algorithme PPO est supporté pour le moment.")

    agent = None
    is_finetuning = False

    # --- LOGIQUE DE CHARGEMENT (FINE-TUNING) ---
    if base_uuid:
        print(f"Tentative de récupération du modèle {base_uuid}...")
        try:
            # 1. Chargement de l'agent
            agent, loaded_grid_size = load_snake_model_data(base_uuid, hf_repo_id)

            if agent is None or loaded_grid_size is None:
                raise ValueError(f"Le modèle {base_uuid} est introuvable.")

            grid_size = loaded_grid_size
            is_finetuning = True
            mode_label = "FINE-TUNING"

            # 2. Récupération des métadonnées (n_envs et game_mode)
            try:
                model_folder = f"{grid_size}x{grid_size}/{base_uuid}"
                meta_path = hf_hub_download(
                    repo_id=hf_repo_id,
                    filename=f"{model_folder}/metadata.json"
                )

                with open(meta_path, 'r') as f:
                    old_meta = json.load(f)

                # Récupération n_envs
                if "n_envs" in old_meta:
                    n_envs = old_meta["n_envs"]
                    print(f"🔄 Reprise avec n_envs={n_envs}")

                # Récupération game_mode (NOUVEAU)
                if "game_mode" in old_meta:
                    prev_mode = old_meta["game_mode"]
                    print(f"🔄 Mode de jeu détecté : {prev_mode}")
                    game_mode = prev_mode  # On force le mode d'origine pour ne pas perdre l'apprentissage
                else:
                    print(f"⚠️ 'game_mode' inconnu. Utilisation de : {game_mode}")

            except Exception as e:
                print(f"⚠️ Impossible de lire les métadonnées ({e}). Paramètres par défaut utilisés.")

            print(f"✅ Modèle chargé. Grille {grid_size}x{grid_size}, Mode {game_mode}, {n_envs} envs.")

        except Exception as e:
            print(f"❌ Erreur critique chargement {base_uuid} : {e}")
            return
    else:
        # Nouveau Run
        if grid_size is None:
            raise ValueError("⚠️ 'grid_size' requis pour un nouvel entraînement.")
        mode_label = "NEW_TRAINING"
        print(f"✨ Nouvel agent : Grille {grid_size}x{grid_size}, Mode {game_mode}, {n_envs} envs.")

    # --- CONFIGURATION MLFLOW ---
    run_name = f"{mode_label}_{date_str}_{new_agent_uuid[:8]}"
    mlflow.set_experiment(f"Snake_{grid_size}x{grid_size}")

    print(f"\nDémarrage Run MLflow : {run_name}")

    with mlflow.start_run(run_name=run_name) as run:
        # Tags
        mlflow.set_tag("agent_uuid", new_agent_uuid)
        mlflow.set_tag("hf_repo", hf_repo_id)
        mlflow.set_tag("game_mode", game_mode)  # Tag important pour le tri
        if base_uuid:
            mlflow.set_tag("parent_model_uuid", base_uuid)

        # Params
        mlflow.log_params({
            "algorithm": algorithm,
            "grid_size": grid_size,
            "n_envs": n_envs,
            "game_mode": game_mode,  # <--- Logué
            "timesteps": timesteps,
            "base_model": base_uuid if base_uuid else "None"
        })

        # --- CRÉATION ENVIRONNEMENT ---
        # On passe le game_mode à SnakeEnv
        env = make_vec_env(
            lambda: Monitor(SnakeEnv(grid_size=grid_size, render_mode=None, game_mode=game_mode)),
            n_envs=n_envs
        )

        if is_finetuning:
            agent.set_env(env)
        else:
            agent = PPO("MlpPolicy", env, verbose=1)

        # --- ENTRAÎNEMENT ---
        print(f"Go pour {timesteps} steps...")
        agent.learn(
            total_timesteps=timesteps,
            callback=MLflowLoggingCallback(),
            reset_num_timesteps=not is_finetuning
        )

        # --- SAUVEGARDE & UPLOAD ---
        print("\nSauvegarde...")
        with tempfile.TemporaryDirectory() as temp_dir_str:
            temp_dir = Path(temp_dir_str)

            # 1. Modèle
            agent.save(temp_dir / "model.zip")

            # 2. Métadonnées
            hf_folder = f"{grid_size}x{grid_size}/{new_agent_uuid}"
            final_reward = safe_mean([ep["r"] for ep in agent.ep_info_buffer]) if agent.ep_info_buffer else None

            metadata = {
                "uuid": new_agent_uuid,
                "type": "finetuned" if is_finetuning else "fresh",
                "parent_uuid": base_uuid,
                "grid_size": grid_size,
                "n_envs": n_envs,
                "game_mode": game_mode,  # <--- SAUVEGARDÉ POUR LE FRONTEND
                "algorithm": algorithm,
                "date": readable_date,
                "final_mean_reward": final_reward,
                "hf_folder": hf_folder,
                "mlflow_run_id": run.info.run_id
            }

            with open(temp_dir / "metadata.json", "w") as f:
                json.dump(metadata, f, indent=4)

            # 3. Upload HF
            api = HfApi(token=hf_token)
            api.create_repo(repo_id=hf_repo_id, repo_type="model", exist_ok=True, private=True)
            api.upload_folder(
                folder_path=str(temp_dir),
                path_in_repo=hf_folder,
                repo_id=hf_repo_id,
                commit_message=f"Add {mode_label} model ({game_mode}) {new_agent_uuid}"
            )

            # 4. Note MLflow
            hf_url = f"https://huggingface.co/{hf_repo_id}/tree/main/{hf_folder}"
            zip_url = f"https://huggingface.co/{hf_repo_id}/resolve/main/{hf_folder}/model.zip?download=true"

            note = textwrap.dedent(f"""\
                ### {mode_label} - Snake {grid_size}x{grid_size}

                **ID :** `{new_agent_uuid}`
                **Mode :** {game_mode.upper()} 
                **Reward :** {final_reward}

                [Voir sur Hugging Face]({hf_url})
                """)

            mlflow.set_tag("mlflow.note.content", note)

            # 5. Model Registry
            model_wrapper = SnakeHFModel(repo_id=hf_repo_id, subfolder=hf_folder)
            model_info = mlflow.pyfunc.log_model(
                name="snake_model",
                python_model=model_wrapper,
                pip_requirements=["stable-baselines3", "huggingface_hub", "gymnasium", "shimmy", "numpy"]
            )
            mlflow.register_model(model_uri=model_info.model_uri, name=f"Snake_{grid_size}x{grid_size}")

            print(f"Terminé ! Modèle {game_mode} dispo : {new_agent_uuid}")