class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cameraX = 0;
    this.cameraY = 0;
    this.targetCameraX = 0;
    this.targetCameraY = 0;
    this.zoom = 1;

    // Minimap
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    // Particles
    this.particles = [];

    // Frame timing
    this.lastFrame = 0;
    this.alpha = 0;

    // World state cache
    this.worldState = null;
    this.worldSize = { w: 4000, h: 4000 };

    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;

    if (this.minimapCanvas) {
      const size = 160;
      this.minimapCanvas.width = size;
      this.minimapCanvas.height = size;
      this.minimapCanvas.style.width = size + 'px';
      this.minimapCanvas.style.height = size + 'px';
    }
  }

  setWorldState(state) {
    if (state.worldSize) {
      this.worldSize = state.worldSize;
    }
    this.worldState = state;
  }

  updateCamera(playerSnake) {
    if (!playerSnake) return;

    const cw = this.canvas.width;
    const ch = this.canvas.height;

    this.targetCameraX = playerSnake.x - cw / 2;
    this.targetCameraY = playerSnake.y - ch / 2;

    // Smooth camera following
    this.cameraX += (this.targetCameraX - this.cameraX) * 0.1;
    this.cameraY += (this.targetCameraY - this.cameraY) * 0.1;
  }

  addParticles(x, y, count, color, type = 'burst') {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.02 + Math.random() * 0.04,
        color,
        radius: 2 + Math.random() * 3,
        type,
      });
    }
  }

  render(timestamp) {
    if (!this.lastFrame) this.lastFrame = timestamp;
    const dt = Math.min(timestamp - this.lastFrame, 33); // cap at 30fps equivalent
    this.lastFrame = timestamp;

    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Clear
    ctx.fillStyle = '#0a0e17';
    ctx.fillRect(0, 0, cw, ch);

    if (!this.worldState) {
      this._renderLoading(ctx, cw, ch);
      return;
    }

    const camX = this.cameraX;
    const camY = this.cameraY;

    ctx.save();

    // Draw world background
    this._renderBackground(ctx, camX, camY, cw, ch);

    // Draw grid (subtle)
    this._renderGrid(ctx, camX, camY, cw, ch);

    // Draw food
    this._renderFood(ctx, camX, camY);

    // Draw power-ups
    this._renderPowerUps(ctx, camX, camY, timestamp);

    // Draw snakes
    if (this.worldState.snakes) {
      const sorted = [...this.worldState.snakes].sort((a, b) => b.score - a.score);
      for (const snakeData of sorted) {
        this._renderSnake(ctx, snakeData, camX, camY, timestamp);
      }
    }

    // Draw particles
    this._renderParticles(ctx, camX, camY);

    // Update particles
    this._updateParticles(dt);

    ctx.restore();

    // Draw minimap
    this._renderMinimap();

    // Draw screen-edge indicators for nearby snakes
    this._renderEdgeIndicators(ctx, cw, ch);
  }

  _renderBackground(ctx, camX, camY, cw, ch) {
    // Dark base
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, cw, ch);

    // Subtle gradient circles
    const time = Date.now() * 0.0001;
    for (let i = 0; i < 8; i++) {
      const bx = (i * 500 + 200) % this.worldSize.w - camX;
      const by = (i * 350 + 150) % this.worldSize.h - camY;
      const r = 200 + Math.sin(time + i) * 40;

      if (bx > -r && bx < cw + r && by > -r && by < ch + r) {
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        grad.addColorStop(0, 'rgba(30, 40, 60, 0.15)');
        grad.addColorStop(1, 'rgba(13, 17, 23, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(bx - r, by - r, r * 2, r * 2);
      }
    }
  }

  _renderGrid(ctx, camX, camY, cw, ch) {
    const gridSize = 80;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;

    const startX = -(camX % gridSize);
    const startY = -(camY % gridSize);

    ctx.beginPath();
    for (let x = startX; x < cw; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let y = startY; y < ch; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();
  }

  _renderFood(ctx, camX, camY) {
    if (!this.worldState.foods) return;

    const time = Date.now() * 0.001;

    for (const f of this.worldState.foods) {
      const sx = f.x - camX;
      const sy = f.y - camY;

      // Frustum culling
      if (sx < -50 || sx > this.canvas.width + 50 || sy < -50 || sy > this.canvas.height + 50) continue;

      const bob = Math.sin(time * 3 + f.x * 0.01 + f.y * 0.01) * 2;

      // Glow
      const glow = ctx.createRadialGradient(sx, sy + bob, f.radius * 0.3, sx, sy + bob, f.radius * 1.8);
      glow.addColorStop(0, f.color + '66');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, sy + bob, f.radius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      // Main circle
      const grad = ctx.createRadialGradient(sx - f.radius * 0.3, sy + bob - f.radius * 0.3, f.radius * 0.1, sx, sy + bob, f.radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, f.color);
      grad.addColorStop(1, f.color + '88');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy + bob, f.radius, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(sx - f.radius * 0.25, sy + bob - f.radius * 0.25, f.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _renderPowerUps(ctx, camX, camY, timestamp) {
    if (!this.worldState.powerUps) return;

    for (const pu of this.worldState.powerUps) {
      const sx = pu.x - camX;
      const sy = pu.y - camY;

      if (sx < -60 || sx > this.canvas.width + 60 || sy < -60 || sy > this.canvas.height + 60) continue;

      const pulse = 1 + Math.sin(timestamp * 0.006) * 0.2;
      const r = pu.radius * pulse;

      // Rotating outer ring
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(timestamp * 0.003);
      ctx.strokeStyle = pu.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const len = r * 1.6;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      }
      ctx.stroke();

      // Center glow
      const glow = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2);
      glow.addColorStop(0, pu.color + 'aa');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2, 0, Math.PI * 2);
      ctx.fill();

      // Center circle
      ctx.fillStyle = pu.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      // Icon
      ctx.fillStyle = '#fff';
      ctx.font = `${r * 1.2}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pu.icon, 0, 1);

      ctx.restore();
    }
  }

  _renderSnake(ctx, snakeData, camX, camY, timestamp) {
    const segs = snakeData.segments;
    if (!segs || segs.length < 2) return;

    const skin = SKIN_DEFS[snakeData.skinName] || SKIN_DEFS.default;
    const isPlayer = false; // Will be set by main

    const boostGlow = snakeData.boosting ? 1 : 0;
    const hasMagnet = snakeData.activePowerUps && snakeData.activePowerUps.includes('magnet');
    const hasSpeed = snakeData.activePowerUps && snakeData.activePowerUps.includes('speed');

    // Body shadow
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Draw body segments (reverse: tail to head for proper overlap)
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      const sx = s.x - camX;
      const sy = s.y - camY;
      const t = 1 - i / Math.max(segs.length - 1, 1); // 0 at tail, 1 at head
      const thickness = 8 + t * 8;

      if (sx < -40 || sx > this.canvas.width + 40 || sy < -40 || sy > this.canvas.height + 40) continue;

      // Body color with gradient across segments
      const colorIdx = Math.floor((i / Math.max(segs.length - 1, 1)) * (skin.body.length - 1));
      const bodyColor = skin.body[Math.min(colorIdx, skin.body.length - 1)];

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(sx + 2, sy + 2, thickness * 0.8, 0, Math.PI * 2);
      ctx.fill();

      // Body segment with gradient
      const segGrad = ctx.createRadialGradient(sx - thickness * 0.3, sy - thickness * 0.3, 0, sx, sy, thickness);
      segGrad.addColorStop(0, '#fff');
      segGrad.addColorStop(0.3, bodyColor);
      segGrad.addColorStop(1, bodyColor + '88');
      ctx.fillStyle = segGrad;
      ctx.beginPath();
      ctx.arc(sx, sy, thickness * 0.85, 0, Math.PI * 2);
      ctx.fill();

      // Pattern overlays
      if (skin.pattern === 'diamond' && i % 3 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(sx, sy, thickness * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (skin.pattern === 'striped' && i % 4 < 2) {
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.beginPath();
        ctx.arc(sx, sy, thickness * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw head
    const head = segs[0];
    const hx = head.x - camX;
    const hy = head.y - camY;

    if (hx >= -50 && hx <= this.canvas.width + 50 && hy >= -50 && hy <= this.canvas.height + 50) {
      // Head glow (boost effect)
      if (boostGlow) {
        const boostGlowGrad = ctx.createRadialGradient(hx, hy, 8, hx, hy, 30);
        boostGlowGrad.addColorStop(0, '#ffd700aa');
        boostGlowGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = boostGlowGrad;
        ctx.beginPath();
        ctx.arc(hx, hy, 30, 0, Math.PI * 2);
        ctx.fill();
      }

      // Magnet effect
      if (hasMagnet) {
        const magGrad = ctx.createRadialGradient(hx, hy, 10, hx, hy, 25);
        magGrad.addColorStop(0, '#f368e066');
        magGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = magGrad;
        ctx.beginPath();
        ctx.arc(hx, hy, 25, 0, Math.PI * 2);
        ctx.fill();
      }

      // Speed effect
      if (hasSpeed) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 22, 0, Math.PI * 2);
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = -timestamp * 0.1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Invincibility shield
      if (snakeData.invincible) {
        const shieldPulse = 1 + Math.sin(timestamp * 0.008) * 0.15;
        const shieldR = 24 * shieldPulse;
        const shieldGrad = ctx.createRadialGradient(hx, hy, shieldR * 0.5, hx, hy, shieldR);
        shieldGrad.addColorStop(0, 'rgba(255,255,255,0.15)');
        shieldGrad.addColorStop(0.7, 'rgba(100,200,255,0.25)');
        shieldGrad.addColorStop(1, 'rgba(100,200,255,0)');
        ctx.fillStyle = shieldGrad;
        ctx.beginPath();
        ctx.arc(hx, hy, shieldR, 0, Math.PI * 2);
        ctx.fill();

        // Shield ring
        ctx.strokeStyle = `rgba(150,220,255,${0.35 + Math.sin(timestamp * 0.006) * 0.2})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, shieldR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Head shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.arc(hx + 2, hy + 2, 15, 0, Math.PI * 2);
      ctx.fill();

      // Head gradient
      const headGrad = ctx.createRadialGradient(hx - 4, hy - 4, 2, hx, hy, 15);
      headGrad.addColorStop(0, '#ffffff');
      headGrad.addColorStop(0.3, skin.head);
      headGrad.addColorStop(1, skin.head + '88');
      ctx.fillStyle = headGrad;
      ctx.beginPath();
      ctx.arc(hx, hy, 15, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const angle = snakeData.angle;
      const eyeOffsetX = Math.cos(angle) * 6;
      const eyeOffsetY = Math.sin(angle) * 6;
      const perpX = Math.cos(angle + Math.PI / 2) * 6;
      const perpY = Math.sin(angle + Math.PI / 2) * 6;

      // Left eye
      ctx.fillStyle = skin.eye;
      ctx.beginPath();
      ctx.arc(hx + eyeOffsetX + perpX, hy + eyeOffsetY + perpY, 5, 0, Math.PI * 2);
      ctx.fill();

      // Right eye
      ctx.beginPath();
      ctx.arc(hx + eyeOffsetX - perpX, hy + eyeOffsetY - perpY, 5, 0, Math.PI * 2);
      ctx.fill();

      // Pupils
      const pupilX = Math.cos(angle) * 2;
      const pupilY = Math.sin(angle) * 2;
      ctx.fillStyle = skin.pupil;
      ctx.beginPath();
      ctx.arc(hx + eyeOffsetX + perpX + pupilX, hy + eyeOffsetY + perpY + pupilY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(hx + eyeOffsetX - perpX + pupilX, hy + eyeOffsetY - perpY + pupilY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Name tag above head
    if (snakeData.name && hx >= -60 && hx <= this.canvas.width + 60) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 3;
      ctx.fillText(snakeData.name, hx, hy - 20);
      ctx.shadowBlur = 0;

      // Length indicator
      ctx.fillStyle = '#aaa';
      ctx.font = '9px "Segoe UI", sans-serif';
      ctx.fillText(`${snakeData.length}`, hx, hy - 8);
    }
  }

  _renderParticles(ctx, camX, camY) {
    for (const p of this.particles) {
      const sx = p.x - camX;
      const sy = p.y - camY;

      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, p.radius * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * (dt / 16);
      p.y += p.vy * (dt / 16);
      p.life -= p.decay * (dt / 16);
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  _renderMinimap() {
    const mmCtx = this.minimapCtx;
    const size = this.minimapCanvas.width;

    if (!mmCtx) return;

    mmCtx.clearRect(0, 0, size, size);

    // Background
    mmCtx.fillStyle = 'rgba(10, 14, 23, 0.85)';
    mmCtx.fillRect(0, 0, size, size);

    // Border
    mmCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(0, 0, size, size);

    const scaleX = size / this.worldSize.w;
    const scaleY = size / this.worldSize.h;

    // Food (tiny dots)
    if (this.worldState.foods) {
      mmCtx.fillStyle = 'rgba(255, 100, 100, 0.4)';
      for (const f of this.worldState.foods) {
        mmCtx.fillRect(f.x * scaleX - 0.5, f.y * scaleY - 0.5, 1, 1);
      }
    }

    // Snakes
    if (this.worldState.snakes) {
      for (const s of this.worldState.snakes) {
        if (!s.alive) continue;
        const skin = SKIN_DEFS[s.skinName] || SKIN_DEFS.default;
        mmCtx.fillStyle = s.boosting ? '#ffd700' : skin.head;
        mmCtx.fillRect(s.x * scaleX - 1.5, s.y * scaleY - 1.5, 3, 3);
      }
    }

    // Viewport rectangle
    mmCtx.strokeStyle = '#fff';
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(
      this.cameraX * scaleX,
      this.cameraY * scaleY,
      this.canvas.width * scaleX,
      this.canvas.height * scaleY
    );
  }

  _renderEdgeIndicators(ctx, cw, ch) {
    if (!this.worldState || !this.worldState.snakes) return;

    // Find closest threat (other snake bigger than player)
    // This will be filled in by main.js with the player snake reference
    // For now, skip - this needs player ID context
  }

  _renderLoading(ctx, cw, ch) {
    ctx.fillStyle = '#fff';
    ctx.font = '24px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Sunucuya bağlanıyor...', cw / 2, ch / 2);
  }
}
