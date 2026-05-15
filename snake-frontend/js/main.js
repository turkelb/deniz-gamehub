class Game {
  constructor() {
    this.canvas = document.getElementById('gameCanvas');
    this.renderer = new Renderer(this.canvas);
    this.input = new InputManager(this.canvas);
    this.network = new NetworkManager();
    this.prediction = new PredictionEngine();
    this.ui = new UIManager();

    this.playerSnake = null;    // Local predicted state
    this.remoteSnakes = {};     // id -> snakeData (from server)
    this.worldState = null;
    this.leaderboard = [];

    this.running = false;
    this.animationId = null;
    this.lastInputSend = 0;
    this.inputSendInterval = 1000 / 30; // 30 Hz

    this._setupNetworkCallbacks();
    this._setupGameEvents();
  }

  _setupNetworkCallbacks() {
    this.network.onConnect = () => {
      console.log('[Game] Connected to server');
      this.ui.showConnectionStatus(true);
    };

    this.network.onDisconnect = () => {
      console.log('[Game] Disconnected');
      this.ui.showConnectionStatus(false);
    };

    this.network.onGameState = (state) => {
      this.worldState = state;
      this.renderer.setWorldState(state);

      // Update remote snakes
      this.remoteSnakes = {};
      if (state.snakes) {
        for (const s of state.snakes) {
          this.remoteSnakes[s.id] = s;
        }
      }

      // Reconcile local player
      if (this.playerSnake && this.network.playerId) {
        this.prediction.reconcile(state, this.playerSnake);
      }
    };

    this.network.onLeaderboard = (lb) => {
      this.leaderboard = lb;
      this.ui.updateLeaderboard(lb);
    };

    this.network.onYourId = (data) => {
      console.log('[Game] My ID:', data.id);
      this.network.playerId = data.id;
      this.ui.init(data.id);

      // Find our snake in the world state
      if (this.worldState && this.worldState.snakes) {
        const me = this.worldState.snakes.find(s => s.id === data.id);
        if (me) {
          this.playerSnake = { ...me };
          this.renderer.updateCamera(this.playerSnake);
        }
      }
    };

    this.network.onPlayerJoined = (data) => {
      // Optional: toast notification
    };

    this.network.onPlayerLeft = (data) => {
      delete this.remoteSnakes[data.id];
    };

    this.network.onDeathAnalysis = (data) => {
      this.ui.showDeathScreen(this.playerSnake, data.analysis);
    };
  }

  _setupGameEvents() {
    // Start game
    document.addEventListener('startGame', (e) => {
      const { name, skin } = e.detail;
      this.network.connect();
      // Wait for connection then join
      const checkConnect = setInterval(() => {
        if (this.network.connected) {
          clearInterval(checkConnect);
          this.network.join(name, skin);
          this.running = true;
          this._gameLoop(0);
        }
      }, 50);
    });

    // Respawn
    document.addEventListener('requestRespawn', () => {
      this.network.requestRespawn();
    });

    // Track previous alive state to detect death
    this._wasAlive = true;
  }

  _gameLoop(timestamp) {
    if (!this.running) return;
    this.animationId = requestAnimationFrame((t) => this._gameLoop(t));

    // Check for player snake in world state
    if (!this.playerSnake && this.worldState && this.network.playerId) {
      const me = this.worldState.snakes?.find(s => s.id === this.network.playerId);
      if (me) {
        this.playerSnake = { ...me };
      }
    }

    // Update player reference from server state
    if (this.playerSnake && this.worldState) {
      const serverMe = this.worldState.snakes?.find(s => s.id === this.network.playerId);
      if (serverMe) {
        // Check if just died
        if (this._wasAlive && !serverMe.alive) {
          this._wasAlive = false;
          this.ui.showDeathScreen(this.playerSnake, null);
        } else if (!this._wasAlive && serverMe.alive) {
          this._wasAlive = true;
          this.ui.hideDeathScreen();
        }

        // Update local player state
        this.playerSnake = { ...serverMe };
      }
    }

    // Send input
    if (this.network.connected && this.playerSnake && this.playerSnake.alive) {
      const now = timestamp;
      if (now - this.lastInputSend >= this.inputSendInterval) {
        const input = this.input.getInput(
          this.renderer.cameraX,
          this.renderer.cameraY,
          this.playerSnake
        );
        this.network.sendInput(input);
        this.prediction.recordInput(input, this.network.lastInputSeq);
        this.lastInputSend = now;
      }
    }

    // Update camera
    if (this.playerSnake && this.playerSnake.alive) {
      this.renderer.updateCamera(this.playerSnake);
    }

    // Update HUD
    this.ui.updateHUD(this.playerSnake);

    // Render
    this.renderer.render(timestamp);
  }

  destroy() {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this.network.disconnect();
  }
}

// Start the game when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
