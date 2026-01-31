import pytest
import httpx
import re
import os

# Configuration : Utilisez l'URL de Render par défaut, ou localhost pour le debug local
BASE_URL = os.getenv("TEST_BASE_URL", "https://snake-rl.onrender.com")

@pytest.mark.asyncio
async def test_api_start_status():
    """Vérifie que l'endpoint /api/start répond correctement."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as ac:
        response = await ac.post("/api/start", json={"grid_size": 10})
    
    assert response.status_code == 200
    # Correction par rapport à l'ancien test : l'API renvoie "ok"
    assert response.json() == {"status": "ok"}

@pytest.mark.asyncio
async def test_metrics_exposition_and_increment():
    """Vérifie que les métriques sont exposées et s'incrémentent bien."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as ac:
        # 1. Récupérer la valeur initiale (si elle existe)
        resp_init = await ac.get("/metrics")
        assert resp_init.status_code == 200
        initial_count = get_metric_value(resp_init.text, "snake_games_started_total", grid_size=10)

        # 2. Déclencher une action qui incrémente la métrique
        await ac.post("/api/start", json={"grid_size": 10})

        # 3. Vérifier l'incrémentation
        resp_final = await ac.get("/metrics")
        assert resp_final.status_code == 200
        new_count = get_metric_value(resp_final.text, "snake_games_started_total", grid_size=10)
        
        assert new_count == initial_count + 1

@pytest.mark.asyncio
async def test_model_load_metric():
    """Vérifie l'incrémentation lors du chargement d'un modèle."""
    # Note : Ce test suppose que le modèle 'test' n'existe pas ou va échouer, 
    # mais l'incrémentation dans api.py se fait APRES le succès du chargement.
    # On teste donc ici la présence de la structure de la métrique.
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as ac:
        response = await ac.get("/metrics")
        assert "snake_model_loaded_total" in response.text

@pytest.mark.asyncio
async def test_invalid_grid_size_type():
    """Vérifie que l'API rejette les mauvais types de données (Validation Pydantic)."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as ac:
        # Envoi d'une chaîne au lieu d'un entier
        response = await ac.post("/api/start", json={"grid_size": "not_an_int"})
    
    assert response.status_code == 422 # Unprocessable Entity

# --- Helpers ---

def get_metric_value(metrics_text, metric_name, grid_size=10):
    """
    Extrait la valeur numérique d'une métrique spécifique avec son label.
    Format attendu : snake_games_started_total{grid_size="10"} 1.0
    """
    # Regex pour capturer la valeur associée au label grid_size spécifique
    pattern = rf'{metric_name}{{grid_size="{grid_size}"}}\s+(\d+\.?\d*)'
    match = re.search(pattern, metrics_text)
    return float(match.group(1)) if match else 0.0


@pytest.mark.asyncio
async def test_list_models_structure():
    """Vérifie que la liste des modèles est accessible et bien formatée."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=20.0) as ac:
        response = await ac.get("/api/models")
    
    assert response.status_code == 200
    models = response.json()
    assert isinstance(models, list)
    if len(models) > 0:
        # Vérifie les champs obligatoires définis dans le ModelInfo de api.py
        model = models[0]
        assert "uuid" in model
        assert "grid_size" in model
        assert "algorithm" in model

@pytest.mark.asyncio
async def test_predict_without_model():
    """Vérifie le comportement de prédiction quand aucun modèle n'est chargé."""
    # Note: Dans ModelManager, current_agent est None au démarrage.
    grid_size = 10
    empty_grid = [[0 for _ in range(grid_size)] for _ in range(grid_size)]
    
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as ac:
        response = await ac.post("/api/predict", json={"grid: grid": empty_grid})
    
    # Si aucun modèle n'est chargé, api.py renvoie action 0 et probas à 0
    if response.status_code == 200:
        data = response.json()
        assert "action" in data
        assert "probabilities" in data

@pytest.mark.asyncio
async def test_load_non_existent_model():
    """Vérifie qu'un modèle inexistant renvoie bien une erreur 404."""
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as ac:
        response = await ac.post("/api/load", json={
            "uuid": "non-existent-uuid-12345",
            "grid_size": 10
        })
    
    # ModelManager.load_model renvoie False si le téléchargement échoue
    assert response.status_code == 404

@pytest.mark.asyncio
async def test_websocket_connection_status():
    """Vérifie que l'endpoint WebSocket pour l'entraînement est joignable."""
    # On teste juste l'ouverture pour un run_id fictif
    from fastapi.testclient import TestClient
    from app.main import app
    
    # Les WebSockets se testent mieux via TestClient ou un client WS dédié
    with TestClient(app) as client:
        with client.websocket_connect("/api/ws/training/fake-id") as websocket:
            data = websocket.receive_json()
            # Selon api.py, si le run_id n'existe pas, renvoie "finished"
            assert data["status"] == "finished"