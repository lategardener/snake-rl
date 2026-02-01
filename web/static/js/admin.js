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

        if(models.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">No models found in repository.</div>';
            return;
        }

        models.forEach(model => {
            const el = document.createElement('div');
            el.className = 'model-card';
            // Badge visuel pour le mode
            const badgeClass = model.game_mode === 'walls' ? 'badge-walls' : 'badge-classic';
            const badgeText = model.game_mode === 'walls' ? 'WALLS' : 'CLASSIC';

            el.innerHTML = `
                <div class="card-top">
                    <span class="grid-badge">${model.grid_size}x${model.grid_size}</span>
                    <span class="mode-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="uuid">${model.uuid.substring(0,12)}...</div>
                <div style="font-size:0.7rem; color:#888; margin-top:5px;">
                    R: ${model.final_mean_reward ? model.final_mean_reward.toFixed(2) : 'N/A'} | ${model.algorithm || 'PPO'}
                </div>
            `;
            el.onclick = () => selectForRetrain(model, el);
            container.appendChild(el);
        });
    } catch(e) {
        console.error("Load Error:", e);
    }
}

function selectForRetrain(model, el) {
    // Gestion de la sélection visuelle
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    selectedModel = model;

    const card = document.getElementById('model-details-card');
    card.classList.add('visible');

    // Remplissage des données JSON verrouillées
    document.getElementById('detail-uuid').innerText = "AGENT: " + model.uuid;
    document.getElementById('detail-date').value = model.date || "Unknown";
    document.getElementById('detail-algo').value = model.algorithm || "PPO";
    document.getElementById('detail-grid').value = `${model.grid_size} x ${model.grid_size}`;
    document.getElementById('detail-mode').value = model.game_mode.toUpperCase();
    document.getElementById('detail-envs').value = model.n_envs;

    const rewardVal = model.final_mean_reward !== undefined ? model.final_mean_reward.toFixed(4) : "0.0000";
    document.getElementById('detail-reward').value = rewardVal;

    // Reset du champ editable (Timesteps)
    // On met 50k par défaut, mais on peut imaginer reprendre une valeur précédente si besoin
    document.getElementById('train-timesteps').value = 50000;
}

// --- BARRES DE PROGRESSION (Jobs) ---
async function syncActiveJobs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();

        if (ids.length > 0) {
            const msg = document.getElementById('no-jobs-msg');
            if(msg) msg.style.display = 'none';
        } else {
            const msg = document.getElementById('no-jobs-msg');
            if(msg) msg.style.display = 'block';
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
                    <p>Agent Saved.</p>
                </div>`;
            socket.close();
            // Rafraichir la liste après 3 secondes pour voir le nouveau modèle
            setTimeout(() => {
                const card = document.getElementById(`job-card-${runId}`);
                if(card) card.remove();
                loadModels();
            }, 3000);
        } else if (data.progress !== undefined) {
            const p = Math.round(data.progress * 100);
            document.getElementById(`fill-${runId}`).style.width = p + "%";
            document.getElementById(`percent-${runId}`).innerText = p + "%";
            document.getElementById(`status-${runId}`).innerText = "Optimizing...";
            if(data.stats && data.stats.mean_reward) {
                document.getElementById(`reward-${runId}`).innerText = "Reward: " + data.stats.mean_reward.toFixed(2);
            }
        }
    };

    socket.onerror = () => {
        console.error("WS Error for", runId);
        socket.close();
    };
    socket.onclose = () => delete activeWebSockets[runId];
}

async function launchTraining() {
    if (!selectedModel) return showAlert("System Error", "Please select a model from the repository first.", "error");

    const tsInput = document.getElementById('train-timesteps');
    let timesteps = parseInt(tsInput.value);

    // Validation Min/Max
    if (timesteps < 20000) {
        showAlert("Invalid Config", "Timesteps must be at least 20,000.", "error");
        tsInput.value = 20000;
        return;
    }
    if (timesteps > 500000) {
        showAlert("Invalid Config", "Timesteps cannot exceed 500,000.", "error");
        tsInput.value = 500000;
        return;
    }

    const payload = {
        timesteps: timesteps,
        n_envs: selectedModel.n_envs, // Repris du modèle JSON
        grid_size: selectedModel.grid_size, // Repris du modèle JSON
        game_mode: selectedModel.game_mode, // Repris du modèle JSON
        base_uuid: selectedModel.uuid
    };

    try {
        const res = await fetch(`${API_BASE_URL}/api/train/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error("API Limit or Error");

        const data = await res.json();
        if(data.run_id) {
            createJobCard(data.run_id);
            listenToJob(data.run_id);
            showAlert("Sequence Initiated", `Retraining started for ${timesteps} steps.`, "success");
        }
    } catch(e) {
        showAlert("Connection Failed", "Could not start training sequence.", "error");
    }
}