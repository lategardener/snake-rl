const API_BASE_URL = window.location.origin;
let selectedModel = null;
let currentSocket = null;
let activeRunId = null;

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    checkActiveTrainings();
    setInterval(checkActiveTrainings, 5000);
});

// --- NOUVEAU SYSTÈME DE POP-UP ---
function showAlert(title, message, type = 'info') {
    const overlay = document.getElementById('customAlertOverlay');
    const box = document.getElementById('customAlertBox');
    const titleEl = document.getElementById('alertTitle');
    const msgEl = document.getElementById('alertMessage');

    // Reset classes
    box.classList.remove('success', 'error');

    if (type === 'success') box.classList.add('success');
    if (type === 'error') box.classList.add('error');

    titleEl.innerText = title;
    msgEl.innerHTML = message; // innerHTML permet de mettre des <br> ou <b>

    overlay.classList.add('active');
}

function closeCustomAlert() {
    document.getElementById('customAlertOverlay').classList.remove('active');
}
// ----------------------------------


// ... (loadModels et showDetails restent identiques) ...
async function loadModels() { /* ... Code existant ... */
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
    launchBtn.classList.add('btn-warning');
}

// --- MODIFICATION ICI : On remplace alert() par showAlert() ---
async function launchTraining() {
    if (!selectedModel) {
        showAlert("NO SELECTION", "Please select a model from the list first.", "error");
        return;
    }

    const payload = {
        timesteps: parseInt(document.getElementById('train-timesteps').value),
        n_envs: parseInt(selectedModel.n_envs || 4),
        grid_size: parseInt(selectedModel.grid_size),
        game_mode: document.getElementById('train-mode').value,
        base_uuid: selectedModel.uuid
    };

    try {
        // Petit feedback visuel immédiat
        const btn = document.getElementById('btn-launch-train');
        btn.innerText = "⏳ INITIATING...";

        const res = await fetch(`${API_BASE_URL}/api/train/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.run_id) {
            // Popup Stylée SUCCÈS
            showAlert(
                "TRAINING INITIATED",
                `Run ID: <span style="color:var(--neon-blue)">${data.run_id.substring(0,8)}</span><br>Process started in background.`,
                "success"
            );

            connectToUnityStream(data.run_id, payload.n_envs, payload.grid_size);
            checkActiveTrainings();

            btn.innerText = "🚀 START RETRAINING"; // Reset bouton
        }
    } catch (e) {
        showAlert("SYSTEM ERROR", "Failed to start training.<br>Check server logs.", "error");
        console.error(e);
    }
}

function connectToUnityStream(runId, nEnvs, gridSize) {
    if (currentSocket) currentSocket.close();

    activeRunId = runId;
    const container = document.getElementById('unity-container');
    container.innerHTML = '';
    document.getElementById('live-indicator').style.display = 'block';

    const ctxs = [];

    for(let i=0; i<nEnvs; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'env-wrapper';

        const label = document.createElement('span');
        label.className = 'env-label';
        label.innerText = `ENV ${i}`;

        const cvs = document.createElement('canvas');
        cvs.width = 100; cvs.height = 100;
        cvs.className = 'env-canvas';

        wrap.appendChild(label);
        wrap.appendChild(cvs);
        container.appendChild(wrap);
        ctxs.push(cvs.getContext('2d'));
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/training/${runId}`;

    currentSocket = new WebSocket(wsUrl);

    currentSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'finished') {
            currentSocket.close();
            document.getElementById('live-indicator').style.display = 'none';

            // Popup Stylée FIN
            showAlert(
                "MISSION ACCOMPLISHED",
                "Training cycle completed successfully.<br>Model has been uploaded to Hugging Face.",
                "success"
            );

            loadModels();
            return;
        }

        if (data.grids && Array.isArray(data.grids)) {
            data.grids.forEach((gridData, idx) => {
                if (idx < ctxs.length) {
                    drawMiniGrid(ctxs[idx], gridData.grid, gridSize); // .grid car l'objet contient {grid: [...], reward: ...}
                }
            });
        }
    };
}

function drawMiniGrid(ctx, grid, size) {
    const cellSize = ctx.canvas.width / size;
    ctx.fillStyle = "#050510";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    if(!grid) return;

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

        if (!ids || ids.length === 0) {
            list.innerHTML = "No training jobs currently active.";
        } else {
            list.innerHTML = ids.map(id =>
                `<div style="cursor:pointer; color:var(--neon-green); margin-bottom:5px;" onclick="connectToUnityStream('${id}', 4, 10)">
                    ▶ Monitoring Job: ${id.substring(0,8)}...
                </div>`
            ).join('');
        }
    } catch(e) { console.error("Erreur check jobs:", e); }
}