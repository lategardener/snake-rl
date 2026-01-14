const canvas = document.getElementById('snakeCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const iaActionEl = document.getElementById('ia-action');

const GRID_SIZE = 5; // Correspond à tes modèles 5x5
const CELL_SIZE = canvas.width / GRID_SIZE;

let snake = [{x: 2, y: 2}];
let food = {x: 4, y: 4};
let score = 0;
let gameOver = false;

function draw() {
    // Nettoyer le canvas
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Dessiner la nourriture (Rouge)
    ctx.fillStyle = '#e94560';
    ctx.fillRect(food.x * CELL_SIZE, food.y * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);

    // Dessiner le serpent (Vert/Jaune)
    snake.forEach((part, index) => {
        ctx.fillStyle = (index === 0) ? '#4ecca3' : '#f8b500';
        ctx.fillRect(part.x * CELL_SIZE, part.y * CELL_SIZE, CELL_SIZE - 2, CELL_SIZE - 2);
    });
}

async function update() {
    if (gameOver) return;

    // 1. Préparer la grille pour l'IA (format 0:vide, 1:serpent, 2:food)
    let grid = Array(GRID_SIZE).fill().map(() => Array(GRID_SIZE).fill(0));
    snake.forEach(p => grid[p.y][p.x] = 1);
    grid[food.y][food.x] = 2;

    // 2. Appeler l'API pour obtenir l'action (0:Haut, 1:Bas, 2:Gauche, 3:Droite)
    try {
        const response = await fetch('/api/predict', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ grid: grid })
        });
        const data = await response.json();
        const action = data.action;

        const actionsLabel = ["HAUT", "BAS", "GAUCHE", "DROITE"];
        iaActionEl.innerText = actionsLabel[action];

        // 3. Appliquer le mouvement
        let head = { ...snake[0] };
        if (action === 0) head.y--;
        if (action === 1) head.y++;
        if (action === 2) head.x--;
        if (action === 3) head.x++;

        // Check collisions
        if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE || 
            snake.some(p => p.x === head.x && p.y === head.y)) {
            gameOver = true;
            alert("Game Over! Score: " + score);
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

        draw();
    } catch (e) {
        console.error("Erreur API:", e);
    }
}

function placeFood() {
    food = {
        x: Math.floor(Math.random() * GRID_SIZE),
        y: Math.floor(Math.random() * GRID_SIZE)
    };
    // Empêcher la nourriture de spawn sur le serpent
    if (snake.some(p => p.x === food.x && p.y === food.y)) placeFood();
}

function resetGame() {
    snake = [{x: 2, y: 2}];
    score = 0;
    scoreEl.innerText = score;
    gameOver = false;
    placeFood();
    draw();
}

// Boucle de jeu (toutes les 300ms pour voir l'IA réfléchir)
setInterval(update, 300);
draw();