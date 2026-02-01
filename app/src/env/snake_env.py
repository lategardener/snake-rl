import gymnasium as gym
from gymnasium import spaces
import numpy as np
import random
import pygame

# Codes ANSI pour le rendu Console (utile pour le debug)
RESET = "\033[0m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
BLUE = "\033[34m"
WHITE = "\033[37m"


class SnakeEnv(gym.Env):
    """
    Environnement Snake compatible Gymnasium avec modes de jeu dynamiques.

    Modes de jeu (game_mode) :
    – "classic" : Mode standard (juste des pommes).
    – "walls" : Mode avancé (pommes + murs dynamiques).

    Dynamique des murs :
    – Apparaissent via interaction utilisateur ou aléatoirement.
    – Restent affichés pendant WALL_DURATION steps.
    – Disparaissent ensuite durant WALL_COOLDOWN_TIME steps.
    """
    metadata = {"render_modes": ["human", "pygame", "rgb_array"], "render_fps": 10}

    def __init__(self, grid_size=10, render_mode=None, max_steps=150, game_mode="classic"):
        super().__init__()

        self.step_count = None
        self.food = None
        self.snake = None
        self.grid_size = grid_size
        self.render_mode = render_mode
        self.max_steps = max_steps
        self.game_mode = game_mode  # "classic" ou "walls"

        # Paramètres Pygame
        self.window_size = 500
        self.cell_size = self.window_size // self.grid_size
        self.window = None
        self.clock = None

        # --- CONFIGURATION DES MURS ---
        self.walls = []  # Liste des positions (x, y) des murs actifs
        self.wall_timer = 0  # Compteur de durée de vie du mur
        self.wall_cooldown = 0  # Compteur d'attente avant prochain mur

        # Réglages de gameplay
        self.WALL_DURATION = 3  # Le mur reste 3 steps
        self.WALL_COOLDOWN_TIME = 6  # Temps de recharge entre deux murs
        self.WALL_RANDOM_PROB = 0.05  # 5% de chance qu'un mur apparaisse seul (mode automatique/entraînement)

        # --- INTERACTION API ---
        self.pending_food_position = None
        self.pending_wall_position = None

        # Actions : 0=Haut, 1=Bas, 2=Gauche, 3=Droite
        self.action_space = spaces.Discrete(4)

        # Observation : Grille 2D
        # 0 : Vide, 1 : Serpent, 2 : Nourriture, 3 : Mur temporaire
        self.observation_space = spaces.Box(
            low=0, high=3, shape=(grid_size, grid_size), dtype=np.int8
        )

        self.reset()

    def set_game_mode(self, mode):
        """Change le mode de jeu à la volée (appelé par l'API)"""
        if mode in ["classic", "walls"]:
            self.game_mode = mode
            # Nettoyage immédiat si on repasse en classique
            if mode == "classic":
                self.walls = []
                self.wall_timer = 0
                self.wall_cooldown = 0
            print(f"Mode de jeu changé : {mode}")

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)

        # Reset du Serpent (au centre)
        start_pos = (self.grid_size // 2, self.grid_size // 2)
        self.snake = [start_pos]

        #  Reset des mécanismes de jeu
        self.walls = []
        self.wall_timer = 0
        self.wall_cooldown = 0
        self.pending_food_position = None
        self.pending_wall_position = None

        # Placement première pomme
        self.food = None
        self._place_food()

        self.step_count = 0

        if self.render_mode == "pygame":
            self._render_frame()

        return self._get_obs(), {}

    def step(self, action):
        self.step_count += 1

        # --- PHASE 1 : GESTION DES MURS DYNAMIQUES ---

        # Cas A : Des murs sont présents → On décrémente leur vie
        if self.walls:
            self.wall_timer -= 1
            if self.wall_timer <= 0:
                self.walls = []  # Ils disparaissent
                self.wall_cooldown = self.WALL_COOLDOWN_TIME  # Début du temps de recharge

        # Cas B : Pas de murs, mais on est en recharge → On décrémente le cooldown
        elif self.wall_cooldown > 0:
            self.wall_cooldown -= 1

        # Cas C : Prêt à faire apparaître un mur (Mode Walls + Pas de murs + Cooldown fini)
        if self.game_mode == "walls" and not self.walls and self.wall_cooldown == 0:
            target_wall = None

            # Priorité 1 : L'utilisateur a cliqué (API)
            if self.pending_wall_position:
                target_wall = self.pending_wall_position
                self.pending_wall_position = None  # Action consommée

            # Priorité 2 : Aléatoire (Entraînement ou Idle)
            elif random.random() < self.WALL_RANDOM_PROB:
                empty_cells = self._get_empty_cells()
                if empty_cells:
                    target_wall = random.choice(empty_cells)

            # Application du mur (si valide)
            if target_wall:
                # Sécurité critique : Ne pas faire apparaître SUR le serpent ou la pomme
                if target_wall not in self.snake and target_wall != self.food:
                    self.walls = [target_wall]
                    self.wall_timer = self.WALL_DURATION

        # --- PHASE 2 : MOUVEMENT ---
        head_x, head_y = self.snake[0]
        if action == 0:
            head_x -= 1  # Haut
        elif action == 1:
            head_x += 1  # Bas
        elif action == 2:
            head_y -= 1  # Gauche
        elif action == 3:
            head_y += 1  # Droite

        new_head = (head_x, head_y)
        is_eating = (new_head == self.food)

        # --- PHASE 3 : COLLISIONS & RÉCOMPENSES ---
        terminated = False

        # Vérification des collisions (Murs Bordure OU Corps OU Murs Dynamiques)
        tail = self.snake[-1]

        # Collision bordures ou murs
        if (head_x < 0 or head_x >= self.grid_size or
                head_y < 0 or head_y >= self.grid_size or
                new_head in self.walls):

            terminated = True
            reward = -1

        # Collision avec le corps (sauf la queue si elle bouge)
        elif new_head in self.snake and not (new_head == tail and not is_eating):
            terminated = True
            reward = -1

        else:
            # Avancer toujours ici
            self.snake.insert(0, new_head)

            if is_eating:
                reward = 1
                placed = self._place_food()
                if not placed:
                    terminated = True
            else:
                self.snake.pop()
                reward = -0.01

        # Troncature (Max steps atteint)
        truncated = self.step_count >= self.max_steps

        # Rendu
        if self.render_mode == "pygame":
            self._render_frame()

        return self._get_obs(), reward, terminated, truncated, {}

    def queue_interaction(self, action_type, x, y):
        """
        API Entrypoint: Reçoit les ordres du Frontend.
        x, y : Coordonnées grille (0 à grid_size-1)
        """
        # Conversion Frontend (x,y) -> Backend (row, col) si nécessaire
        # Ici on suppose que le front envoie x=col, y=row.
        target = (y, x)

        if action_type == "place_food":
            self.pending_food_position = target

        elif action_type == "place_wall":
            # On enregistre l'intention, elle sera traitée au prochain step()
            # si le cooldown le permet.
            self.pending_wall_position = target

    def _place_food(self):
        """Place la nourriture (Manuel ou Auto)"""
        # 1. Manuel
        if self.pending_food_position:
            pos = self.pending_food_position
            # Vérif qu'on ne pose pas sur un obstacle
            if pos not in self.snake and pos not in self.walls:
                self.food = pos
                self.pending_food_position = None
                return True

        # 2. Auto
        empty_cells = self._get_empty_cells()
        if empty_cells:
            self.food = random.choice(empty_cells)
            return True
        return False

    def _get_empty_cells(self):
        return [
            (r, c) for r in range(self.grid_size) for c in range(self.grid_size)
            if (r, c) not in self.snake and (r, c) not in self.walls and (r, c) != self.food
        ]

    def _get_obs(self):
        """Génère la matrice d'observation pour l'IA"""
        grid = np.zeros((self.grid_size, self.grid_size), dtype=np.int8)

        # 1 = Corps
        for r, c in self.snake:
            grid[r, c] = 1

        # 2 = Nourriture
        if self.food:
            grid[self.food[0], self.food[1]] = 2

        # 3 = Murs Dynamiques
        for r, c in self.walls:
            grid[r, c] = 3

        # [NOUVEAU] Sauvegarde pour l'API externe (Streaming)
        self.current_grid_state = grid.tolist()

        return grid


    def get_state(self):
        """Retourne l'état brut pour la visualisation web"""
        return {
            "grid": getattr(self, "current_grid_state", []),
            "score": self.step_count,
            "head": self.snake[0] if self.snake else None,
            "is_dead": False  # Pourra être amélioré plus tard
        }


    def render(self):
        if self.render_mode == "human":
            self._render_console()
        elif self.render_mode == "pygame":
            self._render_frame()
        elif self.render_mode == "rgb_array":
            return self._render_frame(return_rgb=True)
        return None

    def _render_console(self):
        print(WHITE + "┌" + "─" * (self.grid_size * 2) + "┐" + RESET)
        for r in range(self.grid_size):
            line = WHITE + "│" + RESET
            for c in range(self.grid_size):
                if (r, c) == self.snake[0]:
                    line += GREEN + "■ " + RESET
                elif (r, c) in self.snake:
                    line += YELLOW + "■ " + RESET
                elif (r, c) == self.food:
                    line += RED + "● " + RESET
                elif (r, c) in self.walls:
                    line += BLUE + "▒ " + RESET
                else:
                    line += "  "
            line += WHITE + "│" + RESET
            print(line)
        print(WHITE + "└" + "─" * (self.grid_size * 2) + "┘" + RESET)

    def _render_frame(self, return_rgb=False):
        if self.window is None and self.render_mode == "pygame":
            pygame.init()
            pygame.display.init()
            self.window = pygame.display.set_mode((self.window_size, self.window_size))
            pygame.display.set_caption("Snake AI")

        if self.clock is None:
            self.clock = pygame.time.Clock()

        canvas = pygame.Surface((self.window_size, self.window_size))
        canvas.fill((20, 20, 20))  # Fond sombre

        # Dessin Nourriture (Rouge)
        if self.food:
            pygame.draw.rect(canvas, (231, 76, 60),
                             pygame.Rect(self.food[1] * self.cell_size, self.food[0] * self.cell_size, self.cell_size,
                                         self.cell_size))

        # Dessin Murs (Bleu/Gris avec style)
        for (r, c) in self.walls:
            pygame.draw.rect(canvas, (52, 152, 219),
                             pygame.Rect(c * self.cell_size, r * self.cell_size, self.cell_size, self.cell_size))
            pygame.draw.rect(canvas, (41, 128, 185),  # Bordure intérieure
                             pygame.Rect(c * self.cell_size + 4, r * self.cell_size + 4, self.cell_size - 8,
                                         self.cell_size - 8))

        # Dessin Serpent
        for i, (r, c) in enumerate(self.snake):
            color = (46, 204, 113) if i == 0 else (241, 196, 15)
            pygame.draw.rect(canvas, color,
                             pygame.Rect(c * self.cell_size, r * self.cell_size, self.cell_size, self.cell_size))

        if return_rgb:
            return np.transpose(np.array(pygame.surfarray.pixels3d(canvas)), (1, 0, 2))

        if self.render_mode == "pygame":
            self.window.blit(canvas, canvas.get_rect())
            pygame.event.pump()
            pygame.display.flip()
            self.clock.tick(self.metadata["render_fps"])
        return None

    def close(self):
        if self.window is not None:
            pygame.display.quit()
            pygame.quit()