const { WORLD_W, WORLD_H, MAX_FOOD, FOOD_TYPES, SPAWN_MARGIN } = require('./constants');

class Food {
  constructor() {
    this.items = [];
    this._init();
  }

  _init() {
    for (let i = 0; i < MAX_FOOD; i++) {
      this.items.push(this._spawnOne());
    }
  }

  _spawnOne() {
    const ft = FOOD_TYPES[Math.floor(Math.random() * FOOD_TYPES.length)];
    return {
      x: SPAWN_MARGIN + Math.random() * (WORLD_W - SPAWN_MARGIN * 2),
      y: SPAWN_MARGIN + Math.random() * (WORLD_H - SPAWN_MARGIN * 2),
      type: ft.type,
      nutrition: ft.nutrition,
      radius: ft.radius,
      color: ft.color,
      score: ft.score,
    };
  }

  spawn(count = 1) {
    for (let i = 0; i < count; i++) {
      if (this.items.length < MAX_FOOD) {
        this.items.push(this._spawnOne());
      }
    }
  }

  remove(index) {
    this.items.splice(index, 0);  // Will be replaced by spawn
  }

  removeAt(index) {
    this.items.splice(index, 1);
  }

  getNearby(x, y, radius) {
    const result = [];
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      const dx = Math.abs(x - f.x);
      const dy = Math.abs(y - f.y);
      const dxW = Math.min(dx, WORLD_W - dx);
      const dyW = Math.min(dy, WORLD_H - dy);
      if (Math.sqrt(dxW * dxW + dyW * dyW) < radius + f.radius) {
        result.push({ index: i, food: f, dist: Math.sqrt(dxW * dxW + dyW * dyW) });
      }
    }
    return result;
  }

  getState() {
    return this.items;
  }

  // Return sparse food data (only changed items)
  getDelta() {
    return this.items.slice(0, MAX_FOOD);
  }
}

module.exports = Food;
