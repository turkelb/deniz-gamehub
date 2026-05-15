const {
  WORLD_W, WORLD_H, MAX_POWERUPS, POWERUP_TYPES, SPAWN_MARGIN,
} = require('./constants');

class PowerUpManager {
  constructor() {
    this.items = [];
    this.spawnTimer = 0;
  }

  update(dt) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.items.length < MAX_POWERUPS) {
      this.spawn();
      this.spawnTimer = 8000 + Math.random() * 4000;
    }
  }

  spawn() {
    const pt = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    this.items.push({
      x: SPAWN_MARGIN + Math.random() * (WORLD_W - SPAWN_MARGIN * 2),
      y: SPAWN_MARGIN + Math.random() * (WORLD_H - SPAWN_MARGIN * 2),
      type: pt.type,
      duration: pt.duration,
      radius: pt.radius,
      icon: pt.icon,
      color: pt.color,
    });
  }

  collect(index) {
    if (index >= 0 && index < this.items.length) {
      const item = this.items[index];
      this.items.splice(index, 1);
      return item;
    }
    return null;
  }

  getState() {
    return this.items;
  }
}

module.exports = PowerUpManager;
