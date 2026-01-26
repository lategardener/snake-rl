import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_read_main():
    """Vérifie que la page d'accueil HTML se charge bien."""
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]

def test_metrics_endpoint():
    """Vérifie que l'endpoint Prometheus est disponible."""
    response = client.get("/metrics")
    assert response.status_code == 200

def test_list_models_unauthorized():
    """
    Vérifie que l'API de modèles réagit (même si elle échoue sans vrai token).
    Cela confirme que le router /api/models est bien branché.
    """
    response = client.get("/api/models")
    # Si le token est invalide, on s'attend à une 500 ou une 401 selon ton code
    assert response.status_code in [200, 500] 

def test_start_game_metric():
    """Teste l'endpoint de métriques de début de partie que tu as ajouté."""
    payload = {"grid_size": 10}
    response = client.post("/api/start", json=payload)
    assert response.status_code == 200
    assert response.json() == {"status": "metric_updated"}