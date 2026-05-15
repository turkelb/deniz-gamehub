const {
  SNAKE_BASE_SPEED, SNAKE_BOOST_SPEED, SNAKE_START_LENGTH,
  SNAKE_SEGMENT_SIZE, WORLD_W, WORLD_H, SPAWN_MARGIN,
  SPAWN_INVINCIBILITY_MS, TICK_MS,
} = require('./constants');

const SKINS = {
  default: { head: '#51cf66', body: ['#40c057', '#2f9e44', '#37b24d', '#69db7c'], eye: '#fff', pupil: '#111' },
  viper: { head: '#ff6b6b', body: ['#ee5a24', '#f0932b', '#e84118', '#c23616'], eye: '#fff', pupil: '#111' },
  ocean: { head: '#0abde3', body: ['#48dbfb', '#0abde3', '#01a3a4', '#00d2d3'], eye: '#fff', pupil: '#111' },
  golden: { head: '#feca57', body: ['#ff9f43', '#feca57', '#ff9f43', '#feca57'], eye: '#fff', pupil: '#111' },
  neon: { head: '#ff00ff', body: ['#be2edd', '#e056a0', '#c44569', '#cf6a87'], eye: '#0ff', pupil: '#000' },
  shadow: { head: '#2f3542', body: ['#57606f', '#747d8c', '#2f3542', '#57606f'], eye: '#ff4757', pupil: '#111' },
};

function randomSkin() {
  const keys = Object.keys(SKINS);
  return keys[Math.floor(Math.random() * keys.length)];
}

const NEXT_ID = { val: 0 };

class Snake {
  constructor(id, name, skinName, isBot = false) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.skinName = skinName || randomSkin();
    this.skin = SKINS[this.skinName] || SKINS.default;

    // Position
    this.x = SPAWN_MARGIN + Math.random() * (WORLD_W - SPAWN_MARGIN * 2);
    this.y = SPAWN_MARGIN + Math.random() * (WORLD_H - SPAWN_MARGIN * 2);
    this.angle = Math.random() * Math.PI * 2;

    // Segments: each { x, y }
    this.segments = [];
    for (let i = 0; i < SNAKE_START_LENGTH; i++) {
      this.segments.push({
        x: this.x - Math.cos(this.angle) * i * SNAKE_SEGMENT_SIZE * 1.1,
        y: this.y - Math.sin(this.angle) * i * SNAKE_SEGMENT_SIZE * 1.1,
      });
    }

    // State
    this.alive = true;
    this.invincibleUntil = Date.now() + SPAWN_INVINCIBILITY_MS;
    this.score = 0;
    this.kills = 0;
    this.deaths = 0;
    this.length = SNAKE_START_LENGTH;

    // Input
    this.targetAngle = this.angle;
    this.boosting = false;

    // Boost
    this.boostActive = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;

    // Power-ups
    this.activePowerUps = {};  // { magnet: endTime, speed: endTime }

    // Interpolation (for rendering)
    this.prevX = this.x;
    this.prevY = this.y;

    // Bot AI state
    this.aiTarget = null;
    this.aiTimer = 0;
    this.aiDirection = { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  get isInvincible() {
    return Date.now() < this.invincibleUntil;
  }

  get speed() {
    let s = this.boosting || this.boostActive ? SNAKE_BOOST_SPEED : SNAKE_BASE_SPEED;
    if (this.activePowerUps.speed) s *= 1.6;
    return s;
  }

  get head() {
    return this.segments[0];
  }

  setAngle(angle) {
    this.targetAngle = angle;
  }

  setBoost(active) {
    if (active && this.boostCooldown <= 0 && !this.boostActive) {
      this.boostActive = true;
      this.boostTimer = 2000;
      this.boostCooldown = 5000;
    }
    this.boosting = active && this.boostTimer > 0;
  }

  activatePowerUp(type, duration) {
    this.activePowerUps[type] = Date.now() + duration;
  }

  update(dt) {
    if (!this.alive) return;

    // Smooth angle turn
    const turnSpeed = 0.12;
    let diff = this.targetAngle - this.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.angle += diff * Math.min(turnSpeed * dt / TICK_MS, 1);

    // Store previous position for interpolation
    this.prevX = this.head.x;
    this.prevY = this.head.y;

    // Move head
    const spd = this.speed;
    const newHeadX = this.head.x + Math.cos(this.angle) * spd;
    const newHeadY = this.head.y + Math.sin(this.angle) * spd;

    // Wrap around world
    const wx = ((newHeadX % WORLD_W) + WORLD_W) % WORLD_W;
    const wy = ((newHeadY % WORLD_H) + WORLD_H) % WORLD_H;

    // Add new head
    this.segments.unshift({ x: wx, y: wy });

    // Remove tail to maintain length
    while (this.segments.length > this.length) {
      this.segments.pop();
    }

    // Update boost timer
    if (this.boostActive) {
      this.boostTimer -= dt;
      if (this.boostTimer <= 0) {
        this.boostActive = false;
        this.boostTimer = 0;
      }
    }
    if (this.boostCooldown > 0) {
      this.boostCooldown -= dt;
    }

    // Update power-up timers
    const now = Date.now();
    for (const [type, endTime] of Object.entries(this.activePowerUps)) {
      if (now >= endTime) {
        delete this.activePowerUps[type];
      }
    }
  }

  grow(amount) {
    this.length += amount;
    this.score += amount * 10;
  }

  die() {
    this.alive = false;
    this.deaths++;
  }

  respawn() {
    this.x = SPAWN_MARGIN + Math.random() * (WORLD_W - SPAWN_MARGIN * 2);
    this.y = SPAWN_MARGIN + Math.random() * (WORLD_H - SPAWN_MARGIN * 2);
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.segments = [];
    for (let i = 0; i < SNAKE_START_LENGTH; i++) {
      this.segments.push({
        x: this.x - Math.cos(this.angle) * i * SNAKE_SEGMENT_SIZE * 1.1,
        y: this.y - Math.sin(this.angle) * i * SNAKE_SEGMENT_SIZE * 1.1,
      });
    }
    this.alive = true;
    this.invincibleUntil = Date.now() + SPAWN_INVINCIBILITY_MS;
    this.length = SNAKE_START_LENGTH;
    this.score = 0;
    this.boostActive = false;
    this.boostTimer = 0;
    this.boostCooldown = 0;
    this.activePowerUps = {};
  }

  // Check if a point collides with this snake's body
  collidesWithHead(x, y, radius = SNAKE_HEAD_RADIUS) {
    const h = this.head;
    const dx = x - h.x;
    const dy = y - h.y;
    // Account for world wrap
    const dxW = Math.min(Math.abs(dx), WORLD_W - Math.abs(dx));
    const dyW = Math.min(Math.abs(dy), WORLD_H - Math.abs(dy));
    return Math.sqrt(dxW * dxW + dyW * dyW) < radius + SNAKE_HEAD_RADIUS;
  }

  collidesWithBody(x, y, skipCount = 1) {
    // Start from skipCount (skip head + nearby segments)
    for (let i = skipCount; i < this.segments.length; i++) {
      const s = this.segments[i];
      const dx = Math.abs(x - s.x);
      const dy = Math.abs(y - s.y);
      const dxW = Math.min(dx, WORLD_W - dx);
      const dyW = Math.min(dy, WORLD_H - dy);
      if (Math.sqrt(dxW * dxW + dyW * dyW) < SNAKE_SEGMENT_SIZE * 0.8) {
        return true;
      }
    }
    return false;
  }

  checkSelfCollision() {
    // Skip first 10 body segments — they're always close to the head
    // due to normal movement speed (3u/tick) and segment spacing
    return this.collidesWithBody(this.head.x, this.head.y, 10);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      skinName: this.skinName,
      isBot: this.isBot,
      x: this.head.x,
      y: this.head.y,
      angle: this.angle,
      segments: this.segments.slice(0, Math.min(this.segments.length, 200)),
      length: this.length,
      score: this.score,
      kills: this.kills,
      alive: this.alive,
      invincible: this.isInvincible,
      boosting: this.boostActive || this.boosting,
      boostCooldown: Math.max(0, this.boostCooldown),
      activePowerUps: Object.keys(this.activePowerUps).filter(
        t => this.activePowerUps[t] > Date.now()
      ),
    };
  }
}

module.exports = Snake;
