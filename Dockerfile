# Utilisation d'une image Python légère
FROM python:3.10-slim

# Éviter les fichiers .pyc et forcer l'affichage des logs
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Installation des dépendances système (Nécessaire pour Gym/Pygame/OpenCV)
RUN apt-get update && apt-get install -y \
    build-essential \
    libgl1 \
    libglx-mesa0 \
    libosmesa6-dev \
    freeglut3-dev \
    libglu1-mesa \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installation des dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copie du reste du code
COPY . .

# CORRECTION ICI : On expose le bon port
EXPOSE 7860

# Commande de lancement (inchangée)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]