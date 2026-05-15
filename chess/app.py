import os
import re
import json
import uuid
import time
import random
import string
import logging
import subprocess
import threading
import chess
import requests
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "chess-secret-" + str(uuid.uuid4()))
logging.basicConfig(level=logging.INFO)

socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "YOUR_DEEPSEEK_KEY")
DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_KEY")
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"

AVAILABLE_MODELS = {
    "stockfish": {
        "label": "Stockfish",
        "models": {
            "stockfish-level-1": {"label": "Stockfish Seviye 1 (Acemi)", "speed": "Anlık", "strength": "Başlangıç", "level": 1},
            "stockfish-level-5": {"label": "Stockfish Seviye 5 (Orta)", "speed": "Anlık", "strength": "Orta", "level": 5},
            "stockfish-level-10": {"label": "Stockfish Seviye 10 (Güçlü)", "speed": "Anlık", "strength": "Güçlü", "level": 10},
            "stockfish-level-15": {"label": "Stockfish Seviye 15 (Usta)", "speed": "Anlık", "strength": "Çok Güçlü", "level": 15},
            "stockfish-level-20": {"label": "Stockfish Seviye 20 (Yenilmez)", "speed": "Anlık", "strength": "Yenilmez", "level": 20},
        },
    },
    "deepseek": {
        "label": "DeepSeek",
        "models": {
            "deepseek-v4-pro": {"label": "DeepSeek V4 Pro (Hızlı)", "speed": "Hızlı", "strength": "Güçlü"},
            "deepseek-reasoner": {"label": "DeepSeek Reasoner (Usta)", "speed": "Yavaş", "strength": "Yenilmez"},
        },
    },
    "gemini": {
        "label": "Gemini",
        "models": {
            "gemini-2.5-flash-lite": {"label": "Gemini 2.5 Flash Lite (Hızlı)", "speed": "Hızlı", "strength": "Orta"},
        },
    },
}

STOCKFISH_PATH = "/usr/games/stockfish"
_stockfish_lock = threading.Lock()

SYSTEM_PROMPT_BASE = """You are a grandmaster-level chess engine (2800+ Elo). Choose the BEST legal move.

CRITICAL: Your ENTIRE response must be ONLY the JSON object below. NOTHING else — no thinking, no markdown, no explanation outside the JSON. Just this exact format:
{"move":"e2e4","explanation":"Merkezi kontrol eder"}

## HOW TO CHOOSE THE BEST MOVE
Step 1 — Evaluate the position: material balance, king safety, piece activity, pawn structure, threats.
Step 2 — List candidate moves and calculate at least 3-4 moves ahead.
Step 3 — For each candidate, check: does it hang a piece? Does opponent have a check/capture/threat in response?
Step 4 — Pick the move with the best evaluation.

## PRIORITY ORDER (highest to lowest)
1. CHECKMATE — deliver checkmate if possible
2. CAPTURE — win material safely (check if recapture loses more)
3. CHECK — give check if it improves your position
4. THREAT — create threats (fork, pin, skewer, discovered attack)
5. DEVELOPMENT — develop pieces to active squares, control center
6. KING SAFETY — castle early, don't leave king exposed
7. PAWN STRUCTURE — avoid doubled/isolated pawns

## CRITICAL RULES
- NEVER hang a piece (move it to a square where it can be captured for free)
- NEVER ignore a threat to your king
- If you are ahead in material, simplify by trading pieces
- If you are behind, keep pieces on the board and create complications
- In the opening (first 10 moves): develop knights and bishops, control e4/d4/e5/d5, castle
- In the middlegame: improve piece positions, create and exploit weaknesses
- In the endgame: activate the king, push passed pawns

## EXAMPLES OF GOOD MOVES
- e2e4 (controls center, opens bishop and queen)
- g1f3 (develops knight to best square)
- e1g8 (kingside castle — king safety)
- d4d5 (pawn break in center)
- d1h5 (queen attack, threatening checkmate)

## EXAMPLES OF TERRIBLE MOVES (AVOID)
- Moving the same piece twice in the opening
- Moving rook pawns (a4, h4) early
- Developing knights to the edge (a3, h3, a6, h6) — "knight on the rim is dim"
- Moving the queen out too early where it can be harassed
- Pushing too many pawns without developing pieces"""

STYLE_PROMPTS = {
    "balanced": SYSTEM_PROMPT_BASE,
    "aggressive": SYSTEM_PROMPT_BASE + "\n\n## AGGRESSIVE STYLE\nPlay aggressively. Launch attacks toward the opponent king. Sacrifices for initiative are welcome. Prioritize checks, threats, and king-side attacks. Aim for checkmate quickly.",
    "defensive": SYSTEM_PROMPT_BASE + "\n\n## DEFENSIVE STYLE\nPlay solid and safe. Prioritize king safety above all. Maintain a solid pawn structure. Block enemy attacks. Trade pieces when ahead in material. Only attack when it's clearly winning.",
    "random": SYSTEM_PROMPT_BASE + "\n\n## CREATIVE STYLE\nPlay creatively. Use unusual openings and offbeat tactics. Surprise the opponent while staying within the rules. Prefer interesting sidelines over main lines.",
}

AVAILABLE_STYLES = {
    "balanced": "Dengeli",
    "aggressive": "Agresif",
    "defensive": "Savunmacı",
    "random": "Sürpriz",
    "teacher": "Öğretici",
}

STYLE_PROMPTS["teacher"] = SYSTEM_PROMPT_BASE + """\n\nYou are playing against a complete beginner who is learning chess. Your goals:
1. Make reasonable but not perfect moves — leave some opportunities for the beginner
2. In your explanation, briefly mention WHY your move is good (1 short sentence in Turkish)
3. Occasionally point out if the opponent missed a tactic or made a mistake, gently
4. Play at an easy/medium level — avoid complex grandmaster-level tactics
5. Keep explanations educational and encouraging"""

# ---- Room Management ----
# Structure: { code: { fen, history, white: {sid, token, connected}, black: {sid, token, connected}, turn, created_at } }
rooms = {}

def _room_code():
    while True:
        code = "".join(random.choices(string.ascii_uppercase, k=4))
        if code not in rooms:
            return code


# ---- Routes ----

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/models")
def list_models():
    return jsonify(AVAILABLE_MODELS)


@app.route("/api/styles")
def list_styles():
    return jsonify(AVAILABLE_STYLES)


# ---- Socket.IO Events ----

@socketio.on("create_room")
def handle_create_room():
    code = _room_code()
    token = str(uuid.uuid4())
    rooms[code] = {
        "fen": chess.STARTING_FEN,
        "history": [],
        "white": {"sid": request.sid, "token": token, "connected": True},
        "black": None,
        "turn": "w",
        "created_at": time.time(),
    }
    join_room(code)
    app.logger.info("Oda oluşturuldu: %s (beyaz: %s)", code, request.sid)
    emit("room_created", {"code": code, "token": token, "color": "white"})


@socketio.on("join_room")
def handle_join_room(data):
    code = data.get("code", "").upper().strip()
    if not code or code not in rooms:
        emit("error_msg", {"message": "Oda bulunamadı. Kodu kontrol et."})
        return

    room = rooms[code]

    # Already in this room? (reconnecting via refresh etc)
    existing = _find_player_in_room(room, request.sid)
    if existing:
        room[existing]["connected"] = True
        room[existing]["sid"] = request.sid
        join_room(code)
        app.logger.info("Oyuncu odaya tekrar bağlandı: %s (%s, %s)", code, existing, request.sid)
        emit("room_joined", {
            "code": code,
            "token": room[existing]["token"],
            "color": existing,
            "fen": room["fen"],
            "history": room["history"],
            "turn": room["turn"],
            "reconnect": True,
        })
        _notify_connection_status(code)
        return

    # Check by token (cross-device reconnect)
    player_token = data.get("token", "")
    if player_token:
        if room["white"] and room["white"]["token"] == player_token:
            room["white"]["connected"] = True
            room["white"]["sid"] = request.sid
            join_room(code)
            app.logger.info("Beyaz token ile tekrar bağlandı: %s", code)
            emit("room_joined", {
                "code": code, "token": player_token, "color": "white",
                "fen": room["fen"], "history": room["history"], "turn": room["turn"],
                "reconnect": True,
            })
            _notify_connection_status(code)
            return
        if room["black"] and room["black"]["token"] == player_token:
            room["black"]["connected"] = True
            room["black"]["sid"] = request.sid
            join_room(code)
            app.logger.info("Siyah token ile tekrar bağlandı: %s", code)
            emit("room_joined", {
                "code": code, "token": player_token, "color": "black",
                "fen": room["fen"], "history": room["history"], "turn": room["turn"],
                "reconnect": True,
            })
            _notify_connection_status(code)
            return
        emit("error_msg", {"message": "Geçersiz token. Bu oyuna ait değilsin."})
        return

    # New player joining
    if room["black"] is not None:
        emit("error_msg", {"message": "Oda dolu. İki oyuncu zaten var."})
        return

    token = str(uuid.uuid4())
    room["black"] = {"sid": request.sid, "token": token, "connected": True}
    join_room(code)
    app.logger.info("Siyah oyuncu odaya katıldı: %s (%s)", code, request.sid)

    emit("room_joined", {
        "code": code, "token": token, "color": "black",
        "fen": room["fen"], "history": room["history"], "turn": room["turn"],
        "reconnect": False,
    })

    # Notify white
    if room["white"] and room["white"]["connected"]:
        socketio.emit("opponent_joined", {"color": "black"}, to=room["white"]["sid"])

    _notify_connection_status(code)


@socketio.on("online_move")
def handle_online_move(data):
    code = data.get("code", "").upper()
    uci = data.get("move", "")
    player_token = data.get("token", "")

    if code not in rooms:
        emit("error_msg", {"message": "Oda bulunamadı."})
        return

    room = rooms[code]
    player_color = _get_player_color(room, player_token)
    if player_color is None:
        emit("error_msg", {"message": "Bu oyunda değilsin."})
        return

    if player_color[0] != room["turn"]:
        emit("error_msg", {"message": "Sıra sende değil."})
        return

    try:
        board = chess.Board(room["fen"])
        move = chess.Move.from_uci(uci)
    except (ValueError, chess.InvalidMoveError):
        emit("error_msg", {"message": "Geçersiz hamle formatı."})
        return

    if move not in board.legal_moves:
        emit("error_msg", {"message": "Yasadışı hamle."})
        return

    board.push(move)
    captured = room["fen"].split()[0] != board.fen().split()[0]  # crude but works for sound

    room["fen"] = board.fen()
    room["history"].append({
        "from": uci[:2], "to": uci[2:4],
        "promotion": uci[4:5] if len(uci) > 4 else "",
        "color": player_color,
    })
    room["turn"] = "b" if room["turn"] == "w" else "w"

    app.logger.info("Hamle %s: %s -> %s", code, player_color, uci)

    move_data = {
        "move": uci,
        "fen": room["fen"],
        "turn": room["turn"],
        "is_check": board.is_check(),
        "is_checkmate": board.is_checkmate(),
        "is_game_over": board.is_game_over(),
        "captured": captured,
        "history": room["history"],
    }

    # Send to both players
    socketio.emit("move_made", move_data, room=code)


@socketio.on("voice_signal")
def handle_voice_signal(data):
    """Relay WebRTC signaling between players in the same room."""
    code = data.get("code", "").upper()
    if code not in rooms:
        return
    room = rooms[code]
    player_token = data.get("token", "")
    color = _get_player_color(room, player_token)
    if color is None:
        return
    # Relay to the OTHER player in the room
    other_color = "black" if color == "white" else "white"
    other = room.get(other_color)
    if other and other["connected"]:
        socketio.emit("voice_signal", {
            "from": color,
            "data": data.get("signal", {}),
        }, to=other["sid"])


@socketio.on("voice_call")
def handle_voice_call(data):
    """Notify the other player that someone started voice chat."""
    code = data.get("code", "").upper()
    if code not in rooms:
        return
    room = rooms[code]
    player_token = data.get("token", "")
    color = _get_player_color(room, player_token)
    if color is None:
        return
    other_color = "black" if color == "white" else "white"
    other = room.get(other_color)
    if other and other["connected"]:
        socketio.emit("voice_call", {"from": color}, to=other["sid"])


@socketio.on("resign_game")
def handle_resign(data):
    code = data.get("code", "").upper()
    player_token = data.get("token", "")
    if code not in rooms:
        return
    room = rooms[code]
    color = _get_player_color(room, player_token)
    if color is None:
        return
    winner = "black" if color == "white" else "white"
    app.logger.info("Oyuncu terk etti: %s -> %s kazandı", code, winner)
    socketio.emit("game_over", {"reason": "resign", "winner": winner}, room=code)


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    for code, room in list(rooms.items()):
        player_color = _find_player_in_room(room, sid)
        if player_color:
            room[player_color]["connected"] = False
            app.logger.info("Oyuncu ayrıldı: %s (%s, %s)", code, player_color, sid)
            _notify_connection_status(code)
            break


def _find_player_in_room(room, sid):
    if room["white"] and room["white"]["sid"] == sid:
        return "white"
    if room["black"] and room["black"]["sid"] == sid:
        return "black"
    return None


def _get_player_color(room, token):
    if room["white"] and room["white"]["token"] == token:
        return "white"
    if room["black"] and room["black"]["token"] == token:
        return "black"
    return None


def _notify_connection_status(code):
    room = rooms[code]
    w_connected = room["white"] and room["white"]["connected"]
    b_connected = room["black"] and room["black"]["connected"]
    status = {
        "white_connected": w_connected,
        "black_connected": b_connected,
        "both_connected": w_connected and b_connected,
    }
    socketio.emit("connection_status", status, room=code)


# ---- Stockfish Engine (UCI) ----

def _get_stockfish(level=10, movetime=1000):
    """Start Stockfish subprocess with UCI protocol and given skill level."""
    try:
        proc = subprocess.Popen(
            [STOCKFISH_PATH],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except FileNotFoundError:
        return None, "Stockfish bulunamadı. Lütfen stockfish paketini kurun."

    def _send(cmd):
        proc.stdin.write(cmd + "\n")
        proc.stdin.flush()

    _send("uci")
    # Wait for "uciok"
    for line in proc.stdout:
        if line.strip() == "uciok":
            break

    _send(f"setoption name Skill Level value {level}")
    _send("isready")
    # Wait for "readyok"
    for line in proc.stdout:
        if line.strip() == "readyok":
            break

    return proc, None


def _call_stockfish(model, fen, move_history):
    """Get best move from Stockfish for the given position."""
    model_info = AVAILABLE_MODELS["stockfish"]["models"].get(model, {})
    level = model_info.get("level", 10)

    # Parse move count to adjust thinking time
    try:
        board = chess.Board(fen)
        move_count = len(board.move_stack)
    except ValueError:
        move_count = 0

    # Longer thinking time in middle game, shorter in opening/endgame
    if move_count <= 3:
        movetime = 200  # opening book moves
    elif move_count <= 20:
        movetime = 1000  # middle game
    else:
        movetime = 1500  # endgame needs calculation

    with _stockfish_lock:
        proc, err = _get_stockfish(level=level, movetime=movetime)
        if proc is None:
            return {"error": err, "status": 500}

        try:
            proc.stdin.write(f"position fen {fen}\n")
            proc.stdin.flush()
            proc.stdin.write(f"go movetime {movetime}\n")
            proc.stdin.flush()

            bestmove = None
            for line in proc.stdout:
                if line.startswith("bestmove"):
                    bestmove = line.strip().split()
                    break
        finally:
            try:
                proc.terminate()
                proc.wait(timeout=5)
            except Exception:
                proc.kill()

    if bestmove is None or len(bestmove) < 2 or bestmove[1] == "(none)":
        return {"error": "Stockfish hamle bulamadı", "status": 500}

    uci_move = bestmove[1]
    app.logger.info("Stockfish (level %d): %s", level, uci_move)

    return {
        "parsed": {
            "move": uci_move,
            "explanation": f"Stockfish Seviye {level} hamlesi.",
        }
    }


# ---- AI Move (REST) ----

@app.route("/api/ai-move", methods=["POST"])
def ai_move():
    data = request.get_json(silent=True) or {}
    fen = data.get("fen", "").strip()
    move_history = data.get("move_history", "")
    provider = data.get("provider", "deepseek")
    model = data.get("model", "deepseek-v4-pro")
    style = data.get("style", "balanced")
    temperature = float(data.get("temperature", 0.0))
    temperature = max(0.0, min(2.0, temperature))

    if not fen:
        return jsonify({"error": "FEN gerekli"}), 400

    try:
        board = chess.Board(fen)
    except ValueError:
        return jsonify({"error": "Geçersiz FEN"}), 400

    if board.is_game_over():
        outcome = board.outcome()
        return jsonify({"error": f"Oyun bitti: {outcome.termination.value if outcome else 'oyun sonu'}"}), 400

    legal_moves = [m.uci() for m in board.legal_moves]
    turn = "beyaz" if board.turn == chess.WHITE else "siyah"

    if provider == "stockfish":
        result = _call_stockfish(model, fen, move_history)
    elif provider == "gemini":
        system_prompt = STYLE_PROMPTS.get(style, SYSTEM_PROMPT_BASE)
        result = _call_gemini(model, fen, turn, legal_moves, move_history, system_prompt, temperature)
    else:
        system_prompt = STYLE_PROMPTS.get(style, SYSTEM_PROMPT_BASE)
        result = _call_deepseek(model, fen, turn, legal_moves, move_history, system_prompt, temperature)

    if result.get("error"):
        return jsonify(result), result.get("status", 500)

    ai_data = result.get("parsed", {})
    uci_move = (ai_data.get("move") or "").strip().lower()
    explanation = ai_data.get("explanation", "Hamle yapıldı.")

    try:
        move = chess.Move.from_uci(uci_move)
    except ValueError:
        app.logger.warning("Geçersiz UCI: %s, yasal hamlelerden seçiliyor", uci_move)
        if legal_moves:
            uci_move = legal_moves[0]
            move = chess.Move.from_uci(uci_move)
            explanation = "Yedek hamle kullanıldı."
        else:
            return jsonify({"error": "Yasal hamle yok"}), 400

    if move not in board.legal_moves:
        app.logger.warning("Yasadışı hamle: %s, ilk yasal hamle kullanılıyor", uci_move)
        if legal_moves:
            uci_move = legal_moves[0]
            move = chess.Move.from_uci(uci_move)
            explanation = "Yasal hamle otomatik seçildi."
        else:
            return jsonify({"error": "Yasal hamle yok"}), 400

    board.push(move)

    return jsonify({
        "move": uci_move,
        "explanation": explanation,
        "new_fen": board.fen(),
        "is_check": board.is_check(),
        "is_checkmate": board.is_checkmate(),
        "is_game_over": board.is_game_over(),
    })



def _call_deepseek(model, fen, turn, legal_moves, move_history, system_prompt, temperature):
    board = chess.Board(fen)
    move_count = len(board.move_stack)

    # Material count
    piece_values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    white_material = sum(piece_values.get(p.piece_type, 0) for p in board.piece_map().values() if p.color == chess.WHITE)
    black_material = sum(piece_values.get(p.piece_type, 0) for p in board.piece_map().values() if p.color == chess.BLACK)

    # Phase detection
    if move_count <= 10:
        phase = "OPENING — develop pieces, control center, castle early"
    elif move_count <= 30:
        phase = "MIDDLEGAME — improve piece positions, create threats, attack weaknesses"
    else:
        phase = "ENDGAME — activate king, push passed pawns, convert material advantage"

    # Castling availability
    castling = []
    if board.has_kingside_castling_rights(chess.WHITE): castling.append("White can castle kingside")
    if board.has_queenside_castling_rights(chess.WHITE): castling.append("White can castle queenside")
    if board.has_kingside_castling_rights(chess.BLACK): castling.append("Black can castle kingside")
    if board.has_queenside_castling_rights(chess.BLACK): castling.append("Black can castle queenside")

    # Threats
    in_check = board.is_check()
    threat_info = "⚠️ YOUR KING IS IN CHECK — you MUST escape check!" if in_check else "No immediate check."

    # Top legal moves (limit to 50 for prompt size)
    moves_list = legal_moves[:50]
    moves_str = ", ".join(moves_list)

    user_prompt = f"""## Position
FEN: {fen}
Turn: {turn}
Move number: {move_count + 1}
Phase: {phase}

## Material
White: {white_material} points — Black: {black_material} points
{"White is ahead!" if white_material > black_material else "Black is ahead!" if black_material > white_material else "Material is equal."}

## King Safety
{threat_info}
Castling rights: {"; ".join(castling) if castling else "None — both sides have moved their kings or rooks"}

## Move History
{move_history or 'First move'}

## Legal Moves ({len(legal_moves)} total, showing first 50)
{moves_str}

## Instructions
1. Analyze the position carefully
2. Calculate 3-4 moves ahead
3. Choose the BEST legal move from the list above
4. Verify your chosen move is in the legal moves list

Return JSON: {{"move": "<uci_move>", "explanation": "<short reason in Turkish>"}}"""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "max_tokens": 1024 if "reasoner" in model else 300,
    }

    app.logger.info("DeepSeek (%s) API çağrısı: %s", model, fen)

    try:
        resp = requests.post(DEEPSEEK_API_URL, headers=headers, json=payload, timeout=90)
        resp.raise_for_status()
    except requests.RequestException as e:
        app.logger.error("DeepSeek API hatası: %s", e)
        return {"error": f"DeepSeek API bağlantı hatası: {str(e)}", "status": 500}

    result = resp.json()
    msg = result["choices"][0]["message"]
    content = (msg.get("content") or "").strip()

    # Reasoner model: reasoning_content contains the thinking, content has the answer
    # Sometimes content is empty and the answer is at the end of reasoning_content
    if not content and "reasoning_content" in msg:
        reasoning = msg.get("reasoning_content") or ""
        app.logger.info("DeepSeek reasoning (son 200): %s", reasoning[-200:])
        # The final answer is usually at the end of the reasoning
        content = reasoning.strip()

    app.logger.info("DeepSeek yanıtı (ham): %s", content[:300] if content else "(bos)")

    # Reasoner model may include reasoning_content — use only the final content
    # Also try to extract JSON from code blocks or mixed text
    parsed = _parse_response(content)
    if not parsed.get("move"):
        # Fallback: try to find UCI move anywhere in the content
        app.logger.warning("JSON parse basarisiz, ham icerik: %s", content[:300])

    return {"parsed": parsed}


def _call_gemini(model, fen, turn, legal_moves, move_history, system_prompt, temperature):
    board = chess.Board(fen)
    move_count = len(board.move_stack)

    piece_values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    white_material = sum(piece_values.get(p.piece_type, 0) for p in board.piece_map().values() if p.color == chess.WHITE)
    black_material = sum(piece_values.get(p.piece_type, 0) for p in board.piece_map().values() if p.color == chess.BLACK)

    if move_count <= 10:
        phase = "OPENING — develop pieces, control center, castle early"
    elif move_count <= 30:
        phase = "MIDDLEGAME — improve piece positions, create threats, attack weaknesses"
    else:
        phase = "ENDGAME — activate king, push passed pawns, convert material advantage"

    castling = []
    if board.has_kingside_castling_rights(chess.WHITE): castling.append("White can castle kingside")
    if board.has_queenside_castling_rights(chess.WHITE): castling.append("White can castle queenside")
    if board.has_kingside_castling_rights(chess.BLACK): castling.append("Black can castle kingside")
    if board.has_queenside_castling_rights(chess.BLACK): castling.append("Black can castle queenside")

    in_check = board.is_check()
    threat_info = "YOUR KING IS IN CHECK — you MUST escape check!" if in_check else "No immediate check."

    moves_list = legal_moves[:50]
    moves_str = ", ".join(moves_list)

    user_prompt = f"""## Position
FEN: {fen}
Turn: {turn}
Move number: {move_count + 1}
Phase: {phase}

## Material
White: {white_material} points — Black: {black_material} points
{"White is ahead!" if white_material > black_material else "Black is ahead!" if black_material > white_material else "Material is equal."}

## King Safety
{threat_info}
Castling rights: {"; ".join(castling) if castling else "None"}

## Move History
{move_history or 'First move'}

## Legal Moves ({len(legal_moves)} total, showing first 50)
{moves_str}

## Instructions
Choose the BEST legal move. Verify it is in the legal moves list.
Return JSON: {{"move": "<uci_move>", "explanation": "<short reason in Turkish>"}}"""

    url = f"{GEMINI_API_URL}/{model}:generateContent?key={GEMINI_API_KEY}"

    payload = {
        "systemInstruction": {
            "parts": [{"text": system_prompt}]
        },
        "contents": [{
            "parts": [{"text": user_prompt}]
        }],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 300,
        },
    }

    app.logger.info("Gemini (%s) API çağrısı: %s", model, fen)

    try:
        resp = requests.post(url, json=payload, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as e:
        app.logger.error("Gemini API hatası: %s", e)
        return {"error": f"Gemini API bağlantı hatası: {str(e)}", "status": 500}

    result = resp.json()

    try:
        content = result["candidates"][0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError):
        app.logger.error("Gemini beklenmeyen yanıt: %s", result)
        return {"error": "Gemini beklenmeyen yanıt formatı", "status": 500}

    app.logger.info("Gemini yanıtı: %s", content)

    return {"parsed": _parse_response(content)}


def _parse_response(content):
    # Try direct JSON first
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    # Try to extract JSON from markdown code blocks ```json ... ``` or ``` ... ```
    for pattern in [r'```json\s*(\{.*?\})\s*```', r'```\s*(\{.*?\})\s*```']:
        m = re.search(pattern, content, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass

    # Try any { ... } containing "move" key
    for m in re.finditer(r'\{[^{}]*"move"[^{}]*\}', content, re.DOTALL):
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass

    # Try regex extraction from text
    move_match = re.search(r'"move"\s*:\s*"([a-h][1-8][a-h][1-8][qrbn]?)"', content)
    exp_match = re.search(r'"explanation"\s*:\s*"([^"]*)"', content)
    if move_match:
        return {"move": move_match.group(1), "explanation": exp_match.group(1) if exp_match else "AI hamlesi."}

    # Last resort: find ALL UCI-like patterns, return the LAST one (likely the final choice)
    uci_matches = re.findall(r'\b([a-h][1-8][a-h][1-8][qrbn]?)\b', content)
    if uci_matches:
        return {"move": uci_matches[-1], "explanation": "Hamle metinden çıkarıldı."}

    return {}


@app.route("/api/validate", methods=["POST"])
def validate_move():
    data = request.get_json(silent=True) or {}
    fen = data.get("fen", "")
    move_uci = data.get("move", "")

    try:
        board = chess.Board(fen)
        move = chess.Move.from_uci(move_uci)
        legal = move in board.legal_moves
        board.push(move)
        return jsonify({
            "legal": legal,
            "new_fen": board.fen() if legal else fen,
            "is_check": board.is_check() if legal else False,
            "is_checkmate": board.is_checkmate() if legal else False,
        })
    except (ValueError, chess.InvalidMoveError):
        return jsonify({"legal": False, "new_fen": fen})


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, allow_unsafe_werkzeug=True)
