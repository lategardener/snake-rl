import pytest
from fastapi.testclient import TestClient
from app.main import app

# On crée le client une seule fois
client = TestClient(app)

def test_start_game_metric():
    """Vérifie que l'endpoint de métrique répond bien."""
    response = client.post("/api/start", json={"grid_size": 10})
    assert response.status_code == 200
    assert response.json()["status"] == "metric_updated"

def test_metrics_presence():
    """Vérifie que la métrique personnalisée est présente dans le flux Prometheus."""
    # On simule un départ de partie pour être sûr que la métrique existe
    client.post("/api/start", json={"grid_size": 15})
    
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "snake_games_started_total" in response.text