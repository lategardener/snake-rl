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
let isDead = false;
let gameLoopInterval = null;

// --- GOD MODE VARIABLES ---
let godModeEnabled = false;
let currentTool = 'food';
let walls = [];
let wallTimer = 0;
const WALL_DURATION = 3;

// --- Initialisation ---
async function init() {
    loadModels();

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && isPlaying && !isDead) {
            togglePause();
            e.preventDefault();
        }
    });

    canvas.addEventListener('mousedown', onCanvasClick);

    // Initialisation état boutons
    toggleGameMode();
}

// --- Gestion du Mode de Jeu ---
function toggleGameMode() {
    const checkbox = document.getElementById('mode-toggle');
    const label = document.getElementById('mode-label');
    const tools = document.getElementById('tools-container');
    const wallBtn = document.getElementById('btn-tool-wall');

    godModeEnabled = checkbox.checked;

    if (godModeEnabled) {
        // MODE AVANCÉ (WALLS)
        label.innerText = "GOD MODE (WALLS)";
        label.style.color = "var(--neon-pink)";
        tools.classList.remove('disabled');

        // Active le bouton mur
        wallBtn.classList.remove('locked');
        wallBtn.disabled = false;

    } else {
        // MODE CLASSIQUE
        label.innerText = "CLASSIC";
        label.style.color = "var(--text-muted)";
        tools.classList.add('disabled'); // Cache tout le panneau ou...
        tools.classList.remove('disabled'); // ... laisse affiché mais restreint

        // Force l'outil sur Food car Wall est interdit
        selectTool('food');

        // Désactive visuellement le bouton mur
        wallBtn.classList.add('locked');
        wallBtn.disabled = true;

        // Nettoyage
        walls = [];
        wallTimer = 0;
        if (!isDead) draw();
    }
}

function selectTool(tool) {
    if (tool === 'wall' && !godModeEnabled) return; // Sécurité

    currentTool = tool;
    document.getElementById('btn-tool-food').classList.remove('active');
    document.getElementById('btn-tool-wall').classList.remove('active');
    document.getElementById(`btn-tool-${tool}`).classList.add('active');
}

// --- Interaction Clic ---
function onCanvasClick(e) {
    if (!isPlaying || isPaused || isDead) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const col = Math.floor(x / CELL_SIZE);
    const row = Math.floor(y / CELL_SIZE);

    if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return;

    // Logique Outils
    if (currentTool === 'food') {
        // Outil Pomme : Marche dans les deux modes
        if (!snake.some(p => p.x === col && p.y === row)) {
            food = {x: col, y: row};
            draw();
            // Envoyer info au backend (si nécessaire pour sync)
        }
    } else if (currentTool === 'wall' && godModeEnabled) {
        // Outil Mur : Seulement en God Mode
        if (!snake.some(p => p.x === col && p.y === row) && !(food.x === col && food.y === row)) {
            walls = [{x: col, y: row}];
            wallTimer = WALL_DURATION + 1;
            draw();
        }
    }
}

// --- Gestion des Modèles ---
async function loadModels() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/models`);
        const models = await res.json();
        modelListEl.innerHTML = '';

        const groupedModels = {};
        models.forEach(model => {
            if (!groupedModels[model.grid_size]) groupedModels[model.grid_size] = [];
            groupedModels[model.grid_size].push(model);
        });

        const sortedGridSizes = Object.keys(groupedModels).sort((a, b) => parseInt(a) - parseInt(b));

        sortedGridSizes.forEach(size => {
            const header = document.createElement('div');
            header.className = 'grid-category-header';
            header.innerHTML = `GRID SYSTEM [ ${size}x${size} ]`;
            modelListEl.appendChild(header);

            groupedModels[size].sort((a, b) => (b.reward || 0) - (a.reward || 0));

            groupedModels[size].forEach(model => {
                const card = document.createElement('div');
                card.className = 'model-card';

                // --- 1. GESTION DES BADGES ---
                let badgeHtml = '';
                if (model.game_mode === 'walls') {
                    badgeHtml = `<span class="mode-badge badge-walls">WALLS</span>`;
                } else {
                    badgeHtml = `<span class="mode-badge badge-classic">CLASSIC</span>`;
                }

                card.innerHTML = `
                    <div class="card-top">
                        <span class="grid-badge">${model.algorithm || 'PPO'}</span>
                        ${badgeHtml} </div>
                    <div style="margin-top:5px; display:flex; justify-content:space-between;">
                         <span class="uuid">${model.uuid.substring(0, 8)}...</span>
                         <span class="reward">R: ${model.reward ? model.reward.toFixed(2) : 'N/A'}</span>
                    </div>
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

    activeModelNameEl.innerText = `LOADING...`;
    statusText.innerText = "DOWNLOADING...";
    statusDot.className = "dot";
    pauseBtn.disabled = true;

    try {
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
        }
    } catch (e) { console.error(e); }
}

function resetGame() {
    if (gameLoopInterval) clearInterval(gameLoopInterval);

    snake = [{x: Math.floor(GRID_SIZE/2), y: Math.floor(GRID_SIZE/2)}];
    score = 0;
    scoreEl.innerText = score;
    isPaused = false;
    isPlaying = true;
    isDead = false;
    walls = [];
    wallTimer = 0;

    statusText.innerText = "ONLINE - RUNNING";
    statusText.style.color = "var(--text-main)";
    statusDot.className = "dot active";
    pauseBtn.disabled = false;

    // Reset visuel
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
        const onSnake = snake.some(p => p.x === food.x && p.y === food.y);
        const onWall = walls.some(w => w.x === food.x && w.y === food.y);
        valid = !onSnake && !onWall;
    }
}

async function gameStep() {
    if (!isPlaying || isPaused || isDead) return;

    if (walls.length > 0) {
        wallTimer--;
        if (wallTimer <= 0) walls = [];
    }

    let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    snake.forEach(p => grid[p.y][p.x] = 1);
    grid[food.y][food.x] = 2;
    walls.forEach(w => grid[w.y][w.x] = 3);

    try {
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

        // --- 3. GESTION DES PROBABILITÉS ---
        if (data.probabilities) {
            // Mapping : 0=Haut, 1=Bas, 2=Gauche, 3=Droite (Vérifier selon ton Env)
            updateBrainBar('prob-up', data.probabilities[0]);
            updateBrainBar('prob-down', data.probabilities[1]);
            updateBrainBar('prob-left', data.probabilities[2]);
            updateBrainBar('prob-right', data.probabilities[3]);
        }

        moveSnake(action);
        draw();

    } catch (e) { console.error("Erreur Prediction", e); }
}

function updateBrainBar(elementId, probability) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // Animation fluide
    const percent = (probability * 100).toFixed(1);
    el.style.width = percent + '%';

    // Code couleur confiance
    if (probability > 0.8) {
        el.style.backgroundColor = 'var(--neon-green)';
        el.style.boxShadow = '0 0 10px var(--neon-green)';
    } else if (probability < 0.05) {
        el.style.backgroundColor = 'rgba(255, 0, 0, 0.2)'; // Quasi invisible
        el.style.boxShadow = 'none';
    } else {
        el.style.backgroundColor = 'var(--neon-blue)';
        el.style.boxShadow = '0 0 5px var(--neon-blue)';
    }
}

function moveSnake(action) {
    let head = { ...snake[0] };
    if (action === 0) head.y -= 1;
    if (action === 1) head.y += 1;
    if (action === 2) head.x -= 1;
    if (action === 3) head.x += 1;

    const hitWall = walls.some(w => w.x === head.x && w.y === head.y);

    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE ||
        snake.some(p => p.x === head.x && p.y === head.y) || hitWall) {
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
    isDead = true;
    clearInterval(gameLoopInterval);
    statusText.innerText = "GAME OVER";
    statusDot.className = "dot";
    pauseBtn.disabled = true;
    draw();
    ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
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

    // MURS
    walls.forEach(w => {
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ffffff";
        ctx.fillRect(w.x * CELL_SIZE + 1, w.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.shadowBlur = 0;
    });

    // FOOD
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#bc13fe";
    ctx.fillStyle = "#bc13fe";
    ctx.fillRect(food.x * CELL_SIZE + 2, food.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    ctx.shadowBlur = 0;

    // SNAKE
    snake.forEach((part, index) => {
        if (index === 0) {
            if (isDead) {
                ctx.fillStyle = "#ff0000";
                ctx.shadowBlur = 25;
                ctx.shadowColor = "#ff0000";
            } else {
                ctx.fillStyle = "#00f3ff";
                ctx.shadowBlur = 20;
                ctx.shadowColor = "#00f3ff";
            }
        } else {
            ctx.fillStyle = "rgba(0, 243, 255, 0.6)";
            ctx.shadowBlur = 0;
        }
        ctx.fillRect(part.x * CELL_SIZE + 1, part.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    });
    ctx.shadowBlur = 0;
}

init();