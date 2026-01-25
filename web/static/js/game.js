const canvas = document.getElementById('snakeCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const actionEl = document.getElementById('ia-action');
const modelListEl = document.getElementById('model-list');
const overlayEl = document.getElementById('overlay');
const activeModelNameEl = document.getElementById('active-model-name');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

let GRID_SIZE = 10; // Valeur par défaut, sera mise à jour par le modèle
let CELL_SIZE = canvas.width / GRID_SIZE;

let snake = [];
let food = {};
let score = 0;
let isPlaying = false;
let gameLoopInterval = null;

// --- Initialisation ---
async function init() {
    loadModels();
}

// --- 1. Gestion des Modèles ---
async function loadModels() {
    try {
        const res = await fetch('/api/models');
        const models = await res.json();

        modelListEl.innerHTML = '';
        models.forEach(model => {
            const card = document.createElement('div');
            card.className = 'model-card';
            card.innerHTML = `
                <div class="card-top">
                    <span class="grid-badge">${model.grid_size}x${model.grid_size}</span>
                    <span class="reward">R: ${model.reward ? model.reward.toFixed(2) : 'N/A'}</span>
                </div>
                <div class="uuid">${model.uuid.substring(0, 18)}...</div>
                <span class="date">${model.date}</span>
            `;
            card.onclick = () => selectModel(model, card);
            modelListEl.appendChild(card);
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

    // Server Call
    try {
        const res = await fetch('/api/load', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ uuid: model.uuid, grid_size: model.grid_size })
        });

        if (res.ok) {
            // Success
            GRID_SIZE = model.grid_size;
            CELL_SIZE = canvas.width / GRID_SIZE;

            activeModelNameEl.innerText = `AGENT: ${model.uuid.substring(0, 8)}`;
            activeModelNameEl.innerHTML += ` <span style="font-size:0.5em; color:var(--neon-pink)">[${model.grid_size}x${model.grid_size}]</span>`;

            statusText.innerText = "ONLINE - RUNNING";
            statusDot.classList.add('active'); // vert
            overlayEl.style.display = 'none';

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

function resetGame() {
    if (gameLoopInterval) clearInterval(gameLoopInterval);

    snake = [{x: Math.floor(GRID_SIZE/2), y: Math.floor(GRID_SIZE/2)}];
    score = 0;
    scoreEl.innerText = score;
    placeFood();
    isPlaying = true;
    draw();

    // Démarrage de la boucle IA
    gameLoopInterval = setInterval(gameStep, 150); // Vitesse du jeu
}

function placeFood() {
    let valid = false;
    while (!valid) {
        food = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE)
        };
        // Vérifier que la food n'est pas sur le serpent
        valid = !snake.some(p => p.x === food.x && p.y === food.y);
    }
}

async function gameStep() {
    if (!isPlaying) return;

    // A. Construire la grille pour l'IA
    let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));

    // Corps du serpent = 1 (ou -1 selon ton training, ici on suppose 1)
    snake.forEach(p => grid[p.y][p.x] = 1);
    // Tête (optionnel, parfois utile de la différencier)
    // grid[snake[0].y][snake[0].x] = 5;

    // Food = 2 (ou autre valeur selon training)
    grid[food.y][food.x] = 2; // On met 2 pour simplifier, assure-toi que ça matche ton env.

    // B. Demander l'action
    try {
        const res = await fetch('/api/predict', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ grid: grid })
        });
        const data = await res.json();
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

    // Mapping SB3 standard : 0:Up, 1:Down, 2:Left, 3:Right
    // (Vérifie si ça correspond à ton env.py)
    if (action === 0) head.y -= 1;
    if (action === 1) head.y += 1;
    if (action === 2) head.x -= 1;
    if (action === 3) head.x += 1;

    // Collisions Mur
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
        gameOver();
        return;
    }

    // Collisions Soi-même
    if (snake.some(p => p.x === head.x && p.y === head.y)) {
        gameOver();
        return;
    }

    snake.unshift(head);

    // Manger Food
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
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillRect(0,0, canvas.width, canvas.height);
}

// --- 3. Rendu Graphique (Canvas) ---
function draw() {
    // Fond
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grille (subtile)
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

    // Food (Neon Glow)
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#bc13fe";
    ctx.fillStyle = "#bc13fe";
    ctx.fillRect(food.x * CELL_SIZE + 2, food.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    ctx.shadowBlur = 0; // Reset

    // Snake
    snake.forEach((part, index) => {
        if (index === 0) { // Tête
            ctx.fillStyle = "#00f3ff";
            ctx.shadowBlur = 20;
            ctx.shadowColor = "#00f3ff";
        } else { // Corps
            ctx.fillStyle = "rgba(0, 243, 255, 0.6)";
            ctx.shadowBlur = 0;
        }
        ctx.fillRect(part.x * CELL_SIZE + 1, part.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
    });
    ctx.shadowBlur = 0;
}

// Lancement
init();