FROM python:3.10-slim

# Optimisations Python
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1
# Force Pygame à fonctionner sans écran (Headless)
ENV SDL_VIDEODRIVER=dummy

# Installation des dépendances système
# Ajout des librairies SDL pour Pygame
RUN apt-get update && apt-get install -y \
    build-essential \
    libgl1-mesa-dev \
    libglib2.0-0 \
    libsdl2-dev \
    libsdl2-image-dev \
    libsdl2-mixer-dev \
    libsdl2-ttf-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ÉTAPE CRITIQUE : Installer les dépendances AVANT de copier le reste du code
# Cela permet de mettre en cache l'installation lourde (Torch, MLflow, Pygame)
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copie du reste du projet
COPY . .

# Commande de démarrage
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}