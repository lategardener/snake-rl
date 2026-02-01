const API_BASE_URL = window.location.origin;
let activeWebSockets = {};
let selectedModel = null;

// --- VARIABLES CALCULATEUR ---
let currentTimesteps = 50000;
let operationMode = 1; // 1 = ADD, -1 = SUBTRACT

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    syncActiveJobs();
    setInterval(syncActiveJobs, 5000);
    updateTimestepDisplay();
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

// --- 1. LISTE DES MODÈLES (Groupée par Grid Size) ---
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

        // 1. Groupement
        const grouped = {};
        models.forEach(m => {
            if (!grouped[m.grid_size]) grouped[m.grid_size] = [];
            grouped[m.grid_size].push(m);
        });

        // 2. Tri des tailles (3, 5, 10...)
        const gridSizes = Object.keys(grouped).map(Number).sort((a,b) => a - b);

        // 3. Affichage
        gridSizes.forEach(size => {
            // Création du séparateur (CSS class dans style.css)
            const separator = document.createElement('div');
            separator.className = 'grid-separator';
            separator.innerHTML = `GRID SYSTEM [ ${size}x${size} ]`;
            container.appendChild(separator);

            // Trier les modèles par Reward décroissant
            grouped[size].sort((a, b) => (b.final_mean_reward || 0) - (a.final_mean_reward || 0));

            grouped[size].forEach(model => {
                const el = document.createElement('div');
                el.className = 'model-card';

                const isWalls = model.game_mode === 'walls';
                const badgeClass = isWalls ? 'badge-walls' : 'badge-classic';
                const badgeText = isWalls ? 'WALLS' : 'CLASSIC';

                // Formatage Date
                let shortDate = "N/A";
                if(model.date) shortDate = model.date.split(' ')[0];

                el.innerHTML = `
                    <div class="card-top">
                        <span class="mode-badge ${badgeClass}">${badgeText}</span>
                        <span class="grid-badge">${model.algorithm || 'PPO'}</span>
                    </div>
                    <div class="uuid">${model.uuid}</div>
                    <div class="card-stats">
                        <span>📅 ${shortDate}</span>
                        <span style="color:${model.final_mean_reward > 0 ? 'var(--neon-green)' : '#888'}">
                            R: ${model.final_mean_reward ? model.final_mean_reward.toFixed(2) : '0.00'}
                        </span>
                    </div>
                `;
                el.onclick = () => selectForRetrain(model, el);
                container.appendChild(el);
            });
        });

    } catch(e) {
        console.error("Load Error:", e);
        document.getElementById('admin-model-list').innerHTML = '<div style="color:red; text-align:center; padding:20px;">Connection Error</div>';
    }
}

function selectForRetrain(model, el) {
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    selectedModel = model;

    const card = document.getElementById('model-details-card');
    card.classList.add('visible');

    // Remplissage Formulaire
    document.getElementById('detail-uuid').innerText = "AGENT: " + model.uuid;
    document.getElementById('detail-date').value = model.date || "Unknown";
    document.getElementById('detail-algo').value = model.algorithm || "PPO";
    document.getElementById('detail-grid').value = `${model.grid_size} x ${model.grid_size}`;
    document.getElementById('detail-mode').value = (model.game_mode || "CLASSIC").toUpperCase();
    document.getElementById('detail-envs').value = model.n_envs !== undefined ? model.n_envs : "4";

    const rewardVal = model.final_mean_reward !== undefined ? model.final_mean_reward.toFixed(4) : "0.0000";
    document.getElementById('detail-reward').value = rewardVal;

    // Reset du Calculateur à 50k
    currentTimesteps = 50000;
    updateTimestepDisplay();
}

// --- 2. CALCULATOR LOGIC ---
function setOpMode(mode) {
    operationMode = mode;
    const btnAdd = document.getElementById('btn-mode-add');
    const btnSub = document.getElementById('btn-mode-sub');

    if (mode === 1) {
        btnAdd.classList.add('active-add');
        btnSub.classList.remove('active-sub');
    } else {
        btnAdd.classList.remove('active-add');
        btnSub.classList.add('active-sub');
    }
}

function modifyTimesteps(amount) {
    let newValue = currentTimesteps + (amount * operationMode);

    // Contraintes strictes : Min 50k, Max 500k
    if (newValue < 50000) newValue = 50000;
    if (newValue > 500000) newValue = 500000;

    currentTimesteps = newValue;
    updateTimestepDisplay();
}

function updateTimestepDisplay() {
    document.getElementById('ts-display').innerText = currentTimesteps.toLocaleString('en-US');
}

// --- 3. JOB MONITORING ---
async function syncActiveJobs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();
        const msg = document.getElementById('no-jobs-msg');

        if (ids.length > 0) {
            if(msg) msg.style.display = 'none';
        } else {
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
                <div style="border: 1px solid var(--neon-green); color: var(--neon-green); padding: 10px; text-align: center; border-radius: 5px; background: rgba(0,255,0,0.05);">
                    <h3>✔ TRAINING COMPLETE</h3>
                    <p>Agent Saved.</p>
                </div>`;
            socket.close();
            setTimeout(() => {
                const card = document.getElementById(`job-card-${runId}`);
                if(card) card.remove();
                loadModels(); // Refresh list
            }, 3000);
        } else if (data.progress !== undefined) {
            const p = Math.round(data.progress * 100);
            document.getElementById(`fill-${runId}`).style.width = p + "%";
            document.getElementById(`percent-${runId}`).innerText = p + "%";
            document.getElementById(`status-${runId}`).innerText = "Optimizing...";
            if(data.stats && data.stats.mean_reward) {
                document.getElementById(`reward-${runId}`).innerText = "R: " + data.stats.mean_reward.toFixed(2);
            }
        }
    };
    socket.onclose = () => delete activeWebSockets[runId];
}

async function launchTraining() {
    if (!selectedModel) return showAlert("Error", "Select model first", "error");

    const payload = {
        timesteps: currentTimesteps,
        n_envs: selectedModel.n_envs || 4,
        grid_size: selectedModel.grid_size,
        game_mode: selectedModel.game_mode,
        base_uuid: selectedModel.uuid
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
            showAlert("Started", `Training started for ${currentTimesteps} steps.`, "success");
        }
    } catch(e) { showAlert("Error", "Failed to start", "error"); }
}