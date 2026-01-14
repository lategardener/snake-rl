import uvicorn
import os

if __name__ == "__main__":
    # S'assure que le dossier des modèles existe
    if not os.path.exists("saved_agents"):
        os.makedirs("saved_agents")
        print("Note: N'oubliez pas de placer vos modèles .zip dans le dossier saved_agents")

    print("--- Lancement du serveur Snake AI Web ---")
    print("Accédez à l'URL : http://127.0.0.1:5000")
    
    # Lancement d'Uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=5000, reload=True)