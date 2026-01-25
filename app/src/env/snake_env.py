import gymnasium as gym
from gymnasium import spaces
import numpy as np
import random
import pygame
import sys

# Codes ANSI pour le rendu Console
RESET = "\033[0m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
WHITE = "\033[37m"

class SnakeEnv(gym.Env):
    """
    Environnement Snake compatible Gymnasium avec rendu Console et Pygame.
    """
    metadata = {"render_modes": ["human", "pygame"], "render_fps": 10}

    def __init__(self, grid_size=10, render_mode=None, max_steps=150):
        super().__init__()

        self.grid_size = grid_size
        self.render_mode = render_mode
        self.max_steps = max_steps

        # Paramètres Pygame
        self.window_size = 500  # Taille de la fenêtre
        self.cell_size = self.window_size // self.grid_size
        self.window = None
        self.clock = None

        # Actions : 0=Haut, 1=Bas, 2=Gauche, 3=Droite
        self.action_space = spaces.Discrete(4)

        # Observation : Grille 2D (0: vide, 1: serpent, 2: nourriture)
        self.observation_space = spaces.Box(
            low=0, high=2, shape=(grid_size, grid_size), dtype=np.int8
        )

        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        
        # Initialisation du serpent au centre
        start_pos = (self.grid_size // 2, self.grid_size // 2)
        self.snake = [start_pos]
        
        # Placement de la nourriture
        self.food = None
        self._place_food()
        
        self.step_count = 0

        if self.render_mode == "pygame":
            self._render_frame()

        return self._get_obs(), {}

    def step(self, action):
        self.step_count += 1

        # 1. Calculer la nouvelle position de la tête
        head_x, head_y = self.snake[0]
        if action == 0:  # Haut
            head_x -= 1
        elif action == 1:  # Bas
            head_x += 1
        elif action == 2:  # Gauche
            head_y -= 1
        elif action == 3:  # Droite
            head_y += 1

        new_head = (head_x, head_y)

        # 2. Vérifier les collisions
        terminated = False
        reward = 0

        # Collision murs ou corps
        if (head_x < 0 or head_x >= self.grid_size or
                head_y < 0 or head_y >= self.grid_size or
                new_head in self.snake):
            terminated = True
            reward = -1  # Grosse pénalité en cas de mort
        else:
            self.snake.insert(0, new_head)

            # 3. Vérifier si mange la nourriture
            if new_head == self.food:
                reward = 1  # Grosse récompense
                placed = self._place_food()
                if not placed:
                    # Plus de cases vides -> dernière nourriture mangée -> fin de la partie
                    terminated = True
            else:
                self.snake.pop()  # On retire la queue si on n'a pas mangé
                reward = -0.01  # Petite pénalité pour encourager à avancer vite

        # 4. Vérifier la troncature (temps max)
        truncated = self.step_count >= self.max_steps

        # 5. Rendu
        if self.render_mode == "pygame":
            self._render_frame()

        return self._get_obs(), reward, terminated, truncated, {}

    def _place_food(self):
        """Place une pomme sur une case vide. Retourne True si placée, False sinon."""
        empty_cells = [
            (r, c) for r in range(self.grid_size) for c in range(self.grid_size)
            if (r, c) not in self.snake
        ]
        if empty_cells:
            self.food = random.choice(empty_cells)
            return True
        else:
            self.food = None
            return False


    def _get_obs(self):
        """Génère la matrice de la grille."""
        grid = np.zeros((self.grid_size, self.grid_size), dtype=np.int8)
        for i, (r, c) in enumerate(self.snake):
            grid[r, c] = 1 # Corps
        if self.food:
            grid[self.food[0], self.food[1]] = 2 # Nourriture
        return grid

    def render(self):
        """Point d'entrée pour le rendu."""
        if self.render_mode == "human":
            self._render_console()
        elif self.render_mode == "pygame":
            self._render_frame()

    def _render_console(self):
        """Affiche le jeu dans le terminal."""
        print(WHITE + "┌" + "─" * (self.grid_size * 2) + "┐" + RESET)
        for r in range(self.grid_size):
            line = WHITE + "│" + RESET
            for c in range(self.grid_size):
                if (r, c) == self.snake[0]:
                    line += GREEN + "■ " + RESET # Tête
                elif (r, c) in self.snake:
                    line += YELLOW + "■ " + RESET # Corps
                elif (r, c) == self.food:
                    line += RED + "■ " + RESET # Fruit
                else:
                    line += "  "
            line += WHITE + "│" + RESET
            print(line)
        print(WHITE + "└" + "─" * (self.grid_size * 2) + "┘" + RESET)

    def _render_frame(self):
        if self.window is None:
            pygame.init()
            pygame.display.init()
            # On force la création de la fenêtre
            self.window = pygame.display.set_mode((self.window_size, self.window_size))
            pygame.display.set_caption("Snake AI")
        
        if self.clock is None:
            self.clock = pygame.time.Clock()

        # On traite TOUS les événements (évite que la fenêtre ne freeze)
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self.close()
                sys.exit()

        canvas = pygame.Surface((self.window_size, self.window_size))
        canvas.fill((20, 20, 20))

        # Dessin de la nourriture
        if self.food:
            pygame.draw.rect(
                canvas, (231, 76, 60),
                pygame.Rect(self.food[1] * self.cell_size, self.food[0] * self.cell_size, self.cell_size, self.cell_size)
            )

        # Dessin du serpent
        for i, (r, c) in enumerate(self.snake):
            color = (46, 204, 113) if i == 0 else (241, 196, 15)
            pygame.draw.rect(
                canvas, color,
                pygame.Rect(c * self.cell_size, r * self.cell_size, self.cell_size, self.cell_size)
            )

        self.window.blit(canvas, canvas.get_rect())
        pygame.display.flip() # On utilise flip() qui est plus robuste que update()
        self.clock.tick(self.metadata["render_fps"])
        
    def close(self):
        """Ferme les ressources proprement."""
        if self.window is not None:
            pygame.display.quit()
            pygame.quit()