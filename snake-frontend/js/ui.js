class UIManager {
  constructor() {
    this.playerId = null;
    this.playerSnake = null;
    this.killFeedTimeout = null;

    // Setup menu immediately (before network connection)
    this._setupMenu();
  }

  _setupMenu() {
    // Skin selector
    const skinSelector = document.getElementById('skinSelector');
    for (const [key, skin] of Object.entries(SKIN_DEFS)) {
      const div = document.createElement('div');
      div.className = 'skin-option';
      div.style.backgroundColor = skin.head;
      div.title = skin.name;
      div.dataset.skin = key;
      div.addEventListener('click', () => {
        document.querySelectorAll('.skin-option').forEach(el => el.classList.remove('selected'));
        div.classList.add('selected');
        div.dataset.selected = 'true';
      });
      if (key === 'default') {
        div.classList.add('selected');
        div.dataset.selected = 'true';
      }
      skinSelector.appendChild(div);
    }

    // Play button
    document.getElementById('playBtn').addEventListener('click', () => {
      const name = document.getElementById('nameInput').value.trim() || 'Oyuncu';
      const selected = document.querySelector('.skin-option[data-selected="true"]');
      const skin = selected ? selected.dataset.skin : 'default';

      document.getElementById('startMenu').classList.add('hidden');
      document.dispatchEvent(new CustomEvent('startGame', { detail: { name, skin } }));
    });

    // Enter key to start
    document.getElementById('nameInput').addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        document.getElementById('playBtn').click();
      }
    });

    // Respawn button
    document.getElementById('respawnBtn').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('respawn'));
    });

    // Respawn via Enter key
    document.addEventListener('respawn', () => {
      document.getElementById('deathScreen').classList.add('hidden');
      document.dispatchEvent(new CustomEvent('requestRespawn'));
    });

    // Mobile controls visibility
    if ('ontouchstart' in window) {
      document.getElementById('mobileControls').classList.remove('hidden');
    }
  }

  init(playerId) {
    this.playerId = playerId;
  }

  updateHUD(snake) {
    if (!snake) return;

    const scoreEl = document.getElementById('scoreValue');
    const lengthEl = document.getElementById('lengthValue');
    const boostEl = document.getElementById('boostIndicator');

    if (scoreEl) scoreEl.textContent = Math.floor(snake.score);
    if (lengthEl) lengthEl.textContent = Math.floor(snake.length);

    if (boostEl) {
      if (snake.boostCooldown > 0) {
        boostEl.className = 'boost-cooldown';
        boostEl.innerHTML = `⚡ <span>${Math.ceil(snake.boostCooldown / 1000)}s</span>`;
      } else {
        boostEl.className = 'boost-ready';
        boostEl.innerHTML = '⚡ BOOST HAZIR';
      }
    }

    // Power-up bar
    const puBar = document.getElementById('powerUpBar');
    if (puBar && snake.activePowerUps) {
      let html = '';
      for (const type of snake.activePowerUps) {
        const icon = type === 'magnet' ? '🧲' : '⚡';
        html += `<span class="pu-badge">${icon} ${type}</span>`;
      }
      puBar.innerHTML = html;
    }
  }

  updateLeaderboard(leaderboard) {
    const lbList = document.getElementById('lbList');
    if (!lbList || !leaderboard) return;

    let html = '';
    for (let i = 0; i < leaderboard.length; i++) {
      const p = leaderboard[i];
      const isMe = p.id === this.playerId;
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const bgClass = isMe ? 'lb-me' : '';

      html += `<div class="lb-row ${bgClass}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${this._escapeHTML(p.name)}${p.isBot ? ' 🤖' : ''}</span>
        <span class="lb-score">${Math.floor(p.score)}</span>
      </div>`;
    }

    lbList.innerHTML = html;
  }

  showDeathScreen(snake, analysis) {
    const screen = document.getElementById('deathScreen');
    const statsEl = document.getElementById('deathStats');
    const analysisEl = document.getElementById('aiAnalysis');

    if (!screen || !snake) return;

    screen.classList.remove('hidden');

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="death-stat"><span>Skor</span><span>${Math.floor(snake.score)}</span></div>
        <div class="death-stat"><span>Uzunluk</span><span>${Math.floor(snake.length)}</span></div>
        <div class="death-stat"><span>Avlar</span><span>${snake.kills || 0}</span></div>
      `;
    }

    if (analysisEl) {
      if (analysis) {
        analysisEl.textContent = '🧠 ' + analysis;
      } else {
        analysisEl.textContent = 'AI analizi hazırlanıyor...';
      }
    }
  }

  hideDeathScreen() {
    document.getElementById('deathScreen')?.classList.add('hidden');
  }

  addKillMessage(killerName, victimName) {
    const feed = document.getElementById('killFeed');
    if (!feed) return;

    const msg = document.createElement('div');
    msg.className = 'kill-msg';
    msg.textContent = `${killerName} 🔪 ${victimName}`;
    feed.appendChild(msg);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (msg.parentNode) msg.remove();
    }, 5000);

    // Limit feed to 5 messages
    while (feed.children.length > 5) {
      feed.firstChild.remove();
    }
  }

  showConnectionStatus(connected) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;

    if (connected) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }

  _escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
