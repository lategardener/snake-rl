#  Neural Snake • AI Arcade

**Bienvenue dans l'arène de l'Intelligence Artificielle.**
Ici, ce n'est pas vous qui jouez au Snake. C'est une IA que j'ai entraînée qui joue pour vous.

Votre rôle ? **L'observer, l'analyser... et la piéger.**

---

##  [CLIQUER ICI POUR JOUER](https://snake-rl.onrender.com)

---

## 🎮 Comment ça marche ?

Ce projet utilise le **Deep Reinforcement Learning** (Apprentissage par Renforcement). Le serpent a appris tout seul à jouer en faisant des millions d'essais et d'erreurs. Il "voit" la grille et décide de la meilleure action (Haut, Bas, Gauche, Droite) pour maximiser son score.

### 1. Choisissez votre Champion
Dans le menu de gauche, sélectionnez un **Agent**.
* **Classic :** Un agent entraîné sur le jeu standard. Il est prudent et efficace.
* **Walls (God Mode) :** Un agent entraîné à survivre avec des murs dynamiques. Il est plus paranoïaque et robuste.

### 2. Devenez le Maître du Jeu
Vous ne contrôlez pas le serpent, mais vous contrôlez son environnement ! Utilisez les **Outils Interactifs** pour le tester :

* **Plan Next Food :** Au prochain repas, le jeu se fige. C'est à VOUS de cliquer sur la grille pour placer la prochaine pomme. Mettez-la dans un coin difficile pour voir si l'IA s'en sort !
*  **Drop Wall :** *(Uniquement avec les agents 'Walls')* Faites apparaître un mur temporaire devant le serpent pour le forcer à réagir en urgence.

### 3. Lisez dans ses pensées
Le panneau **"Brain Visualization"** à droite vous montre en temps réel ce que l'IA pense.
* Les barres colorées indiquent la probabilité qu'elle choisisse une direction.
* Si une barre est verte, elle est sûre d'elle. Si toutes sont basses, elle panique !

---

## 🛠️ Technologies
* **Cerveau :** PyTorch & Stable Baselines 3 (PPO Algorithm)
* **Interface :** HTML5 / Canvas / JavaScript
* **Backend :** FastAPI (Python)
* **Hébergement :** Render & Hugging Face

---

## Prometheus

Pour avoir les metrics personnalisé (nombre de modèle charger et partie lancé) en locale sur prometheus il est nécessaire de modifier API_BASE_URL et de mettre la valeur window.location.origin, cette variable se trouve dans web/static/js/game.js à la ligne 1.
Car sinon le backend est lancé par render et vous ne verrez pas les metrics apparaitre en locale.

*Projet réalisé par Marc DJOLE & Sonny BERTHELOT*