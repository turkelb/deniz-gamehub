import json
import re
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import random as _random, socket as _socket
import random as _random, socket as _socket

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

# ─── API Clients ──────────────────────────────────────────────────────────────

DEEPSEEK_KEY = "YOUR_DEEPSEEK_KEY"
GEMINI_KEY = "YOUR_GEMINI_KEY"

_openai_available = False
deepseek_client = None
try:
    from openai import OpenAI
    deepseek_client = OpenAI(api_key=DEEPSEEK_KEY, base_url="https://api.deepseek.com/v1")
    _openai_available = True
except ImportError:
    pass

# ─── Model Registry ───────────────────────────────────────────────────────────

AI_MODELS = {
    "deepseek-v4-pro": {
        "name": "DeepSeek V4 Pro",
        "provider": "deepseek",
        "model_id": "deepseek-chat",
        "max_tokens": 150,
        "description": "Hızlı ve güçlü, günlük oyun için ideal",
    },
    "deepseek-reasoner": {
        "name": "DeepSeek Reasoner",
        "provider": "deepseek",
        "model_id": "deepseek-reasoner",
        "max_tokens": 1024,
        "description": "Derin düşünme, usta seviyesi",
    },
    "gemini-2.5-flash-lite": {
        "name": "Gemini 2.5 Flash Lite",
        "provider": "gemini",
        "model_id": "gemini-2.5-flash-lite",
        "max_tokens": 150,
        "description": "Hafif ve ücretsiz tier",
    },
}

DEFAULT_MODEL = "deepseek-v4-pro"
DEFAULT_TEMPERATURE = 0.3

# ─── Playing Styles (System Prompts) ──────────────────────────────────────────

PLAYING_STYLES = {
    "balanced": {
        "name": "Dengeli",
        "system": "Sen bir Türk Daması oyuncususun. Dengeli oyna; hem savunma hem hücum yap. En iyi stratejik hamleyi seç. Yasal hamle listesinden en mantıklı hamleyi seç, kısa bir açıklama yap.",
    },
    "aggressive": {
        "name": "Agresif",
        "system": "Sen agresif bir Türk Daması oyuncususun. Sürekli saldır! Rakip taşlarını yemeye odaklan. Mümkün olan en fazla taşı al. Feda yapmaktan çekinme, hızlı kazanmayı hedefle. Yasal hamle listesinden en saldırgan hamleyi seç.",
    },
    "defensive": {
        "name": "Savunmacı",
        "system": "Sen savunmacı bir Türk Daması oyuncususun. Taşlarını koru, sağlam bir yapı kur. Riskli hamlelerden kaçın, rakibin taşlarını yemesini engelle. Yasal hamle listesinden en güvenli hamleyi seç.",
    },
    "surprise": {
        "name": "Sürpriz",
        "system": "Sen sürpriz bir Türk Daması oyuncususun. Yaratıcı ve tahmin edilemez hamleler yap. Rakibini şaşırt, alışılmadık stratejiler dene. Yasal hamle listesinden en beklenmedik ama etkili hamleyi seç.",
    },
    "educational": {
        "name": "Öğretici",
        "system": "Sen öğretici bir Türk Daması oyuncususun. Yeni başlayanlara uygun oyna. Her hamlende ne yaptığını ve nedenini detaylı açıkla. Basit ve anlaşılır hamleler yap, karmaşık tuzaklardan kaçın. Yasal hamle listesinden en öğretici hamleyi seç.",
    },
}

DEFAULT_STYLE = "balanced"

# ─── Turkish Checkers Engine ─────────────────────────────────────────────────

class TurkishCheckers:
    """Turkish Draughts (Türk Daması) game engine.

    Rules:
    - Men move 1 square forward or sideways (NOT diagonal).
    - Men capture by jumping over an adjacent enemy piece forward or sideways.
    - Men cannot move or capture backward.
    - Multi-capture is mandatory; must take the path that captures the most pieces.
    - On reaching the opponent's back rank, a man becomes a king (Dama).
    - Kings move any number of squares in 4 orthogonal directions (like a rook).
    - Kings capture by flying over an enemy piece, landing on any empty square beyond.
    """

    def __init__(self):
        self.board = []
        self.turn = "w"
        self.move_history = []
        self.captured_by_white = 0
        self.captured_by_black = 0
        self.game_over = False
        self.winner = None
        self.new_game()

    def new_game(self):
        self.board = [
            [".",".",".",".",".",".",".","."],
            ["b","b","b","b","b","b","b","b"],
            ["b","b","b","b","b","b","b","b"],
            [".",".",".",".",".",".",".","."],
            [".",".",".",".",".",".",".","."],
            ["w","w","w","w","w","w","w","w"],
            ["w","w","w","w","w","w","w","w"],
            [".",".",".",".",".",".",".","."],
        ]
        self.turn = "w"
        self.move_history = []
        self.captured_by_white = 0
        self.captured_by_black = 0
        self.game_over = False
        self.winner = None

    def _is_king(self, piece):
        return piece in ("W", "B")

    def _color(self, piece):
        if piece in ("w", "W"):
            return "w"
        if piece in ("b", "B"):
            return "b"
        return None

    def _forward_dirs(self, color):
        """Return the forward direction(s) for the given color."""
        if color == "w":
            return [(-1, 0)]  # white moves up
        else:
            return [(1, 0)]   # black moves down

    def _side_dirs(self):
        return [(0, -1), (0, 1)]

    def _in_bounds(self, r, c):
        return 0 <= r < 8 and 0 <= c < 8

    def _find_captures_for_piece(self, r, c):
        """Find all possible capture sequences for the piece at (r,c).
        Returns list of capture paths, each path is list of (row, col) including start."""
        piece = self.board[r][c]
        if piece == ".":
            return []
        color = self._color(piece)
        is_king = self._is_king(piece)

        all_paths = []

        def dfs(cr, cc, visited_mask, path):
            """DFS to find all capture paths. visited_mask is a bitmask of captured pieces."""
            found_any = False
            dirs_to_check = []
            if is_king:
                dirs_to_check = [(-1,0),(1,0),(0,-1),(0,1)]
            else:
                dirs_to_check = self._forward_dirs(color) + self._side_dirs()

            for dr, dc in dirs_to_check:
                if is_king:
                    # King flies: step over one enemy, land anywhere beyond
                    tr, tc = cr + dr, cc + dc
                    # Find first enemy piece in this direction
                    enemy_r, enemy_c = -1, -1
                    while self._in_bounds(tr, tc):
                        if self.board[tr][tc] != ".":
                            if self._color(self.board[tr][tc]) != color:
                                enemy_r, enemy_c = tr, tc
                            break
                        tr += dr
                        tc += dc
                    if enemy_r == -1:
                        continue
                    # Enemy found, king can land on any empty square beyond
                    land_r, land_c = enemy_r + dr, enemy_c + dc
                    while self._in_bounds(land_r, land_c):
                        if self.board[land_r][land_c] == ".":
                            enemy_idx = enemy_r * 8 + enemy_c
                            if not (visited_mask & (1 << enemy_idx)):
                                found_any = True
                                dfs(land_r, land_c, visited_mask | (1 << enemy_idx), path + [(land_r, land_c)])
                        else:
                            break
                        land_r += dr
                        land_c += dc
                else:
                    # Man: jump exactly 2 squares (over adjacent enemy)
                    mid_r, mid_c = cr + dr, cc + dc
                    land_r, land_c = cr + 2 * dr, cc + 2 * dc
                    if (self._in_bounds(mid_r, mid_c) and self._in_bounds(land_r, land_c)):
                        mid_piece = self.board[mid_r][mid_c]
                        if (mid_piece != "." and self._color(mid_piece) != color
                                and self.board[land_r][land_c] == "."):
                            enemy_idx = mid_r * 8 + mid_c
                            if not (visited_mask & (1 << enemy_idx)):
                                found_any = True
                                dfs(land_r, land_c, visited_mask | (1 << enemy_idx), path + [(land_r, land_c)])

            if not found_any:
                all_paths.append(path)

        dfs(r, c, 0, [])
        return all_paths

    def get_all_captures(self, color):
        """Get all max-length capture paths for the given color."""
        all_paths = []
        for r in range(8):
            for c in range(8):
                piece = self.board[r][c]
                if piece != "." and self._color(piece) == color:
                    paths = self._find_captures_for_piece(r, c)
                    for p in paths:
                        if len(p) > 0:
                            all_paths.append(((r, c), p))

        if not all_paths:
            return []

        # Only keep paths of maximum length
        max_len = max(len(p) for _, p in all_paths)
        return [(start, path) for start, path in all_paths if len(path) == max_len]

    def get_legal_moves(self, color):
        """Get all legal moves for the given color.
        Returns list of (from_pos, to_pos) tuples, where positions are (row, col)."""
        moves = []

        # Add all capture moves
        captures = self.get_all_captures(color)
        for start, path in captures:
            moves.append((start, path[-1]))

        # Add all non-capture moves
        for r in range(8):
            for c in range(8):
                piece = self.board[r][c]
                if piece == "." or self._color(piece) != color:
                    continue
                is_king = self._is_king(piece)
                if is_king:
                    dirs = [(-1,0),(1,0),(0,-1),(0,1)]
                    for dr, dc in dirs:
                        nr, nc = r + dr, c + dc
                        while self._in_bounds(nr, nc) and self.board[nr][nc] == ".":
                            moves.append(((r, c), (nr, nc)))
                            nr += dr
                            nc += dc
                else:
                    dirs = self._forward_dirs(color) + self._side_dirs()
                    for dr, dc in dirs:
                        nr, nc = r + dr, c + dc
                        if self._in_bounds(nr, nc) and self.board[nr][nc] == ".":
                            moves.append(((r, c), (nr, nc)))
        return moves

    def make_move(self, from_pos, to_pos):
        """Execute a move. Returns (success, message, captured_list)."""
        fr, fc = from_pos
        tr, tc = to_pos
        piece = self.board[fr][fc]
        if piece == ".":
            return False, "Boş kare seçildi", []
        if self._color(piece) != self.turn:
            return False, f"Sıra {self.turn} renginde", []
        if self.game_over:
            return False, "Oyun bitti", []

        color = self._color(piece)

        # Check if this move exists in legal moves
        legal = self.get_legal_moves(color)
        if (from_pos, to_pos) not in legal:
            return False, "Geçersiz hamle", []

        captures = self.get_all_captures(color)

        captured = []
        is_capture_move = False

        # Check if this is a capture move
        for start, path in captures:
            if start == from_pos and path[-1] == to_pos:
                is_capture_move = True
                # Execute the full capture path
                cr, cc = from_pos
                for step_idx, (nr, nc) in enumerate(path):
                    if self._is_king(piece):
                        dr = 0 if nr == cr else (1 if nr > cr else -1)
                        dc = 0 if nc == cc else (1 if nc > cc else -1)
                        sr, sc = cr + dr, cc + dc
                        while (sr, sc) != (nr, nc):
                            if self.board[sr][sc] != "." and self._color(self.board[sr][sc]) != color:
                                captured.append(((sr, sc), self.board[sr][sc]))
                                self.board[sr][sc] = "."
                                break
                            sr += dr
                            sc += dc
                    else:
                        mid_r = (cr + nr) // 2
                        mid_c = (cc + nc) // 2
                        captured.append(((mid_r, mid_c), self.board[mid_r][mid_c]))
                        self.board[mid_r][mid_c] = "."
                    cr, cc = nr, nc

                # Move the piece
                self.board[fr][fc] = "."
                final_r, final_c = path[-1]
                if piece == "w" and final_r == 0:
                    piece = "W"
                elif piece == "b" and final_r == 7:
                    piece = "B"
                self.board[final_r][final_c] = piece
                break

        if not is_capture_move:
            # Simple move
            self.board[fr][fc] = "."
            if piece == "w" and tr == 0:
                piece = "W"
            elif piece == "b" and tr == 7:
                piece = "B"
            self.board[tr][tc] = piece

        # Update captured counts
        for _, p in captured:
            if self._color(p) == "b":
                self.captured_by_white += 1
            else:
                self.captured_by_black += 1

        # Save history
        self.move_history.append({
            "from": from_pos,
            "to": to_pos,
            "piece": piece,
            "captured": captured,
        })

        # Check for game over
        opponent = "b" if color == "w" else "w"
        opponent_moves = self.get_legal_moves(opponent)
        opponent_pieces = sum(1 for r in range(8) for c in range(8) if self._color(self.board[r][c]) == opponent)
        if not opponent_moves or opponent_pieces == 0:
            self.game_over = True
            self.winner = color
            return True, f"Oyun bitti! {'Beyaz' if color == 'w' else 'Siyah'} kazandı!", captured

        # Switch turn
        self.turn = opponent
        return True, "OK", captured

    def undo(self):
        """Undo last move. Works for the last 2 moves (AI + human, or human + human)."""
        if not self.move_history:
            return False, "Geri alınacak hamle yok"

        # Undo the last move
        last = self.move_history.pop()
        fr, fc = last["from"]
        tr, tc = last["to"]
        piece = self.board[tr][tc]

        # Restore piece to original position (downgrade king if needed)
        original_piece = last["piece"]
        self.board[fr][fc] = original_piece
        self.board[tr][tc] = "."

        # Restore captured pieces
        for (cr, cc), cp in last["captured"]:
            self.board[cr][cc] = cp
            if self._color(cp) == "b":
                self.captured_by_white -= 1
            else:
                self.captured_by_black -= 1

        # Restore turn
        self.turn = self._color(original_piece)
        self.game_over = False
        self.winner = None
        return True, "Hamle geri alındı"

    def to_fen(self):
        """Export board state as FEN string."""
        rows = []
        for r in range(8):
            row = ""
            empty = 0
            for c in range(8):
                p = self.board[r][c]
                if p == ".":
                    empty += 1
                else:
                    if empty > 0:
                        row += str(empty)
                        empty = 0
                    row += p
            if empty > 0:
                row += str(empty)
            rows.append(row)
        return "/".join(rows) + " " + self.turn

    def board_to_text(self):
        """Pretty-print the board for AI prompt."""
        col_labels = "  a b c d e f g h"
        lines = [col_labels]
        for r in range(8):
            row = f"{8-r} "
            for c in range(8):
                p = self.board[r][c]
                if p == ".":
                    row += "· "
                elif p == "w":
                    row += "○ "
                elif p == "W":
                    row += "◎ "
                elif p == "b":
                    row += "● "
                elif p == "B":
                    row += "◉ "
            row += f"{8-r}"
            lines.append(row)
        lines.append(col_labels)
        return "\n".join(lines)


game = TurkishCheckers()


# ─── Flask Routes ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/new_game", methods=["POST"])
def api_new_game():
    data = request.get_json() or {}
    mode = data.get("mode", "pvp")
    player_color = data.get("player_color", "w")
    game.new_game()
    return jsonify({
        "board": game.board,
        "turn": game.turn,
        "fen": game.to_fen(),
        "mode": mode,
        "player_color": player_color,
        "game_over": False,
    })


@app.route("/api/state", methods=["GET"])
def api_state():
    return jsonify({
        "board": game.board,
        "turn": game.turn,
        "fen": game.to_fen(),
        "game_over": game.game_over,
        "winner": game.winner,
        "captured_by_white": game.captured_by_white,
        "captured_by_black": game.captured_by_black,
        "move_count": len(game.move_history),
    })


@app.route("/api/move", methods=["POST"])
def api_move():
    data = request.get_json()
    from_pos = tuple(data["from"])
    to_pos = tuple(data["to"])
    success, msg, captured = game.make_move(from_pos, to_pos)
    return jsonify({
        "success": success,
        "message": msg,
        "captured": [(list(p), piece) for p, piece in captured],
        "board": game.board,
        "turn": game.turn,
        "fen": game.to_fen(),
        "game_over": game.game_over,
        "winner": game.winner,
        "move_count": len(game.move_history),
        "captured_by_white": game.captured_by_white,
        "captured_by_black": game.captured_by_black,
    })


@app.route("/api/undo", methods=["POST"])
def api_undo():
    # Undo twice if last mover was AI (to undo both AI and player move)
    success, msg = game.undo()
    if not success:
        return jsonify({"success": False, "message": msg})
    return jsonify({
        "success": True,
        "message": msg,
        "board": game.board,
        "turn": game.turn,
        "fen": game.to_fen(),
        "game_over": game.game_over,
    })


@app.route("/api/legal_moves", methods=["POST"])
def api_legal_moves():
    data = request.get_json()
    pos = tuple(data["pos"])
    r, c = pos
    piece = game.board[r][c]
    if piece == ".":
        return jsonify({"moves": []})
    color = game._color(piece)
    legal = game.get_legal_moves(color)
    moves_from_pos = [to for fr, to in legal if fr == pos]
    return jsonify({"moves": [list(m) for m in moves_from_pos]})


@app.route("/api/ai_config", methods=["GET"])
def api_ai_config():
    """Return available models, styles, and defaults."""
    return jsonify({
        "models": {
            k: {
                "name": v["name"],
                "provider": v["provider"],
                "description": v["description"],
            }
            for k, v in AI_MODELS.items()
        },
        "styles": {
            k: {"name": v["name"]} for k, v in PLAYING_STYLES.items()
        },
        "defaults": {
            "model": DEFAULT_MODEL,
            "temperature": DEFAULT_TEMPERATURE,
            "style": DEFAULT_STYLE,
        },
    })


def _call_deepseek(model_id, system_prompt, user_prompt, temperature, max_tokens):
    """Call DeepSeek API (OpenAI-compatible format)."""
    if deepseek_client is None:
        raise RuntimeError("OpenAI kutuphanesi yuklu degil")
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})

    response = deepseek_client.chat.completions.create(
        model=model_id,
        messages=messages,
        temperature=temperature,
        max_tokens=max(max_tokens, 200),
    )
    return response.choices[0].message.content.strip()


def _call_gemini(model_id, system_prompt, user_prompt, temperature, max_tokens):
    """Call Gemini API (Google format)."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:generateContent?key={GEMINI_KEY}"

    payload = {
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max(max_tokens, 200),
        },
        "contents": [{"parts": [{"text": user_prompt}]}],
    }

    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}

    resp = requests.post(url, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["candidates"][0]["content"]["parts"][0]["text"].strip()


@app.route("/api/ai_move", methods=["POST"])
def api_ai_move():
    # Offline fallback: use random move immediately\    try:\        s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)\        s.settimeout(2)\        s.connect(("8.8.8.8", 53))\        s.close()\    except:\        moves = game.get_legal_moves(game.turn)\        if moves:\            from_pos, to_pos = _random.choice(moves)\            game.make_move(from_pos, to_pos)\            return jsonify({"success": True, "from": list(from_pos), "to": list(to_pos), "explanation": "Offline mod - rastgele hamle", "board": game.board, "turn": game.turn, "fen": game.to_fen(), "game_over": game.game_over, "winner": game.winner, "captured_by_white": game.captured_by_white, "captured_by_black": game.captured_by_black})
    if game.game_over:
        return jsonify({"success": False, "message": "Oyun bitti"})

    # Read user preferences
    data = request.get_json() or {}
    model_key = data.get("model", DEFAULT_MODEL)
    temperature = float(data.get("temperature", DEFAULT_TEMPERATURE))
    style_key = data.get("style", DEFAULT_STYLE)

    # Validate model
    model_info = AI_MODELS.get(model_key)
    if not model_info:
        model_key = DEFAULT_MODEL
        model_info = AI_MODELS[model_key]

    # Validate style
    style_info = PLAYING_STYLES.get(style_key)
    if not style_info:
        style_key = DEFAULT_STYLE
        style_info = PLAYING_STYLES[style_key]

    ai_color = game.turn
    board_text = game.board_to_text()

    # Get legal moves for the AI
    legal_moves = game.get_legal_moves(ai_color)
    if not legal_moves:
        return jsonify({"success": False, "message": "AI için geçerli hamle yok"})

    color_name = "Beyaz (○)" if ai_color == "w" else "Siyah (●)"

    # Number the legal moves for easy selection
    numbered_moves = []
    for i, ((fr, fc), (tr, tc)) in enumerate(legal_moves):
        cap = ""
        if abs(fr - tr) > 1 or abs(fc - tc) > 1:
            cap = " [YEME]"
        numbered_moves.append(f"  #{i}: [{fr},{fc}] -> [{tr},{tc}]{cap}")

    numbered_text = "\n".join(numbered_moves)

    system_prompt = style_info["system"]
    user_prompt = f"""Türk Daması. Sıra: {color_name}.

Tahta (satır 0=üst, satır 7=alt):
{board_text}

Yasal hamleler (birini seç):
{numbered_text}

En iyi hamlenin NUMARASINI (#) seç. Yanıtı şu JSON ver, başka metin ekleme:
{{"move_id":sayi,"explanation":"kisaca sebep"}}"""

    try:
        # Route to correct provider
        provider = model_info["provider"]
        model_id = model_info["model_id"]
        max_tokens = model_info["max_tokens"]

        if provider == "deepseek":
            content = _call_deepseek(model_id, system_prompt, user_prompt, temperature, max_tokens)
        elif provider == "gemini":
            content = _call_gemini(model_id, system_prompt, user_prompt, temperature, max_tokens)
        else:
            raise ValueError(f"Unknown provider: {provider}")

        print(f"[AI: {model_key} | t={temperature} | style={style_key}] {content[:200]}", flush=True)

        # Parse AI response
        ai_data = None

        # Strategy 1: markdown code block
        md_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', content, re.DOTALL)
        if md_match:
            try:
                ai_data = json.loads(md_match.group(1).strip())
            except json.JSONDecodeError:
                pass

        # Strategy 2: find JSON object
        if ai_data is None:
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                try:
                    ai_data = json.loads(json_match.group())
                except json.JSONDecodeError:
                    pass

        # Determine move from AI response
        explanation = ""
        if ai_data is not None:
            if "move_id" in ai_data:
                idx = int(ai_data["move_id"])
                if 0 <= idx < len(legal_moves):
                    from_pos, to_pos = legal_moves[idx]
                    explanation = ai_data.get("explanation", "")
                else:
                    from_pos, to_pos = legal_moves[0]
                    explanation = "AI geçersiz numara verdi, ilk hamle oynandı."
            elif "from" in ai_data and "to" in ai_data:
                from_pos = tuple(ai_data["from"])
                to_pos = tuple(ai_data["to"])
                explanation = ai_data.get("explanation", "")
                if (from_pos, to_pos) not in legal_moves:
                    from_pos, to_pos = legal_moves[0]
                    explanation = "AI geçersiz hamle önerdi, ilk hamle oynandı."
            else:
                from_pos, to_pos = legal_moves[0]
                explanation = "AI JSON'u eksik, ilk hamle oynandı."
        else:
            app.logger.error(f"AI parse failed: {content[:150]}")
            from_pos, to_pos = legal_moves[0]
            explanation = "AI yanıtı okunamadı, ilk hamle oynandı."

        success, msg, captured = game.make_move(from_pos, to_pos)
        return jsonify({
            "success": success,
            "from": list(from_pos),
            "to": list(to_pos),
            "explanation": explanation,
            "message": msg,
            "board": game.board,
            "turn": game.turn,
            "fen": game.to_fen(),
            "game_over": game.game_over,
            "winner": game.winner,
            "captured_by_white": game.captured_by_white,
            "captured_by_black": game.captured_by_black,
        })
    except Exception as e:
        print(f"[AI Error] {e}")
        # Fallback: play first legal move
        from_pos, to_pos = legal_moves[0]
        success, msg, captured = game.make_move(from_pos, to_pos)
        return jsonify({
            "success": success,
            "from": list(from_pos),
            "to": list(to_pos),
            "explanation": f"AI hatası ({str(e)[:50]}), ilk yasal hamle oynandı.",
            "message": msg,
            "board": game.board,
            "turn": game.turn,
            "fen": game.to_fen(),
            "game_over": game.game_over,
            "winner": game.winner,
            "captured_by_white": game.captured_by_white,
            "captured_by_black": game.captured_by_black,
        })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
