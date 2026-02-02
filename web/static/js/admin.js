const API_BASE_URL = window.location.origin;
let activeWebSockets = {};
let activeCharts = {};
let selectedModel = null;

// --- CONFIGURATION TIMESTEPS (5k - 100k) ---
let currentTimesteps = 20000; // Valeur par défaut
let operationMode = 1;
// Liste pour empêcher la réapparition des jobs qu'on vient de finir/stopper
const ignoredJobs = new Set();

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    syncActiveJobs();
    setInterval(syncActiveJobs, 5000);
    updateTimestepDisplay();
});

// --- ALERTES --- (Inchangé)
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

// --- CHARGEMENT MODELES --- (Inchangé, garde ta version précédente)
async function loadModels() {
    // ... (Garde le code de la réponse précédente pour loadModels) ...
    // Pour la brièveté de la réponse je ne remets pas tout ce bloc s'il fonctionne déjà
    // Mais assure-toi d'avoir la version avec le tri par reward corrigé
    try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();
        const container = document.getElementById('admin-model-list');
        container.innerHTML = '';
        if(models.length === 0) {
            container.innerHTML = '<div style="padding:20px; text-align:center; color:#666;">No models found in repository.</div>';
            return;
        }

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

                let rewardDisplay = "N/A";
                if (model.final_mean_reward !== undefined && model.final_mean_reward !== null) {
                    rewardDisplay = model.final_mean_reward.toFixed(2);
                }
                let rewardColor = (parseFloat(rewardDisplay) > 0) ? 'var(--neon-green)' : '#888';
                let shortDate = model.date ? model.date.split(' ')[0] : "N/A";

                el.innerHTML = `
                    <div class="card-top">
                        <span class="${badgeClass}">${badgeText}</span>
                        <span class="algo-badge">${model.algorithm || 'PPO'}</span>
                    </div>
                    <div class="uuid">${model.uuid}</div>
                    <div class="card-stats">
                        <span>📅 ${shortDate}</span>
                        <span style="color:${rewardColor}">R: ${rewardDisplay}</span>
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

    if (model.final_mean_reward !== undefined && model.final_mean_reward !== null) {
        document.getElementById('detail-reward').value = model.final_mean_reward.toFixed(4);
    } else {
        document.getElementById('detail-reward').value = "0.0000";
    }

    // Reset à une valeur par défaut cohérente avec le nouveau range
    currentTimesteps = 20000;
    updateTimestepDisplay();
}

// --- CALCULATEUR (CORRIGÉ 5k - 100k) ---
function setOpMode(mode) {
    operationMode = mode;
    const btnAdd = document.getElementById('btn-mode-add');
    const btnSub = document.getElementById('btn-mode-sub');
    if (mode === 1) { btnAdd.classList.add('active-add'); btnSub.classList.remove('active-sub'); }
    else { btnAdd.classList.remove('active-add'); btnSub.classList.add('active-sub'); }
}

function modifyTimesteps(amount) {
    let newValue = currentTimesteps + (amount * operationMode);

    // NOUVELLES LIMITES
    if (newValue < 5000) newValue = 5000;     // Min 5k
    if (newValue > 100000) newValue = 100000; // Max 100k

    currentTimesteps = newValue;
    updateTimestepDisplay();
}

function updateTimestepDisplay() { document.getElementById('ts-display').innerText = currentTimesteps.toLocaleString('en-US'); }

// --- MONITORING (ANTI-CLIGNOTEMENT) ---
async function syncActiveJobs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const ids = await res.json();
        const msg = document.getElementById('no-jobs-msg');

        // Filtrer les IDs : on ne garde que ceux qui ne sont PAS dans la liste ignorée
        const validIds = ids.filter(id => !ignoredJobs.has(id));

        if (validIds.length > 0) { if(msg) msg.style.display = 'none'; }
        else { if(msg) msg.style.display = 'block'; }

        validIds.forEach(runId => {
            if (!activeWebSockets[runId]) {
                createJobCard(runId);
                listenToJob(runId);
            }
        });
    } catch(e) {}
}

// ... createJobCard et initChart sont inchangés, garde ta version ...
function createJobCard(runId) {
    const container = document.getElementById('jobs-progress-container');
    if (document.getElementById(`job-card-${runId}`)) return;

    const card = document.createElement('div');
    card.id = `job-card-${runId}`;
    card.className = 'job-progress-card';

    card.innerHTML = `
        <button id="close-${runId}" class="btn-close-job" onclick="removeJobCard('${runId}')">✖</button>
        <div class="job-left">
            <div>
                <div class="job-run-id">RUN: ${runId.substring(0,8)}</div>
                <div class="job-step-info">STEPS: <span id="steps-${runId}" style="color:white;">Initializing...</span></div>
                <div class="job-step-info">REWARD: <span id="current-reward-${runId}" style="color:var(--neon-blue); font-weight:bold;">--</span></div>
                <div class="progress-track"><div id="fill-${runId}" class="progress-fill"></div></div>
                <div id="percent-${runId}" class="progress-text">0%</div>
            </div>
            <button id="btn-stop-${runId}" onclick="stopTraining('${runId}')" class="btn-stop">■ ABORT TRAINING</button>
        </div>
        <div class="job-right"><canvas id="chart-${runId}"></canvas></div>
    `;
    container.appendChild(card);
    initChart(runId);
}

function initChart(runId) {
    const ctx = document.getElementById(`chart-${runId}`).getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 120);
    gradient.addColorStop(0, 'rgba(0, 243, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(0, 243, 255, 0.0)');
    activeCharts[runId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Reward', data: [], borderColor: '#00f3ff', backgroundColor: gradient,
                borderWidth: 2, pointRadius: 0, fill: true, tension: 0.4
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#888', font:{size:9} } } },
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
        const card = document.getElementById(`job-card-${runId}`);
        if(!card) return;

        if (data.status === 'finished' || data.status === 'cancelled' || data.status === 'error') {
            const isCancelled = data.status === 'cancelled';
            const isError = data.status === 'error';

            // 1. AJOUT A LA LISTE IGNORÉE POUR EVITER LE CLIGNOTEMENT
            ignoredJobs.add(runId);

            let color = 'var(--neon-green)';
            let text = '✔ COMPLETE';
            if (isCancelled) { color = '#555'; text = '✖ ABORTED'; }
            if (isError) { color = '#ff3333'; text = '⚠ ERROR'; }

            const btnStop = document.getElementById(`btn-stop-${runId}`);
            const btnClose = document.getElementById(`close-${runId}`);
            if(btnStop) btnStop.style.display = 'none';
            if(btnClose) btnClose.style.display = 'block';

            card.style.borderColor = color;
            card.style.opacity = "0.7";
            const stepEl = document.getElementById(`steps-${runId}`);
            if(stepEl) stepEl.innerHTML = `<span style="color:${color}; font-weight:bold;">${text}</span>`;

            socket.close();
            if(!isCancelled && !isError) loadModels();
            return;
        }

        if (data.stats) {
            let current = data.current_step || 0;
            let total = data.total_steps || 1;
            let percent = Math.min(100, Math.round((current / total) * 100));

            const fillEl = document.getElementById(`fill-${runId}`);
            const percentEl = document.getElementById(`percent-${runId}`);
            const stepsEl = document.getElementById(`steps-${runId}`);
            const rewardEl = document.getElementById(`current-reward-${runId}`);

            if(fillEl) fillEl.style.width = percent + "%";
            if(percentEl) percentEl.innerText = percent + "%";
            if(stepsEl) stepsEl.innerText = `${current.toLocaleString()} / ${total.toLocaleString()}`;
            if(rewardEl && data.stats.mean_reward !== undefined) rewardEl.innerText = data.stats.mean_reward.toFixed(2);

            if (activeCharts[runId] && data.stats.mean_reward !== undefined) {
                const chart = activeCharts[runId];
                if (chart.data.labels.length > 50) { chart.data.labels.shift(); chart.data.datasets[0].data.shift(); }
                chart.data.labels.push("");
                chart.data.datasets[0].data.push(data.stats.mean_reward);
                chart.update();
            }
        }
    };

    socket.onclose = () => { delete activeWebSockets[runId]; };
}

async function stopTraining(runId) {
    if(!confirm("Abort training?")) return;

    // Ajout immédiat à la liste ignorée pour éviter que syncActiveJobs ne le recrée
    // si le websocket ferme avant que le backend ne nettoie
    // (bien que listenToJob l'ajoute aussi, double sécurité)
    // ignoredJobs.add(runId); <-- Non, attendons la confirmation du serveur via websocket pour afficher "Cancelled"

    const btn = document.getElementById(`btn-stop-${runId}`);
    if(btn) {
        btn.disabled = true;
        btn.innerText = "STOPPING...";
        btn.classList.add("disabled");
    }

    try {
        await fetch(`${API_BASE_URL}/api/train/stop/${runId}`, { method: 'DELETE' });
    } catch(e) {
        showAlert("Error", "Could not stop training", "error");
        // Si erreur, on le retire de la liste ignorée au cas où
        // ignoredJobs.delete(runId);
        if(btn) { btn.disabled = false; btn.innerText = "■ ABORT TRAINING"; btn.classList.remove("disabled"); }
    }
}

function removeJobCard(runId) {
    // On s'assure qu'il est ignoré pour toujours
    ignoredJobs.add(runId);

    const card = document.getElementById(`job-card-${runId}`);
    if(card) {
        card.style.opacity = '0';
        card.style.transform = 'translateY(-20px)';
        setTimeout(() => card.remove(), 300);
    }
    if(activeCharts[runId]) { activeCharts[runId].destroy(); delete activeCharts[runId]; }
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
            // On s'assure qu'il n'est pas dans les ignorés (cas rare de réutilisation d'ID)
            ignoredJobs.delete(data.run_id);
            createJobCard(data.run_id);
            listenToJob(data.run_id);
            showAlert("Started", `Sequence started (${currentTimesteps} steps).`, "success");
        }
    } catch(e) { showAlert("Error", "Failed to start", "error"); }
}