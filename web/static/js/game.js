// CORRECTION CRITIQUE : URL absolue vers Render
const API_BASE_URL = "https://snake-rl.onrender.com";

const canvas = document.getElementById('snakeCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const actionEl = document.getElementById('ia-action');
const modelListEl = document.getElementById('model-list');
const overlayEl = document.getElementById('overlay');
const activeModelNameEl = document.getElementById('active-model-name');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const pauseBtn = document.getElementById('pause-btn');

let GRID_SIZE = 10;
let CELL_SIZE = canvas.width / GRID_SIZE;

let snake = [];
let food = {};
let score = 0;
let isPlaying = false;
let isPaused = false;
let gameLoopInterval = null;

// --- Initialisation ---
async function init() {
    loadModels();

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && isPlaying) {
            togglePause();
            e.preventDefault();
        }
    });
}

// --- 1. Gestion des Modèles ---
async function loadModels() {
    try {
        // Fetch vers Render (URL absolue)
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();

        modelListEl.innerHTML = '';
        const groupedModels = {};
        models.forEach(model => {
            if (!groupedModels[model.grid_size]) groupedModels[model.grid_size] = [];
            groupedModels[model.grid_size].push(model);
        });

        const sortedGridSizes = Object.keys(groupedModels).sort((a, b) => parseInt(a) - parseInt(b));

        if (sortedGridSizes.length === 0) {
            modelListEl.innerHTML = '<div style="text-align:center; margin-top:20px;">No models found</div>';
            return;
        }

        sortedGridSizes.forEach(size => {
            const header = document.createElement('div');
            header.className = 'grid-category-header';
            header.innerHTML = `GRID SYSTEM [ ${size}x${size} ]`;
            modelListEl.appendChild(header);

            groupedModels[size].sort((a, b) => (b.reward || 0) - (a.reward || 0));

            groupedModels[size].forEach(model => {
                const card = document.createElement('div');
                card.className = 'model-card';
                card.innerHTML = `
                    <div class="card-top">
                        <span class="grid-badge">${model.algorithm || 'PPO'}</span>
                        <span class="reward">R: ${model.reward ? model.reward.toFixed(2) : 'N/A'}</span>
                    </div>
                    <div class="uuid">${model.uuid.substring(0, 18)}...</div>
                    <span class="date">${model.date}</span>
                `;
                card.onclick = () => selectModel(model, card);
                modelListEl.appendChild(card);
            });
        });

    } catch (e) {
        modelListEl.innerHTML = '<div style="color:red">Error loading models</div>';
        console.error(e);
    }
}

async function selectModel(model, cardElement) {
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');

    activeModelNameEl.innerText = `LOADING ${model.uuid.substring(0, 8)}...`;
    statusText.innerText = "DOWNLOADING...";
    statusDot.className = "dot";
    pauseBtn.disabled = true;

    try {
        // Fetch vers Render (URL absolue)
        const res = await fetch(`${API_BASE_URL}/api/load`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ uuid: model.uuid, grid_size: model.grid_size })
        });

        if (res.ok) {
            GRID_SIZE = model.grid_size;
            CELL_SIZE = canvas.width / GRID_SIZE;

            activeModelNameEl.innerText = `AGENT: ${model.uuid.substring(0, 8)}`;
            activeModelNameEl.innerHTML += ` <span style="font-size:0.5em; color:var(--neon-pink)">[${model.grid_size}x${model.grid_size}]</span>`;

            overlayEl.style.display = 'none';
            pauseBtn.disabled = false;
            resetGame();
        } else {
            alert("Erreur chargement modèle");
        }
    } catch (e) {
        console.error(e);
        activeModelNameEl.innerText = "ERROR LOADING";
    }
}

// --- 2. Logique du Jeu ---

function togglePause() {
    if (!isPlaying) return;
    isPaused = !isPaused;

    if (isPaused) {
        statusText.innerText = "SYSTEM PAUSED";
        statusText.style.color = "#ffaa00";
        pauseBtn.innerText = "RESUME";
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "white";
        ctx.font = "20px Orbitron";
        ctx.textAlign = "center";
        ctx.fillText("PAUSED", canvas.width/2, canvas.height/2);
    } else {
        statusText.innerText = "ONLINE - RUNNING";
        statusText.style.color = "var(--text-main)";
        pauseBtn.innerText = "PAUSE";
        draw();
    }
}

function resetGame() {
    if (gameLoopInterval) clearInterval(gameLoopInterval);

    snake = [{x: Math.floor(GRID_SIZE/2), y: Math.floor(GRID_SIZE/2)}];
    score = 0;
    scoreEl.innerText = score;
    isPaused = false;
    isPlaying = true;

    statusText.innerText = "ONLINE - RUNNING";
    statusText.style.color = "var(--text-main)";
    statusDot.className = "dot active";
    pauseBtn.innerText = "PAUSE";
    pauseBtn.disabled = false;

    // Reset des barres de proba
    updateBrainBar('prob-up', 0);
    updateBrainBar('prob-down', 0);
    updateBrainBar('prob-left', 0);
    updateBrainBar('prob-right', 0);

    placeFood();
    draw();
    gameLoopInterval = setInterval(gameStep, 150);
}

function placeFood() {
    let valid = false;
    while (!valid) {
        food = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE)
        };
        valid = !snake.some(p => p.x === food.x && p.y === food.y);
    }
}

async function gameStep() {
    if (!isPlaying || isPaused) return;

    let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    snake.forEach(p => grid[p.y][p.x] = 1);
    grid[food.y][food.x] = 2;

    try {
        // Fetch vers Render (URL absolue)
        const res = await fetch(`${API_BASE_URL}/api/predict`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ grid: grid })
        });

        if (!res.ok) return;

        const data = await res.json();
        if (isPaused || !isPlaying) return;

        const action = data.action;
        const actionsLabel = ["UP", "DOWN", "LEFT", "RIGHT"];
        actionEl.innerText = actionsLabel[action];

        // NOUVEAU : Mise à jour des barres de visualisation
        if (data.probabilities) {
            // Ordre : 0=Haut, 1=Bas, 2=Gauche, 3=Droite
            updateBrainBar('prob-up', data.probabilities[0]);
            updateBrainBar('prob-down', data.probabilities[1]);
            updateBrainBar('prob-left', data.probabilities[2]);
            updateBrainBar('prob-right', data.probabilities[3]);
        }

        moveSnake(action);
        draw();

    } catch (e) {
        console.error("Erreur Prediction", e);
    }
}

// Fonction utilitaire pour l'animation des barres
function updateBrainBar(elementId, probability) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const percent = (probability * 100).toFixed(1);
    el.style.width = percent + '%';

    if (probability > 0.8) {
        el.style.backgroundColor = 'var(--neon-green)';
        el.style.boxShadow = '0 0 10px var(--neon-green)';
    } else if (probability < 0.1) {
        el.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
        el.style.boxShadow = 'none';
    } else {
        el.style.backgroundColor = 'var(--neon-blue)';
        el.style.boxShadow = '0 0 10px var(--neon-blue)';
    }
}

function moveSnake(action) {
    let head = { ...snake[0] };
    if (action === 0) head.y -= 1;
    if (action === 1) head.y += 1;
    if (action === 2) head.x -= 1;
    if (action === 3) head.x += 1;

    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE ||
        snake.some(p => p.x === head.x && p.y === head.y)) {
        gameOver();
        return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
        score++;
        scoreEl.innerText = score;
        placeFood();
    } else {
        snake.pop();
    }
}

function gameOver() {
    isPlaying = false;
    clearInterval(gameLoopInterval);
    statusText.innerText = "GAME OVER";
    statusDot.className = "dot";
    pauseBtn.disabled = true;
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillRect(0,0, canvas.width, canvas.height);
}

function draw() {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for(let i=0; i<=GRID_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i*CELL_SIZE, 0); ctx.lineTo(i*CELL_SIZE, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i*CELL_SIZE); ctx.lineTo(canvas.width, i*CELL_SIZE);
        ctx.stroke();
    }

    ctx.shadowBlur = 15;
    ctx.shadowColor = "#bc13fe";
    ctx.fillStyle = "#bc13fe";
    ctx.fillRect(food.x * CELL_SIZE + 2, food.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    ctx.shadowBlur = 0;

    snake.forEach((part, index) => {
        if (index === 0) {
            ctx.fillStyle = "#00f3ff";
            ctx.shadowBlur = 20;
            ctx.shadowColor = "#00f3ff";
        } else {
            ctx.fillStyle = "rgba(0, 243, 255, 0.6)";
            ctx.shadowBlur = 0;
        }
        ctx.fillRect(part.x * CELL_SIZE + 1, part.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    });
    ctx.shadowBlur = 0;
}

init();