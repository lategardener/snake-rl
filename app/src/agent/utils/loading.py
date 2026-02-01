import os
import json
from huggingface_hub import HfApi
from stable_baselines3 import PPO
from dotenv import load_dotenv
from huggingface_hub import hf_hub_download

load_dotenv()
hf_token = os.getenv("HF_HUB_TOKEN")
if not hf_token:
    raise ValueError("⚠️ Variable HF_HUB_TOKEN manquante.")



def load_snake_model_data(uuid: str, hf_repo_id: str, show_logs: bool = False):
    token = os.getenv("HF_HUB_TOKEN")
    if not token:
        print("❌ Erreur : HF_HUB_TOKEN manquant.")
        return None, None

    print(f"Scan du dépôt pour trouver l'UUID : {uuid} ...")
    api = HfApi(token=token)
    sb3_verbose = 1 if show_logs else 0

    try:
        all_files = api.list_repo_files(repo_id=hf_repo_id, repo_type="model", token=token)

        target_path = None
        for filename in all_files:
            # On cherche le fichier metadata qui contient notre UUID dans son chemin
            if uuid in filename and filename.endswith("metadata.json"):
                target_path = filename
                break

        if not target_path:
            print(f"Impossible de trouver un dossier contenant l'UUID {uuid}")
            return None, None

        print(f"Fichier trouvé : {target_path}")

        local_meta_path = hf_hub_download(
            repo_id=hf_repo_id,
            filename=target_path,
            repo_type="model",
            token=token
        )

        with open(local_meta_path, "r") as f:
            data = json.load(f)
            grid_size = data.get("grid_size")


        model_path_in_repo = target_path.replace("metadata.json", "model.zip")

        print(f"Téléchargement du modèle : {model_path_in_repo}")
        local_model_path = hf_hub_download(
            repo_id=hf_repo_id,
            filename=model_path_in_repo,
            repo_type="model",
            token=token
        )

        agent = PPO.load(local_model_path, verbose=sb3_verbose)
        print(f"✅ Succès ! Agent chargé (Grille {grid_size}x{grid_size})")

        return agent, grid_size

    except Exception as e:
        print(f" Erreur lors du scan/chargement : {e}")
        return None, None