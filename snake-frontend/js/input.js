class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.angle = 0;
    this.boosting = false;

    // Touch joystick
    this.joystickActive = false;
    this.joystickId = null;
    this.joystickStart = { x: 0, y: 0 };
    this.joystickPos = { x: 0, y: 0 };

    this._setupListeners();
  }

  _setupListeners() {
    // Mouse
    this.canvas.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.boosting = true;
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.boosting = false;
    });

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.boosting = true;
      }
      if (e.code === 'Enter') {
        document.dispatchEvent(new CustomEvent('respawn'));
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.boosting = false;
      }
    });

    // Touch for mobile
    const jz = document.getElementById('joystickZone');
    const jt = document.getElementById('joystickThumb');
    const mb = document.getElementById('mobileControls');

    if (jz && jt) {
      jz.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        this.joystickId = t.identifier;
        this.joystickActive = true;
        this.joystickStart = { x: t.clientX, y: t.clientY };
        this.joystickPos = { x: t.clientX, y: t.clientY };
        jz.style.display = 'flex';
      }, { passive: false });

      jz.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          if (t.identifier === this.joystickId) {
            this.joystickPos = { x: t.clientX, y: t.clientY };
            const dx = t.clientX - this.joystickStart.x;
            const dy = t.clientY - this.joystickStart.y;
            const maxR = 50;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const clampDist = Math.min(dist, maxR);
            const ax = dx / (dist || 1);
            const ay = dy / (dist || 1);
            jt.style.transform = `translate(${ax * clampDist}px, ${ay * clampDist}px)`;
          }
        }
      }, { passive: false });

      jz.addEventListener('touchend', (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier === this.joystickId) {
            this.joystickActive = false;
            this.joystickId = null;
            jt.style.transform = 'translate(0px, 0px)';
          }
        }
      });
    }

    if (mb) {
      const boostBtn = document.getElementById('mobileBoostBtn');
      if (boostBtn) {
        boostBtn.addEventListener('touchstart', (e) => {
          e.preventDefault();
          this.boosting = true;
        });
        boostBtn.addEventListener('touchend', (e) => {
          e.preventDefault();
          this.boosting = false;
        });
      }
    }
  }

  getInput(cameraX, cameraY, playerSnake) {
    let targetAngle;

    if (this.joystickActive && this.joystickId !== null) {
      const dx = this.joystickPos.x - this.joystickStart.x;
      const dy = this.joystickPos.y - this.joystickStart.y;
      targetAngle = Math.atan2(dy, dx);
    } else if (playerSnake) {
      // Mouse relative to player's world position on screen
      const worldMouseX = this.mouseX + cameraX;
      const worldMouseY = this.mouseY + cameraY;
      const dx = worldMouseX - playerSnake.x;
      const dy = worldMouseY - playerSnake.y;
      targetAngle = Math.atan2(dy, dx);
    } else {
      targetAngle = 0;
    }

    return {
      angle: targetAngle,
      boost: this.boosting,
    };
  }
}
