import json
import random
from pathlib import Path
from stable_baselines3 import PPO


def load_agent(
        grid_size: int,
        agent_uuid: str | None = None,
        selection: str = "latest"
) -> tuple:
    """
    Charge un agent depuis le dossier agents.

    Args:
        grid_size: Taille de la grille (ex: 5 pour 5x5)
        agent_uuid: UUID de l'agent à charger. Si None, utilise 'selection'
        selection: 'latest' pour le dernier agent, 'random' pour un agent aléatoire

    Returns:
        tuple: (model, agent_info)

    Raises:
        FileNotFoundError: Si aucun agent n'est trouvé pour cette taille de grille
        ValueError: Si l'UUID spécifié n'existe pas ou si l'algorithme n'est pas PPO
    """
    # Trouve la racine du projet depuis src/agent/utils/agent_loader.py
    current_file = Path(__file__).resolve()
    repo_root = current_file.parent.parent.parent.parent

    # Les agents sont maintenant directement dans agent/agents/ (sans src/)
    save_dir = repo_root / "agent" / "agents" / f"{grid_size}x{grid_size}"
    metadata_file = save_dir / "agents_history.json"

    if not metadata_file.exists():
        raise FileNotFoundError(
            f"Aucun historique trouvé pour {grid_size}x{grid_size}. "
            f"Entraînez d'abord un agent avec train_snake()."
        )

    with open(metadata_file, 'r') as f:
        history = json.load(f)

    if not history["agents"]:
        raise FileNotFoundError(f"Aucun agent trouvé pour {grid_size}x{grid_size}")

    # Sélection de l'agent
    if agent_uuid:
        # Recherche par UUID (partielle ou complète)
        for agent_info in history["agents"]:
            if agent_info["uuid"] == agent_uuid or agent_info["uuid"].startswith(agent_uuid):
                return _load_agent_from_info(agent_info, repo_root)

        raise ValueError(f"Aucun agent trouvé avec l'UUID: {agent_uuid}")

    elif selection == "latest":
        agent_info = history["agents"][-1]
        return _load_agent_from_info(agent_info, repo_root)

    elif selection == "random":
        agent_info = random.choice(history["agents"])
        return _load_agent_from_info(agent_info, repo_root)

    else:
        raise ValueError(f"Selection '{selection}' invalide. Utilisez 'latest' ou 'random'.")


def _load_agent_from_info(agent_info: dict, repo_root: Path) -> tuple:
    """
    Charge un agent à partir de ses métadonnées.

    Args:
        agent_info: Dictionnaire contenant les métadonnées de l'agent
        repo_root: Chemin vers la racine du projet

    Returns:
        tuple: (model, agent_info)

    Raises:
        ValueError: Si l'algorithme n'est pas PPO
    """
    algorithm = agent_info.get("algorithm", "PPO")

    # Pour l'instant, on supporte uniquement PPO
    if algorithm != "PPO":
        raise ValueError(
            f"Algorithme '{algorithm}' non supporté. "
            f"Seul PPO est actuellement disponible."
        )

    agent_path = repo_root / agent_info["agent_path"]
    model = PPO.load(str(agent_path))

    print(f"✓ Agent chargé: {agent_info['agent_filename']}")
    print(f"  UUID: {agent_info['uuid']}")
    print(f"  Algorithme: {algorithm}")
    print(f"  Entraîné avec {agent_info['total_timesteps']:,} timesteps")

    return model, agent_info


def list_agents(grid_size: int | None = None) -> dict:
    """
    Liste tous les agents disponibles.

    Args:
        grid_size: Si spécifié, liste uniquement les agents pour cette taille de grille

    Returns:
        dict: Dictionnaire avec les agents par taille de grille
    """
    current_file = Path(__file__).resolve()
    repo_root = current_file.parent.parent.parent.parent
    agents_dir = repo_root / "agent" / "agents"

    if not agents_dir.exists():
        return {}

    all_agents = {}

    # Si grid_size est spécifié, ne cherche que celui-là
    if grid_size:
        grid_dirs = [agents_dir / f"{grid_size}x{grid_size}"]
    else:
        grid_dirs = [d for d in agents_dir.iterdir() if d.is_dir()]

    for grid_dir in grid_dirs:
        metadata_file = grid_dir / "agents_history.json"
        if metadata_file.exists():
            with open(metadata_file, 'r') as f:
                history = json.load(f)
                all_agents[history["grid_size"]] = history["agents"]

    return all_agents



def show_available_agents(grid_size: int | None = None):
    """
    Affiche tous les agents disponibles de manière formatée.

    Args:
        grid_size: Si spécifié, affiche uniquement les agents pour cette taille
    """
    agents = list_agents(grid_size=grid_size)

    if not agents:
        print("❌ Aucun agent trouvé. Entraînez-en un avec train_snake() !")
        return

    print("=" * 80)
    print("📋 AGENTS DISPONIBLES")
    print("=" * 80)

    for grid, agent_list in agents.items():
        print(f"\n🎯 Grille {grid}:")
        print("-" * 80)

        for i, agent in enumerate(agent_list, 1):
            algorithm = agent.get('algorithm', 'PPO')
            print(f"\n  [{i}] {agent['agent_filename']}")
            print(f"      UUID (court): {agent['uuid'][:8]}")
            print(f"      UUID (complet): {agent['uuid']}")
            print(f"      Algorithme: {algorithm}")
            print(f"      Timesteps: {agent['total_timesteps']:,}")
            print(f"      Environnements: {agent['n_envs']}")
            print(f"      Date: {agent['training_date']}")

    print("\n" + "=" * 80)