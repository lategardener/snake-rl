import pytest
import httpx
import re

from app.main import app  # Import direct de l'application FastAPI

# On utilise une URL fictive car le transport ASGI intercepte tout localement
BASE_URL = "http://testserver"


@pytest.fixture
def app_transport():
    return httpx.ASGITransport(app=app)


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
        assert "snake_model_loaded_total" in response.text


@pytest.mark.asyncio
async def test_invalid_grid_size_type(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/start", json={"grid_size": "not_an_int"})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_list_models_structure(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.get("/api/models")

    assert response.status_code == 200
    models = response.json()
    assert isinstance(models, list)
    if len(models) > 0:
        model = models[0]
        assert "uuid" in model
        assert "grid_size" in model
        assert "algorithm" in model


@pytest.mark.asyncio
async def test_predict_without_model(app_transport):
    grid_size = 10
    empty_grid = [[0 for _ in range(grid_size)] for _ in range(grid_size)]

    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/predict", json={"grid": empty_grid})

    if response.status_code == 200:
        data = response.json()
        assert "action" in data
        assert "probabilities" in data


@pytest.mark.asyncio
async def test_load_non_existent_model(app_transport):
    async with httpx.AsyncClient(transport=app_transport, base_url=BASE_URL) as ac:
        response = await ac.post("/api/load", json={
            "uuid": "non-existent-uuid-12345",
            "grid_size": 10
        })

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_websocket_connection_status():
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        with client.websocket_connect("/api/ws/training/fake-id") as websocket:
            data = websocket.receive_json()
            assert data["status"] == "finished"


# --- Helpers ---

def get_metric_value(metrics_text, metric_name, grid_size=10):
    pattern = rf'{metric_name}{{grid_size="{grid_size}"}}\s+(\d+\.?\d*)'
    match = re.search(pattern, metrics_text)
    return float(match.group(1)) if match else 0.0