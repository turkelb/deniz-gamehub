const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const GameWorld = require('./game/GameWorld');
const Snake = require('./game/Snake');
const BotManager = require('./game/BotManager');
const { getGameAnalysis } = require('./services/deepseek');
const { TICK_MS, TICK_RATE } = require('./game/constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingInterval: 5000,
  pingTimeout: 15000,
  transports: ['websocket', 'polling'],
});

const world = new GameWorld();
const botManager = new BotManager(world);

// Player tracking
const playerSockets = new Map();  // socketId -> { snakeId, playerName, ... }

// Game loop
let lastTick = Date.now();
let tickAccumulator = 0;

function gameLoop() {
  const now = Date.now();
  let dt = now - lastTick;
  lastTick = now;

  // Cap dt to prevent spiral of death
  if (dt > 200) dt = 200;

  tickAccumulator += dt;

  while (tickAccumulator >= TICK_MS) {
    world.update(TICK_MS);
    tickAccumulator -= TICK_MS;
  }

  // Broadcast state at 10 Hz (every 100ms)
  if (world.tickCount % 2 === 0) {
    const state = world.getFullState();
    io.emit('gameState', state);
  }

  // Broadcast leaderboard at 2 Hz (every 500ms)
  if (world.tickCount % 10 === 0) {
    io.emit('leaderboard', world.getLeaderboard());
  }
}

setInterval(gameLoop, TICK_MS);

// Start bots
botManager.start();

// Socket.io handlers
io.on('connection', (socket) => {
  console.log(`[Connect] ${socket.id}`);

  socket.on('join', (data) => {
    const name = (data.name || 'Player').substring(0, 20);
    const skin = data.skin || 'default';
    const snakeId = `p_${socket.id}`;
    const snake = new Snake(snakeId, name, skin, false);

    world.addSnake(snake);
    playerSockets.set(socket.id, { snakeId, playerName: name, joinedAt: Date.now() });

    socket.emit('yourId', { id: snakeId });
    socket.emit('gameState', world.getFullState());

    // Notify others
    socket.broadcast.emit('playerJoined', {
      id: snakeId,
      name,
      skinName: skin,
    });

    console.log(`[Join] ${name} (${snakeId})`);
  });

  socket.on('input', (data) => {
    const ps = playerSockets.get(socket.id);
    if (!ps) return;

    const snake = world.getSnake(ps.snakeId);
    if (!snake || !snake.alive) return;

    if (data.angle !== undefined) {
      snake.setAngle(data.angle);
    }
    if (data.boost !== undefined) {
      snake.setBoost(data.boost);
    }
  });

  socket.on('respawn', () => {
    const ps = playerSockets.get(socket.id);
    if (!ps) return;

    const snake = world.getSnake(ps.snakeId);
    if (!snake) return;

    if (!snake.alive) {
      // Generate AI analysis before respawn
      const stats = { score: snake.score, length: snake.length, kills: snake.kills, deaths: snake.deaths + 1 };
      getGameAnalysis(ps.playerName, stats, { deathCause: 'collision', longestStreak: 0 })
        .then(analysis => {
          socket.emit('deathAnalysis', { analysis, stats });
        });

      snake.respawn();
      socket.emit('gameState', world.getFullState());
    }
  });

  socket.on('disconnect', () => {
    const ps = playerSockets.get(socket.id);
    if (ps) {
      const snake = world.getSnake(ps.snakeId);
      if (snake) {
        world.removeSnake(ps.snakeId);
        io.emit('playerLeft', { id: ps.snakeId });
        console.log(`[Leave] ${ps.playerName} (${ps.snakeId})`);
      }
      playerSockets.delete(socket.id);
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    players: world.getPlayerCount(),
    bots: botManager.bots.size,
    uptime: Math.round((Date.now() - world.startTime) / 1000),
    tick: world.tickCount,
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Snake Clash.io server running on port ${PORT}`);
  console.log(`Game tick rate: ${TICK_RATE} Hz`);
});
