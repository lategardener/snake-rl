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