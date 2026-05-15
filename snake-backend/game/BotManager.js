const Snake = require('./Snake');
const { WORLD_W, WORLD_H, SPAWN_MARGIN, MIN_BOTS, MAX_BOTS } = require('./constants');

const BOT_NAMES = [
  'ZekiBot', 'Predator', 'Venom', 'Hydra', 'Cobra',
  'ViperX', 'ShadowStrike', 'Fangs', 'SlitherKing', 'DeathRoll',
  'NightFang', 'TitanSnake', 'BladeScale', 'VenomStrike', 'IronCoil',
];

let botIdCounter = 1000;

class BotManager {
  constructor(world) {
    this.world = world;
    this.bots = new Map(); // id -> Snake
    this.aiInterval = null;
  }

  start() {
    this.aiInterval = setInterval(() => this.updateAI(), 1500);
    this.ensureBotCount();
  }

  stop() {
    if (this.aiInterval) {
      clearInterval(this.aiInterval);
      this.aiInterval = null;
    }
  }

  ensureBotCount() {
    const playerCount = this.world.getPlayerCount();
    const totalCount = playerCount + this.bots.size;

    if (totalCount < MIN_BOTS) {
      const toSpawn = MIN_BOTS - totalCount;
      for (let i = 0; i < toSpawn; i++) {
        this.spawnBot();
      }
    } else if (totalCount > MAX_BOTS) {
      const toRemove = totalCount - MAX_BOTS;
      for (let i = 0; i < toRemove; i++) {
        this.removeBot();
      }
    }
  }

  spawnBot() {
    const id = `bot_${botIdCounter++}`;
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + '_' + (botIdCounter % 100);
    const bot = new Snake(id, name, 'viper', true);
    this.bots.set(id, bot);
    this.world.addSnake(bot);
  }

  removeBot() {
    const firstKey = this.bots.keys().next().value;
    if (firstKey) {
      const bot = this.bots.get(firstKey);
      this.world.removeSnake(bot.id);
      this.bots.delete(firstKey);
    }
  }

  updateAI() {
    for (const bot of this.bots.values()) {
      if (!bot.alive) continue;
      this.runHeuristicAI(bot);
    }
    this.ensureBotCount();
  }

  runHeuristicAI(bot) {
    const head = bot.head;

    // Find nearest threat (bigger snake nearby, skip invincible)
    let nearestThreat = null;
    let threatDist = 300;
    for (const snake of this.world.snakes.values()) {
      if (snake.id === bot.id || !snake.alive || snake.isInvincible) continue;
      const dx = Math.min(Math.abs(head.x - snake.head.x), WORLD_W - Math.abs(head.x - snake.head.x));
      const dy = Math.min(Math.abs(head.y - snake.head.y), WORLD_H - Math.abs(head.y - snake.head.y));
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threatDist && snake.length > bot.length * 1.2) {
        nearestThreat = snake;
        threatDist = dist;
      }
    }

    // Find nearest player to hunt (skip invincible)
    let nearestPrey = null;
    let preyDist = 500;
    for (const snake of this.world.snakes.values()) {
      if (snake.id === bot.id || !snake.alive || snake.isBot || snake.isInvincible) continue;
      const dx = Math.min(Math.abs(head.x - snake.head.x), WORLD_W - Math.abs(head.x - snake.head.x));
      const dy = Math.min(Math.abs(head.y - snake.head.y), WORLD_H - Math.abs(head.y - snake.head.y));
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < preyDist && bot.length > snake.length * 1.5) {
        nearestPrey = snake;
        preyDist = dist;
      }
    }

    // Find nearest food
    let nearestFood = null;
    let foodDist = 400;
    for (let i = 0; i < this.world.food.items.length; i++) {
      const f = this.world.food.items[i];
      const dx = Math.min(Math.abs(head.x - f.x), WORLD_W - Math.abs(head.x - f.x));
      const dy = Math.min(Math.abs(head.y - f.y), WORLD_H - Math.abs(head.y - f.y));
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < foodDist) {
        nearestFood = f;
        foodDist = dist;
      }
    }

    // Find nearest power-up
    let nearestPU = null;
    let puDist = 350;
    for (const pu of this.world.powerUps.items) {
      const dx = Math.min(Math.abs(head.x - pu.x), WORLD_W - Math.abs(head.x - pu.x));
      const dy = Math.min(Math.abs(head.y - pu.y), WORLD_H - Math.abs(head.y - pu.y));
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < puDist) {
        nearestPU = pu;
        puDist = dist;
      }
    }

    let targetAngle = bot.angle;

    if (nearestThreat) {
      // Flee from threat
      const dx = head.x - nearestThreat.head.x;
      const dy = head.y - nearestThreat.head.y;
      targetAngle = Math.atan2(dy, dx);
      // Add some randomness
      targetAngle += (Math.random() - 0.5) * 0.5;
    } else if (nearestPrey && bot.length > 15) {
      // Hunt prey: aim ahead of them to cut them off
      const preyHead = nearestPrey.head;
      const preyAngle = nearestPrey.angle;
      const interceptX = preyHead.x + Math.cos(preyAngle) * 80;
      const interceptY = preyHead.y + Math.sin(preyAngle) * 80;
      const dx = interceptX - head.x;
      const dy = interceptY - head.y;
      targetAngle = Math.atan2(dy, dx);
    } else if (nearestPU) {
      const dx = nearestPU.x - head.x;
      const dy = nearestPU.y - head.y;
      targetAngle = Math.atan2(dy, dx);
    } else if (nearestFood) {
      const dx = nearestFood.x - head.x;
      const dy = nearestFood.y - head.y;
      targetAngle = Math.atan2(dy, dx);
    } else {
      // Wander
      targetAngle = bot.angle + (Math.random() - 0.5) * 0.6;
    }

    // Clamp angle change to avoid self-collision
    let angleDiff = targetAngle - bot.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    const maxTurn = 0.5; // radians per AI update
    if (angleDiff > maxTurn) angleDiff = maxTurn;
    if (angleDiff < -maxTurn) angleDiff = -maxTurn;
    targetAngle = bot.angle + angleDiff;

    // Avoid walls
    const margin = 150;
    if (head.x < margin) targetAngle = Math.random() * Math.PI - Math.PI / 2;
    if (head.x > WORLD_W - margin) targetAngle = Math.PI / 2 + Math.random() * Math.PI;
    if (head.y < margin) targetAngle = Math.random() * Math.PI;
    if (head.y > WORLD_H - margin) targetAngle = -Math.random() * Math.PI;

    bot.setAngle(targetAngle);

    // Boost when hunting prey and close enough
    bot.setBoost(nearestPrey && preyDist < 200 && bot.boostCooldown <= 0);
  }

  getBot(id) {
    return this.bots.get(id);
  }

  getAllBots() {
    return Array.from(this.bots.values());
  }
}

module.exports = BotManager;
