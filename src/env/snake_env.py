import gymnasium as gym
from gymnasium import spaces
import numpy as np
import random

class SnakeEnv(gym.Env):
    """Environnement simple pour Snake"""

    metadata = {"render_modes": ["human"], "render_fps": 4}

    def __init__(self, grid_size=10, render_mode=None):
        super().__init__()

        self.grid_size = grid_size
        self.render_mode = render_mode

        # Actions : 0=haut, 1=bas, 2=gauche, 3=droite
        self.action_space = spaces.Discrete(4)

        # Observation : matrice de la grille
        self.observation_space = spaces.Box(
            low=0, high=2, shape=(grid_size, grid_size), dtype=np.int8
        )

        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.snake = [(self.grid_size // 2, self.grid_size // 2)]
        self.direction = random.choice([0, 1, 2, 3])
        self._place_food()
        self.done = False
        return self._get_obs(), {}

    def step(self, action):
        if self.done:
            return self._get_obs(), 0, True, False, {}

        # Déplacer la tête
        x, y = self.snake[0]
        if action == 0:    # haut
            x -= 1
        elif action == 1:  # bas
            x += 1
        elif action == 2:  # gauche
            y -= 1
        elif action == 3:  # droite
            y += 1

        new_head = (x, y)

        # Vérifier collisions
        if (
            x < 0
            or x >= self.grid_size
            or y < 0
            or y >= self.grid_size
            or new_head in self.snake
        ):
            self.done = True
            reward = -1
        else:
            self.snake.insert(0, new_head)
            if new_head == self.food:
                reward = 1
                self._place_food()
            else:
                reward = 0
                self.snake.pop()

        return self._get_obs(), reward, self.done, False, {}

    def _place_food(self):
        empty = [
            (i, j)
            for i in range(self.grid_size)
            for j in range(self.grid_size)
            if (i, j) not in self.snake
        ]
        self.food = random.choice(empty)

    def _get_obs(self):
        grid = np.zeros((self.grid_size, self.grid_size), dtype=np.int8)
        for x, y in self.snake:
            grid[x, y] = 1
        fx, fy = self.food
        grid[fx, fy] = 2
        return grid

    def render(self):
        if self.render_mode != "human":
            return
        print("\n".join(
            "".join(
                "S" if (i, j) in self.snake else "F" if (i, j) == self.food else "."
                for j in range(self.grid_size)
            )
            for i in range(self.grid_size)
        ))
        print()
