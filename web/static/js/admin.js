const API_BASE_URL = window.location.origin;
let activeWebSockets = {};
let activeCharts = {}; // Stocke les graphiques
let selectedModel = null;
let currentTimesteps = 50000;
let operationMode = 1;

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    syncActiveJobs();
    setInterval(syncActiveJobs, 5000); // Check nouveaux jobs toutes les 5s
    updateTimestepDisplay();
});

// --- ALERTES ---
function showAlert(title, message, type = 'info') {
    const overlay = document.getElementById('customAlertOverlay');
    document.getElementById('alertTitle').innerText = title;
    document.getElementById('alertMessage').innerHTML = message;
    const box = document.getElementById('customAlertBox');
    box.className = 'modal-box';
    if(type === 'error') box.style.borderColor = '#bc13fe';
    else box.style.borderColor = '#00f3ff';
    overlay.classList.add('active');
}
function closeCustomAlert() { document.getElementById('customAlertOverlay').classList.remove('active'); }

// --- CHARGEMENT DES MODÈLES ---
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
        // Groupement par grid_size
        const grouped = {};
        models.forEach(m => {
            if (!grouped[m.grid_size]) grouped[m.grid_size] = [];
            grouped[m.grid_size].push(m);
        });
        const gridSizes = Object.keys(grouped).map(Number).sort((a,b) => a - b);

        gridSizes.forEach(size => {
            const separator = document.createElement('div');
            separator.className = 'grid-separator';
            separator.innerHTML = `GRID SYSTEM [ ${size}x${size} ]`;
            container.appendChild(separator);

            grouped[size].sort((a, b) => (b.final_mean_reward || 0) - (a.final_mean_reward || 0));

            grouped[size].forEach(model => {
                const el = document.createElement('div');
                el.className = 'model-card';
                const isWalls = model.game_mode === 'walls';
                const badgeClass = isWalls ? 'badge-walls' : 'badge-classic';
                const badgeText = isWalls ? 'WALLS' : 'CLASSIC';
                let shortDate = model.date ? model.date.split(' ')[0] : "N/A";

                el.innerHTML = `
                    <div class="card-top">
                        <span class="${badgeClass}">${badgeText}</span>
                        <span class="algo-badge">${model.algorithm || 'PPO'}</span>
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
    } catch(e) { console.error("Load Error:", e); }
}

function selectForRetrain(model, el) {
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    selectedModel = model;
    document.getElementById('model-details-card').classList.add('visible');

    document.getElementById('detail-uuid').innerText = "AGENT: " + model.uuid;
    document.getElementById('detail-date').value = model.date || "Unknown";
    document.getElementById('detail-algo').value = model.algorithm || "PPO";
    document.getElementById('detail-grid').value = `${model.grid_size} x ${model.grid_size}`;
    document.getElementById('detail-mode').value = (model.game_mode || "CLASSIC").toUpperCase();
    document.getElementById('detail-envs').value = model.n_envs !== undefined ? model.n_envs : "4";
    document.getElementById('detail-reward').value = model.final_mean_reward !== undefined ? model.final_mean_reward.toFixed(4) : "0.0000";

    currentTimesteps = 50000;
    updateTimestepDisplay();
}

// --- CALCULATEUR ---
function setOpMode(mode) {
    operationMode = mode;
    const btnAdd = document.getElementById('btn-mode-add');
    const btnSub = document.getElementById('btn-mode-sub');
    if (mode === 1) { btnAdd.classList.add('active-add'); btnSub.classList.remove('active-sub'); }
    else { btnAdd.classList.remove('active-add'); btnSub.classList.add('active-sub'); }
}
function modifyTimesteps(amount) {
    let newValue = currentTimesteps + (amount * operationMode);
    if (newValue < 50000) newValue = 50000;
    if (newValue > 500000) newValue = 500000;
    currentTimesteps = newValue;
    updateTimestepDisplay();
}
function updateTimestepDisplay() { document.getElementById('ts-display').innerText = currentTimesteps.toLocaleString('en-US'); }

// --- GESTION DES JOBS (MONITORING) ---
async function syncActiveJobs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();
        const msg = document.getElementById('no-jobs-msg');

        if (ids.length > 0) { if(msg) msg.style.display = 'none'; }
        else { if(msg) msg.style.display = 'block'; }

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

    // STRUCTURE SPLIT (Gauche: Infos/Stop, Droite: Canvas)
    card.innerHTML = `
        <div class="job-left">
            <div>
                <div class="job-run-id">RUN: ${runId.substring(0,8)}</div>
                <div class="job-step-info">
                    STEPS: <span id="steps-${runId}" style="color:white;">0 / --</span>
                </div>
                <div class="progress-track"><div id="fill-${runId}" class="progress-fill"></div></div>
                <div id="percent-${runId}" class="progress-text">0%</div>
            </div>
            
            <button onclick="stopTraining('${runId}')" class="btn-stop">■ ABORT TRAINING</button>
        </div>
        
        <div class="job-right">
            <canvas id="chart-${runId}"></canvas>
        </div>
    `;
    container.appendChild(card);

    // Initialisation Chart.js
    const ctx = document.getElementById(`chart-${runId}`).getContext('2d');

    // Dégradé néon
    const gradient = ctx.createLinearGradient(0, 0, 0, 120);
    gradient.addColorStop(0, 'rgba(0, 243, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 243, 255, 0.0)');

    activeCharts[runId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Reward',
                data: [],
                borderColor: '#00f3ff',
                backgroundColor: gradient,
                borderWidth: 2,
                pointRadius: 0,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: { display: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888', font:{size:9} } }
            },
            animation: false
        }
    });
}

function listenToJob(runId) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${wsProtocol}//${window.location.host}/api/ws/training/${runId}`);
    activeWebSockets[runId] = socket;

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        // 1. GESTION FIN ou ANNULATION
        if (data.status === 'finished' || data.status === 'cancelled') {
            const isCancelled = data.status === 'cancelled';
            const color = isCancelled ? '#ff3333' : 'var(--neon-green)';
            const text = isCancelled ? '✖ ABORTED' : '✔ COMPLETE';

            document.getElementById(`job-card-${runId}`).innerHTML = `
                <div style="grid-column: 1 / -1; border: 1px solid ${color}; color: ${color}; padding: 15px; text-align: center; border-radius: 5px; background: rgba(0,0,0,0.2);">
                    <h3>${text}</h3>
                    <p>${isCancelled ? 'Process killed.' : 'Agent Saved.'}</p>
                </div>`;

            if(activeCharts[runId]) { activeCharts[runId].destroy(); delete activeCharts[runId]; }
            socket.close();

            setTimeout(() => {
                const card = document.getElementById(`job-card-${runId}`);
                if(card) card.remove();
                if(!isCancelled) loadModels(); // Recharge liste seulement si succès
            }, 3000);
            return;
        }

        // 2. MISE À JOUR PROGRESSION & GRAPH
        if (data.stats) {
            // Calcul précis du pourcentage
            let current = data.current_step || 0;
            let total = data.total_steps || 1;
            let percent = Math.min(100, Math.round((current / total) * 100));

            // UI Updates
            const fillEl = document.getElementById(`fill-${runId}`);
            const percentEl = document.getElementById(`percent-${runId}`);
            const stepsEl = document.getElementById(`steps-${runId}`);

            if(fillEl) fillEl.style.width = percent + "%";
            if(percentEl) percentEl.innerText = percent + "%";
            if(stepsEl) stepsEl.innerText = `${current.toLocaleString()} / ${total.toLocaleString()}`;

            // Chart Update
            if (activeCharts[runId] && data.stats.mean_reward !== undefined) {
                const chart = activeCharts[runId];
                if (chart.data.labels.length > 50) { // Max 50 points
                    chart.data.labels.shift();
                    chart.data.datasets[0].data.shift();
                }
                chart.data.labels.push("");
                chart.data.datasets[0].data.push(data.stats.mean_reward);
                chart.update();
            }
        }
    };

    socket.onclose = () => {
        delete activeWebSockets[runId];
        if(activeCharts[runId]) delete activeCharts[runId];
    };
}

// Fonction appelée par le bouton STOP
async function stopTraining(runId) {
    if(!confirm("Are you sure you want to abort this training?")) return;
    try {
        await fetch(`${API_BASE_URL}/api/train/stop/${runId}`, { method: 'DELETE' });
    } catch(e) { showAlert("Error", "Could not stop training", "error"); }
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
            showAlert("Started", `Sequence started (${currentTimesteps} steps).`, "success");
        }
    } catch(e) { showAlert("Error", "Failed to start", "error"); }
}