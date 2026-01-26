const canvas = document.getElementById('snakeCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const actionEl = document.getElementById('ia-action');
const modelListEl = document.getElementById('model-list');
const overlayEl = document.getElementById('overlay');
const activeModelNameEl = document.getElementById('active-model-name');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const pauseBtn = document.getElementById('pause-btn'); // Nouveau bouton

let GRID_SIZE = 10;
let CELL_SIZE = canvas.width / GRID_SIZE;

let snake = [];
let food = {};
let score = 0;
let isPlaying = false;
let isPaused = false; // Nouvelle variable d'état
let gameLoopInterval = null;

// --- Initialisation ---
async function init() {
    loadModels();

    // Ajout du contrôle clavier pour la pause (Espace)
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && isPlaying) {
            togglePause();
            e.preventDefault(); // Empêche le scroll
        }
    });
}

// --- 1. Gestion des Modèles ---
async function loadModels() {
    try {
        const res = await fetch('/api/models');
        const models = await res.json();

        modelListEl.innerHTML = '';

        // A. Grouper les modèles par grid_size
        const groupedModels = {};
        models.forEach(model => {
            if (!groupedModels[model.grid_size]) {
                groupedModels[model.grid_size] = [];
            }
            groupedModels[model.grid_size].push(model);
        });

        // B. Trier les tailles de grille (petit vers grand)
        const sortedGridSizes = Object.keys(groupedModels).sort((a, b) => parseInt(a) - parseInt(b));

        // C. Afficher les bannières et les cartes
        if (sortedGridSizes.length === 0) {
            modelListEl.innerHTML = '<div style="text-align:center; margin-top:20px;">No models found</div>';
            return;
        }

        sortedGridSizes.forEach(size => {
            // 1. Créer la bannière lumineuse
            const header = document.createElement('div');
            header.className = 'grid-category-header';
            header.innerHTML = `GRID SYSTEM [ ${size}x${size} ]`;
            modelListEl.appendChild(header);

            // 2. Trier les modèles de cette grille par reward (meilleur en haut)
            groupedModels[size].sort((a, b) => (b.reward || 0) - (a.reward || 0));

            // 3. Créer les cartes
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
    // UI Update
    document.querySelectorAll('.model-card').forEach(c => c.classList.remove('active'));
    cardElement.classList.add('active');

    activeModelNameEl.innerText = `LOADING ${model.uuid.substring(0, 8)}...`;
    statusText.innerText = "DOWNLOADING...";
    statusDot.className = "dot"; // rouge
    pauseBtn.disabled = true; // Désactiver pause pendant chargement

    // Server Call
    try {
        const res = await fetch('/api/load', {
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
            pauseBtn.disabled = false; // Activer le bouton pause

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
        // Petit effet visuel sur le canvas pour montrer la pause
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
        // On redessine tout de suite pour effacer le texte "PAUSED"
        draw();
    }
}

function resetGame() {
    if (gameLoopInterval) clearInterval(gameLoopInterval);

    // Reset variables
    snake = [{x: Math.floor(GRID_SIZE/2), y: Math.floor(GRID_SIZE/2)}];
    score = 0;
    scoreEl.innerText = score;
    isPaused = false; // Important : on enlève la pause au reset
    isPlaying = true;

    // Reset UI
    statusText.innerText = "ONLINE - RUNNING";
    statusText.style.color = "var(--text-main)";
    statusDot.className = "dot active";
    pauseBtn.innerText = "PAUSE";
    pauseBtn.disabled = false;

    placeFood();
    draw();

    // Démarrage de la boucle IA
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
    // Si pas en jeu OU si en PAUSE, on ne fait rien
    if (!isPlaying || isPaused) return;

    // A. Construire la grille pour l'IA
    let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    snake.forEach(p => grid[p.y][p.x] = 1);
    grid[food.y][food.x] = 2;

    // B. Demander l'action
    try {
        const res = await fetch('/api/predict', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ grid: grid })
        });

        if (!res.ok) return; // Sécurité si serveur down

        const data = await res.json();

        // Vérif double : si l'utilisateur a mis pause PENDANT la requête fetch (asynchrone)
        if (isPaused || !isPlaying) return;

        const action = data.action;
        const actionsLabel = ["UP", "DOWN", "LEFT", "RIGHT"];
        actionEl.innerText = actionsLabel[action];

        moveSnake(action);
        draw();

    } catch (e) {
        console.error("Erreur Prediction", e);
    }
}

function moveSnake(action) {
    let head = { ...snake[0] };

    if (action === 0) head.y -= 1;
    if (action === 1) head.y += 1;
    if (action === 2) head.x -= 1;
    if (action === 3) head.x += 1;

    // Collisions
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
    statusDot.className = "dot"; // Rouge
    pauseBtn.disabled = true; // On ne peut pas mettre en pause si mort

    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillRect(0,0, canvas.width, canvas.height);
}

// --- 3. Rendu Graphique (Canvas) ---
function draw() {
    // (Identique à ton code précédent)
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

    // Glow effect
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