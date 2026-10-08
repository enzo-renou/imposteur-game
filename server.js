const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const WORDS = require('./words');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------------------------------------------------------------------------
// CONSTANTES
// ---------------------------------------------------------------------------
// FAST_TEST=1 raccourcit tous les délais (utilisé uniquement par les tests automatiques)
const FAST = process.env.FAST_TEST === '1';
const ms = (n) => (FAST ? Math.max(30, Math.round(n / 20)) : n);

const MAX_PLAYERS = 12;
const MAX_ROOMS = 300;
const MAX_CUSTOM_PAIRS = 100;
const GRACE_LOBBY = 30 * 1000;          // temps pour revenir après une déconnexion (lobby)
const GRACE_GAME = 120 * 1000;          // idem en pleine partie
const HOST_TRANSFER_DELAY = 10 * 1000;  // l'hôte déconnecté perd le rôle après ce délai
const DISCONNECTED_TURN_TIME = 15;      // un joueur absent n'a que 15 s pour son tour
const VOTE_RESULT_DELAY = 8 * 1000;     // durée d'affichage du résultat du vote
const WHITE_GUESS_TIME = 30;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;   // salle sans aucune activité
const ROOM_EMPTY_MS = 10 * 60 * 1000;      // salle sans personne de connecté
const RATE_MAX = Number(process.env.RATE_MAX) || 40;   // événements max par socket et par fenêtre de 5 s

const TURN_TIMES = [30, 45, 60, 90, 120, 180];
const VOTE_TIMES = [60, 90, 120, 180];

const games = {};

// ---------------------------------------------------------------------------
// OUTILS
// ---------------------------------------------------------------------------
function randInt(max) { return crypto.randomInt(0, max); }

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function sanitize(str, maxLen) {
    return String(str == null ? '' : str).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
function sanitizePid(pid) {
    pid = String(pid || '');
    return /^[A-Za-z0-9_-]{8,64}$/.test(pid) ? pid : '';
}
function sanitizeAvatar(a) {
    a = String(a || '');
    return /^[A-Za-z0-9]{1,16}$/.test(a) ? a : 'default';
}
function normalizeString(str) {
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function generateRoomId() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result;
    do {
        result = '';
        for (let i = 0; i < 4; i++) result += characters.charAt(randInt(characters.length));
    } while (games[result]);
    return result;
}

function emitTo(player, event, data) {
    if (player && player.socketId && player.connected) io.to(player.socketId).emit(event, data);
}
function touch(game) { game.lastActivity = Date.now(); }

// ---------------------------------------------------------------------------
// PARTIES & JOUEURS
// ---------------------------------------------------------------------------
function defaultSettings() {
    return {
        turnTime: 90,
        voteTime: 120,
        impostors: 'auto',
        mrWhite: true,
        categories: Object.keys(WORDS)
    };
}

function newGame(id) {
    return {
        id,
        players: [],
        phase: 'lobby',          // lobby | clues | decision | voting | voteResult | whiteGuess | result
        gameActive: false,
        settings: defaultSettings(),
        customPairs: [],         // [[motCitoyens, motImposteur], ...]
        currentTurn: 0,
        votingVotes: {},         // pid votant -> pid cible
        decisionVotes: {},       // pid -> 'vote' | 'cycle'
        emergencyVotes: new Set(),
        impostorIds: [],
        whiteId: null,
        currentPair: {},
        order: [],
        timer: null,
        turnTimer: null,
        pendingTimeout: null,
        timeLeft: 0,
        turnTimeLeft: 0,
        roundCount: 0,
        clueRound: 1,
        gamesPlayed: 0,
        usedPairs: new Set(),
        wordHistory: {},
        log: [],                 // historique des indices (pour la reconnexion)
        lastVoteResult: null,
        lastResult: null,
        lastActivity: Date.now()
    };
}

function isPlayable(p) { return p && p.alive && !p.left && !p.spectator; }
function findByPid(game, pid) { return game.players.find(p => p.pid === pid); }
function alivePlayers(game) { return game.players.filter(isPlayable); }
function roleOf(game, p) {
    if (game.impostorIds.includes(p.pid)) return 'impostor';
    if (p.pid === game.whiteId) return 'white';
    return 'citizen';
}
function wordFor(game, p) {
    const r = roleOf(game, p);
    if (r === 'impostor') return game.currentPair.imposteur;
    if (r === 'white') return '???';
    return game.currentPair.normal;
}
function emergencyThreshold(game) { return Math.floor(alivePlayers(game).length / 2) + 1; }

function publicPlayers(game) {
    return game.players.filter(p => !p.left).map(p => ({
        id: p.pubId,
        name: p.name,
        avatar: p.avatar,
        isAdmin: p.isAdmin,
        connected: p.connected,
        score: p.score,
        spectator: p.spectator,
        alive: p.alive
    }));
}
function broadcastPlayers(game) { io.to(game.id).emit('updatePlayerList', publicPlayers(game)); }

function categoryList(game) {
    const list = Object.entries(WORDS).map(([key, c]) => ({ key, emoji: c.emoji, label: c.label, count: c.pairs.length }));
    if (game.customPairs.length) list.push({ key: 'perso', emoji: '⭐', label: 'Mots perso', count: game.customPairs.length });
    return list;
}
function settingsPayload(game) {
    return { settings: game.settings, categoryList: categoryList(game), customCount: game.customPairs.length };
}

function voteData(game) {
    return alivePlayers(game).map(p => {
        const words = game.wordHistory[p.pid];
        return { id: p.pubId, name: p.name, avatar: p.avatar, lastWord: words && words.length ? words[words.length - 1] : '...' };
    });
}
function allVoted(game, votes) {
    const voters = game.players.filter(p => isPlayable(p) && p.connected);
    return voters.length > 0 && voters.every(p => votes[p.pid] !== undefined);
}
function voteProgress(game) {
    const voters = game.players.filter(p => isPlayable(p) && p.connected);
    return { done: voters.filter(p => game.votingVotes[p.pid] !== undefined).length, total: voters.length };
}

// ---------------------------------------------------------------------------
// TIRAGES (imposteur, mots)
// ---------------------------------------------------------------------------
function pickImpostors(game, candidates, count) {
    const pool = [...candidates];
    const chosen = [];
    for (let n = 0; n < count && pool.length > 0; n++) {
        const weights = pool.map(p => {
            let w = 1 / Math.pow(1 + (p.timesImpostor || 0), 2);
            if (p.lastImpostorGame === game.gamesPlayed - 1) w *= 0.25;
            return w;
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let r = (randInt(1000000) / 1000000) * total;
        let idx = 0;
        while (idx < pool.length - 1 && r >= weights[idx]) { r -= weights[idx]; idx++; }
        chosen.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return chosen;
}

function buildPool(game) {
    const entries = [];
    const cats = game.settings.categories;
    Object.entries(WORDS).forEach(([key, c]) => {
        if (cats.includes(key)) c.pairs.forEach((pair, i) => entries.push({ key: key + ':' + i, a: pair[0], b: pair[1] }));
    });
    if (cats.includes('perso')) game.customPairs.forEach((pair, i) => entries.push({ key: 'perso:' + i + ':' + pair[0], a: pair[0], b: pair[1] }));
    if (entries.length === 0) {
        Object.entries(WORDS).forEach(([key, c]) => c.pairs.forEach((pair, i) => entries.push({ key: key + ':' + i, a: pair[0], b: pair[1] })));
    }
    return entries;
}

function pickWordPair(game) {
    const pool = buildPool(game);
    let fresh = pool.filter(e => !game.usedPairs.has(e.key));
    if (fresh.length === 0) {
        pool.forEach(e => game.usedPairs.delete(e.key));
        fresh = pool;
    }
    const entry = fresh[randInt(fresh.length)];
    game.usedPairs.add(entry.key);
    return randInt(2) === 0 ? { normal: entry.a, imposteur: entry.b } : { normal: entry.b, imposteur: entry.a };
}

// ---------------------------------------------------------------------------
// MINUTEURS
// ---------------------------------------------------------------------------
function clearTimers(game) {
    if (game.timer) clearInterval(game.timer);
    if (game.turnTimer) clearInterval(game.turnTimer);
    if (game.pendingTimeout) clearTimeout(game.pendingTimeout);
    game.timer = null; game.turnTimer = null; game.pendingTimeout = null;
}

function startCountdown(game, seconds, eventName, onEnd) {
    if (game.timer) clearInterval(game.timer);
    game.timeLeft = seconds;
    io.to(game.id).emit(eventName, game.timeLeft);
    game.timer = setInterval(() => {
        game.timeLeft--;
        io.to(game.id).emit(eventName, game.timeLeft);
        if (game.timeLeft <= 0) {
            clearInterval(game.timer);
            game.timer = null;
            onEnd();
        }
    }, 1000);
}

function startTurnTimer(game) {
    if (game.turnTimer) clearInterval(game.turnTimer);
    game.turnTimeLeft = game.settings.turnTime;
    const cur = game.players[game.currentTurn];
    if (cur && !cur.connected) game.turnTimeLeft = Math.min(game.turnTimeLeft, DISCONNECTED_TURN_TIME);
    io.to(game.id).emit('turnTimerUpdate', game.turnTimeLeft);
    game.turnTimer = setInterval(() => {
        game.turnTimeLeft--;
        io.to(game.id).emit('turnTimerUpdate', game.turnTimeLeft);
        if (game.turnTimeLeft <= 0) {
            clearInterval(game.turnTimer);
            game.turnTimer = null;
            const p = game.players[game.currentTurn];
            if (p && game.phase === 'clues') handleWordSubmission(game, p, '...');
        }
    }, 1000);
}

// ---------------------------------------------------------------------------
// SNAPSHOT (reconnexion / arrivée en cours de partie)
// ---------------------------------------------------------------------------
function buildSnapshot(game, p) {
    const inGame = game.gameActive && p.inGame && !p.left;
    const cur = game.players[game.currentTurn];
    const white = findByPid(game, game.whiteId);
    return {
        roomId: game.id,
        me: { id: p.pubId, name: p.name, isAdmin: p.isAdmin, alive: p.alive, spectator: p.spectator },
        phase: game.phase,
        players: publicPlayers(game),
        settings: game.settings,
        categoryList: categoryList(game),
        customCount: game.customPairs.length,
        customPairs: p.isAdmin ? game.customPairs : null,
        gamesPlayed: game.gamesPlayed,
        history: game.log,
        clueRound: game.clueRound,
        order: game.order,
        word: inGame ? wordFor(game, p) : null,
        isWhite: inGame && p.pid === game.whiteId,
        currentPlayer: game.phase === 'clues' && cur ? { id: cur.pubId, name: cur.name } : null,
        turnTimeLeft: game.turnTimeLeft,
        timeLeft: game.timeLeft,
        emergency: {
            show: game.roundCount > 0,
            count: game.emergencyVotes.size,
            required: emergencyThreshold(game),
            clicked: game.emergencyVotes.has(p.pid)
        },
        decisionAnswered: game.decisionVotes[p.pid] !== undefined,
        voting: game.phase === 'voting'
            ? { players: voteData(game), voted: game.votingVotes[p.pid] !== undefined, progress: voteProgress(game) }
            : null,
        whiteGuess: game.phase === 'whiteGuess' ? (p.pid === game.whiteId ? 'you' : 'wait') : null,
        whiteName: white ? white.name : '',
        voteResult: game.phase === 'voteResult' ? game.lastVoteResult : null,
        result: game.phase === 'result' ? game.lastResult : null
    };
}

// ---------------------------------------------------------------------------
// HÔTE
// ---------------------------------------------------------------------------
function ensureHost(game) {
    if (game.players.some(p => p.isAdmin && !p.left)) return false;
    const next = game.players.find(p => !p.left && p.connected) || game.players.find(p => !p.left);
    if (!next) return false;
    next.isAdmin = true;
    io.to(game.id).emit('hostChanged', { id: next.pubId, name: next.name });
    emitTo(next, 'customPairsUpdated', game.customPairs);
    return true;
}

// ---------------------------------------------------------------------------
// DÉROULEMENT DU JEU
// ---------------------------------------------------------------------------
function startTurnPhase(game) {
    game.phase = 'clues';
    game.currentTurn = 0;
    while (game.currentTurn < game.players.length && !isPlayable(game.players[game.currentTurn])) game.currentTurn++;
}

function handleWordSubmission(game, player, word) {
    if (game.phase !== 'clues') return;
    if (game.turnTimer) { clearInterval(game.turnTimer); game.turnTimer = null; }

    const cleanWord = sanitize(word, 20) || '...';
    game.wordHistory[player.pid].push(cleanWord);
    const entry = {
        round: game.clueRound,
        name: player.name,
        avatar: player.avatar,
        word: cleanWord,
        timedOut: cleanWord === '...'
    };
    game.log.push(entry);
    io.to(game.id).emit('wordSubmitted', entry);
    advanceTurn(game);
}

function advanceTurn(game) {
    do { game.currentTurn++; }
    while (game.currentTurn < game.players.length && !isPlayable(game.players[game.currentTurn]));

    if (game.currentTurn >= game.players.length) return startDecisionPhase(game);
    const cur = game.players[game.currentTurn];
    io.to(game.id).emit('updateTurn', { id: cur.pubId, name: cur.name });
    startTurnTimer(game);
}

function startDecisionPhase(game) {
    game.phase = 'decision';
    game.decisionVotes = {};
    game.roundCount++;
    io.to(game.id).emit('decisionPhaseStarted', { timer: 30 });
    startCountdown(game, 30, 'timerUpdate', () => resolveDecision(game));
}

function resolveDecision(game) {
    if (game.phase !== 'decision') return;
    if (game.timer) { clearInterval(game.timer); game.timer = null; }
    let votesForKick = 0, votesForCycle = 0;
    Object.values(game.decisionVotes).forEach(v => {
        if (v === 'vote') votesForKick++;
        if (v === 'cycle') votesForCycle++;
    });
    if (votesForKick > votesForCycle) startVotingPhase(game);
    else startNewCycle(game, "La majorité veut refaire un tour d'indices !");
}

function startNewCycle(game, message) {
    clearTimers(game);
    game.votingVotes = {};
    game.decisionVotes = {};
    game.emergencyVotes = new Set();
    game.clueRound++;
    startTurnPhase(game);
    const cur = game.players[game.currentTurn];
    io.to(game.id).emit('startNewCycle', {
        nextPlayer: { id: cur.pubId, name: cur.name },
        message,
        showEmergency: game.roundCount > 0,
        emergencyThreshold: emergencyThreshold(game),
        clueRound: game.clueRound
    });
    startTurnTimer(game);
}

function startVotingPhase(game) {
    if (game.turnTimer) { clearInterval(game.turnTimer); game.turnTimer = null; }
    game.phase = 'voting';
    game.votingVotes = {};
    io.to(game.id).emit('votingStarted', { players: voteData(game), timer: game.settings.voteTime, progress: voteProgress(game) });
    startCountdown(game, game.settings.voteTime, 'timerUpdate', () => finishVote(game));
}

function finishVote(game) {
    if (game.phase !== 'voting') return;
    if (game.timer) { clearInterval(game.timer); game.timer = null; }
    game.phase = 'voteResult';

    const tally = {};
    const votes = [];
    Object.entries(game.votingVotes).forEach(([voterPid, targetPid]) => {
        const voter = findByPid(game, voterPid);
        const target = findByPid(game, targetPid);
        if (!voter || !target) return;
        votes.push({ voter: { name: voter.name, avatar: voter.avatar }, target: { name: target.name, avatar: target.avatar } });
        tally[targetPid] = (tally[targetPid] || 0) + 1;
    });
    const counts = Object.entries(tally)
        .map(([pid, count]) => { const t = findByPid(game, pid); return { pid, id: t.pubId, name: t.name, avatar: t.avatar, count }; })
        .sort((a, b) => b.count - a.count);

    const max = counts.length ? counts[0].count : 0;
    const top = counts.filter(c => c.count === max);
    const tie = counts.length > 0 && top.length > 1;

    let target = null;
    let eliminated = null;
    if (counts.length > 0 && !tie) {
        target = findByPid(game, top[0].pid);
        eliminated = { id: target.pubId, name: target.name, avatar: target.avatar, role: roleOf(game, target) };
    }

    const result = {
        votes,
        counts: counts.map(({ pid, ...rest }) => rest),
        tie,
        noVotes: counts.length === 0,
        eliminated
    };
    game.lastVoteResult = result;
    io.to(game.id).emit('voteResult', result);

    game.pendingTimeout = setTimeout(() => afterVote(game, target), ms(eliminated ? VOTE_RESULT_DELAY : 5000));
}

function afterVote(game, target) {
    game.pendingTimeout = null;
    if (!game.gameActive) return;
    if (!target) return startNewCycle(game, "Égalité ou aucun vote ! Personne n'est éliminé.");

    target.alive = false;
    broadcastPlayers(game);

    if (target.pid === game.whiteId && !target.left) {
        game.phase = 'whiteGuess';
        game.players.forEach(p => {
            if (p === target) emitTo(p, 'mrWhiteLastChance', { timer: WHITE_GUESS_TIME });
            else emitTo(p, 'waitingForWhite', { name: target.name, timer: WHITE_GUESS_TIME });
        });
        startCountdown(game, WHITE_GUESS_TIME, 'whiteTimerUpdate', () => whiteGuessFailed(game, target, ''));
        return;
    }
    emitTo(target, 'youAreDead');
    continueEliminationLogic(game, target);
}

function whiteGuessFailed(game, whitePlayer, guess) {
    if (game.phase !== 'whiteGuess') return;
    if (game.timer) { clearInterval(game.timer); game.timer = null; }
    io.to(game.id).emit('gameMessage', {
        message: guess ? `M. White a proposé "${guess}"... et c'est RATÉ !` : "M. White n'a pas trouvé le mot (temps écoulé) !"
    });
    if (whitePlayer) emitTo(whitePlayer, 'youAreDead');
    continueEliminationLogic(game, whitePlayer || { pid: game.whiteId, name: 'M. White' });
}

function checkWin(game) {
    const aliveImpostors = game.players.filter(p => isPlayable(p) && game.impostorIds.includes(p.pid));
    const aliveOthers = game.players.filter(p => isPlayable(p) && !game.impostorIds.includes(p.pid));
    if (aliveImpostors.length === 0) return 'citizens';
    if (aliveImpostors.length >= aliveOthers.length) return 'impostors';
    return null;
}

function continueEliminationLogic(game, eliminated) {
    const name = eliminated.name;
    const winner = checkWin(game);
    if (winner === 'citizens') {
        return endGame(game, { winner, message: 'VICTOIRE DES CITOYENS ! Tous les imposteurs sont éliminés.', eliminatedName: name });
    }
    if (winner === 'impostors') {
        return endGame(game, { winner, message: 'LES IMPOSTEURS ONT GAGNÉ ! (Majorité numérique)', eliminatedName: name });
    }
    if (game.impostorIds.includes(eliminated.pid)) {
        return startNewCycle(game, `🔥 BRAVO ! ${name} était un IMPOSTEUR ! Mais attention, il n'est pas seul...`);
    }
    if (eliminated.pid === game.whiteId) {
        return startNewCycle(game, `⚠️ C'ÉTAIT M. WHITE ! (${name} éliminé). Les imposteurs sont toujours là...`);
    }
    startNewCycle(game, `${name} a été éliminé... C'était un Citoyen !`);
}

function endGame(game, { winner, message, eliminatedName }) {
    clearTimers(game);
    game.gameActive = false;
    game.phase = 'result';

    const participants = game.players.filter(p => p.inGame);
    const deltas = {};
    participants.forEach(p => {
        const role = roleOf(game, p);
        let d = 0;
        if (winner === 'citizens' && role === 'citizen') d = 2;
        else if (winner === 'impostors' && role === 'impostor') d = 3;
        else if (winner === 'white' && role === 'white') d = 4;
        deltas[p.pid] = d;
        p.score += d;
    });

    const roles = participants.map(p => ({
        id: p.pubId, name: p.name, avatar: p.avatar,
        role: roleOf(game, p), word: wordFor(game, p), alive: p.alive, left: p.left
    }));
    const winners = participants.filter(p => deltas[p.pid] > 0).map(p => p.pubId);
    const impostorNames = participants.filter(p => game.impostorIds.includes(p.pid)).map(p => p.name).join(' & ');

    // On nettoie : départs définitifs retirés, spectateurs deviennent joueurs
    game.players = game.players.filter(p => !p.left);
    Object.keys(game.wordHistory).forEach(pid => { if (!findByPid(game, pid)) delete game.wordHistory[pid]; });
    game.players.forEach(p => { p.spectator = false; p.alive = true; p.inGame = false; });
    ensureHost(game);

    const scores = game.players
        .map(p => ({ id: p.pubId, name: p.name, avatar: p.avatar, score: p.score, delta: deltas[p.pid] || 0 }))
        .sort((a, b) => b.score - a.score);

    const result = {
        winner,
        message,
        impostor: impostorNames || 'N/A',
        eliminated: eliminatedName || null,
        roles,
        winners,
        scores,
        pair: winner ? { normal: game.currentPair.normal, imposteur: game.currentPair.imposteur } : null
    };
    game.lastResult = result;
    io.to(game.id).emit('gameResult', result);
    broadcastPlayers(game);
}

// ---------------------------------------------------------------------------
// DÉPARTS / DÉCONNEXIONS
// ---------------------------------------------------------------------------
function destroyGame(game) {
    clearTimers(game);
    game.players.forEach(p => { clearTimeout(p.graceTimer); clearTimeout(p.hostTimer); });
    io.to(game.id).emit('roomClosed');
    io.in(game.id).socketsLeave(game.id);
    delete games[game.id];
}

function checkProgress(game) {
    if (!game.gameActive) return;
    switch (game.phase) {
        case 'clues': {
            const cur = game.players[game.currentTurn];
            if (!cur || !isPlayable(cur)) {
                if (game.turnTimer) { clearInterval(game.turnTimer); game.turnTimer = null; }
                advanceTurn(game);
            } else if (!cur.connected) {
                game.turnTimeLeft = Math.min(game.turnTimeLeft, DISCONNECTED_TURN_TIME);
            }
            break;
        }
        case 'decision':
            if (allVoted(game, game.decisionVotes)) resolveDecision(game);
            break;
        case 'voting':
            if (allVoted(game, game.votingVotes)) finishVote(game);
            else io.to(game.id).emit('voteProgress', voteProgress(game));
            break;
        case 'whiteGuess': {
            const w = findByPid(game, game.whiteId);
            if (!w || w.left) whiteGuessFailed(game, w, '');
            break;
        }
    }
}

function removePlayerFinal(game, p) {
    clearTimeout(p.graceTimer);
    clearTimeout(p.hostTimer);
    if (p.socketId) {
        const s = io.sockets.sockets.get(p.socketId);
        if (s && s.roomId === game.id) { s.leave(game.id); s.roomId = null; }
    }
    p.socketId = null;
    p.connected = false;
    const wasAdmin = p.isAdmin;

    // Hors partie (ou simple spectateur) : on retire le joueur
    if (!game.gameActive || !p.inGame) {
        game.players = game.players.filter(x => x !== p);
        delete game.wordHistory[p.pid];
        if (game.players.length === 0) return destroyGame(game);
        if (wasAdmin) ensureHost(game);
        broadcastPlayers(game);
        if (game.gameActive) checkProgress(game);
        return;
    }

    // En pleine partie : le joueur est marqué "parti"
    p.left = true;
    p.alive = false;
    p.isAdmin = false;
    if (wasAdmin) ensureHost(game);

    if (!game.players.some(x => !x.left)) return destroyGame(game);

    const remaining = game.players.filter(x => x.inGame && !x.left);
    if (remaining.length < 3) {
        endGame(game, { winner: null, message: 'PARTIE INTERROMPUE ! Pas assez de joueurs.', eliminatedName: null });
        return;
    }
    const winner = checkWin(game);
    if (winner) {
        endGame(game, {
            winner,
            message: winner === 'citizens'
                ? `VICTOIRE DES CITOYENS ! (${p.name} a quitté la partie)`
                : `LES IMPOSTEURS ONT GAGNÉ ! (${p.name} a quitté la partie)`,
            eliminatedName: p.name
        });
        return;
    }
    broadcastPlayers(game);
    checkProgress(game);
}

function evictPid(pid, exceptRoomId) {
    Object.values(games).forEach(g => {
        if (g.id === exceptRoomId) return;
        const p = g.players.find(x => x.pid === pid && !x.left);
        if (!p) return;
        if (p.socketId) {
            const s = io.sockets.sockets.get(p.socketId);
            if (s) s.emit('sessionReplaced');
        }
        removePlayerFinal(g, p);
    });
}

// ---------------------------------------------------------------------------
// FICHIERS STATIQUES (uniquement le dossier public/ : le code serveur n'est plus exposé)
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    }
}));
app.get('/healthz', (req, res) => res.send('ok'));

// ---------------------------------------------------------------------------
// SOCKET.IO
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
    socket.rlStart = Date.now();
    socket.rlCount = 0;

    // Anti-spam : au-delà de RATE_MAX événements en 5 s, les paquets sont ignorés
    socket.use((packet, next) => {
        const now = Date.now();
        if (now - socket.rlStart > 5000) { socket.rlStart = now; socket.rlCount = 0; }
        if (++socket.rlCount > RATE_MAX) return;
        next();
    });

    function fail(msg) { socket.emit('errorMsg', msg); }

    function ctx() {
        const game = games[socket.roomId];
        if (!game) return {};
        const player = game.players.find(p => p.pid === socket.pid && !p.left);
        if (!player || player.socketId !== socket.id) return {};
        touch(game);
        return { game, player };
    }

    function attach(game, player) {
        if (player.socketId && player.socketId !== socket.id) {
            const old = io.sockets.sockets.get(player.socketId);
            if (old) { old.roomId = null; old.leave(game.id); old.emit('sessionReplaced'); }
        }
        player.socketId = socket.id;
        player.connected = true;
        clearTimeout(player.graceTimer);
        clearTimeout(player.hostTimer);
        socket.join(game.id);
        socket.roomId = game.id;
        socket.pid = player.pid;
    }

    function joinRoom(game, info) {
        const spectator = game.gameActive;
        const p = {
            pid: info.pid,
            pubId: crypto.randomBytes(4).toString('hex'),
            name: info.username,
            avatar: info.avatar,
            alive: !spectator,
            isAdmin: info.isAdmin,
            spectator,
            inGame: false,
            left: false,
            connected: true,
            socketId: null,
            score: 0,
            timesImpostor: 0,
            lastImpostorGame: -1
        };
        game.players.push(p);
        game.wordHistory[p.pid] = [];
        attach(game, p);
        touch(game);
        socket.emit('syncState', buildSnapshot(game, p));
        broadcastPlayers(game);
        if (spectator) socket.emit('gameMessage', { message: '👁 Partie en cours : tu regardes en spectateur, tu joueras à la prochaine !' });
    }

    function leaveCurrent() {
        const game = games[socket.roomId];
        if (game) {
            const p = game.players.find(x => x.pid === socket.pid && !x.left && x.socketId === socket.id);
            if (p) removePlayerFinal(game, p);
        }
        if (socket.roomId) socket.leave(socket.roomId);
        socket.roomId = null;
    }

    // --- Création -----------------------------------------------------------
    socket.on('createGame', (data) => {
        data = data || {};
        const pid = sanitizePid(data.pid);
        const username = sanitize(data.username, 12);
        if (!pid) return fail('Identifiant invalide, recharge la page.');
        if (!username) return fail('Pseudo invalide !');
        if (Object.keys(games).length >= MAX_ROOMS) return fail('Le serveur est plein, réessaie plus tard.');

        leaveCurrent();
        evictPid(pid, null);

        const game = newGame(generateRoomId());
        games[game.id] = game;
        joinRoom(game, { pid, username, avatar: sanitizeAvatar(data.avatar), isAdmin: true });
    });

    // --- Rejoindre ----------------------------------------------------------
    socket.on('joinGame', (data) => {
        data = data || {};
        const pid = sanitizePid(data.pid);
        const username = sanitize(data.username, 12);
        const roomId = String(data.roomId || '').toUpperCase();
        if (!pid) return fail('Identifiant invalide, recharge la page.');
        if (!username) return fail('Pseudo invalide !');
        if (!roomId) return fail('Code de salle manquant !');
        const game = games[roomId];
        if (!game) return fail("Cette salle n'existe pas !");

        // Déjà dans cette salle avec le même identifiant : simple reprise de place
        const existing = game.players.find(p => p.pid === pid && !p.left);
        if (existing) {
            attach(game, existing);
            touch(game);
            socket.emit('syncState', buildSnapshot(game, existing));
            broadcastPlayers(game);
            return;
        }

        if (game.players.filter(p => !p.left).length >= MAX_PLAYERS) return fail(`La salle est pleine (${MAX_PLAYERS} joueurs max) !`);
        if (game.players.some(p => !p.left && p.name.toLowerCase() === username.toLowerCase())) {
            return fail('Ce pseudo est déjà pris dans cette salle !');
        }

        leaveCurrent();
        evictPid(pid, game.id);
        joinRoom(game, { pid, username, avatar: sanitizeAvatar(data.avatar), isAdmin: false });
    });

    // --- Reconnexion --------------------------------------------------------
    socket.on('rejoin', (data) => {
        data = data || {};
        const pid = sanitizePid(data.pid);
        const game = games[String(data.roomId || '').toUpperCase()];
        const p = game && pid ? game.players.find(x => x.pid === pid && !x.left) : null;
        if (!p) return socket.emit('rejoinFailed');
        attach(game, p);
        touch(game);
        socket.emit('syncState', buildSnapshot(game, p));
        broadcastPlayers(game);
        checkProgress(game);
    });

    socket.on('leaveRoom', () => {
        leaveCurrent();
        socket.emit('leftRoom');
    });

    // --- Réglages (hôte, dans le lobby) ---------------------------------------
    socket.on('updateSettings', (input) => {
        const { game, player } = ctx();
        if (!game || !player.isAdmin || game.gameActive || !input) return;
        const s = game.settings;
        if (TURN_TIMES.includes(Number(input.turnTime))) s.turnTime = Number(input.turnTime);
        if (VOTE_TIMES.includes(Number(input.voteTime))) s.voteTime = Number(input.voteTime);
        if (input.impostors === 'auto') s.impostors = 'auto';
        else if ([1, 2, 3].includes(Number(input.impostors))) s.impostors = Number(input.impostors);
        if (typeof input.mrWhite === 'boolean') s.mrWhite = input.mrWhite;
        if (Array.isArray(input.categories)) {
            const valid = categoryList(game).map(c => c.key);
            const cats = [...new Set(input.categories.filter(k => valid.includes(k)))];
            if (cats.length) s.categories = cats;
        }
        io.to(game.id).emit('settingsUpdated', settingsPayload(game));
    });

    socket.on('setCustomPairs', (list) => {
        const { game, player } = ctx();
        if (!game || !player.isAdmin || game.gameActive || !Array.isArray(list)) return;
        const seen = new Set();
        const clean = [];
        for (const item of list) {
            const a = sanitize(Array.isArray(item) ? item[0] : item && item.a, 24);
            const b = sanitize(Array.isArray(item) ? item[1] : item && item.b, 24);
            if (!a || !b || normalizeString(a) === normalizeString(b)) continue;
            const key = normalizeString(a) + '|' + normalizeString(b);
            if (seen.has(key)) continue;
            seen.add(key);
            clean.push([a, b]);
            if (clean.length >= MAX_CUSTOM_PAIRS) break;
        }
        const hadPerso = game.customPairs.length > 0;
        game.customPairs = clean;
        const s = game.settings;
        if (clean.length && !hadPerso && !s.categories.includes('perso')) s.categories.push('perso');
        if (!clean.length) {
            s.categories = s.categories.filter(k => k !== 'perso');
            if (!s.categories.length) s.categories = Object.keys(WORDS);
        }
        io.to(game.id).emit('settingsUpdated', settingsPayload(game));
        emitTo(player, 'customPairsUpdated', game.customPairs);
    });

    // --- Démarrage ------------------------------------------------------------
    socket.on('startGame', () => {
        const { game, player } = ctx();
        if (!game || !player.isAdmin) return;
        if (game.gameActive) return fail('La partie est déjà en cours !');

        const participants = game.players.filter(p => !p.left);
        if (participants.length < 3) return fail('Il faut au moins 3 joueurs !');
        if (participants.some(p => !p.connected)) return fail('Un joueur est déconnecté, attends qu\'il revienne (ou qu\'il soit retiré).');

        clearTimers(game);
        game.gameActive = true;
        game.phase = 'clues';
        game.votingVotes = {};
        game.decisionVotes = {};
        game.emergencyVotes = new Set();
        game.impostorIds = [];
        game.whiteId = null;
        game.roundCount = 0;
        game.clueRound = 1;
        game.log = [];
        game.lastVoteResult = null;
        game.lastResult = null;
        participants.forEach(p => { p.alive = true; p.spectator = false; p.inGame = true; game.wordHistory[p.pid] = []; });

        // Ordre de parole aléatoire à chaque partie
        shuffle(game.players);
        game.order = game.players.map(p => p.name);
        game.currentPair = pickWordPair(game);

        // Rôles
        const n = participants.length;
        const maxImpostors = Math.max(1, Math.floor((n - 1) / 2));
        const wanted = game.settings.impostors === 'auto' ? (n >= 6 ? 2 : 1) : game.settings.impostors;
        const impostors = pickImpostors(game, participants, Math.min(wanted, maxImpostors));
        impostors.forEach(p => {
            game.impostorIds.push(p.pid);
            p.timesImpostor = (p.timesImpostor || 0) + 1;
            p.lastImpostorGame = game.gamesPlayed;
        });
        const others = participants.filter(p => !game.impostorIds.includes(p.pid));
        if (game.settings.mrWhite && n >= 5 && others.length > 0) {
            game.whiteId = others[randInt(others.length)].pid;
        }
        game.gamesPlayed++;

        startTurnPhase(game);
        const first = game.players[game.currentTurn];
        game.players.forEach(p => {
            emitTo(p, 'gameStarted', {
                word: wordFor(game, p),
                isWhite: p.pid === game.whiteId,
                currentPlayer: { id: first.pubId, name: first.name },
                order: game.order,
                clueRound: 1
            });
        });
        broadcastPlayers(game);
        startTurnTimer(game);
    });

    // --- Indices ----------------------------------------------------------------
    socket.on('submitWord', (word) => {
        const { game, player } = ctx();
        if (!game || game.phase !== 'clues') return;
        if (game.players[game.currentTurn] !== player) return;
        handleWordSubmission(game, player, word);
    });

    socket.on('submitDecision', (choice) => {
        const { game, player } = ctx();
        if (!game || game.phase !== 'decision' || !isPlayable(player)) return;
        if (choice !== 'vote' && choice !== 'cycle') return;
        game.decisionVotes[player.pid] = choice;
        if (allVoted(game, game.decisionVotes)) resolveDecision(game);
    });

    socket.on('triggerEmergency', () => {
        const { game, player } = ctx();
        if (!game || game.phase !== 'clues' || game.roundCount < 1 || !isPlayable(player)) return;
        game.emergencyVotes.add(player.pid);
        const threshold = emergencyThreshold(game);
        io.to(game.id).emit('updateEmergencyState', { count: game.emergencyVotes.size, required: threshold });
        if (game.emergencyVotes.size >= threshold) startVotingPhase(game);
    });

    socket.on('castVote', (targetId) => {
        const { game, player } = ctx();
        if (!game || game.phase !== 'voting' || !isPlayable(player)) return;
        const target = game.players.find(p => p.pubId === String(targetId) && isPlayable(p));
        if (!target || target === player) return;
        game.votingVotes[player.pid] = target.pid;
        if (allVoted(game, game.votingVotes)) finishVote(game);
        else io.to(game.id).emit('voteProgress', voteProgress(game));
    });

    socket.on('mrWhiteGuess', (guess) => {
        const { game, player } = ctx();
        if (!game || game.phase !== 'whiteGuess' || player.pid !== game.whiteId) return;
        const cleanGuess = sanitize(guess, 40);
        if (!cleanGuess) return;
        if (game.timer) { clearInterval(game.timer); game.timer = null; }

        if (normalizeString(game.currentPair.normal) === normalizeString(cleanGuess)) {
            endGame(game, { winner: 'white', message: 'M. WHITE A TROUVÉ LE MOT ! 😱 Il vole la victoire !', eliminatedName: player.name });
        } else {
            whiteGuessFailed(game, player, cleanGuess);
        }
    });

    // --- Déconnexion ----------------------------------------------------------
    socket.on('disconnect', () => {
        const game = games[socket.roomId];
        if (!game) return;
        const p = game.players.find(x => x.pid === socket.pid && !x.left);
        if (!p || p.socketId !== socket.id) return;

        p.connected = false;
        p.socketId = null;
        const grace = game.gameActive && p.inGame ? GRACE_GAME : GRACE_LOBBY;
        p.graceTimer = setTimeout(() => { if (!p.connected) removePlayerFinal(game, p); }, ms(grace));
        if (p.isAdmin) {
            p.hostTimer = setTimeout(() => {
                if (p.connected || p.left) return;
                if (!game.players.some(x => x !== p && !x.left && x.connected)) return;
                p.isAdmin = false;
                ensureHost(game);
                broadcastPlayers(game);
            }, ms(HOST_TRANSFER_DELAY));
        }
        touch(game);
        broadcastPlayers(game);
        checkProgress(game);
    });
});

// ---------------------------------------------------------------------------
// NETTOYAGE DES SALLES ABANDONNÉES
// ---------------------------------------------------------------------------
setInterval(() => {
    const now = Date.now();
    Object.values(games).forEach(game => {
        const anyConnected = game.players.some(p => p.connected);
        const idle = now - game.lastActivity;
        if ((!anyConnected && idle > ROOM_EMPTY_MS) || idle > ROOM_IDLE_MS) destroyGame(game);
    });
}, 60 * 1000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
