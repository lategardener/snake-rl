from typing import Any, List, Dict

import mlflow.pyfunc
import numpy as np


class SnakeHFModel(mlflow.pyfunc.PythonModel):
    """
    Classe Wrapper qui permet à MLflow de savoir comment charger et utiliser
    ton modèle stocké sur Hugging Face.
    """
    def __init__(self, repo_id: str, subfolder: str):
        # On sauvegarde les infos pour retrouver le modèle plus tard
        self.repo_id = repo_id
        self.subfolder = subfolder
        self.model = None

    def load_context(self, context):
        # Cette méthode est exécutée quand on charge le modèle via mlflow.pyfunc.load_model()
        from huggingface_hub import hf_hub_download
        from stable_baselines3 import PPO

        print(f"📥 Chargement du contexte modèle depuis {self.repo_id}...")

        # Téléchargement du fichier physique
        model_path = hf_hub_download(
            repo_id=self.repo_id,
            filename=f"{self.subfolder}/model.zip"
        )

        # Chargement en mémoire
        self.model = PPO.load(model_path)

    def predict(self, context, model_input: np.ndarray, params: Dict[str, Any] = None):
        """
        Prédiction avec signature typée pour calmer MLflow.
        """
        action, _ = self.model.predict(model_input)
        return action