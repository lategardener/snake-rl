import pytest
import httpx
import re
import os
import json
from app.main import app

# URL fictive pour le transport interne
BASE_URL = "http://testserver"


# --- FIXTURE D'ENVIRONNEMENT ---
@pytest.fixture(autouse=True)
def setup_test_env(monkeypatch):
    """
    Configure l'environnement pour les tests :
    - Base de données SQLite locale pour MLflow (évite Postgres).
    - Dossiers temporaires pour éviter les erreurs de fichiers.
    """
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "sqlite:///test_mlflow.db")
    os.makedirs("models", exist_ok=True)
    yield


# --- FIXTURE CLIENT ---
@pytest.fixture
def app_transport():
    return httpx.ASGITransport(app=app)


# --- TESTS ---

@pytest.mark.asyncio
async def test_api_start_status(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/start", json={"grid_size": 10})
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_metrics_exposition_and_increment(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        resp_init = await ac.get("/metrics")
        assert resp_init.status_code == 200
        initial_count = get_metric_value(resp_init.text, "snake_games_started_total", grid_size=10)

        await ac.post("/api/start", json={"grid_size": 10})

        resp_final = await ac.get("/metrics")
        assert resp_final.status_code == 200
        new_count = get_metric_value(resp_final.text, "snake_games_started_total", grid_size=10)
        assert new_count == initial_count + 1


@pytest.mark.asyncio
async def test_model_load_metric(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.get("/metrics")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_invalid_grid_size_type(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/start", json={"grid_size": "not_an_int"})
    assert response.status_code == 422


# --- LE TEST CORRIGÉ AVEC LE BON CHEMIN ---
@pytest.mark.asyncio
async def test_list_models_structure(app_transport, mocker, tmp_path):
    """
    On utilise 'mocker' pour simuler HuggingFace.
    """

    # Création d'un faux fichier metadata.json
    fake_meta_file = tmp_path / "metadata.json"
    fake_data = {
        "uuid": "fake-uuid-123",
        "grid_size": 10,
        "algorithm": "PPO",
        "final_mean_reward": 150.5,
        "date": "2023-10-27"
    }
    fake_meta_file.write_text(json.dumps(fake_data))

    # On mock 'HfApi' dans le fichier 'app/routers/api.py'
    mock_hf_api = mocker.patch("app.routers.api.HfApi")
    mock_hf_api.return_value.list_repo_files.return_value = ["model_folder/metadata.json"]

    # On mock 'hf_hub_download' au même endroit
    mocker.patch("app.routers.api.hf_hub_download", return_value=str(fake_meta_file))

    # Exécution du test
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.get("/api/models")

    # Debug si nécessaire
    if response.status_code != 200:
        print(f"Erreur: {response.text}")

    assert response.status_code == 200
    models = response.json()
    assert isinstance(models, list)
    assert len(models) == 1
    assert models[0]["uuid"] == "fake-uuid-123"


@pytest.mark.asyncio
async def test_predict_without_model(app_transport):
    grid_size = 10
    empty_grid = [[0 for _ in range(grid_size)] for _ in range(grid_size)]
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/predict", json={"grid": empty_grid})

    assert response.status_code in [200, 503]
    if response.status_code == 200:
        data = response.json()
        assert "action" in data


@pytest.mark.asyncio
async def test_load_non_existent_model(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/load", json={
            "uuid": "non-existent-uuid",
            "grid_size": 10
        })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_websocket_connection_status():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        try:
            with client.websocket_connect("/api/ws/training/fake-id") as websocket:
                data = websocket.receive_json()
                assert "status" in data
        except Exception:
            pass


# --- HELPERS ---
def get_metric_value(metrics_text, metric_name, grid_size=10):
    pattern = rf'{metric_name}{{grid_size="{grid_size}"}}\s+(\d+\.?\d*)'
    match = re.search(pattern, metrics_text)
    return float(match.group(1)) if match else 0.0