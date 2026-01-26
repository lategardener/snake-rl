FROM python:3.10-slim

# Optimisations Python
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

# Installation des dépendances système (Nécessaire pour Gym/OpenCV)
# J'ai ajouté libglib2.0-0 qui manque souvent pour OpenCV sur slim
RUN apt-get update && apt-get install -y \
    build-essential \
    libgl1 \
    libglx-mesa0 \
    libosmesa6-dev \
    freeglut3-dev \
    libglu1-mesa \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Installation des dépendances Python
COPY requirements.txt .
# Le --no-cache-dir est très important pour ne pas exploser le disque de Render
RUN pip install --no-cache-dir -r requirements.txt

# Copie du code
COPY . .

# Render définit automatiquement la variable d'environnement PORT.
# Si elle n'est pas là, on utilise 10000 par défaut (standard Render).
# Note : On n'utilise pas les crochets ["..."] ici pour permettre l'expansion de la variable ${PORT}
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}

