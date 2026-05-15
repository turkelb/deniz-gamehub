// Game world dimensions
const WORLD_W = 4000;
const WORLD_H = 4000;

// Tick rate
const TICK_RATE = 30;        // ticks per second
const TICK_MS = 1000 / TICK_RATE;

// Snake settings
const SNAKE_BASE_SPEED = 5.5;   // units per tick
const SNAKE_BOOST_SPEED = 9.0;
const SNAKE_START_LENGTH = 20;
const SPAWN_INVINCIBILITY_MS = 20000;
const SPAWN_SAFE_RADIUS = 350;
const SNAKE_SEGMENT_SIZE = 14;
const SNAKE_HEAD_RADIUS = 16;
const SNAKE_MIN_TURN_RADIUS = 4;

// Boost
const BOOST_DURATION = 2000;    // ms
const BOOST_COOLDOWN = 5000;    // ms

// Food
const MAX_FOOD = 250;
const FOOD_TYPES = [
  { type: 'watermelon', nutrition: 3, radius: 16, color: '#ff4757', score: 30 },
  { type: 'tomato', nutrition: 2, radius: 13, color: '#ff6348', score: 20 },
  { type: 'apple', nutrition: 2, radius: 12, color: '#ff3838', score: 20 },
  { type: 'grape', nutrition: 1, radius: 10, color: '#a855f7', score: 10 },
  { type: 'orange', nutrition: 1, radius: 11, color: '#ffa502', score: 10 },
];

// Power-ups
const POWERUP_SPAWN_INTERVAL = 8000;  // ms
const MAX_POWERUPS = 8;
const POWERUP_TYPES = [
  { type: 'magnet', duration: 8000, radius: 200, icon: '🧲', color: '#f368e0' },
  { type: 'speed', duration: 4000, radius: 18, icon: '⚡', color: '#ffd700' },
];

// Viewport padding for spawn margin
const SPAWN_MARGIN = 200;

// Bot settings
const MIN_BOTS = 3;
const MAX_BOTS = 8;
const BOT_AI_INTERVAL = 1500;   // ms between AI decisions

// Leaderboard
const LEADERBOARD_SIZE = 10;

module.exports = {
  WORLD_W, WORLD_H, TICK_RATE, TICK_MS,
  SNAKE_BASE_SPEED, SNAKE_BOOST_SPEED, SNAKE_START_LENGTH,
  SNAKE_SEGMENT_SIZE, SNAKE_HEAD_RADIUS, SNAKE_MIN_TURN_RADIUS,
  BOOST_DURATION, BOOST_COOLDOWN,
  MAX_FOOD, FOOD_TYPES,
  POWERUP_SPAWN_INTERVAL, MAX_POWERUPS, POWERUP_TYPES,
  SPAWN_MARGIN, SPAWN_INVINCIBILITY_MS, SPAWN_SAFE_RADIUS,
  MIN_BOTS, MAX_BOTS, BOT_AI_INTERVAL,
  LEADERBOARD_SIZE,
};
