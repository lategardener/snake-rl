import os
import uuid
import json
import mlflow
import tempfile
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import HfApi
from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.utils import safe_mean
import textwrap
from app.src.env.snake_env import SnakeEnv
from app.src.agent.utils.mlflow_wrapper import SnakeHFModel

from app.src.agent.utils.callbacks import MLflowLoggingCallback
from app.src.agent.utils.loading import load_snake_model_data

load_dotenv()
hf_token = os.getenv("HF_HUB_TOKEN")
if not hf_token:
    raise ValueError("⚠️ Variable HF_HUB_TOKEN manquante.")



def train_snake(
    timesteps: int = 100_000,
    grid_size: int = None,
    n_envs: int = 4,
    algorithm: str = "PPO",
    hf_repo_id: str = "Lategardener/snake-rl-models",
    base_uuid: str = None
):
    # Initialisation
    now = datetime.now()
    readable_date = now.strftime("%d/%m/%Y %H:%M:%S")
    date_str = now.strftime("%Y%m%d_%H%M%S")
    new_agent_uuid = str(uuid.uuid4())

    # Contrôle de l'algorithme
    if algorithm != "PPO":
        raise ValueError("⚠️ Seul l'algorithme PPO est supporté pour le moment.")
    agent = None
    is_finetuning = False

    if base_uuid:
        # Mode FINE-TUNING : On va chercher le modèle et ses infos
        try:
            agent, loaded_grid_size = load_snake_model_data(base_uuid, hf_repo_id)

            # On écrase la grid_size avec celle du modèle chargé (c'est la vérité terrain)
            grid_size = loaded_grid_size
            is_finetuning = True
            mode_label = "FINE-TUNING"
            print(f"✅ Modèle chargé avec succès. Reprise sur grille {grid_size}x{grid_size}.")

        except Exception as e:
            print(f"❌ Impossible de charger le modèle {base_uuid} : {e}")
            return None, None
    else:
        # Mode NEW TRAINING
        if grid_size is None:
            raise ValueError("⚠️ Vous devez spécifier 'grid_size' pour un nouvel entraînement.")
        mode_label = "NEW_TRAINING"
        print(f"✨ Création d'un nouvel agent vierge sur grille {grid_size}x{grid_size}.")

    # --- C. Configuration MLflow ---
    run_name = f"{mode_label}_{date_str}_{new_agent_uuid[:8]}"
    mlflow.set_experiment(f"Snake_{grid_size}x{grid_size}")

    print(f"\n🚀 Démarrage Run MLflow : {run_name}")
    print(f"🆔 Nouvel ID : {new_agent_uuid}")

    with mlflow.start_run(run_name=run_name) as run:

        # Tags
        mlflow.set_tag("agent_uuid", new_agent_uuid)
        mlflow.set_tag("hf_repo", hf_repo_id)
        mlflow.set_tag("run_type", "finetuning" if is_finetuning else "fresh")
        if base_uuid:
            mlflow.set_tag("parent_model_uuid", base_uuid)

        # Params
        mlflow.log_params({
            "algorithm": algorithm,
            "grid_size": grid_size,
            "timesteps_added": timesteps,
            "base_model": base_uuid if base_uuid else "None"
        })

        # --- D. Environnement & Agent ---
        env = make_vec_env(lambda: Monitor(SnakeEnv(grid_size=grid_size, render_mode=None)), n_envs=n_envs)

        if is_finetuning:
            agent.set_env(env) # Connexion du vieux cerveau au nouveau corps
        else:
            agent = PPO("MlpPolicy", env, verbose=1)

        # Entraînement
        print(f"\n🏋️‍♂️ Démarrage de l'entraînement pour {timesteps} timesteps...")
        agent.learn(
            total_timesteps=timesteps,
            callback=MLflowLoggingCallback(),
            reset_num_timesteps=not is_finetuning # False si fine-tuning pour continuer les courbes
        )

        print("\n💾 Sauvegarde et chargement...")
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
                commit_message=f"Add {mode_label} model {new_agent_uuid}"
            )

            # Mise à jour MLflow avec liens HF
            hf_url = f"https://huggingface.co/{hf_repo_id}/tree/main/{hf_folder}"
            zip_url = f"https://huggingface.co/{hf_repo_id}/resolve/main/{hf_folder}/model.zip?download=true"

            parent_info = f"**Base Modele :** `{base_uuid}`" if base_uuid else ""

            note = textwrap.dedent(f"""\
                ### {mode_label} - Snake {grid_size}x{grid_size}

                ID : {new_agent_uuid}
                Date : {readable_date}
                {parent_info}
                Reward Finale : {final_reward if final_reward else 'N/A'}

                ---
                - [Telecharger Modele]({zip_url})
                - [Voir Fichiers]({hf_url})
                """)

            mlflow.set_tag("mlflow.note.content", note)
            mlflow.set_tag("model_url", hf_url)

            # Model registration
            model_wrapper = SnakeHFModel(repo_id=hf_repo_id, subfolder=hf_folder)
            model_info = mlflow.pyfunc.log_model(artifact_path="snake_model", python_model=model_wrapper)
            mlflow.register_model(model_uri=model_info.model_uri, name=f"Snake_{grid_size}x{grid_size}")

            print(f"✅ Terminé ! Nouveau modèle : {new_agent_uuid}")

    return agent, new_agent_uuid