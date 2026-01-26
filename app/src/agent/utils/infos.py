import os
import json
from datetime import datetime
from huggingface_hub import HfApi
from dotenv import load_dotenv
from huggingface_hub import hf_hub_download

load_dotenv()
hf_token = os.getenv("HF_HUB_TOKEN")
if not hf_token:
    raise ValueError("⚠️ Variable HF_HUB_TOKEN manquante.")



def list_snake_models(
    grid_size_filter: int = None,
    sort_by: str = "date",  
    hf_repo_id: str = "snakeRL/snake-rl-models"
):
    print(f"🔍 Recherche des modèles dans {hf_repo_id}...")
    api = HfApi(token=hf_token)

    all_files = api.list_repo_files(repo_id=hf_repo_id, repo_type="model")

    meta_files = [f for f in all_files if f.endswith("metadata.json")]

    models_data = []

    for meta_file in meta_files:
        try:
            local_path = hf_hub_download(repo_id=hf_repo_id, filename=meta_file, repo_type="model", token=hf_token)

            with open(local_path, "r") as f:
                data = json.load(f)

            model_grid = data.get("grid_size")
            if grid_size_filter is not None and model_grid != grid_size_filter:
                continue

            date_str = data.get("date", "")
            try:
                dt_object = datetime.strptime(date_str, "%d/%m/%Y %H:%M:%S")
            except ValueError:
                dt_object = datetime.min

            data["_dt_object"] = dt_object # Stocké pour le tri interne
            models_data.append(data)

        except Exception as e:
            print(f"⚠️ Erreur lecture {meta_file}: {e}")

    if sort_by == "date":
        models_data.sort(key=lambda x: x["_dt_object"], reverse=True) # Plus récent en premier
    elif sort_by == "reward":
        models_data.sort(key=lambda x: x.get("final_mean_reward") or float('-inf'), reverse=True)

    print(f"\n{' ' * 12} {'MODELE (UUID)'} {' ' * 17} || {' ' * 15} {'DESCRIPTION'}")
    print("-" * 110)

    for m in models_data:
        uuid_display = f"{m.get('grid_size'):02d}x{m.get('grid_size'):02d} / {m.get('uuid')}"

        # Construction de la description
        algo = m.get('algorithm', 'N/A')
        date = m.get('date', 'N/A')
        rew = m.get('final_mean_reward')
        rew_str = f"{rew:.2f}" if isinstance(rew, (int, float)) else "N/A"

        desc = f"Algo: {algo} | Date: {date} | Reward: {rew_str}"

        print(f"{uuid_display} || {desc}")

    print("-" * 110)
    print(f"✅ Nombre de modèles trouvés : {len(models_data)}")