// Utilisation dynamique de l'URL du serveur actuel
const API_BASE_URL = window.location.origin;

let selectedModel = null;
let currentSocket = null;
let activeRunId = null;

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    checkActiveTrainings();
    // Poll active jobs toutes les 5s pour mettre à jour la liste des entraînements en cours
    setInterval(checkActiveTrainings, 5000);
});

// --- 1. GESTION DES MODÈLES (AFFICHAGE) ---
async function loadModels() {
    const container = document.getElementById('admin-model-list');
    try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();

        container.innerHTML = '';
        models.forEach(model => {
            const el = document.createElement('div');
            el.className = 'model-card';

            // Badge de mode (Classic ou Walls)
            const modeBadge = model.game_mode === 'walls'
                ? '<span class="mode-badge badge-walls">WALLS</span>'
                : '<span class="mode-badge badge-classic">CLASSIC</span>';

            el.innerHTML = `
                <div class="card-top">
                    <span class="grid-badge">${model.grid_size}x${model.grid_size}</span>
                    ${modeBadge}
                </div>
                <div class="uuid">${model.uuid.substring(0, 12)}...</div>
            `;

            // Interaction : Survol pour les détails, Clic pour sélectionner le réentraînement
            el.onmouseenter = () => showDetails(model, false);
            el.onclick = () => selectForRetrain(model, el);

            container.appendChild(el);
        });
    } catch (e) { console.error("Erreur lors du chargement des modèles:", e); }
}

// --- 2. AFFICHAGE DES DÉTAILS DANS L'INSPECTEUR ---
function showDetails(model, isSelected) {
    // Si un modèle est déjà cliqué/sélectionné, on ignore le survol des autres
    if (!isSelected && selectedModel) return;

    const card = document.getElementById('model-details-card');
    card.classList.add('visible');

    // Mise à jour des informations textuelles
    document.getElementById('detail-uuid').innerText = "AGENT: " + model.uuid.substring(0, 8);

    // On peut aussi mettre à jour les labels de récompense si besoin
    if (document.getElementById('detail-grid')) document.getElementById('detail-grid').innerText = model.grid_size + 'x' + model.grid_size;
    if (document.getElementById('detail-mode')) document.getElementById('detail-mode').innerText = model.game_mode.toUpperCase();
}

// --- 3. SÉLECTION POUR RÉENTRAÎNEMENT (VERROUILLAGE) ---
function selectForRetrain(model, cardElement) {
    // Gestion visuelle de la sélection dans la liste
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');

    selectedModel = model;
    showDetails(model, true);

    // Remplissage des champs de formulaire (Verrouillés dans l'HTML)
    // On remplit les inputs readonly pour que l'utilisateur voit ce qu'il va réentraîner
    document.getElementById('train-grid').value = `${model.grid_size} x ${model.grid_size}`;

    // On remplit le texte affiché et la valeur cachée pour le mode
    document.getElementById('train-mode-text').value = model.game_mode.toUpperCase();
    document.getElementById('train-mode').value = model.game_mode;

    // On fixe le nombre d'environnements basé sur le modèle parent
    document.getElementById('train-envs').value = (model.n_envs || 4) + " Parallel Envs";

    // On s'assure que le bouton est prêt
    const launchBtn = document.getElementById('btn-launch-train');
    launchBtn.innerText = "🚀 START RETRAINING";
    launchBtn.classList.add('btn-warning');
}

// --- 4. LANCEMENT DU JOB D'ENTRAÎNEMENT ---
async function launchTraining() {
    if (!selectedModel) {
        alert("Please select a model from the list first.");
        return;
    }

    // Le seul champ modifiable par l'utilisateur est 'train-timesteps'
    const payload = {
        timesteps: parseInt(document.getElementById('train-timesteps').value),
        n_envs: parseInt(selectedModel.n_envs || 4), // Paramètre fixe
        grid_size: parseInt(selectedModel.grid_size), // Paramètre fixe
        game_mode: document.getElementById('train-mode').value, // Paramètre fixe
        base_uuid: selectedModel.uuid // L'ID du modèle à réentraîner
    };

    try {
        const res = await fetch(`${API_BASE_URL}/api/train/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.run_id) {
            alert("Training process started! Run ID: " + data.run_id);
            // On connecte immédiatement le flux "Unity-style"
            connectToUnityStream(data.run_id, payload.n_envs, payload.grid_size);
            checkActiveTrainings();
        }
    } catch (e) {
        alert("Failed to start training. Check server logs.");
        console.error(e);
    }
}

// --- 5. VISUALISATION TEMPS RÉEL (UNITY-STYLE) ---
function connectToUnityStream(runId, nEnvs, gridSize) {
    if (currentSocket) currentSocket.close();

    activeRunId = runId;
    const container = document.getElementById('unity-container');
    container.innerHTML = ''; // Nettoyage de la grille de visualisation
    document.getElementById('live-indicator').style.display = 'block';

    const ctxs = [];

    // Création dynamique des canvas pour chaque environnement parallèle
    for(let i=0; i<nEnvs; i++) {
        const wrap = document.createElement('div');
        wrap.style.textAlign = "center";
        wrap.innerHTML = `<span style="font-size:0.7rem; color:#888;">ENV ${i}</span>`;

        const cvs = document.createElement('canvas');
        cvs.width = 120; // Taille miniature pour le monitoring
        cvs.height = 120;
        cvs.className = 'env-canvas';

        wrap.appendChild(cvs);
        container.appendChild(wrap);
        ctxs.push(cvs.getContext('2d'));
    }

    // Initialisation du WebSocket pour le streaming des grilles
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/training/${runId}`;

    currentSocket = new WebSocket(wsUrl);

    currentSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'finished') {
            currentSocket.close();
            document.getElementById('live-indicator').style.display = 'none';
            alert("Training Job " + runId.substring(0,8) + " completed!");
            loadModels(); // Rafraîchir la liste pour voir le nouveau modèle
            return;
        }

        // Dessiner chaque grille reçue sur son canvas correspondant
        if (data.grids && Array.isArray(data.grids)) {
            data.grids.forEach((gridData, idx) => {
                if (idx < ctxs.length) {
                    drawMiniGrid(ctxs[idx], gridData.grid, gridSize);
                }
            });
        }
    };
}

// Fonction utilitaire de dessin pour les miniatures
function drawMiniGrid(ctx, grid, size) {
    const cellSize = ctx.canvas.width / size;
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for(let r=0; r<size; r++) {
        for(let c=0; c<size; c++) {
            const val = grid[r][c];
            if (val === 1) { // Snake
                ctx.fillStyle = "#00f3ff";
                ctx.fillRect(c*cellSize, r*cellSize, cellSize-1, cellSize-1);
            } else if (val === 2) { // Food
                ctx.fillStyle = "#bc13fe";
                ctx.fillRect(c*cellSize, r*cellSize, cellSize-1, cellSize-1);
            } else if (val === 3) { // Wall
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(c*cellSize, r*cellSize, cellSize-1, cellSize-1);
            }
        }
    }
}

// --- 6. VÉRIFICATION DES JOBS ACTIFS ---
async function checkActiveTrainings() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();
        const list = document.getElementById('active-jobs-list');

        if (!ids || ids.length === 0) {
            list.innerHTML = "No training jobs currently active.";
        } else {
            list.innerHTML = ids.map(id =>
                `<div style="cursor:pointer; color:var(--neon-green); margin-bottom:5px;" onclick="connectToUnityStream('${id}', 4, 10)">
                    ▶ Monitoring Job: ${id.substring(0,8)}...
                </div>`
            ).join('');
        }
    } catch(e) { console.error("Erreur lors de la vérification des jobs:", e); }
}