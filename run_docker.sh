# Stopper les anciens containers s'ils existent
docker-compose down

# Builder l'image et lancer les services en arrière-plan
docker-compose up --build -d

# Vérifier que tout tourne
docker ps