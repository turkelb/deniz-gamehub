/**
 * Client-side prediction for smooth snake movement.
 *
 * How it works:
 * 1. Player input is applied locally immediately
 * 2. Server sends authoritative state
 * 3. If discrepancy > threshold, smoothly interpolate to server position
 */
class PredictionEngine {
  constructor() {
    this.inputHistory = [];  // { seq, angle, boost, time }
    this.serverState = null;
    this.reconciled = false;
  }

  recordInput(input, seq) {
    this.inputHistory.push({
      seq,
      angle: input.angle,
      boost: input.boost,
      time: Date.now(),
    });

    // Keep only last 60 inputs (~3 seconds at 20Hz)
    if (this.inputHistory.length > 60) {
      this.inputHistory.shift();
    }
  }

  /**
   * Apply prediction to the local snake state.
   * This runs the snake forward using pending inputs that the server hasn't processed yet.
   */
  applyLocalPrediction(snake, serverSnake) {
    if (!serverSnake || !snake) return;

    // Update position from server (authoritative)
    snake.x = serverSnake.x;
    snake.y = serverSnake.y;
    snake.angle = serverSnake.angle;
    snake.segments = serverSnake.segments;
    snake.length = serverSnake.length;
    snake.score = serverSnake.score;
    snake.alive = serverSnake.alive;
    snake.boosting = serverSnake.boosting;
    snake.boostCooldown = serverSnake.boostCooldown;
    snake.activePowerUps = serverSnake.activePowerUps || [];
  }

  /**
   * Interpolate between previous and current server state for smooth rendering.
   */
  interpolateSnake(snake, serverSnake, alpha) {
    if (!serverSnake) return;

    snake.x = snake.x + (serverSnake.x - snake.x) * 0.3;
    snake.y = snake.y + (serverSnake.y - snake.y) * 0.3;
    snake.angle = snake.angle + (serverSnake.angle - snake.angle) * 0.3;

    // Snap segments to server positions (they're the visual representation)
    if (serverSnake.segments && serverSnake.segments.length > 0) {
      snake.segments = serverSnake.segments;
      snake.length = serverSnake.length;
    }
  }

  /**
   * Process incoming server state and reconcile with local prediction.
   */
  reconcile(serverState, localPlayer) {
    if (!localPlayer || !serverState) return;

    const serverPlayer = serverState.snakes.find(s => s.id === localPlayer.id);
    if (!serverPlayer || !serverPlayer.alive) {
      if (localPlayer.alive && serverPlayer && !serverPlayer.alive) {
        localPlayer.alive = false;
      }
      return;
    }

    // Simple reconciliation: lerp toward server position
    const dx = serverPlayer.x - localPlayer.x;
    const dy = serverPlayer.y - localPlayer.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 30) {
      // Large discrepancy - snap to server
      localPlayer.x = serverPlayer.x;
      localPlayer.y = serverPlayer.y;
    } else if (dist > 5) {
      // Small discrepancy - smooth lerp
      localPlayer.x += dx * 0.4;
      localPlayer.y += dy * 0.4;
    }

    localPlayer.angle += (serverPlayer.angle - localPlayer.angle) * 0.4;
    localPlayer.length = serverPlayer.length;
    localPlayer.score = serverPlayer.score;
    localPlayer.segments = serverPlayer.segments;
    localPlayer.boosting = serverPlayer.boosting;
    localPlayer.boostCooldown = serverPlayer.boostCooldown;
    localPlayer.activePowerUps = serverPlayer.activePowerUps || [];
    localPlayer.alive = serverPlayer.alive;
  }
}
