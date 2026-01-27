const API_BASE_URL = window.location.origin;
let selectedModel = null;
let currentSocket = null;
let activeRunId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    checkActiveTrainings();
    setInterval(checkActiveTrainings, 5000);
});

// --- SYSTÈME DE POP-UP ---
function showAlert(title, message, type = 'info') {
    const overlay = document.getElementById('customAlertOverlay');
    const box = document.getElementById('customAlertBox');
    const titleEl = document.getElementById('alertTitle');
    const msgEl = document.getElementById('alertMessage');

    box.classList.remove('success', 'error');
    if (type === 'success') box.classList.add('success');
    if (type === 'error') box.classList.add('error');

    titleEl.innerText = title;
    msgEl.innerHTML = message;
    overlay.classList.add('active');
}

function closeCustomAlert() {
    document.getElementById('customAlertOverlay').classList.remove('active');
}

// --- GESTION DES MODÈLES ---
async function loadModels() {
    const container = document.getElementById('admin-model-list');
    try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();
        container.innerHTML = '';
        models.forEach(model => {
            const el = document.createElement('div');
            el.className = 'model-card';
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
            el.onmouseenter = () => showDetails(model, false);
            el.onclick = () => selectForRetrain(model, el);
            container.appendChild(el);
        });
    } catch (e) { console.error(e); }
}

function showDetails(model, isSelected) {
    if (!isSelected && selectedModel) return;
    const card = document.getElementById('model-details-card');
    card.classList.add('visible');
    document.getElementById('detail-uuid').innerText = "AGENT: " + model.uuid.substring(0, 8);
}

function selectForRetrain(model, cardElement) {
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');
    selectedModel = model;
    showDetails(model, true);

    document.getElementById('train-grid').value = `${model.grid_size} x ${model.grid_size}`;
    document.getElementById('train-mode-text').value = model.game_mode.toUpperCase();
    document.getElementById('train-mode').value = model.game_mode;
    document.getElementById('train-envs').value = (model.n_envs || 4) + " Parallel Envs";

    const launchBtn = document.getElementById('btn-launch-train');
    launchBtn.innerText = "🚀 START RETRAINING";
}

// --- LANCEMENT ENTRAÎNEMENT ---
async function launchTraining() {
    if (!selectedModel) {
        showAlert("NO SELECTION", "Please select a model first.", "error");
        return;
    }

    const payload = {
        timesteps: parseInt(document.getElementById('train-timesteps').value),
        n_envs: 4, // Fixé à 4 pour la grille 2x2
        grid_size: parseInt(selectedModel.grid_size),
        game_mode: document.getElementById('train-mode').value,
        base_uuid: selectedModel.uuid
    };

    try {
        const btn = document.getElementById('btn-launch-train');
        btn.innerText = "⏳ INITIATING...";

        const res = await fetch(`${API_BASE_URL}/api/train/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.run_id) {
            showAlert("TRAINING INITIATED", `Run ID: ${data.run_id.substring(0,8)}`, "success");
            connectToUnityStream(data.run_id, 4, payload.grid_size);
            checkActiveTrainings();
            btn.innerText = "🚀 START RETRAINING";
        }
    } catch (e) {
        showAlert("SYSTEM ERROR", "Failed to start training.", "error");
    }
}

// --- VISUALISATION MULTI-ENV ---
function connectToUnityStream(runId, nEnvs, gridSize) {
    if (currentSocket) currentSocket.close();

    activeRunId = runId;
    const container = document.getElementById('unity-container');
    container.innerHTML = '';
    document.getElementById('live-indicator').style.display = 'block';

    const ctxs = [];

    // On crée exactement le nombre d'environnements prévus
    for(let i=0; i < nEnvs; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'env-wrapper';
        wrap.innerHTML = `<span class="env-label">ENV ${i}</span>`;

        const cvs = document.createElement('canvas');
        cvs.width = 300;
        cvs.height = 300;
        cvs.className = 'env-canvas';

        wrap.appendChild(cvs);
        container.appendChild(wrap);
        ctxs.push(cvs.getContext('2d'));
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/training/${runId}`;

    currentSocket = new WebSocket(wsUrl);

    currentSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // 1. Gestion des erreurs envoyées par le serveur
        if (data.stats && data.stats.status === 'error') {
            currentSocket.close();
            showAlert("TRAINING FAILED", data.stats.message, "error");
            return;
        }

        // 2. Bannière de fin
        if (data.status === 'finished') {
            currentSocket.close();
            document.getElementById('live-indicator').style.display = 'none';

            const banner = document.createElement('div');
            banner.className = 'training-overlay';
            banner.innerHTML = '<h2>TRAINING COMPLETE</h2>';
            container.appendChild(banner);

            showAlert("MISSION ACCOMPLISHED", "Model updated and stored successfully.", "success");
            loadModels();
            return;
        }

        // 3. Dessin des grilles (Correction de la condensation)
        if (data.grids && Array.isArray(data.grids)) {
            data.grids.forEach((envData, idx) => {
                // On s'assure de dessiner dans le bon canvas par index
                if (idx < ctxs.length) {
                    const grid = envData.grid ? envData.grid : envData;
                    drawNeonGrid(ctxs[idx], grid, gridSize);
                }
            });
        }
    };
}

// --- MOTEUR DE RENDU NÉON ---
function drawNeonGrid(ctx, grid, size) {
    const width = ctx.canvas.width;
    const cellSize = width / size;

    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, width, width);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<=size; i++) {
        ctx.beginPath();
        ctx.moveTo(i*cellSize, 0); ctx.lineTo(i*cellSize, width);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i*cellSize); ctx.lineTo(width, i*cellSize);
        ctx.stroke();
    }

    if(!grid || !Array.isArray(grid)) return;

    for(let r=0; r<size; r++) {
        for(let c=0; c<size; c++) {
            const val = grid[r][c];
            if (val === 0) continue;

            if (val === 1) { ctx.shadowBlur = 15; ctx.shadowColor = "#00f3ff"; ctx.fillStyle = "#00f3ff"; }
            else if (val === 2) { ctx.shadowBlur = 15; ctx.shadowColor = "#bc13fe"; ctx.fillStyle = "#bc13fe"; }
            else if (val === 3) { ctx.shadowBlur = 10; ctx.shadowColor = "#ffffff"; ctx.fillStyle = "#ffffff"; }

            ctx.fillRect(c*cellSize + 1, r*cellSize + 1, cellSize - 2, cellSize - 2);
            ctx.shadowBlur = 0;
        }
    }
}

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
    } catch(e) {}
}