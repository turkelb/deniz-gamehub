class NetworkManager {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.playerId = null;
    this.lastInputSeq = 0;
    this.latency = 0;
    this.pingSent = 0;

    // Callbacks
    this.onGameState = null;
    this.onLeaderboard = null;
    this.onYourId = null;
    this.onPlayerJoined = null;
    this.onPlayerLeft = null;
    this.onDeathAnalysis = null;
    this.onConnect = null;
    this.onDisconnect = null;
  }

  connect() {
    this.socket = io("http://" + window.location.hostname + ":3000", {
      transports: ['websocket', 'polling'],
      upgrade: true,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      document.getElementById('connectionStatus')?.classList.add('hidden');
      if (this.onConnect) this.onConnect();
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      const cs = document.getElementById('connectionStatus');
      if (cs) {
        cs.classList.remove('hidden');
        cs.querySelector('span').textContent = 'Bağlantı koptu... Yeniden bağlanıyor';
      }
      if (this.onDisconnect) this.onDisconnect();
    });

    this.socket.on('connect_error', () => {
      const cs = document.getElementById('connectionStatus');
      if (cs) {
        cs.classList.remove('hidden');
        cs.querySelector('span').textContent = 'Sunucuya bağlanılamadı';
      }
    });

    this.socket.on('gameState', (state) => {
      if (this.onGameState) this.onGameState(state);
    });

    this.socket.on('leaderboard', (lb) => {
      if (this.onLeaderboard) this.onLeaderboard(lb);
    });

    this.socket.on('yourId', (data) => {
      this.playerId = data.id;
      if (this.onYourId) this.onYourId(data);
    });

    this.socket.on('playerJoined', (data) => {
      if (this.onPlayerJoined) this.onPlayerJoined(data);
    });

    this.socket.on('playerLeft', (data) => {
      if (this.onPlayerLeft) this.onPlayerLeft(data);
    });

    this.socket.on('deathAnalysis', (data) => {
      if (this.onDeathAnalysis) this.onDeathAnalysis(data);
    });

    // Latency measurement
    setInterval(() => {
      if (!this.connected) return;
      this.pingSent = Date.now();
      // Use socket.io's internal ping
    }, 3000);
  }

  join(name, skin) {
    this.socket.emit('join', { name, skin });
  }

  sendInput(input) {
    if (!this.connected || !this.playerId) return;
    this.lastInputSeq++;
    this.socket.emit('input', {
      angle: input.angle,
      boost: input.boost,
      seq: this.lastInputSeq,
      time: Date.now(),
    });
  }

  requestRespawn() {
    this.socket.emit('respawn');
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}
