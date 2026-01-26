import pytest
import re
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

def test_start_game_invalid_input():
    """Vérifie que le compteur ne bouge pas si l'entrée est invalide (422)."""
    # On récupère la valeur avant l'erreur
    initial_metrics = client.get("/metrics").text
    initial_count = get_metric_value(initial_metrics, "snake_games_started_total")

    # Requête invalide (string au lieu de int)
    response = client.post("/api/start", json={"grid_size": "trop_grand"})
    assert response.status_code == 422 

    # On vérifie que le compteur n'a PAS bougé
    new_metrics = client.get("/metrics").text
    new_count = get_metric_value(new_metrics, "snake_games_started_total")
    assert new_count == initial_count

def test_metrics_incrementation():
    """Vérifie que le compteur augmente précisément de 1 à chaque appel valide."""
    # 1. On récupère la valeur actuelle
    initial_res = client.get("/metrics")
    initial_val = get_metric_value(initial_res.text, "snake_games_started_total")

    # 2. On déclenche l'action
    client.post("/api/start", json={"grid_size": 10})

    # 3. On vérifie l'incrément
    new_res = client.get("/metrics")
    new_val = get_metric_value(new_res.text, "snake_games_started_total")
    
    assert new_val == initial_val + 1

def test_prometheus_format():
    """Vérifie que le format exposé est compatible avec Prometheus (Type et Help)."""
    response = client.get("/metrics")
    assert response.status_code == 200
    # Vérifie la présence des lignes de métadonnées obligatoires
    assert "# HELP snake_games_started_total" in response.text
    assert "# TYPE snake_games_started_total counter" in response.text

# --- Helper function pour extraire la valeur ---
def get_metric_value(metrics_text, metric_name):
    """Extrait la valeur numérique d'une métrique spécifique dans le texte Prometheus."""
    # Utilise une regex pour trouver la ligne qui commence par le nom de la métrique
    pattern = rf"^{metric_name}\s+(\d+\.?\d*)"
    match = re.search(pattern, metrics_text, re.MULTILINE)
    return float(match.group(1)) if match else 0.0