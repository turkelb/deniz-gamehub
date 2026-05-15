import os, re, json, uuid, time, random, string, logging, subprocess, threading
import chess as chess_lib
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "chess-secret-" + str(uuid.uuid4()))
logging.basicConfig(level=logging.INFO)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# ---- Stockfish engine (no external APIs needed) ----
STOCKFISH_PATH = os.environ.get("STOCKFISH_PATH", "stockfish")
_stockfish_lock = threading.Lock()

AVAILABLE_MODELS = {
    "stockfish": {
        "label": "Stockfish",
        "models": {f"stockfish-level-{l}": {"label": f"Stockfish Seviye {l}", "speed": "Anlık", "strength": "Güçlü", "level": l}
                   for l in [1, 5, 10, 15, 20]},
        "default": "stockfish-level-10",
    }
}

def _get_stockfish(level=10, movetime=1000):
    try:
        proc = subprocess.Popen(
            [STOCKFISH_PATH], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, bufsize=1
        )
        proc.stdin.write(f"setoption name Skill Level value {level}\n")
        proc.stdin.write("uci\n")
        proc.stdin.flush()
        return proc, None
    except FileNotFoundError:
        return None, "Stockfish yuklu degil. Termux'ta: pkg install stockfish"

def _call_stockfish(model_key, fen, move_history):
    mi = AVAILABLE_MODELS["stockfish"]["models"].get(model_key, {})
    level = mi.get("level", 10)
    proc, err = _get_stockfish(level)
    if err: return None, err
    try:
        proc.stdin.write("ucinewgame\n")
        for m in move_history:
            proc.stdin.write(f"position fen {fen} moves {' '.join(move_history)}\n" if move_history else f"position fen {fen}\n")
        proc.stdin.write("go movetime 1000\n")
        proc.stdin.flush()
        best = None
        for line in proc.stdout:
            if line.startswith("bestmove"):
                best = line.split()[1]
                break
        return {"move": best, "provider": "stockfish"}, None
    finally:
        proc.terminate()

# ---- Game state store ----
games = {}

@app.route("/")
def index():
    return render_template("index.html")

@socketio.on("create_game")
def on_create(data):
    gid = "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    games[gid] = {"board": chess_lib.Board(), "players": {}, "move_history": [], "ai": data.get("ai", "stockfish-level-10")}
    join_room(gid)
    emit("game_created", {"game_id": gid, "fen": games[gid]["board"].fen()})

@socketio.on("join_game")
def on_join(data):
    gid = data["game_id"]
    if gid not in games: emit("error", {"msg": "Oyun bulunamadi"}); return
    join_room(gid)
    g = games[gid]
    g["players"][request.sid] = data.get("side", "w" if len(g["players"]) == 0 else "b")
    emit("game_joined", {"fen": g["board"].fen(), "side": g["players"][request.sid], "game_id": gid})
    emit("player_joined", {"fen": g["board"].fen()}, room=gid, include_self=False)

@socketio.on("make_move")
def on_move(data):
    gid = data["game_id"]
    g = games.get(gid)
    if not g: return
    try:
        move = chess_lib.Move.from_uci(data["move"])
        if move in g["board"].legal_moves:
            g["board"].push(move)
            g["move_history"].append(data["move"])
            emit("board_update", {"fen": g["board"].fen(), "last_move": data["move"]}, room=gid)
            # AI response
            if g["board"].result() == "*":
                ai_model = g.get("ai", "stockfish-level-10")
                result, err = _call_stockfish(ai_model, g["board"].fen(), g["move_history"])
                if result:
                    ai_move = chess_lib.Move.from_uci(result["move"])
                    g["board"].push(ai_move)
                    g["move_history"].append(result["move"])
                    emit("board_update", {"fen": g["board"].fen(), "last_move": result["move"], "ai": True}, room=gid)
    except: pass

# Original code continues below — we import the rest from the full app.py
# This is a stripped-down offline version that keeps core functionality

if __name__ == "__main__":
    print("♟ Chess server starting on http://0.0.0.0:5000")
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
