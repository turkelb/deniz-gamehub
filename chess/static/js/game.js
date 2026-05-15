/**
 * Chess - Game Engine
 * PvP, PvE (AI), Online multiplayer with reconnection
 */

const ChessGame = (() => {
    // ---- State ----
    let game, board, mode, orientation, history, captured, soundEnabled;
    let selectedProvider = "stockfish";
    let selectedModel = "stockfish-level-5";
    let selectedStyle = "balanced";
    let selectedTemperature = 0.0;
    let beginnerMode = false;
    let availableModels = {};
    let availableStyles = {};
    let socket = null;
    let onlineState = null; // { code, token, color }
    let roomConnected = false;
    let peerConnection = null;
    let localStream = null;
    let voiceActive = false;
    let voiceMuted = false;

    function init() {
        game = new Chess();
        mode = "pvp";
        orientation = "white";
        history = [];
        captured = { w: [], b: [] };
        soundEnabled = true;

        board = Chessboard("board", {
            draggable: true,
            position: "start",
            orientation: orientation,
            onDrop: onDrop,
            onDragStart: onDragStart,
            onMouseoutSquare: onMouseoutSquare,
            pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
            showNotation: true,
        });

        fetchModels();
        fetchStyles();
        setupControls();
        connectSocket();
        checkSavedGame();
        updateUI();
        playSound("start");
    }

    // ---- Socket.IO ----
    function connectSocket() {
        socket = io({ transports: ["polling", "websocket"] });

        socket.on("connect", function () {
            console.log("Socket bağlandı:", socket.id);
        });

        socket.on("room_created", function (data) {
            onlineState = { code: data.code, token: data.token, color: data.color };
            roomConnected = true;
            saveGameToStorage();
            showOnlineActive(data.code);
            updateConnectionUI({ white_connected: true, black_connected: false, both_connected: false });
            orientation = data.color;
            board.orientation(orientation);
            $("#status-text").text("Rakip bekleniyor... Kodu paylaş: " + data.code);
        });

        socket.on("room_joined", function (data) {
            onlineState = { code: data.code, token: data.token, color: data.color };
            roomConnected = true;
            saveGameToStorage();
            showOnlineActive(data.code);

            if (data.reconnect) {
                loadPosition(data.fen, data.history);
                orientation = data.color;
                board.orientation(orientation);
            } else {
                orientation = data.color;
                board.orientation(orientation);
            }

            if (data.turn === data.color[0]) {
                $("#status-text").text("Sıra sende!");
            } else {
                $("#status-text").text("Rakibin hamlesi bekleniyor...");
            }
        });

        socket.on("opponent_joined", function () {
            updateConnectionUI({ white_connected: true, black_connected: true, both_connected: true });
            $("#status-text").text("Rakip katıldı! Sıra beyazda.");
        });

        socket.on("move_made", function (data) {
            const move = game.move({
                from: data.move.substring(0, 2),
                to: data.move.substring(2, 4),
                promotion: data.move.length > 4 ? data.move[4] : "q",
            });

            if (move) {
                recordMove(move);
                board.position(game.fen());
                updateUI();
            }

            if (data.turn === onlineState.color[0]) {
                $("#status-text").text("Sıra sende!");
            } else {
                const oppName = onlineState.color === "white" ? "Siyah" : "Beyaz";
                $("#status-text").text(oppName + " oynadı, sıra sende!");
            }

            if (data.is_game_over) {
                handleOnlineGameOver(data);
            }
        });

        socket.on("game_over", function (data) {
            if (data.reason === "resign") {
                const youWon = data.winner === onlineState.color;
                $("#status-text").html(youWon ? "🏆 Rakip terk etti, kazandın!" : "Rakip terk etti.");
            }
        });

        socket.on("connection_status", function (data) {
            updateConnectionUI(data);
            if (data.both_connected) {
                if (game.turn() === onlineState.color[0]) {
                    $("#status-text").text("Herkes bağlı! Sıra sende.");
                } else {
                    $("#status-text").text("Herkes bağlı! Rakibin hamlesi bekleniyor.");
                }
            } else if (!data.white_connected || !data.black_connected) {
                const who = !data.white_connected ? "Beyaz" : "Siyah";
                $("#status-text").text(who + " oyuncu bağlantısı koptu. Dönmesi bekleniyor...");
            }
        });

        socket.on("error_msg", function (data) {
            alert(data.message);
        });

        socket.on("voice_signal", function (data) {
            const signal = data.data;
            // Auto-accept incoming call
            if (signal.type === "offer" && !peerConnection) {
                acceptIncomingCall(signal);
                return;
            }
            if (!peerConnection) return;
            if (signal.type === "offer") {
                peerConnection.setRemoteDescription(new RTCSessionDescription(signal))
                    .then(function () { return peerConnection.createAnswer(); })
                    .then(function (answer) { return peerConnection.setLocalDescription(answer); })
                    .then(function () {
                        socket.emit("voice_signal", {
                            code: onlineState.code,
                            token: onlineState.token,
                            signal: peerConnection.localDescription,
                        });
                    })
                    .catch(function (e) { console.error("WebRTC answer error:", e); });
            } else if (signal.type === "answer") {
                peerConnection.setRemoteDescription(new RTCSessionDescription(signal))
                    .catch(function (e) { console.error("WebRTC answer error:", e); });
            } else if (signal.candidate) {
                peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate))
                    .catch(function (e) { console.error("ICE candidate error:", e); });
            }
        });

        // Incoming voice call notification
        socket.on("voice_call", function (data) {
            if (!voiceActive && !peerConnection) {
                $("#voice-status").removeClass("hidden").text("Rakip sesli sohbet istiyor...");
                $("#mic-btn").addClass("active");
                $("#mic-icon").text("📞");
                $("#mic-text").text("Katıl (tıkla)");
            }
        });

        socket.on("disconnect", function () {
            roomConnected = false;
            if (onlineState) {
                updateConnectionUI({ white_connected: false, black_connected: false, both_connected: false });
                $("#status-text").text("Bağlantı koptu. Yeniden bağlanılıyor...");
            }
        });
    }

    // ---- WebRTC Voice Chat ----
    function startVoiceChat() {
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(function (stream) {
                localStream = stream;
                voiceActive = true;
                voiceMuted = false;
                $("#mic-btn").addClass("active");
                $("#mic-icon").text("🎤");
                $("#mic-text").text("Sesli Sohbet (Açık)");
                $("#voice-status").removeClass("hidden").text("Bağlanıyor...");

                setupPeerConnection();
                addLocalTracks();
                createOffer();
                // Notify opponent
                socket.emit("voice_call", {
                    code: onlineState.code,
                    token: onlineState.token,
                });
            })
            .catch(function (e) {
                alert("Mikrofona erişilemedi: " + e.message);
                console.error("getUserMedia error:", e);
            });
    }

    function acceptIncomingCall(offerSignal) {
        navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(function (stream) {
                localStream = stream;
                voiceActive = true;
                voiceMuted = false;
                $("#mic-btn").addClass("active");
                $("#mic-icon").text("🎤");
                $("#mic-text").text("Sesli Sohbet (Açık)");
                $("#voice-status").removeClass("hidden").text("Bağlanıyor...");

                setupPeerConnection();
                addLocalTracks();
                return peerConnection.setRemoteDescription(new RTCSessionDescription(offerSignal));
            })
            .then(function () { return peerConnection.createAnswer(); })
            .then(function (answer) { return peerConnection.setLocalDescription(answer); })
            .then(function () {
                socket.emit("voice_signal", {
                    code: onlineState.code,
                    token: onlineState.token,
                    signal: peerConnection.localDescription,
                });
            })
            .catch(function (e) {
                console.error("acceptIncomingCall error:", e);
                if (e.name === "NotAllowedError") return; // user denied mic, ok
                alert("Sesli sohbet başlatılamadı: " + e.message);
            });
    }

    function setupPeerConnection() {
        if (peerConnection) {
            peerConnection.close();
        }
        peerConnection = new RTCPeerConnection({
            iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
            ],
        });

        peerConnection.onicecandidate = function (event) {
            if (event.candidate) {
                socket.emit("voice_signal", {
                    code: onlineState.code,
                    token: onlineState.token,
                    signal: { candidate: event.candidate },
                });
            }
        };

        peerConnection.ontrack = function (event) {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.play().catch(function () {});
            $("#voice-status").removeClass("hidden").text("Bağlı ✓");
        };

        peerConnection.oniceconnectionstatechange = function () {
            if (peerConnection.iceConnectionState === "disconnected" ||
                peerConnection.iceConnectionState === "failed") {
                $("#voice-status").text("Ses bağlantısı koptu");
            } else if (peerConnection.iceConnectionState === "connected") {
                $("#voice-status").text("Bağlı ✓");
            }
        };
    }

    function addLocalTracks() {
        if (!localStream || !peerConnection) return;
        localStream.getTracks().forEach(function (track) {
            peerConnection.addTrack(track, localStream);
        });
    }

    function createOffer() {
        peerConnection.createOffer()
            .then(function (offer) { return peerConnection.setLocalDescription(offer); })
            .then(function () {
                socket.emit("voice_signal", {
                    code: onlineState.code,
                    token: onlineState.token,
                    signal: peerConnection.localDescription,
                });
            })
            .catch(function (e) { console.error("WebRTC offer error:", e); });
    }

    function toggleMute() {
        if (!localStream) return;
        voiceMuted = !voiceMuted;
        localStream.getAudioTracks().forEach(function (track) {
            track.enabled = !voiceMuted;
        });
        if (voiceMuted) {
            $("#mic-btn").addClass("muted").removeClass("active");
            $("#mic-icon").text("🔇");
            $("#mic-text").text("Ses Kapalı");
        } else {
            $("#mic-btn").removeClass("muted").addClass("active");
            $("#mic-icon").text("🎤");
            $("#mic-text").text("Sesli Sohbet (Açık)");
        }
    }

    function stopVoiceChat() {
        if (localStream) {
            localStream.getTracks().forEach(function (t) { t.stop(); });
            localStream = null;
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        voiceActive = false;
        voiceMuted = false;
        $("#mic-btn").removeClass("active muted");
        $("#mic-icon").text("🎤");
        $("#mic-text").text("Sesli Sohbet");
        $("#voice-status").addClass("hidden");
    }

    function updateConnectionUI(data) {
        if (data.white_connected) {
            $("#white-indicator .pi-dot").addClass("active");
        } else {
            $("#white-indicator .pi-dot").removeClass("active");
        }
        if (data.black_connected) {
            $("#black-indicator .pi-dot").addClass("active");
        } else {
            $("#black-indicator .pi-dot").removeClass("active");
        }

        const $dot = $(".conn-dot");
        const $text = $("#conn-text");
        $dot.removeClass("connected disconnected");

        if (data.both_connected) {
            $dot.addClass("connected");
            $text.text("Bağlı");
        } else if (data.white_connected || data.black_connected) {
            $dot.addClass("disconnected");
            $text.text("Kısmi bağlantı");
        } else {
            $text.text("Bağlantı yok");
        }
    }

    function handleOnlineGameOver(data) {
        if (data.is_checkmate) {
            const winner = game.turn() === "w" ? "Siyah" : "Beyaz";
            const youWon = winner.toLowerCase() === onlineState.color;
            $("#status-text").html(youWon ? "&#127942; Şah Mat! Kazandın!" : "&#128128; Şah Mat! Kaybettin.");
        } else {
            $("#status-text").text("Oyun bitti - Berabere!");
        }
        clearSavedGame();
    }

    // ---- Saved Game (localStorage) ----
    function saveGameToStorage() {
        if (!onlineState) return;
        localStorage.setItem("chess_room_code", onlineState.code);
        localStorage.setItem("chess_player_token", onlineState.token);
        localStorage.setItem("chess_player_color", onlineState.color);
    }

    function clearSavedGame() {
        localStorage.removeItem("chess_room_code");
        localStorage.removeItem("chess_player_token");
        localStorage.removeItem("chess_player_color");
        onlineState = null;
        roomConnected = false;
    }

    function checkSavedGame() {
        const code = localStorage.getItem("chess_room_code");
        const token = localStorage.getItem("chess_player_token");
        const color = localStorage.getItem("chess_player_color");
        if (code && token && color) {
            $("#reconnect-code").text(code);
            $("#reconnect-banner").removeClass("hidden");
        }
    }

    function reconnectToGame() {
        const code = localStorage.getItem("chess_room_code");
        const token = localStorage.getItem("chess_player_token");
        const color = localStorage.getItem("chess_player_color");
        if (!code || !token) return;

        // Switch to online mode
        $(".mode-btn").removeClass("active");
        $(".mode-btn[data-mode='online']").addClass("active");
        mode = "online";
        resetGame();
        $("#online-panel").removeClass("hidden");
        $("#model-selector").addClass("hidden");
        $("#reconnect-banner").addClass("hidden");

        showOnlineActive(code);
        onlineState = { code: code, token: token, color: color };
        orientation = color;
        board.orientation(orientation);

        socket.emit("join_room", { code: code, token: token });
    }

    // ---- Online UI ----
    function showOnlineActive(code) {
        $("#online-setup").addClass("hidden");
        $("#online-active").removeClass("hidden");
        $("#room-code-display").text(code);
        $("#white-indicator .pi-label").text(onlineState && onlineState.color === "white" ? "Beyaz (Sen)" : "Beyaz");
        $("#black-indicator .pi-label").text(onlineState && onlineState.color === "black" ? "Siyah (Sen)" : "Siyah");
    }

    function loadPosition(fen, moveHistory) {
        game.load(fen);
        history = [];
        captured = { w: [], b: [] };

        if (moveHistory && moveHistory.length > 0) {
            moveHistory.forEach(function (m) {
                history.push({ move: { from: m.from, to: m.to, color: m.color }, fen: "" });
            });
        }

        board.position(fen);
        updateUI();
    }

    // ---- Sound Engine (Web Audio API) ----
    let audioCtx = null;

    function getAudioCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioCtx;
    }

    function playSound(type) {
        if (!soundEnabled) return;
        try {
            const ctx = getAudioCtx();
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            switch (type) {
                case "move":
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(600, now);
                    osc.frequency.linearRampToValueAtTime(400, now + 0.08);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.linearRampToValueAtTime(0.001, now + 0.1);
                    osc.start(now);
                    osc.stop(now + 0.1);
                    break;
                case "capture":
                    osc.type = "square";
                    osc.frequency.setValueAtTime(300, now);
                    osc.frequency.linearRampToValueAtTime(150, now + 0.12);
                    gain.gain.setValueAtTime(0.18, now);
                    gain.gain.linearRampToValueAtTime(0.001, now + 0.15);
                    osc.start(now);
                    osc.stop(now + 0.15);
                    break;
                case "check":
                    osc.type = "sawtooth";
                    osc.frequency.setValueAtTime(800, now);
                    osc.frequency.linearRampToValueAtTime(600, now + 0.15);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
                    osc.start(now);
                    osc.stop(now + 0.2);
                    break;
                case "start":
                    const notes = [523, 659, 784];
                    notes.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g);
                        g.connect(ctx.destination);
                        o.type = "sine";
                        o.frequency.setValueAtTime(freq, now + i * 0.1);
                        g.gain.setValueAtTime(0.08, now + i * 0.1);
                        g.gain.linearRampToValueAtTime(0.001, now + i * 0.1 + 0.2);
                        o.start(now + i * 0.1);
                        o.stop(now + i * 0.1 + 0.2);
                    });
                    break;
                case "gameover":
                    const goNotes = [400, 350, 300, 250];
                    goNotes.forEach((freq, i) => {
                        const o = ctx.createOscillator();
                        const g = ctx.createGain();
                        o.connect(g);
                        g.connect(ctx.destination);
                        o.type = "triangle";
                        o.frequency.setValueAtTime(freq, now + i * 0.2);
                        g.gain.setValueAtTime(0.12, now + i * 0.2);
                        g.gain.linearRampToValueAtTime(0.001, now + i * 0.2 + 0.3);
                        o.start(now + i * 0.2);
                        o.stop(now + i * 0.2 + 0.3);
                    });
                    break;
                default:
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(500, now);
                    gain.gain.setValueAtTime(0.1, now);
                    gain.gain.linearRampToValueAtTime(0.001, now + 0.08);
                    osc.start(now);
                    osc.stop(now + 0.08);
            }
        } catch (e) {
            // Web Audio not available
        }
    }

    // ---- Drag & Highlight ----
    function onDragStart(source, piece) {
        // Only highlight in non-online modes, or in beginner mode
        if (mode === "online") return;
        if (game.game_over()) return;

        // Don't highlight opponent's pieces
        if (mode === "pve" && game.turn() === "b") return;
        if (mode === "pvp" && piece && piece.search(/^b/) !== -1 && game.turn() === "w") return;
        if (mode === "pvp" && piece && piece.search(/^w/) !== -1 && game.turn() === "b") return;

        showLegalMoves(source);
    }

    function onMouseoutSquare() {
        window.setTimeout(clearHighlights, 50);
    }

    function showLegalMoves(square) {
        clearHighlights();

        // Highlight selected square
        $("#board .square-" + square).addClass("piece-selected-highlight");

        // Get all legal moves from this square
        const moves = game.moves({ square: square, verbose: true });
        moves.forEach(function(move) {
            const $sq = $("#board .square-" + move.to);
            if (move.captured) {
                $sq.addClass("threat-highlight"); // capture highlight
            } else {
                $sq.addClass("legal-move-highlight");
            }
        });

        // Beginner mode: show piece info
        if (beginnerMode) {
            const piece = game.get(square);
            if (piece) {
                showPieceTip(square, piece, moves);
            }
        }
    }

    function clearHighlights() {
        $("#board .square-55d63").removeClass("legal-move-highlight piece-selected-highlight threat-highlight");
    }

    function showPieceTip(square, piece, moves) {
        const pieceNames = {
            p: "Piyon", r: "Kale", n: "At", b: "Fil", q: "Vezir", k: "Şah",
            P: "Piyon", R: "Kale", N: "At", B: "Fil", Q: "Vezir", K: "Şah"
        };
        const name = pieceNames[piece.type] || "Taş";
        const captureMoves = moves.filter(function(m) { return m.captured; });
        let tip = "<span class='tip-item'><span class='tip-icon'>📌</span>" + name + " — " + moves.length + " yasal hamle";
        if (captureMoves.length > 0) {
            tip += " (" + captureMoves.length + " taş alabilir)";
        }
        tip += "</span>";
        $("#tips-content").html(tip);
    }

    function updateBeginnerTips() {
        if (!beginnerMode) return;
        let tips = "";

        // Turn info
        const turn = game.turn() === "w" ? "Beyaz" : "Siyah";
        tips += "<span class='tip-item'><span class='tip-icon'>🎯</span>Sıra: <strong>" + turn + "</strong> — bir taşa tıkla, gidebileceği yerleri gör.</span>";

        // Center control in opening
        const moveCount = game.history().length;
        if (moveCount < 6) {
            tips += "<span class='tip-item'><span class='tip-icon'>💡</span>Açılışta merkezi (e4/d4/e5/d5) kontrol etmeye çalış. At ve filini geliştir.</span>";
        }

        // King safety
        if (game.in_check()) {
            tips += "<span class='tip-item'><span class='tip-icon'>⚠️</span>Şahın tehdit altında! Kaçmak, tehdidi engellemek veya tehdit eden taşı almak zorundasın.</span>";
        }

        // Material count
        const material = countMaterial();
        tips += "<span class='tip-item'><span class='tip-icon'>⚖️</span>Taş değerleri: Beyaz " + material.white + " puan — Siyah " + material.black + " puan</span>";

        // Piece values reference
        tips += "<span class='tip-item'><span class='tip-icon'>📖</span>Taş değerleri: Piyon=1, At=3, Fil=3, Kale=5, Vezir=9, Şah=♾️</span>";

        $("#tips-content").html(tips);
    }

    function countMaterial() {
        const values = { p: 1, r: 5, n: 3, b: 3, q: 9, k: 0 };
        let white = 0, black = 0;
        const fen = game.fen().split(" ")[0];
        for (let i = 0; i < fen.length; i++) {
            const ch = fen[i];
            if (ch in values) {
                white += values[ch];
            } else if (ch.toLowerCase() in values) {
                black += values[ch.toLowerCase()];
            }
        }
        return { white: white, black: black };
    }

    // ---- Drop Handler ----
    function onDrop(source, target) {
        // Online mode: only allow moves when it's your turn
        if (mode === "online") {
            if (!onlineState || game.turn() !== onlineState.color[0]) {
                return "snapback";
            }
            // Try move locally first for snappy UI
            const tryMove = game.move({
                from: source,
                to: target,
                promotion: "q",
            });
            if (tryMove === null) return "snapback";
            game.undo();
            board.position(game.fen()); // reset visual, server will broadcast back

            socket.emit("online_move", {
                code: onlineState.code,
                token: onlineState.token,
                move: source + target + (tryMove.promotion || ""),
            });
            return;
        }

        var move = game.move({
            from: source,
            to: target,
            promotion: "q",
        });

        if (move === null) return "snapback";

        recordMove(move);
        clearHighlights();

        setTimeout(function () {
            board.position(game.fen());
            updateUI();

            if (mode === "pve" && !game.game_over() && game.turn() === "b") {
                requestAIMove();
            }
        }, 50);
    }

    // ---- Move Recording ----
    function recordMove(move) {
        history.push({ move: move, fen: game.fen() });
        const capturedPiece = move.captured;
        if (capturedPiece) {
            if (move.color === "w") {
                captured.w.push(capturedPiece);
            } else {
                captured.b.push(capturedPiece);
            }
            playSound("capture");
        } else {
            playSound("move");
        }

        if (game.in_check()) playSound("check");
        if (game.game_over()) playSound("gameover");
    }

    // ---- AI Move ----
    function requestAIMove() {
        $("#ai-thinking").removeClass("hidden");
        $("#ai-explanation").addClass("hidden");

        const modelName = availableModels[selectedProvider]?.models[selectedModel]?.label || selectedModel;
        $("#status-text").text(modelName + " düşünüyor...");

        const moveHistory = game.pgn({ maxWidth: 80 });

        $.ajax({
            url: "/api/ai-move",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({
                fen: game.fen(),
                move_history: moveHistory || "",
                provider: selectedProvider,
                model: selectedModel,
                style: selectedStyle,
                temperature: selectedTemperature,
            }),
            timeout: 95000,
            success: function (resp) {
                $("#ai-thinking").addClass("hidden");

                if (resp.error) {
                    $("#status-text").text("AI hatası: " + resp.error);
                    return;
                }

                const move = game.move({
                    from: resp.move.substring(0, 2),
                    to: resp.move.substring(2, 4),
                    promotion: resp.move.length > 4 ? resp.move[4] : "q",
                });

                if (move) {
                    recordMove(move);
                    board.position(game.fen());
                    updateUI();
                }

                if (resp.explanation) {
                    $("#ai-text").text(resp.explanation);
                    $("#ai-explanation").removeClass("hidden");
                }
            },
            error: function (xhr, status, err) {
                $("#ai-thinking").addClass("hidden");
                let msg = "AI bağlantı hatası.";
                try {
                    const r = JSON.parse(xhr.responseText);
                    if (r.error) msg = r.error;
                } catch (e) {}
                $("#status-text").text(msg);
            },
        });
    }

    // ---- Model Selector ----
    function fetchModels() {
        $.getJSON("/api/models", function(data) {
            availableModels = data;
            populateModelSelector();
        }).fail(function() {
            console.warn("Model listesi alınamadı.");
        });
    }

    function populateModelSelector() {
        const $provider = $("#provider-select");
        const $model = $("#model-select");

        $provider.empty();
        Object.keys(availableModels).forEach(function(key) {
            const info = availableModels[key];
            $provider.append($("<option>").val(key).text(info.label));
        });

        $provider.val(selectedProvider);
        updateModelDropdown();
        updateModelInfo();
        updateStyleVisibility();

        $provider.off("change").on("change", function() {
            selectedProvider = $(this).val();
            updateModelDropdown();
            updateModelInfo();
            updateStyleVisibility();
        });

        $model.off("change").on("change", function() {
            selectedModel = $(this).val();
            updateModelInfo();
        });
    }

    function updateModelDropdown() {
        const $model = $("#model-select");
        $model.empty();

        const providerInfo = availableModels[selectedProvider];
        if (!providerInfo) return;

        const models = providerInfo.models;
        const modelKeys = Object.keys(models);

        modelKeys.forEach(function(key) {
            $model.append($("<option>").val(key).text(models[key].label));
        });

        if (modelKeys.length > 0) {
            selectedModel = modelKeys[0];
            $model.val(selectedModel);
        }
    }

    function updateModelInfo() {
        const providerInfo = availableModels[selectedProvider];
        if (!providerInfo) return;
        const modelInfo = providerInfo.models[selectedModel];
        if (!modelInfo) return;
        if (selectedProvider === "stockfish") {
            $("#model-info").text("🎚️ Seviye " + modelInfo.level + " · 💪" + modelInfo.strength);
        } else {
            $("#model-info").text("⚡" + modelInfo.speed + " · 💪" + modelInfo.strength);
        }
    }

    function updateStyleVisibility() {
        if (selectedProvider === "stockfish") {
            $("#style-temp-row").addClass("hidden");
            $("#settings-info").addClass("hidden");
        } else {
            $("#style-temp-row").removeClass("hidden");
        }
    }

    // ---- Style & Temperature ----
    function fetchStyles() {
        $.getJSON("/api/styles", function(data) {
            availableStyles = data;
            const $style = $("#style-select");
            $style.empty();
            Object.keys(availableStyles).forEach(function(key) {
                $style.append($("<option>").val(key).text(availableStyles[key]));
            });
            $style.val(selectedStyle);
            $style.off("change").on("change", function() {
                selectedStyle = $(this).val();
            });
        });

        $("#temperature-slider").off("input").on("input", function() {
            selectedTemperature = parseFloat($(this).val());
            $("#temperature-value").text(selectedTemperature.toFixed(1));
        });
    }

    // ---- UI Update ----
    function updateUI() {
        const turn = game.turn() === "w" ? "Beyaz" : "Siyah";
        const turnIcon = game.turn() === "w" ? "&#9817;" : "&#9823;";

        if (game.in_checkmate()) {
            const winner = game.turn() === "w" ? "Siyah" : "Beyaz";
            $("#status-text").html("&#127942; Şah Mat! " + winner + " kazandı!");
        } else if (game.in_draw()) {
            const reasons = [];
            if (game.in_stalemate()) reasons.push("Pat");
            if (game.in_threefold_repetition()) reasons.push("Üç kez tekrar");
            if (game.insufficient_material()) reasons.push("Yetersiz materyal");
            if (game.in_fifty_moves_rule()) reasons.push("50 hamle kuralı");
            $("#status-text").text("Berabere! (" + reasons.join(", ") + ")");
        } else if (game.in_check()) {
            $("#status-text").html("&#9888; " + turn + " - Şah tehdit altında!");
        } else if (mode === "online") {
            // Don't overwrite online status messages
        } else if (mode === "pve" && !$("#ai-thinking").is(":visible")) {
            $("#status-text").html(turnIcon + " " + turn + " oynuyor");
        } else if (mode !== "pve" && mode !== "online") {
            $("#status-text").html(turnIcon + " " + turn + " oynuyor");
        }

        if (beginnerMode) updateBeginnerTips();

        $("#pgn-display").text(game.pgn({ maxWidth: 60 }) || "Henüz hamle yapılmadı.");
        $("#captured-by-white").text(captured.w.map(pieceSymbol).join(" "));
        $("#captured-by-black").text(captured.b.map(pieceSymbol).join(" "));

        $(".square-55d63").removeClass("last-move-highlight");
        if (history.length > 0) {
            const last = history[history.length - 1].move;
            $("#board .square-" + last.from).addClass("last-move-highlight");
            $("#board .square-" + last.to).addClass("last-move-highlight");
        }
    }

    function pieceSymbol(p) {
        const map = {
            p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚",
            P: "♙", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔"
        };
        return map[p] || p;
    }

    // ---- Controls ----
    function setupControls() {
        $(".mode-btn").on("click", function () {
            $(".mode-btn").removeClass("active");
            $(this).addClass("active");
            const newMode = $(this).data("mode");

            // Leave room if switching away from online
            if (mode === "online" && newMode !== "online" && onlineState) {
                stopVoiceChat();
                clearSavedGame();
            }

            mode = newMode;

            if (mode === "pve") {
                $("#model-selector").removeClass("hidden");
                $("#online-panel").addClass("hidden");
                updateStyleVisibility();
            } else {
                $("#model-selector").addClass("hidden");
            }

            if (mode === "online") {
                $("#online-panel").removeClass("hidden");
            } else {
                $("#online-panel").addClass("hidden");
            }

            resetGame();
        });

        // Online: create room
        $("#create-room-btn").on("click", function () {
            resetGame();
            socket.emit("create_room");
        });

        // Online: join room
        $("#join-room-btn").on("click", function () {
            const code = $("#join-code-input").val().trim().toUpperCase();
            if (!code || code.length !== 4) {
                alert("Lütfen 4 haneli oda kodunu girin.");
                return;
            }
            resetGame();
            socket.emit("join_room", { code: code });
        });

        // Info tooltips
        $("#style-help").on("click", function () {
            const info = {
                "balanced": "Dengeli: Standart güçlü oyun. En iyi hamleyi arar.",
                "aggressive": "Agresif: Saldırı odaklı. Merkezi kontrol eder, hızlı mat kovalar, feda yapabilir.",
                "defensive": "Savunmacı: Şah güvenliği öncelikli. Sağlam yapı kurar, taş takası yapar.",
                "random": "Sürpriz: Yaratıcı ve tahmin edilemez. Alışılmadık açılışlar dener.",
                "teacher": "Öğretici: Yeni başlayanlara uygun. Hamleleri açıklar, hataları nazikçe gösterir."
            };
            $("#settings-info-text").text("🎯 " + (info[selectedStyle] || ""));
            $("#settings-info").removeClass("hidden");
        });

        $("#temp-help").on("click", function () {
            $("#settings-info-text").html(
                "🌡️ <strong>Sıcaklık:</strong> AI'ın ne kadar 'yaratıcı' olacağını belirler.<br>" +
                "<strong>0.0</strong> = En tutarlı, güvenli hamleler (hata riski düşük)<br>" +
                "<strong>0.5</strong> = Orta seviye, biraz çeşitlilik<br>" +
                "<strong>1.0+</strong> = Sürprizli ama riskli (kural dışı hamle yapabilir!)<br>" +
                "Şu anki değer: <strong>" + selectedTemperature.toFixed(1) + "</strong>"
            );
            $("#settings-info").removeClass("hidden");
        });

        // Beginner mode toggle
        $("#beginner-toggle").on("change", function () {
            beginnerMode = this.checked;
            if (beginnerMode) {
                selectedStyle = "teacher";
                $("#style-select").val("teacher");
                $("#beginner-tips").removeClass("hidden");
                updateBeginnerTips();
            } else {
                selectedStyle = "balanced";
                $("#style-select").val("balanced");
                $("#beginner-tips").addClass("hidden");
                clearHighlights();
            }
        });

        // Enter key in join input
        $("#join-code-input").on("keydown", function (e) {
            if (e.key === "Enter") $("#join-room-btn").click();
        });

        // Copy room code
        $("#copy-code-btn").on("click", function () {
            const code = $("#room-code-display").text();
            navigator.clipboard.writeText(code).then(function () {
                const $btn = $("#copy-code-btn");
                $btn.text("✓");
                setTimeout(function () { $btn.text("📋"); }, 1500);
            });
        });

        // Voice chat: mic button
        $("#mic-btn").on("click", function () {
            if (!voiceActive) {
                startVoiceChat();
            } else {
                toggleMute();
            }
        });

        // Leave room
        $("#leave-room-btn").on("click", function () {
            stopVoiceChat();
            clearSavedGame();
            resetGame();
            $("#online-setup").removeClass("hidden");
            $("#online-active").addClass("hidden");
            $("#status-text").text("Beyaz oynuyor");
        });

        // Reconnect
        $("#reconnect-btn").on("click", reconnectToGame);
        $("#forget-btn").on("click", function () {
            clearSavedGame();
            $("#reconnect-banner").addClass("hidden");
        });

        // Board controls
        $("#undo-btn").on("click", undoMove);
        $("#new-game-btn").on("click", resetGame);
        $("#flip-btn").on("click", flipBoard);
        $("#sound-toggle").on("change", function () {
            soundEnabled = this.checked;
        });

        // Keyboard shortcuts
        $(document).on("keydown", function (e) {
            if (e.ctrlKey && e.key === "z") { e.preventDefault(); undoMove(); }
            if (e.ctrlKey && e.key === "n") { e.preventDefault(); resetGame(); }
            if (e.ctrlKey && e.key === "f") { e.preventDefault(); flipBoard(); }
        });
    }

    function undoMove() {
        if (mode === "online") return; // No undo in online

        if (mode === "pve") {
            game.undo();
            game.undo();
            history.pop();
            history.pop();
            if (captured.w.length > 0) captured.w.pop();
            if (captured.b.length > 0) captured.b.pop();
        } else {
            game.undo();
            history.pop();
            if (game.turn() === "w" && captured.b.length > 0) captured.b.pop();
            if (game.turn() === "b" && captured.w.length > 0) captured.w.pop();
        }

        board.position(game.fen());
        updateUI();
    }

    function resetGame() {
        game.reset();
        history = [];
        captured = { w: [], b: [] };
        board.position("start");
        orientation = onlineState ? onlineState.color : "white";
        board.orientation(orientation);
        $("#ai-explanation").addClass("hidden");
        updateUI();
        playSound("start");
    }

    function flipBoard() {
        orientation = orientation === "white" ? "black" : "white";
        board.orientation(orientation);
    }

    // ---- Public API ----
    return { init };
})();

$(document).ready(() => ChessGame.init());
