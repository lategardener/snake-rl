//
const API_BASE_URL = window.location.origin;
let activeWebSockets = {}; // Pour suivre plusieurs entraînements si besoin

document.addEventListener('DOMContentLoaded', () => {
    loadModels();
    // On lance la surveillance globale des jobs
    syncActiveJobs();
    setInterval(syncActiveJobs, 3000);
});

async function syncActiveJobs() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/train/active`);
        const activeIds = await res.json();
        const container = document.getElementById('jobs-progress-container');

        if (activeIds.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #666; margin-top: 50px;">NO ACTIVE TRAINING DETECTED</div>';
            return;
        }

        // Pour chaque ID actif, si on n'a pas encore de WebSocket, on le crée
        activeIds.forEach(runId => {
            if (!activeWebSockets[runId]) {
                createJobCard(runId);
                listenToJob(runId);
            }
        });
    } catch (e) { console.error("Sync error:", e); }
}

function createJobCard(runId) {
    const container = document.getElementById('jobs-progress-container');
    // On retire le message "No active" s'il existe
    if (container.querySelector('div[style*="color: #666"]')) container.innerHTML = '';

    const card = document.createElement('div');
    card.id = `job-card-${runId}`;
    card.className = 'job-progress-card';
    card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-family: var(--font-display); color: var(--neon-blue);">JOB: ${runId.substring(0,8)}</span>
            <span id="percent-${runId}" style="color: var(--neon-green);">0%</span>
        </div>
        <div class="progress-track">
            <div id="fill-${runId}" class="progress-fill"></div>
        </div>
        <div style="margin-top: 8px; font-size: 0.8rem; color: #888; display: flex; gap: 15px;">
            <span id="reward-${runId}">Reward: --</span>
            <span id="status-${runId}">Status: Initializing...</span>
        </div>
    `;
    container.appendChild(card);
}

function listenToJob(runId) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/training/${runId}`;
    const socket = new WebSocket(wsUrl);
    activeWebSockets[runId] = socket;

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.status === 'finished') {
            handleJobCompletion(runId, "SUCCESS");
            socket.close();
            return;
        }

        if (data.stats && data.stats.status === 'error') {
            handleJobCompletion(runId, "FAILED", true);
            socket.close();
            return;
        }

        // Mise à jour de la barre et des stats
        // -> le manager envoie 'progress' et 'stats'
        if (data.progress !== undefined) {
            const percent = Math.round(data.progress * 100);
            document.getElementById(`fill-${runId}`).style.width = percent + "%";
            document.getElementById(`percent-${runId}`).innerText = percent + "%";
            document.getElementById(`status-${runId}`).innerText = "Status: Training...";
        }

        if (data.stats && data.stats.mean_reward !== undefined) {
            document.getElementById(`reward-${runId}`).innerText = `Reward: ${data.stats.mean_reward.toFixed(2)}`;
        }
    };

    socket.onclose = () => delete activeWebSockets[runId];
}

function handleJobCompletion(runId, statusText, isError = false) {
    const fill = document.getElementById(`fill-${runId}`);
    const status = document.getElementById(`status-${runId}`);

    if (isError) {
        fill.style.background = "var(--neon-pink)";
        status.style.color = "var(--neon-pink)";
    } else {
        fill.style.width = "100%";
        status.style.color = "var(--neon-green)";
    }
    status.innerText = `Status: ${statusText}`;

    // On laisse la carte 10 secondes puis on rafraîchit la liste des modèles
    setTimeout(() => {
        const card = document.getElementById(`job-card-${runId}`);
        if (card) card.remove();
        loadModels();
    }, 10000);
}