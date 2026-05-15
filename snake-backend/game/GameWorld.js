const Snake = require('./Snake');
const Food = require('./Food');
const PowerUpManager = require('./PowerUp');
const {
  WORLD_W, WORLD_H, TICK_RATE, TICK_MS,
  SNAKE_HEAD_RADIUS, SNAKE_SEGMENT_SIZE,
  LEADERBOARD_SIZE, SPAWN_MARGIN, SPAWN_SAFE_RADIUS, SPAWN_INVINCIBILITY_MS,
} = require('./constants');

class GameWorld {
  constructor() {
    this.snakes = new Map();   // id -> Snake
    this.food = new Food();
    this.powerUps = new PowerUpManager();
    this.tickCount = 0;
    this.startTime = Date.now();
  }

  addSnake(snake) {
    console.log(`[Spawn] ${snake.name} (${snake.id}) spawning. invincUntil=${snake.invincibleUntil} now=${Date.now()} diff=${snake.invincibleUntil - Date.now()}ms`);
    // Find a safe spawn position
    const pos = this._findSafeSpawn();
    snake.x = pos.x;
    snake.y = pos.y;
    snake.angle = pos.angle;
    snake.targetAngle = pos.angle;
    // Rebuild segments at safe position
    snake.segments = [];
    for (let i = 0; i < snake.length; i++) {
      snake.segments.push({
        x: snake.x - Math.cos(snake.angle) * i * SNAKE_SEGMENT_SIZE * 1.1,
        y: snake.y - Math.sin(snake.angle) * i * SNAKE_SEGMENT_SIZE * 1.1,
      });
    }
    this.snakes.set(snake.id, snake);
  }

  _findSafeSpawn() {
    const margin = SPAWN_MARGIN + SPAWN_SAFE_RADIUS;
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = margin + Math.random() * (WORLD_W - margin * 2);
      const y = margin + Math.random() * (WORLD_H - margin * 2);

      let safe = true;
      for (const snake of this.snakes.values()) {
        if (!snake.alive) continue;
        // Check distance to head
        const dxH = Math.min(Math.abs(x - snake.head.x), WORLD_W - Math.abs(x - snake.head.x));
        const dyH = Math.min(Math.abs(y - snake.head.y), WORLD_H - Math.abs(y - snake.head.y));
        if (Math.sqrt(dxH * dxH + dyH * dyH) < SPAWN_SAFE_RADIUS) {
          safe = false;
          break;
        }
        // Check distance to body
        for (let i = 1; i < snake.segments.length; i += 3) {
          const s = snake.segments[i];
          const dxB = Math.min(Math.abs(x - s.x), WORLD_W - Math.abs(x - s.x));
          const dyB = Math.min(Math.abs(y - s.y), WORLD_H - Math.abs(y - s.y));
          if (Math.sqrt(dxB * dxB + dyB * dyB) < SPAWN_SAFE_RADIUS * 0.6) {
            safe = false;
            break;
          }
        }
        if (!safe) break;
      }

      if (safe) {
        return { x, y, angle: Math.random() * Math.PI * 2 };
      }
    }

    // Fallback: corner spawn if no safe position found
    return {
      x: margin,
      y: margin,
      angle: Math.PI / 4,
    };
  }

  removeSnake(id) {
    this.snakes.delete(id);
  }

  getPlayerCount() {
    let count = 0;
    for (const s of this.snakes.values()) {
      if (!s.isBot) count++;
    }
    return count;
  }

  getSnake(id) {
    return this.snakes.get(id);
  }

  update(dt) {
    this.tickCount++;

    // Update all snakes
    for (const snake of this.snakes.values()) {
      snake.update(dt);
    }

    // Check food collisions
    this._checkFoodCollisions();

    // Check power-up collisions
    this._checkPowerUpCollisions();

    // Update power-up spawning
    this.powerUps.update(dt);

    // Check snake-snake collisions
    this._checkSnakeCollisions();

    // Self-collision disabled — players can't die from hitting themselves

    // Respawn dead players after a delay
    // (handled by server via socket events)
  }

  _checkFoodCollisions() {
    for (const snake of this.snakes.values()) {
      if (!snake.alive) continue;

      const head = snake.head;
      let searchRadius = SNAKE_HEAD_RADIUS + 20;

      // Magnet power-up increases food pickup range
      if (snake.activePowerUps.magnet) {
        searchRadius = 200;
      }

      const nearby = this.food.getNearby(head.x, head.y, searchRadius);

      for (const { index, food: f } of nearby) {
        const dx = Math.min(Math.abs(head.x - f.x), WORLD_W - Math.abs(head.x - f.x));
        const dy = Math.min(Math.abs(head.y - f.y), WORLD_H - Math.abs(head.y - f.y));
        const dist = Math.sqrt(dx * dx + dy * dy);

        const pickupRadius = snake.activePowerUps.magnet
          ? 200
          : SNAKE_HEAD_RADIUS + f.radius;

        if (dist < pickupRadius) {
          snake.grow(f.nutrition);
          this.food.removeAt(index);
          this.food.spawn(1);
          break; // One food per tick per snake
        }
      }
    }
  }

  _checkPowerUpCollisions() {
    for (const snake of this.snakes.values()) {
      if (!snake.alive) continue;

      const head = snake.head;
      for (let i = this.powerUps.items.length - 1; i >= 0; i--) {
        const pu = this.powerUps.items[i];
        const dx = Math.min(Math.abs(head.x - pu.x), WORLD_W - Math.abs(head.x - pu.x));
        const dy = Math.min(Math.abs(head.y - pu.y), WORLD_H - Math.abs(head.y - pu.y));
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < SNAKE_HEAD_RADIUS + pu.radius) {
          snake.activatePowerUp(pu.type, pu.duration);
          this.powerUps.collect(i);
          break;
        }
      }
    }
  }

  _checkSnakeCollisions() {
    const snakesArr = Array.from(this.snakes.values());
    const toDie = new Set();

    for (let i = 0; i < snakesArr.length; i++) {
      const a = snakesArr[i];
      if (!a.alive || toDie.has(a.id)) continue;

      for (let j = i + 1; j < snakesArr.length; j++) {
        const b = snakesArr[j];
        if (!b.alive || toDie.has(b.id)) continue;

        // Head-to-head collision
        const aHead = a.head;
        const bHead = b.head;
        const dxHH = Math.min(Math.abs(aHead.x - bHead.x), WORLD_W - Math.abs(aHead.x - bHead.x));
        const dyHH = Math.min(Math.abs(aHead.y - bHead.y), WORLD_H - Math.abs(aHead.y - bHead.y));
        const distHH = Math.sqrt(dxHH * dxHH + dyHH * dyHH);

        if (distHH < SNAKE_HEAD_RADIUS * 1.8) {
          // Head-to-head: invincible snake survives
          if (!a.isInvincible) toDie.add(a.id);
          if (!b.isInvincible) toDie.add(b.id);
          continue;
        }

        // A's head hits B's body (skip if A is invincible)
        if (!a.isInvincible && b.collidesWithBody(a.head.x, a.head.y)) {
          toDie.add(a.id);
          if (!a.isBot && b.isBot) b.kills++;
        }

        // B's head hits A's body (skip if B is invincible)
        if (!b.isInvincible && a.collidesWithBody(b.head.x, b.head.y)) {
          toDie.add(b.id);
          if (!b.isBot && a.isBot) a.kills++;
        }
      }
    }

    for (const id of toDie) {
      const snake = this.snakes.get(id);
      if (snake) {
        console.log(`[Death] ${snake.name} (${snake.id}) dying. invincible=${snake.isInvincible}, age=${Date.now() - (snake.invincibleUntil - SPAWN_INVINCIBILITY_MS)}ms, len=${snake.length}`);
        snake.die();
      }
    }
  }

  getLeaderboard() {
    const arr = Array.from(this.snakes.values())
      .filter(s => s.alive)
      .sort((a, b) => b.score - a.score)
      .slice(0, LEADERBOARD_SIZE)
      .map(s => ({
        id: s.id,
        name: s.name,
        score: s.score,
        length: s.length,
        kills: s.kills,
        isBot: s.isBot,
        skinName: s.skinName,
      }));
    return arr;
  }

  getFullState() {
    return {
      snakes: Array.from(this.snakes.values()).map(s => s.toJSON()),
      foods: this.food.getState(),
      powerUps: this.powerUps.getState(),
      leaderboard: this.getLeaderboard(),
      worldSize: { w: WORLD_W, h: WORLD_H },
      tick: this.tickCount,
    };
  }

  getDeltaState() {
    // For efficiency, send full state (compression can be added later)
    return this.getFullState();
  }
}

module.exports = GameWorld;
