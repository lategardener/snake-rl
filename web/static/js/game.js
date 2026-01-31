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

// --- INTERACTIVE VARIABLES ---
let activeGameMode = 'classic'; // 'classic' ou 'walls' (déterminé par le modèle chargé)
let walls = [];
let wallTimer = 0;
const WALL_DURATION = 2;

// Logique Pomme
let nextFoodManual = false;
let isPlacingFood = false;

// Logique Mur
let canPlaceWall = true;
let isPlacingWall = false;

// --- Initialisation ---
async function init() {
    loadModels();
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && isPlaying && !isDead && !isPlacingFood) {
            togglePause();
            e.preventDefault();
        }
    });
    canvas.addEventListener('mousedown', onCanvasClick);

    // Initialisation état outils par défaut (Classic)
    updateToolsState();
}

// --- GESTION DE L'ÉTAT DES BOUTONS ---
function updateToolsState() {
    const wallBtn = document.getElementById('btn-drop-wall');

    // On désactive tout le temps l'interaction si pas de jeu lancé,
    // mais ici on gère surtout l'aspect visuel selon le mode.

    if (activeGameMode === 'walls') {
        // Mode Walls : Le bouton est activé
        wallBtn.classList.remove('locked');
        wallBtn.disabled = false;
        wallBtn.title = "Place a temporary wall";
    } else {
        // Mode Classic : Le bouton est verrouillé
        wallBtn.classList.add('locked');
        wallBtn.disabled = true;
        wallBtn.title = "Only available for WALLS models";

        // Si on était en train de placer un mur, on annule
        isPlacingWall = false;
        canPlaceWall = true;
        wallBtn.classList.remove('placing');
        wallBtn.innerText = "🧱 DROP WALL (LOCKED)";
    }
}

// --- BOUTON : PLAN NEXT FOOD ---
function toggleFoodPlanning() {
    // Marche dans tous les modes
    const btn = document.getElementById('btn-plan-food');
    nextFoodManual = !nextFoodManual;

    if (nextFoodManual) {
        btn.classList.add('armed');
        btn.innerText = "WAITING FOR EAT...";
    } else {
        btn.classList.remove('armed');
        btn.innerText = "PLAN NEXT FOOD";
        if (isPlacingFood) {
            isPlacingFood = false;
            isPlaying = true;
            placeFood();
            gameLoopInterval = setInterval(gameStep, 150);
        }
    }
}

// --- BOUTON : DROP WALL ---
function activateWallMode() {
    // Sécurité : Impossible si mode classic
    if (activeGameMode !== 'walls' || !canPlaceWall) return;

    const btn = document.getElementById('btn-drop-wall');
    isPlacingWall = !isPlacingWall;

    if (isPlacingWall) {
        btn.classList.add('placing');
        btn.innerText = "CLICK ON GRID";
    } else {
        btn.classList.remove('placing');
        btn.innerText = "DROP WALL";
    }
}

// --- COOLDOWN MUR ---
function startWallCooldown() {
    canPlaceWall = false;
    isPlacingWall = false;

    const btn = document.getElementById('btn-drop-wall');
    const bar = document.getElementById('wall-progress-bar');

    btn.classList.remove('placing');
    btn.classList.add('cooldown');
    btn.innerText = "RELOADING...";

    let timeLeft = 5000;
    const interval = 100;

    const timer = setInterval(() => {
        timeLeft -= interval;
        const percentage = ((5000 - timeLeft) / 5000) * 100;
        bar.style.width = percentage + "%";

        if (timeLeft <= 0) {
            clearInterval(timer);
            canPlaceWall = true;
            bar.style.width = "0%";
            btn.classList.remove('cooldown');
            btn.innerText = "DROP WALL";
        }
    }, interval);
}

// --- CLIC SUR GRILLE ---
function onCanvasClick(e) {
    if ((!isPlaying && !isPlacingFood) || isPaused || isDead) return;

    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const col = Math.floor(x / CELL_SIZE);
    const row = Math.floor(y / CELL_SIZE);

    if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return;

    // 1. POMME
    if (isPlacingFood) {
        if (!snake.some(p => p.x === col && p.y === row) && !walls.some(w => w.x === col && w.y === row)) {
            food = {x: col, y: row};
            isPlacingFood = false;
            nextFoodManual = false;
            document.getElementById('btn-plan-food').classList.remove('armed');
            document.getElementById('btn-plan-food').innerText = "🍎 PLAN NEXT FOOD";

            isPlaying = true;
            statusText.innerText = "ONLINE - RUNNING";
            statusText.style.color = "var(--text-main)";
            gameLoopInterval = setInterval(gameStep, 150);
            draw();
        }
    }
    // 2. MUR (Seulement si activeGameMode est 'walls')
    else if (isPlacingWall && activeGameMode === 'walls' && canPlaceWall) {
        if (!snake.some(p => p.x === col && p.y === row) && !(food.x === col && food.y === row)) {
            walls.push({x: col, y: row});
            wallTimer = WALL_DURATION + 1;
            startWallCooldown();
            draw();
        }
    }
}

// --- GAME LOOP ---
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

        if (data.probabilities) {
            updateBrainBar('prob-up', data.probabilities[0]);
            updateBrainBar('prob-down', data.probabilities[1]);
            updateBrainBar('prob-left', data.probabilities[2]);
            updateBrainBar('prob-right', data.probabilities[3]);
        }

        moveSnake(data.action);
        draw();

    } catch (e) { console.error(e); }
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

        if (nextFoodManual) {
            isPlaying = false;
            clearInterval(gameLoopInterval);
            isPlacingFood = true;
            statusText.innerText = "WAITING FOR PLACEMENT";
            statusText.style.color = "var(--neon-pink)";
            document.getElementById('btn-plan-food').innerText = "CLICK GRID NOW!";
            draw();
        } else {
            placeFood();
        }
    } else {
        snake.pop();
    }
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

    if (isPlacingFood) {
        ctx.fillStyle = "rgba(0, 255, 0, 0.1)";
        for(let r=0; r<GRID_SIZE; r++) {
            for(let c=0; c<GRID_SIZE; c++) {
                const busy = snake.some(p => p.x === c && p.y === r) || walls.some(w => w.x === c && w.y === r);
                if (!busy) {
                    ctx.fillRect(c*CELL_SIZE+1, r*CELL_SIZE+1, CELL_SIZE-2, CELL_SIZE-2);
                }
            }
        }
    }

    walls.forEach(w => {
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ffffff";
        ctx.fillRect(w.x * CELL_SIZE + 1, w.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
        ctx.shadowBlur = 0;
    });

    if (!isPlacingFood) {
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#bc13fe";
        ctx.fillStyle = "#bc13fe";
        ctx.fillRect(food.x * CELL_SIZE + 2, food.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
        ctx.shadowBlur = 0;
    }

    snake.forEach((part, index) => {
        if (index === 0) {
            ctx.fillStyle = isDead ? "#ff0000" : "#00f3ff";
            ctx.shadowBlur = isDead ? 25 : 20;
            ctx.shadowColor = isDead ? "#ff0000" : "#00f3ff";
        } else {
            ctx.fillStyle = "rgba(0, 243, 255, 0.6)";
            ctx.shadowBlur = 0;
        }
        ctx.fillRect(part.x * CELL_SIZE + 1, part.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    });
    ctx.shadowBlur = 0;

    if (isDead) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
        ctx.fillRect(0,0, canvas.width, canvas.height);
    }
}

// Fonction de chargement inchangée (mais assure-toi que tes badges fonctionnent)
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
                let badgeHtml = model.game_mode === 'walls' ? `<span class="mode-badge badge-walls">WALLS</span>` : `<span class="mode-badge badge-classic">CLASSIC</span>`;
                card.innerHTML = `
                    <div class="card-top"><span class="grid-badge">${model.algorithm || 'PPO'}</span>${badgeHtml}</div>
                    <div style="margin-top:5px; display:flex; justify-content:space-between;">
                         <span class="uuid">${model.uuid.substring(0, 8)}...</span>
                         <span class="reward">R: ${model.reward ? model.reward.toFixed(2) : 'N/A'}</span>
                    </div>
                    <span class="date">${model.date}</span>`;
                card.onclick = () => selectModel(model, card);
                modelListEl.appendChild(card);
            });
        });
    } catch (e) { console.error(e); }
}

async function selectModel(model, cardElement) {
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');
    activeModelNameEl.innerText = `LOADING...`;
    statusText.innerText = "DOWNLOADING...";
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

            // --- MISE À JOUR DU MODE ICI ---
            activeModelNameEl.innerText = `AGENT: ${model.uuid.substring(0, 8)}`;
            activeModelNameEl.innerHTML += ` <span style="font-size:0.5em; color:var(--neon-pink)">[${model.grid_size}x${model.grid_size}]</span>`;

            // On récupère le mode du modèle et on met à jour les boutons
            activeGameMode = model.game_mode || 'classic';
            updateToolsState(); // <--- C'est ici que la magie opère

            overlayEl.style.display = 'none';
            pauseBtn.disabled = false;
            resetGame();
        }
    } catch (e) { console.error(e); }
}

async function resetGame() {
    if (gameLoopInterval) clearInterval(gameLoopInterval);
    
    // --- NOUVEL APPEL API POUR LES MÉTRIQUES ---
    try {
        await fetch(`${API_BASE_URL}/api/start`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ grid_size: GRID_SIZE })
        });
    } catch (e) {
        console.error("Erreur lors de l'envoi du métrique start_game:", e);
    }
    // -------------------------------------------

    snake = [{x: Math.floor(GRID_SIZE/2), y: Math.floor(GRID_SIZE/2)}];
    score = 0;
    scoreEl.innerText = score;
    isPlaying = true;
    isDead = false;
    isPaused = false;
    isPlacingFood = false;
    nextFoodManual = false;
    walls = [];
    wallTimer = 0;

    // Reset UI Outils
    const btnFood = document.getElementById('btn-plan-food');
    btnFood.classList.remove('armed');
    btnFood.innerText = "🍎 PLAN NEXT FOOD";

    // Reset Wall state si nécessaire
    updateToolsState();

    statusText.innerText = "ONLINE - RUNNING";
    statusText.style.color = "var(--text-main)";
    pauseBtn.disabled = false;

    placeFood();
    draw();
    gameLoopInterval = setInterval(gameStep, 150);
}

function updateBrainBar(elementId, probability) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const percent = (probability * 100).toFixed(1);
    el.style.width = percent + '%';
    if (probability > 0.8) { el.style.backgroundColor = 'var(--neon-green)'; el.style.boxShadow = '0 0 10px var(--neon-green)'; }
    else if (probability < 0.05) { el.style.backgroundColor = 'rgba(255, 0, 0, 0.2)'; el.style.boxShadow = 'none'; }
    else { el.style.backgroundColor = 'var(--neon-blue)'; el.style.boxShadow = '0 0 5px var(--neon-blue)'; }
}

function togglePause() {
    if (!isPlaying) return;
    isPaused = !isPaused;
    if (isPaused) {
        statusText.innerText = "SYSTEM PAUSED";
        statusText.style.color = "#ffaa00";
        pauseBtn.innerText = "RESUME";
    } else {
        statusText.innerText = "ONLINE - RUNNING";
        statusText.style.color = "var(--text-main)";
        pauseBtn.innerText = "PAUSE";
    }
}

function gameOver() {
    isPlaying = false;
    isDead = true;
    clearInterval(gameLoopInterval);
    statusText.innerText = "GAME OVER";
    pauseBtn.disabled = true;
    draw();
}

init();