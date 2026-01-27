const API_BASE_URL = window.location.origin;
let activeWebSockets = {};
let selectedModel = null;

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    syncActiveJobs();
    setInterval(syncActiveJobs, 5000);
});

// --- ALERTES ---
function showAlert(title, message, type = 'info') {
    const overlay = document.getElementById('customAlertOverlay');
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerHTML = message;
    const box = document.getElementById('customAlertBox');
    box.className = 'modal-box ' + type;
    overlay.classList.add('active');
}
function closeCustomAlert() { document.getElementById('customAlertOverlay').classList.remove('active'); }

// --- LISTE DES MODÈLES ---
async function loadModels() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();
        const container = document.getElementById('admin-model-list');
        container.innerHTML = '';
        models.forEach(model => {
            const el = document.createElement('div');
            el.className = 'model-card';
            const badge = model.game_mode === 'walls' ? '<span class="mode-badge badge-walls">WALLS</span>' : '<span class="mode-badge badge-classic">CLASSIC</span>';
            el.innerHTML = `<div class="card-top"><span class="grid-badge">${model.grid_size}x${model.grid_size}</span>${badge}</div><div class="uuid">${model.uuid.substring(0,12)}...</div>`;
            el.onclick = () => selectForRetrain(model, el);
            container.appendChild(el);
        });
    } catch(e) {}
}

function selectForRetrain(model, el) {
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    selectedModel = model;

    const card = document.getElementById('model-details-card');
    card.classList.add('visible');
    document.getElementById('detail-uuid').innerText = "AGENT: " + model.uuid.substring(0,8);
    document.getElementById('train-grid').value = `${model.grid_size} x ${model.grid_size}`;
    document.getElementById('train-mode-text').value = model.game_mode.toUpperCase();
    document.getElementById('train-mode').value = model.game_mode;
    document.getElementById('train-envs').value = "4 Parallel Envs";
}

// --- BARRES DE PROGRESSION ---
async function syncActiveJobs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();

        // Nettoyage message "No jobs"
        if (ids.length > 0) {
            const msg = document.getElementById('no-jobs-msg');
            if(msg) msg.style.display = 'none';
        }

        ids.forEach(runId => {
            if (!activeWebSockets[runId]) {
                createJobCard(runId);
                listenToJob(runId);
            }
        });
    } catch(e) {}
}

function createJobCard(runId) {
    const container = document.getElementById('jobs-progress-container');
    if (document.getElementById(`job-card-${runId}`)) return;

    const card = document.createElement('div');
    card.id = `job-card-${runId}`;
    card.className = 'job-progress-card';
    card.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
            <span style="color:var(--neon-blue); font-family:var(--font-display);">RUN: ${runId.substring(0,8)}</span>
            <span id="percent-${runId}" style="color:var(--neon-green);">0%</span>
        </div>
        <div class="progress-track"><div id="fill-${runId}" class="progress-fill"></div></div>
        <div style="display:flex; justify-content:space-between; margin-top:10px; font-size:0.8rem; color:#aaa;">
            <span id="reward-${runId}">Reward: --</span>
            <span id="status-${runId}">Starting...</span>
        </div>
    `;
    container.appendChild(card);
}

function listenToJob(runId) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${wsProtocol}//${window.location.host}/api/ws/training/${runId}`);
    activeWebSockets[runId] = socket;

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'finished') {
            document.getElementById(`job-card-${runId}`).innerHTML = `
                <div class="training-complete-banner">
                    <h3>✔ TRAINING COMPLETE</h3>
                    <p>Agent ${runId.substring(0,8)} saved.</p>
                </div>`;
            socket.close();
            setTimeout(() => {
                const card = document.getElementById(`job-card-${runId}`);
                if(card) card.remove();
                loadModels();
            }, 5000);
        } else if (data.progress !== undefined) {
            const p = Math.round(data.progress * 100);
            document.getElementById(`fill-${runId}`).style.width = p + "%";
            document.getElementById(`percent-${runId}`).innerText = p + "%";
            document.getElementById(`status-${runId}`).innerText = "Computing...";
            if(data.stats && data.stats.mean_reward) {
                document.getElementById(`reward-${runId}`).innerText = "Reward: " + data.stats.mean_reward.toFixed(2);
            }
        }
    };
    socket.onclose = () => delete activeWebSockets[runId];
}

async function launchTraining() {
    if (!selectedModel) return showAlert("Error", "Select model first", "error");

    const payload = {
        timesteps: parseInt(document.getElementById('train-timesteps').value),
        n_envs: 4, grid_size: selectedModel.grid_size,
        game_mode: selectedModel.game_mode, base_uuid: selectedModel.uuid
    };

    try {
        const res = await fetch(`${API_BASE_URL}/api/train/start`, {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(data.run_id) {
            createJobCard(data.run_id);
            listenToJob(data.run_id);
            showAlert("Started", "Training initiated.", "success");
        }
    } catch(e) { showAlert("Error", "Failed to start", "error"); }
}