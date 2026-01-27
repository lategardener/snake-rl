const API_BASE_URL = "https://snake-rl.onrender.com"; // Mettre l'URL prod ou localhost

let selectedModel = null;
let currentSocket = null;
let activeRunId = null;

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    checkActiveTrainings();
    setInterval(checkActiveTrainings, 5000); // Poll active jobs toutes les 5s
});

// --- 1. GESTION DES MODÈLES ---
async function loadModels() {
    const container = document.getElementById('admin-model-list');
    try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();

        container.innerHTML = '';
        models.forEach(model => {
            const el = document.createElement('div');
            el.className = 'model-card';
            // Badge Mode
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

            // Interaction : Survol et Clic
            el.onmouseenter = () => showDetails(model, false);
            el.onclick = () => selectForRetrain(model, el);

            container.appendChild(el);
        });
    } catch (e) { console.error(e); }
}

// --- 2. AFFICHAGE DÉTAILS & FORMULAIRE ---
function showDetails(model, isSelected) {
    if (!isSelected && selectedModel) return; // Si un modèle est sélectionné, on ne change pas au survol

    const card = document.getElementById('model-details-card');
    card.classList.add('visible');

    document.getElementById('detail-uuid').innerText = model.uuid.substring(0, 8);
    document.getElementById('detail-grid').innerText = model.grid_size + 'x' + model.grid_size;
    document.getElementById('detail-mode').innerText = model.game_mode.toUpperCase();
    document.getElementById('detail-reward').innerText = model.reward ? model.reward.toFixed(3) : 'N/A';
    document.getElementById('detail-algo').innerText = model.algorithm;
    document.getElementById('detail-date').innerText = model.date;
}

function selectForRetrain(model, cardElement) {
    // Gestion sélection visuelle
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');
    selectedModel = model;

    showDetails(model, true);

    // Remplissage & Verrouillage du Formulaire
    document.getElementById('train-grid').value = model.grid_size;
    document.getElementById('train-grid').disabled = true; // On ne change pas la taille grille en fine-tuning

    const modeSelect = document.getElementById('train-mode');
    modeSelect.value = model.game_mode;
    modeSelect.disabled = true; // On ne change pas le mode en fine-tuning

    document.getElementById('btn-launch-train').innerText = "🚀 RETRAIN THIS MODEL";
    document.getElementById('btn-launch-train').classList.add('btn-warning');
}

function prepareNewTraining() {
    selectedModel = null;
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));

    // Reset Form
    document.getElementById('model-details-card').classList.add('visible');
    document.getElementById('detail-uuid').innerText = "NEW AGENT";
    document.getElementById('train-grid').disabled = false;
    document.getElementById('train-mode').disabled = false;
    document.getElementById('btn-launch-train').innerText = "✨ START FRESH TRAINING";
    document.getElementById('btn-launch-train').classList.remove('btn-warning');
}

// --- 3. LANCEMENT & MONITORING ---
async function launchTraining() {
    const payload = {
        timesteps: parseInt(document.getElementById('train-timesteps').value),
        n_envs: parseInt(document.getElementById('train-envs').value),
        grid_size: parseInt(document.getElementById('train-grid').value),
        game_mode: document.getElementById('train-mode').value,
        base_uuid: selectedModel ? selectedModel.uuid : null // Null = Nouveau, UUID = Retrain
    };

    try {
        const res = await fetch(`${API_BASE_URL}/api/train/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.status === 'started') {
            alert("Training Launched! ID: " + data.run_id);
            connectToUnityStream(data.run_id, payload.n_envs, payload.grid_size);
            checkActiveTrainings();
        }
    } catch (e) { alert("Error starting training"); console.error(e); }
}

// --- 4. VISUALISATION UNITY (WebSocket) ---
function connectToUnityStream(runId, nEnvs, gridSize) {
    if (currentSocket) currentSocket.close();

    activeRunId = runId;
    const container = document.getElementById('unity-container');
    container.innerHTML = ''; // Clear ancien
    document.getElementById('live-indicator').style.display = 'block';

    // Création des N canvas
    const canvases = [];
    const ctxs = [];

    for(let i=0; i<nEnvs; i++) {
        const wrap = document.createElement('div');
        wrap.innerHTML = `<span style="font-size:0.7rem; color:#888;">ENV ${i}</span>`;
        const cvs = document.createElement('canvas');
        cvs.width = 100; // Taille fixe pour la preview
        cvs.height = 100;
        cvs.className = 'env-canvas';
        wrap.appendChild(cvs);
        container.appendChild(wrap);

        canvases.push(cvs);
        ctxs.push(cvs.getContext('2d'));
    }

    // Connexion WS
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Attention : adapter l'URL si tu es en local ou prod
    // Si tu utilises Render, l'URL est API_BASE_URL mais avec wss://
    const wsUrl = API_BASE_URL.replace('http', 'ws') + `/api/ws/training/${runId}`;

    currentSocket = new WebSocket(wsUrl);

    currentSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'finished') {
            currentSocket.close();
            document.getElementById('live-indicator').style.display = 'none';
            alert("Training Finished!");
            loadModels(); // Refresh liste
            return;
        }

        // data.grids contient une liste de grilles (List[List[int]])
        // On dessine chaque grille sur son canvas
        if (data.grids && Array.isArray(data.grids)) {
            data.grids.forEach((gridData, idx) => {
                if (idx < ctxs.length) {
                    drawMiniGrid(ctxs[idx], gridData, gridSize);
                }
            });
        }
    };
}

function drawMiniGrid(ctx, grid, size) {
    const cellSize = ctx.canvas.width / size;
    ctx.fillStyle = "#000";
    ctx.fillRect(0,0, ctx.canvas.width, ctx.canvas.height);

    // grid est une matrice 2D (ou liste de listes)
    // 0=Vide, 1=Snake, 2=Food, 3=Wall
    for(let r=0; r<size; r++) {
        for(let c=0; c<size; c++) {
            const val = grid[r][c];
            if (val === 1) { ctx.fillStyle = "#00f3ff"; ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize); }
            else if (val === 2) { ctx.fillStyle = "#bc13fe"; ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize); }
            else if (val === 3) { ctx.fillStyle = "#ffffff"; ctx.fillRect(c*cellSize, r*cellSize, cellSize, cellSize); }
        }
    }
}

async function checkActiveTrainings() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();
        const list = document.getElementById('active-jobs-list');

        if (ids.length === 0) {
            list.innerHTML = "No active jobs.";
        } else {
            list.innerHTML = ids.map(id =>
                `<div style="cursor:pointer; color:var(--neon-green);" onclick="reconnect('${id}')">▶ Job ${id.substring(0,6)}...</div>`
            ).join('');
        }
    } catch(e){}
}