// ─── Turkish Checkers Frontend ─────────────────────────────────────────────

function createPieceElement(piece) {
  const el = document.createElement("div");
  el.className = "piece";
  const isWhite = piece === "w" || piece === "W";
  const isKing = piece === "W" || piece === "B";

  el.style.cssText = `
    width: 44px; height: 44px;
    border-radius: 50%;
    background: ${isWhite
      ? "radial-gradient(circle at 35% 35%, #ffffff, #e8dcc8, #c4b490)"
      : "radial-gradient(circle at 35% 35%, #555, #2a2a2a, #111)"};
    border: 2px solid ${isWhite ? "#b8a880" : "#444"};
    box-shadow: 2px 2px 4px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.15);
    position: relative;
    pointer-events: none;
    transition: transform 0.1s;
  `;

  if (isKing) {
    const crown = document.createElement("div");
    crown.style.cssText = `
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-size: 22px;
      color: ${isWhite ? "#c8a020" : "#ffd700"};
      text-shadow: 0 0 3px rgba(0,0,0,0.5);
      line-height: 1;
      pointer-events: none;
    `;
    crown.textContent = "★"; // ★ star
    el.appendChild(crown);
  }

  return el;
}

let currentMode = "pvp";
let playerColor = "w";
let selectedCell = null;
let legalMoves = [];
let lastFrom = null;
let lastTo = null;
let isAnimating = false;
let aiConfig = { model: "deepseek-v4-pro", temperature: 0.3, style: "balanced" };

const boardEl = document.getElementById("board");
const turnDot = document.getElementById("turn-dot");
const turnText = document.getElementById("turn-text");
const capWhiteEl = document.getElementById("cap-white");
const capBlackEl = document.getElementById("cap-black");
const aiExplainEl = document.getElementById("ai-explain");
const moveHistoryEl = document.getElementById("move-history");
const btnUndo = document.getElementById("btn-undo");
const btnNew = document.getElementById("btn-new");
const modeButtons = document.querySelectorAll(".mode-selector button");
const aiConfigEl = document.getElementById("ai-config");
const aiModelEl = document.getElementById("ai-model");
const aiTempEl = document.getElementById("ai-temp");
const aiTempValEl = document.getElementById("ai-temp-val");
const aiStyleEl = document.getElementById("ai-style");
const colorPickerBtns = document.querySelectorAll("#color-picker button");

// ─── API helpers ────────────────────────────────────────────────────────────

async function api(path, body) {
  const method = (body !== undefined) ? "POST" : "GET";
  const opts = {
    method: method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

// ─── Board rendering ────────────────────────────────────────────────────────

function createBoard(boardData) {
  boardEl.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.className = "cell " + ((r + c) % 2 === 0 ? "light" : "dark");
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Coordinate labels on edges
      if (c === 7) {
        const lbl = document.createElement("span");
        lbl.className = "coord-label";
        lbl.textContent = 8 - r;
        cell.appendChild(lbl);
      }
      if (r === 7) {
        const lbl = document.createElement("span");
        lbl.className = "coord-label";
        lbl.style.bottom = "auto";
        lbl.style.top = "1px";
        lbl.style.right = "2px";
        lbl.textContent = String.fromCharCode(97 + c);
        cell.appendChild(lbl);
      }

      const piece = boardData[r][c];
      if (piece !== ".") {
        cell.appendChild(createPieceElement(piece));
      }

      // Highlight last move
      if (lastFrom && r === lastFrom[0] && c === lastFrom[1]) {
        cell.classList.add("last-from");
      }
      if (lastTo && r === lastTo[0] && c === lastTo[1]) {
        cell.classList.add("last-to");
      }

      cell.addEventListener("click", () => onCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

// ─── UI updates ─────────────────────────────────────────────────────────────

function updateInfo(state) {
  const isWhite = state.turn === "w";
  turnDot.className = "dot " + (isWhite ? "white" : "black");
  turnDot.textContent = isWhite ? "○" : "●";
  const colorName = isWhite ? "Beyaz" : "Siyah";
  turnText.textContent = "Sıra: " + colorName;
  capWhiteEl.textContent = state.captured_by_white;
  capBlackEl.textContent = state.captured_by_black;
  btnUndo.disabled = state.move_count === 0 || state.game_over;

  if (state.game_over) {
    showGameOver(state.winner);
  }
}

function updateMoveHistory(moveCount, from, to, captured) {
  if (moveCount === 0) {
    moveHistoryEl.innerHTML = '<div style="color:var(--text-dim)">Henüz hamle yapılmadı</div>';
    return;
  }

  if (moveCount === 1 || !moveHistoryEl.querySelector(".move")) {
    moveHistoryEl.innerHTML = "";
  }

  function posToAlg(r, c) {
    return String.fromCharCode(97 + c) + (8 - r);
  }

  const div = document.createElement("div");
  div.className = "move";
  let txt = `${moveCount}. ${posToAlg(from[0], from[1])}→${posToAlg(to[0], to[1])}`;
  if (captured && captured.length > 0) {
    txt += ` ✕${captured.length}`;
  }
  div.textContent = txt;
  moveHistoryEl.appendChild(div);
  moveHistoryEl.scrollTop = moveHistoryEl.scrollHeight;
}

function showGameOver(winner) {
  const name = winner === "w" ? "Beyaz" : "Siyah";
  const overlay = document.createElement("div");
  overlay.className = "game-over-overlay";
  overlay.innerHTML = `
    <div class="game-over-dialog">
      <h2>🎉 Oyun Bitti!</h2>
      <p style="font-size:1.2rem">${name} kazandı!</p>
      <button onclick="this.closest('.game-over-overlay').remove();newGame();">Yeni Oyun</button>
    </div>`;
  document.body.appendChild(overlay);
}

function setAIExplanation(text) {
  if (text) {
    aiExplainEl.textContent = "🤖 " + text;
    aiExplainEl.style.display = "block";
  } else {
    aiExplainEl.style.display = "none";
  }
}

// ─── Game actions ───────────────────────────────────────────────────────────

async function newGame() {
  selectedCell = null;
  legalMoves = [];
  lastFrom = null;
  lastTo = null;
  aiExplainEl.textContent = "AI açıklaması burada görünür";
  moveHistoryEl.innerHTML = '<div style="color:var(--text-dim)">Henüz hamle yapılmadı</div>';

  // Remove any game over overlay
  const overlay = document.querySelector(".game-over-overlay");
  if (overlay) overlay.remove();

  const state = await api("/api/new_game", { mode: currentMode, player_color: playerColor });
  createBoard(state.board);
  updateInfo(state);

  // In PvE mode, if AI plays first (player is black), trigger AI
  if (currentMode === "pve" && playerColor === "b" && state.turn === "w") {
    setTimeout(() => aiMove(), 500);
  }
}

async function onCellClick(r, c) {
  if (isAnimating) return;

  const state = await api("/api/state");
  if (state.game_over) return;

  // In PvE mode, only allow clicking the player's pieces
  if (currentMode === "pve" && state.turn !== playerColor) return;

  // If clicking on a legal destination
  if (selectedCell && legalMoves.some(m => m[0] === r && m[1] === c)) {
    await makeMove(selectedCell[0], selectedCell[1], r, c);
    return;
  }

  // Select a piece
  const piece = state.board[r][c];
  if (piece !== ".") {
    const color = (piece === "w" || piece === "W") ? "w" : "b";
    if (currentMode !== "analyze" && color !== state.turn) return;

    // Deselect if clicking same cell
    if (selectedCell && selectedCell[0] === r && selectedCell[1] === c) {
      selectedCell = null;
      legalMoves = [];
      createBoard(state.board);
      return;
    }

    selectedCell = [r, c];
    const movesResp = await api("/api/legal_moves", { pos: [r, c] });
    legalMoves = movesResp.moves;
    createBoard(state.board);
    highlightLegalMoves();
    highlightSelected(r, c);
  }
}

function highlightSelected(r, c) {
  const cells = boardEl.querySelectorAll(".cell");
  cells.forEach(cell => {
    if (+cell.dataset.row === r && +cell.dataset.col === c) {
      cell.classList.add("selected");
    }
  });
}

function highlightLegalMoves() {
  const cells = boardEl.querySelectorAll(".cell");
  cells.forEach(cell => {
    const row = +cell.dataset.row;
    const col = +cell.dataset.col;
    if (legalMoves.some(m => m[0] === row && m[1] === col)) {
      cell.classList.add("legal");
    }
  });
}

async function makeMove(fr, fc, tr, tc) {
  isAnimating = true;
  const resp = await api("/api/move", { from: [fr, fc], to: [tr, tc] });

  if (!resp.success) {
    alert(resp.message);
    isAnimating = false;
    return;
  }

  lastFrom = [fr, fc];
  lastTo = [tr, tc];
  selectedCell = null;
  legalMoves = [];
  createBoard(resp.board);
  updateInfo(resp);
  updateMoveHistory(resp.move_count, [fr, fc], [tr, tc], resp.captured);

  isAnimating = false;

  // In PvE mode, trigger AI response
  if (currentMode === "pve" && !resp.game_over && resp.turn !== playerColor) {
    setTimeout(() => aiMove(), 400);
  }
}

async function aiMove() {
  isAnimating = true;

  const modelName = AI_MODEL_NAMES[aiConfig.model] || aiConfig.model;
  aiExplainEl.textContent = `🤔 ${modelName} düşünüyor...`;

  const resp = await api("/api/ai_move", {
    model: aiConfig.model,
    temperature: aiConfig.temperature,
    style: aiConfig.style,
  });
  if (!resp.success) {
    aiExplainEl.textContent = "❌ " + resp.message;
    isAnimating = false;
    return;
  }

  lastFrom = resp.from;
  lastTo = resp.to;
  selectedCell = null;
  legalMoves = [];
  createBoard(resp.board);
  updateInfo(resp);
  updateMoveHistory(
    resp.captured_by_white + resp.captured_by_black,
    resp.from,
    resp.to,
    null
  );
  setAIExplanation(resp.explanation);

  isAnimating = false;
}

async function undoMove() {
  selectedCell = null;
  legalMoves = [];

  // In PvE mode, undo both AI move and player move
  const resp1 = await api("/api/undo");
  if (!resp1.success) return;

  let resp = resp1;
  if (currentMode === "pve") {
    // Check if we can undo one more (the player's move)
    const resp2 = await api("/api/undo");
    if (resp2.success) resp = resp2;
  }

  lastFrom = null;
  lastTo = null;
  createBoard(resp.board);
  updateInfo(resp);

  // Refresh move history from scratch
  const state = await api("/api/state");
  moveHistoryEl.innerHTML = "";
  if (state.move_count === 0) {
    moveHistoryEl.innerHTML = '<div style="color:var(--text-dim)">Henüz hamle yapılmadı</div>';
  }
  aiExplainEl.textContent = "AI açıklaması burada görünür";
}

// ─── Mode switching ─────────────────────────────────────────────────────────

modeButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === currentMode) return;
    modeButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;

    // Show AI config only in PvE mode (not PvP, not Analyze)
    if (currentMode === "pve") {
      aiConfigEl.classList.add("visible");
      aiExplainEl.style.display = "block";
    } else {
      aiConfigEl.classList.remove("visible");
      aiExplainEl.style.display = "none";
    }

    playerColor = currentMode === "pve" ? "w" : "w";
    updateColorPickerUI();
    newGame();
  });
});

// ─── AI Config Controls ──────────────────────────────────────────────────────

const AI_MODEL_NAMES = {
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "deepseek-reasoner": "DeepSeek Reasoner",
  "gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
};

aiModelEl.addEventListener("change", () => {
  aiConfig.model = aiModelEl.value;
});

aiTempEl.addEventListener("input", () => {
  aiConfig.temperature = parseFloat(aiTempEl.value);
  aiTempValEl.textContent = aiTempEl.value;
});

aiStyleEl.addEventListener("change", () => {
  aiConfig.style = aiStyleEl.value;
});

function updateColorPickerUI() {
  colorPickerBtns.forEach(b => {
    b.classList.toggle("selected", b.dataset.color === playerColor);
  });
}

colorPickerBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    playerColor = btn.dataset.color;
    updateColorPickerUI();
    // Restart game with new color
    newGame();
  });
});

// ─── Buttons ────────────────────────────────────────────────────────────────

btnUndo.addEventListener("click", undoMove);
btnNew.addEventListener("click", newGame);

// ─── Initialize ─────────────────────────────────────────────────────────────

// Hide AI config by default (PvP is default)
aiConfigEl.classList.remove("visible");
updateColorPickerUI();
newGame();
