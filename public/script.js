const socket = io();
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// OUTILS
// ---------------------------------------------------------------------------
function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const esc = escapeHtml;

const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

function genId() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

function formatTime(seconds) {
    seconds = Math.max(0, seconds | 0);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0' + m : m}:${s < 10 ? '0' + s : s}`;
}

let toastTimer = null;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------------------
// SONS (générés avec WebAudio : aucun fichier à charger)
// ---------------------------------------------------------------------------
const Sfx = (function () {
    let ctx = null;
    let muted = store.get('imp_muted') === '1';

    function ensure() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }
    function tone(freq, t0, dur, type, vol) {
        const c = ensure();
        if (!c) return;
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        const t = c.currentTime + t0;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.05);
    }
    const sounds = {
        turn:   () => [523, 659, 784].forEach((f, i) => tone(f, i * 0.12, 0.28, 'triangle', 0.18)),
        word:   () => tone(880, 0, 0.12, 'sine', 0.08),
        tick:   () => tone(1000, 0, 0.05, 'square', 0.04),
        vote:   () => tone(440, 0, 0.1, 'triangle', 0.12),
        start:  () => [330, 392, 523].forEach((f, i) => tone(f, i * 0.1, 0.2, 'triangle', 0.14)),
        reveal: () => { tone(110, 0, 0.5, 'sawtooth', 0.12); tone(82, 0.05, 0.7, 'sine', 0.22); },
        dead:   () => [392, 330, 262, 196].forEach((f, i) => tone(f, i * 0.18, 0.3, 'sawtooth', 0.08)),
        win:    () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.4, 'triangle', 0.18)),
        lose:   () => [330, 294, 262, 220].forEach((f, i) => tone(f, i * 0.2, 0.35, 'sine', 0.14))
    };
    function play(name) {
        if (muted) return;
        try { if (sounds[name]) sounds[name](); } catch (e) { /* ignore */ }
    }
    function toggle() {
        muted = !muted;
        store.set('imp_muted', muted ? '1' : '0');
        if (!muted) { ensure(); play('vote'); }
        return muted;
    }
    return { play, toggle, isMuted: () => muted, unlock: ensure };
})();

function toggleMute() { $('mute-btn').textContent = Sfx.toggle() ? '🔇' : '🔊'; }
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, () => Sfx.unlock(), { once: true, passive: true }));

// ---------------------------------------------------------------------------
// ÉTAT
// ---------------------------------------------------------------------------
const pid = (function () {
    let v = store.get('imp_pid');
    if (!v || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) { v = genId(); store.set('imp_pid', v); }
    return v;
})();

let myName = '';
let myId = '';
let myAvatarSeed = store.get('imp_avatar') || '';
let currentRoomId = '';
let isAdmin = false;
let isDead = false;
let isSpectator = false;
let myWord = '';
let gamesPlayed = 0;
let players = [];
let settings = null;
let categoryList = [];
let customPairs = [];
let currentTurnId = '';
let pendingAction = '';
let pendingRoomCode = '';
let justCreated = false;
let revealHeld = false;
let alwaysShow = store.get('imp_always') === '1';

try { customPairs = JSON.parse(store.get('imp_custom', '[]')) || []; } catch (e) { customPairs = []; }

const ROLE_LABEL = { impostor: '🕵️ IMPOSTEUR', white: '👻 M. WHITE', citizen: '🧑‍🌾 CITOYEN' };
const SCREENS = ['home-screen', 'pseudo-screen', 'lobby', 'game-screen', 'decision-screen', 'voting-screen',
    'voteresult-screen', 'white-guess-screen', 'wait-white-screen', 'result-screen'];
const WITH_HISTORY = ['game-screen', 'decision-screen', 'voting-screen', 'voteresult-screen',
    'white-guess-screen', 'wait-white-screen', 'result-screen'];

// Lien d'invitation : on l'analyse tout de suite (avant la connexion) pour ne pas
// tenter de reprendre une ancienne salle quand on arrive via un lien vers une autre.
(function () {
    const code = new URLSearchParams(window.location.search).get('room');
    if (code) {
        pendingRoomCode = code.toUpperCase().slice(0, 4);
        if (store.get('imp_room') !== pendingRoomCode) store.del('imp_room');
    }
})();

function switchScreen(screenId) {
    SCREENS.forEach(id => $(id).classList.add('hidden'));
    $(screenId).classList.remove('hidden');
    $('history-panel').classList.toggle('hidden', !WITH_HISTORY.includes(screenId));
}

// ---------------------------------------------------------------------------
// CONNEXION / RECONNEXION
// ---------------------------------------------------------------------------
socket.on('connect', () => {
    $('conn-banner').classList.add('hidden');
    const room = store.get('imp_room');
    if (room) socket.emit('rejoin', { pid, roomId: room });
});
socket.on('disconnect', (reason) => {
    if (reason !== 'io client disconnect') $('conn-banner').classList.remove('hidden');
});
socket.on('connect_error', () => $('conn-banner').classList.remove('hidden'));
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !socket.connected) socket.connect();
});

socket.on('rejoinFailed', () => {
    store.del('imp_room');
    if (currentRoomId) { toast("La salle n'existe plus."); resetToHome(); }
});
socket.on('sessionReplaced', () => {
    store.del('imp_room');
    alert('Tu es connecté depuis un autre onglet : cette page est désactivée.');
    resetToHome();
});
socket.on('roomClosed', () => {
    store.del('imp_room');
    toast('La salle a été fermée.');
    resetToHome();
});
socket.on('leftRoom', () => resetToHome());
socket.on('errorMsg', (msg) => { justCreated = false; toast(msg); });

function resetToHome() {
    currentRoomId = ''; myId = ''; isAdmin = false; isDead = false; isSpectator = false;
    players = []; gamesPlayed = 0; pendingAction = ''; pendingRoomCode = '';
    resetHistory();
    try { window.history.replaceState({}, '', '/'); } catch (e) { /* ignore */ }
    switchScreen('home-screen');
}

// ---------------------------------------------------------------------------
// HISTORIQUE DES MOTS
// ---------------------------------------------------------------------------
function resetHistory() { $('history-list').innerHTML = ''; }

function ensureRound(round) {
    const list = $('history-list');
    list.querySelectorAll('.history-round').forEach(el => el.classList.remove('current'));
    let block = $('history-round-' + round);
    if (!block) {
        block = document.createElement('div');
        block.id = 'history-round-' + round;
        block.className = 'history-round';
        const title = document.createElement('div');
        title.className = 'history-round-title';
        title.textContent = 'Tour ' + round;
        block.appendChild(title);
        list.appendChild(block);
    }
    block.classList.add('current');
    return block;
}

function addHistoryEntry(d, silent) {
    const block = ensureRound(d.round);
    const line = document.createElement('div');
    line.className = 'history-line';
    const img = document.createElement('img');
    img.src = Avatars.url(d.avatar);
    img.alt = '';
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = d.name;
    text.appendChild(name);
    if (d.timedOut) {
        const silent2 = document.createElement('span');
        silent2.className = 'history-silent';
        silent2.textContent = " n'a rien dit (temps écoulé)";
        text.appendChild(silent2);
    } else {
        text.appendChild(document.createTextNode(' a dit '));
        const word = document.createElement('span');
        word.className = 'history-word';
        word.textContent = '« ' + d.word + ' »';
        text.appendChild(word);
    }
    line.appendChild(img);
    line.appendChild(text);
    block.appendChild(line);
    const list = $('history-list');
    list.scrollTop = list.scrollHeight;
    if (!silent && d.name !== myName) Sfx.play('word');
}
socket.on('wordSubmitted', (d) => addHistoryEntry(d, false));

function rebuildHistory(list, round) {
    resetHistory();
    (list || []).forEach(e => addHistoryEntry(e, true));
    ensureRound(round || 1);
}

// ---------------------------------------------------------------------------
// INITIALISATION / ACCUEIL / PSEUDO
// ---------------------------------------------------------------------------
function buildAvatars(first) {
    const grid = $('avatar-grid');
    grid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
        const seed = (i === 0 && first) ? first : Avatars.randomSeed();
        const img = document.createElement('img');
        img.src = Avatars.url(seed);
        img.className = 'avatar-option';
        img.alt = 'avatar';
        img.onclick = () => selectAvatar(seed, img);
        grid.appendChild(img);
    }
    if (grid.firstChild) grid.firstChild.click();
}
function rerollAvatars() { buildAvatars(null); }
function selectAvatar(seed, element) {
    myAvatarSeed = seed;
    document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

function goToPseudo(action) {
    pendingAction = action;
    switchScreen('pseudo-screen');
    $('username').value = store.get('imp_name', '') || '';
    $('username').focus();
    $('pseudo-title').innerText = (action === 'join' && pendingRoomCode) ? `Rejoindre : ${pendingRoomCode}` : 'Créer ton profil';
}
function checkCodeAndGo() {
    const code = $('room-code-input').value.trim().toUpperCase();
    if (!code || code.length !== 4) return toast('Code invalide !');
    pendingRoomCode = code;
    goToPseudo('join');
}
function backToHome() {
    switchScreen('home-screen');
    pendingAction = ''; pendingRoomCode = '';
}
function submitPseudo() {
    const name = $('username').value.trim();
    if (!name) return toast('Choisis un pseudo !');
    myName = name;
    store.set('imp_name', name);
    store.set('imp_avatar', myAvatarSeed);
    const data = { pid, username: name, avatar: myAvatarSeed, roomId: pendingRoomCode };
    if (pendingAction === 'create') { justCreated = true; socket.emit('createGame', data); }
    else if (pendingAction === 'join') socket.emit('joinGame', data);
}
function leaveRoom() {
    store.del('imp_room');
    socket.emit('leaveRoom');
}

// ---------------------------------------------------------------------------
// SNAPSHOT : création, arrivée, reconnexion
// ---------------------------------------------------------------------------
socket.on('syncState', applySnapshot);

function applySnapshot(s) {
    $('conn-banner').classList.add('hidden');
    myId = s.me.id;
    myName = s.me.name;
    currentRoomId = s.roomId;
    isAdmin = s.me.isAdmin;
    isSpectator = s.me.spectator;
    gamesPlayed = s.gamesPlayed;
    players = s.players;
    settings = s.settings;
    categoryList = s.categoryList;
    if (s.customPairs && !justCreated) customPairs = s.customPairs;
    store.set('imp_room', s.roomId);
    $('display-code').innerText = s.roomId;

    const inPlay = ['clues', 'decision', 'voting', 'voteResult', 'whiteGuess'].includes(s.phase);
    isDead = inPlay && !s.me.alive && !s.me.spectator;
    myWord = s.word || '';
    revealHeld = false;

    renderPlayers();
    renderSettings();
    renderCustom();

    if (justCreated) {
        justCreated = false;
        if (customPairs.length) socket.emit('setCustomPairs', customPairs);
    }

    switch (s.phase) {
        case 'clues': enterClues(s); break;
        case 'decision':
            rebuildHistory(s.history, s.clueRound);
            showDecision(s.timeLeft, s.decisionAnswered);
            break;
        case 'voting':
            rebuildHistory(s.history, s.clueRound);
            showVoting({ players: s.voting.players, timer: s.timeLeft }, s.voting.voted);
            setVoteProgress(s.voting.progress);
            break;
        case 'voteResult':
            rebuildHistory(s.history, s.clueRound);
            showVoteResult(s.voteResult, true);
            break;
        case 'whiteGuess':
            rebuildHistory(s.history, s.clueRound);
            if (s.whiteGuess === 'you') showWhiteGuess(s.timeLeft);
            else showWaitWhite(s.whiteName, s.timeLeft);
            break;
        case 'result':
            rebuildHistory(s.history, s.clueRound);
            if (s.result) showResult(s.result, true); else showLobby();
            break;
        default:
            showLobby();
    }
}

function enterClues(s) {
    rebuildHistory(s.history, s.clueRound);
    setOrderInfo(s.order);
    renderRole();
    switchScreen('game-screen');
    setEmergencyUI(s.emergency.show && !isDead && !isSpectator, s.emergency.required, s.emergency.count, s.emergency.clicked);
    if (s.currentPlayer) updateTurnUI(s.currentPlayer, true);
    $('turn-timer-global').textContent = formatTime(s.turnTimeLeft);
}

// ---------------------------------------------------------------------------
// LOBBY : joueurs, réglages, mots perso
// ---------------------------------------------------------------------------
function showLobby() {
    isDead = false;
    switchScreen('lobby');
    renderPlayers();
    renderSettings();
    renderCustom();
}

function renderPlayers() {
    const me = players.find(p => p.id === myId);
    isAdmin = !!(me && me.isAdmin);
    $('players-list').innerHTML = players.map(p => `
        <div class="player-card ${p.id === myId ? 'me' : ''} ${p.connected ? '' : 'offline'}">
            <img src="${esc(Avatars.url(p.avatar))}" alt="avatar">
            <span class="name">${p.isAdmin ? '👑 ' : ''}${esc(p.name)}</span>
            ${gamesPlayed > 0 || p.score > 0 ? `<span class="score-badge">🏆 ${p.score}</span>` : ''}
            ${p.spectator ? '<span class="tag">👁 spectateur</span>' : ''}
            ${p.connected ? '' : '<span class="tag">⚠️ hors ligne</span>'}
        </div>`).join('');
    $('player-count').textContent = `(${players.length})`;
    $('start-btn').classList.toggle('hidden', !isAdmin);
    $('start-btn').innerText = gamesPlayed > 0 ? 'Rejouer ?' : 'Lancer la partie !';
    $('waiting-msg').classList.toggle('hidden', isAdmin);
    $('settings-lock').classList.toggle('hidden', isAdmin);
}
socket.on('updatePlayerList', (list) => {
    players = list;
    renderPlayers();
    renderSettings();
    renderCustom();
});
socket.on('hostChanged', (d) => {
    toast(d.id === myId ? "👑 Tu es maintenant l'hôte !" : `👑 ${d.name} est maintenant l'hôte`);
});

function renderSettings() {
    if (!settings) return;
    $('set-turnTime').value = String(settings.turnTime);
    $('set-voteTime').value = String(settings.voteTime);
    $('set-impostors').value = String(settings.impostors);
    $('set-mrWhite').checked = !!settings.mrWhite;
    ['set-turnTime', 'set-voteTime', 'set-impostors', 'set-mrWhite'].forEach(id => { $(id).disabled = !isAdmin; });
    $('cat-chips').innerHTML = categoryList.map(c => {
        const on = settings.categories.includes(c.key);
        return `<label class="chip ${on ? 'on' : ''}"><input type="checkbox" data-cat="${esc(c.key)}" ${on ? 'checked' : ''} ${isAdmin ? '' : 'disabled'}> ${c.emoji} ${esc(c.label)} <small>(${c.count})</small></label>`;
    }).join('');
}
function sendSettings() {
    if (!isAdmin) return;
    const cats = Array.from(document.querySelectorAll('#cat-chips input:checked')).map(i => i.dataset.cat);
    if (!cats.length) { toast('Garde au moins une catégorie de mots.'); renderSettings(); return; }
    socket.emit('updateSettings', {
        turnTime: Number($('set-turnTime').value),
        voteTime: Number($('set-voteTime').value),
        impostors: $('set-impostors').value,
        mrWhite: $('set-mrWhite').checked,
        categories: cats
    });
}
['set-turnTime', 'set-voteTime', 'set-impostors', 'set-mrWhite'].forEach(id => $(id).addEventListener('change', sendSettings));
$('cat-chips').addEventListener('change', sendSettings);
socket.on('settingsUpdated', (d) => {
    settings = d.settings;
    categoryList = d.categoryList;
    renderSettings();
    renderCustom();
});

function saveCustom() { store.set('imp_custom', JSON.stringify(customPairs)); }
function renderCustom() {
    $('custom-panel').classList.toggle('hidden', !isAdmin);
    const n = customPairs.length;
    $('custom-count').textContent = `${n} paire${n > 1 ? 's' : ''}`;
    $('custom-list').innerHTML = customPairs.map((p, i) => `
        <div class="custom-item"><span>${esc(p[0])} <small>/</small> ${esc(p[1])}</span>
        <button class="small-btn danger" onclick="removeCustomPair(${i})">✕</button></div>`).join('');
}
function addCustomPair() {
    if (!isAdmin) return;
    const a = $('custom-a').value.trim();
    const b = $('custom-b').value.trim();
    if (!a || !b) return toast('Remplis les deux mots.');
    if (a.toLowerCase() === b.toLowerCase()) return toast('Les deux mots doivent être différents.');
    if (customPairs.length >= 100) return toast('100 paires maximum.');
    customPairs.push([a, b]);
    saveCustom();
    socket.emit('setCustomPairs', customPairs);
    $('custom-a').value = ''; $('custom-b').value = '';
    $('custom-a').focus();
    renderCustom();
}
function removeCustomPair(i) {
    customPairs.splice(i, 1);
    saveCustom();
    socket.emit('setCustomPairs', customPairs);
    renderCustom();
}
function clearCustomPairs() {
    if (!customPairs.length || !confirm('Supprimer toutes tes paires de mots ?')) return;
    customPairs = [];
    saveCustom();
    socket.emit('setCustomPairs', customPairs);
    renderCustom();
}
socket.on('customPairsUpdated', (list) => { customPairs = list || []; renderCustom(); });

function startGame() { socket.emit('startGame'); }

function copyLink() {
    const url = window.location.origin + '/?room=' + currentRoomId;
    const done = () => {
        const feedback = $('copy-feedback');
        feedback.classList.remove('hidden');
        setTimeout(() => feedback.classList.add('hidden'), 2000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(() => window.prompt('Copie ce lien :', url));
    } else {
        window.prompt('Copie ce lien :', url);
    }
}

// ---------------------------------------------------------------------------
// JEU : mot caché, tours d'indices
// ---------------------------------------------------------------------------
function renderRole() {
    const disp = $('role-display');
    const card = $('role-card');
    const controls = $('reveal-controls');
    card.classList.toggle('dead-screen', isDead);
    disp.classList.toggle('dead-text', isDead);
    if (isSpectator) {
        $('role-label').textContent = '';
        disp.textContent = '👁 Spectateur';
        controls.classList.add('hidden');
        return;
    }
    if (isDead) {
        $('role-label').textContent = '';
        disp.textContent = '👻 ÉLIMINÉ';
        controls.classList.add('hidden');
        return;
    }
    controls.classList.remove('hidden');
    $('role-label').textContent = 'Ton mot';
    disp.textContent = (revealHeld || alwaysShow) ? myWord : '••••••';
}
function setReveal(v) {
    if (revealHeld === v) return;
    revealHeld = v;
    $('reveal-btn').classList.toggle('held', v);
    renderRole();
}
(function wireReveal() {
    const rb = $('reveal-btn');
    rb.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { rb.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        setReveal(true);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave'].forEach(ev => rb.addEventListener(ev, () => setReveal(false)));
    rb.addEventListener('contextmenu', e => e.preventDefault());
    rb.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setReveal(true); } });
    rb.addEventListener('keyup', () => setReveal(false));
    window.addEventListener('blur', () => setReveal(false));
    document.addEventListener('visibilitychange', () => { if (document.hidden) setReveal(false); });
    const cb = $('always-show');
    cb.checked = alwaysShow;
    cb.addEventListener('change', () => { alwaysShow = cb.checked; store.set('imp_always', alwaysShow ? '1' : '0'); renderRole(); });
})();

function setOrderInfo(order) {
    const el = $('order-info');
    if (order && order.length) {
        el.textContent = 'Ordre de parole : ' + order.join(' → ');
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

socket.on('gameStarted', (d) => {
    isDead = false;
    isSpectator = false;
    myWord = d.word;
    revealHeld = false;
    gamesPlayed++;
    $('reveal-btn').classList.remove('held');
    $('role-card').style.borderBottomColor = 'var(--primary-color)';
    $('white-guess-input').value = '';
    $('game-message').classList.add('hidden');
    resetHistory();
    ensureRound(d.clueRound || 1);
    setOrderInfo(d.order);
    renderRole();
    switchScreen('game-screen');
    setEmergencyUI(false);
    Sfx.play('start');
    updateTurnUI(d.currentPlayer);
});

function updateTurnUI(cp, silent) {
    if (!cp) return;
    currentTurnId = cp.id;
    const turnInfo = $('turn-info');
    const inputArea = $('word-input-area');
    const mine = cp.id === myId && !isDead && !isSpectator;
    if (mine) {
        turnInfo.innerHTML = "⭐ C'est à <strong>TOI</strong> d'écrire !";
        turnInfo.style.color = 'var(--secondary-color)';
        inputArea.classList.remove('hidden');
        if (!silent) {
            $('game-word-input').value = '';
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
            Sfx.play('turn');
        }
        $('game-word-input').focus();
    } else {
        turnInfo.innerHTML = `C'est au tour de <strong>${esc(cp.name)}</strong> d'écrire...`;
        turnInfo.style.color = 'var(--primary-color)';
        inputArea.classList.add('hidden');
    }
}
socket.on('updateTurn', (cp) => updateTurnUI(cp));

function submitWord() {
    const word = $('game-word-input').value.trim();
    $('word-input-area').classList.add('hidden');
    socket.emit('submitWord', word);
}

socket.on('turnTimerUpdate', (t) => {
    const el = $('turn-timer-global');
    el.textContent = formatTime(t);
    el.style.color = t <= 10 ? 'var(--danger-color)' : 'var(--primary-color)';
    if (t <= 5 && t > 0 && currentTurnId === myId && !isDead && !isSpectator) Sfx.play('tick');
});

socket.on('startNewCycle', (d) => {
    switchScreen('game-screen');
    if (d.clueRound) ensureRound(d.clueRound);
    if (d.message) {
        const msg = $('game-message');
        msg.innerText = d.message;
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 5000);
    }
    renderRole();
    setEmergencyUI(d.showEmergency && !isDead && !isSpectator, d.emergencyThreshold, 0, false);
    updateTurnUI(d.nextPlayer);
});

function setEmergencyUI(show, needed, count, clicked) {
    $('emergency-container').classList.toggle('hidden', !show);
    if (!show) return;
    $('emergency-count').innerText = count || 0;
    $('emergency-needed').innerText = needed;
    $('emergency-btn').disabled = !!clicked;
}
function clickEmergency() {
    if (isDead || isSpectator) return;
    $('emergency-btn').disabled = true;
    socket.emit('triggerEmergency');
}
socket.on('updateEmergencyState', (d) => {
    $('emergency-count').innerText = d.count;
    $('emergency-needed').innerText = d.required;
});

socket.on('youAreDead', () => {
    isDead = true;
    if (navigator.vibrate) navigator.vibrate(500);
    Sfx.play('dead');
    $('word-input-area').classList.add('hidden');
    $('emergency-container').classList.add('hidden');
    $('decision-choices').classList.add('hidden');
    renderRole();
});

socket.on('gameMessage', (d) => toast(d.message));

// ---------------------------------------------------------------------------
// DÉCISION
// ---------------------------------------------------------------------------
function showDecision(timer, answered) {
    switchScreen('decision-screen');
    $('timer-display-decision').innerText = formatTime(timer);
    const canAct = !isDead && !isSpectator;
    $('decision-choices').classList.toggle('hidden', !canAct || answered);
    const wait = $('decision-wait-msg');
    wait.classList.toggle('hidden', canAct && !answered);
    wait.textContent = !canAct ? 'Les joueurs encore en jeu décident...' : 'Choix enregistré...';
}
socket.on('decisionPhaseStarted', (d) => showDecision(d.timer, false));
function makeDecision(c) {
    $('decision-choices').classList.add('hidden');
    $('decision-wait-msg').classList.remove('hidden');
    $('decision-wait-msg').textContent = 'Choix enregistré...';
    Sfx.play('vote');
    socket.emit('submitDecision', c);
}

// ---------------------------------------------------------------------------
// VOTE
// ---------------------------------------------------------------------------
function showVoting(data, voted) {
    switchScreen('voting-screen');
    $('timer-display').innerText = formatTime(data.timer);
    const canVote = !isDead && !isSpectator;
    $('spectator-msg').classList.toggle('hidden', canVote);
    $('voting-controls').classList.toggle('hidden', !canVote || voted);
    $('vote-confirmation').classList.toggle('hidden', !(canVote && voted));
    const list = $('candidates-list');
    list.innerHTML = '';
    data.players.filter(p => p.id !== myId).forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'candidate-btn secondary-btn';
        btn.innerHTML = `
            <img src="${esc(Avatars.url(p.avatar))}" alt="">
            <div>${esc(p.name)}</div>
            <div class="last-word-display">"${esc(p.lastWord)}"</div>`;
        btn.onclick = () => submitVote(p.id);
        list.appendChild(btn);
    });
}
socket.on('votingStarted', (d) => {
    showVoting(d, false);
    setVoteProgress(d.progress);
    Sfx.play('start');
});
function setVoteProgress(p) {
    $('vote-progress').textContent = p && p.total ? `🗳️ ${p.done}/${p.total} ont voté` : '';
}
socket.on('voteProgress', setVoteProgress);
function submitVote(targetId) {
    $('candidates-list').innerHTML = '';
    $('voting-controls').classList.add('hidden');
    $('vote-confirmation').classList.remove('hidden');
    Sfx.play('vote');
    socket.emit('castVote', targetId);
}

// ---------------------------------------------------------------------------
// RÉSULTAT DU VOTE (animé)
// ---------------------------------------------------------------------------
let vrTimers = [];
function showVoteResult(d, instant) {
    vrTimers.forEach(clearTimeout);
    vrTimers = [];
    switchScreen('voteresult-screen');

    const bars = $('vr-bars');
    bars.innerHTML = '';
    const max = Math.max(1, ...d.counts.map(c => c.count));
    d.counts.forEach((c, idx) => {
        const voters = d.votes.filter(v => v.target.name === c.name);
        const row = document.createElement('div');
        row.className = 'vr-row';
        row.innerHTML = `
            <div class="vr-who"><img src="${esc(Avatars.url(c.avatar))}" alt=""><span>${esc(c.name)}</span></div>
            <div class="vr-bar-wrap"><div class="vr-bar ${idx === 0 && !d.tie ? 'top' : ''}" style="min-width:${voters.length * 25 + 8}px">
                ${voters.map(v => `<img src="${esc(Avatars.url(v.voter.avatar))}" alt="" title="${esc(v.voter.name)}">`).join('')}
            </div></div>
            <div class="vr-count">${c.count}</div>`;
        bars.appendChild(row);
        const bar = row.querySelector('.vr-bar');
        const pct = Math.max(8, (c.count / max) * 100);
        if (instant) { bar.style.transition = 'none'; bar.style.width = pct + '%'; }
        else vrTimers.push(setTimeout(() => { bar.style.width = pct + '%'; }, 80 + idx * 150));
    });
    if (!d.counts.length) bars.innerHTML = '<p style="color:#999">Aucun vote enregistré.</p>';

    $('vr-who-voted').innerHTML = d.votes.length
        ? '<strong>Qui a voté pour qui :</strong>' + d.votes.map(v => `<div>${esc(v.voter.name)} → <strong>${esc(v.target.name)}</strong></div>`).join('')
        : '';

    const rev = $('vr-reveal');
    rev.classList.add('hidden');
    rev.innerHTML = '';
    const at = (delay, fn) => { if (instant) fn(); else vrTimers.push(setTimeout(fn, delay)); };

    if (d.eliminated) {
        const e = d.eliminated;
        at(2200, () => {
            rev.innerHTML = `<div class="big">💀 ${esc(e.name)} est éliminé…</div>`;
            rev.classList.remove('hidden');
            if (!instant) Sfx.play('reveal');
        });
        at(3800, () => {
            rev.innerHTML += `<div class="vr-role ${esc(e.role)}">C'était ${ROLE_LABEL[e.role] || ''} !</div>`;
            if (!instant) Sfx.play(e.role === 'impostor' ? 'win' : 'lose');
        });
    } else {
        at(1500, () => {
            rev.innerHTML = `<div class="big">${d.tie ? '⚖️ Égalité ! Personne n\'est éliminé.' : "🤷 Personne n'a voté... Personne n'est éliminé."}</div>`;
            rev.classList.remove('hidden');
        });
    }
}
socket.on('voteResult', (d) => showVoteResult(d, false));

// ---------------------------------------------------------------------------
// M. WHITE
// ---------------------------------------------------------------------------
function showWhiteGuess(t) {
    switchScreen('white-guess-screen');
    $('white-timer-guess').textContent = formatTime(t);
    $('white-guess-input').disabled = false;
    document.querySelector('#white-guess-screen button').disabled = false;
    $('white-guess-input').focus();
}
function showWaitWhite(name, t) {
    switchScreen('wait-white-screen');
    $('white-name-display').innerText = name;
    $('white-timer-wait').textContent = formatTime(t);
}
socket.on('mrWhiteLastChance', (d) => { Sfx.play('reveal'); showWhiteGuess(d.timer); });
socket.on('waitingForWhite', (d) => { Sfx.play('reveal'); showWaitWhite(d.name, d.timer); });
socket.on('whiteTimerUpdate', (t) => {
    const f = formatTime(t);
    $('white-timer-guess').textContent = f;
    $('white-timer-wait').textContent = f;
    if (t <= 5 && t > 0) Sfx.play('tick');
});
function submitWhiteGuess() {
    const guess = $('white-guess-input').value.trim();
    if (!guess) return toast('Écris un mot !');
    $('white-guess-input').disabled = true;
    document.querySelector('#white-guess-screen button').disabled = true;
    socket.emit('mrWhiteGuess', guess);
}

// ---------------------------------------------------------------------------
// FIN DE PARTIE : rôles + classement
// ---------------------------------------------------------------------------
socket.on('gameResult', (d) => { isDead = false; showResult(d, false); });

function showResult(d, instant) {
    switchScreen('result-screen');
    const participant = d.roles.some(r => r.id === myId);
    const won = d.winners.includes(myId);
    const title = $('result-title');
    title.className = '';
    if (!d.winner) title.textContent = '⚠️ Partie interrompue';
    else if (participant && won) { title.textContent = '🎉 VICTOIRE !'; title.className = 'win'; }
    else if (participant) { title.textContent = '💀 DÉFAITE'; title.className = 'lose'; }
    else title.textContent = '🏁 FIN DE PARTIE';

    $('result-message').textContent = d.message + (d.eliminated && d.winner ? ` (dernier éliminé : ${d.eliminated})` : '');
    $('result-words').innerHTML = d.pair
        ? `Mot des citoyens : <strong>${esc(d.pair.normal)}</strong> · Mot de l'imposteur : <strong>${esc(d.pair.imposteur)}</strong>`
        : '';

    $('result-roles').innerHTML = d.roles.map(r => `
        <div class="role-line">
            <img src="${esc(Avatars.url(r.avatar))}" alt="">
            <span class="rname">${esc(r.name)}${r.alive ? '' : ' 💀'}${r.left ? ' (parti)' : ''}</span>
            <span class="rrole">${ROLE_LABEL[r.role] || ''}</span>
            <span class="rword">${r.role === 'white' ? '—' : esc(r.word)}</span>
        </div>`).join('');

    $('result-scores').innerHTML = d.scores.map((s, i) => `
        <div class="score-line ${s.id === myId ? 'me' : ''}">
            <span>${['🥇', '🥈', '🥉'][i] || (i + 1)}</span>
            <img src="${esc(Avatars.url(s.avatar))}" alt="">
            <span style="font-weight:600">${esc(s.name)}</span>
            <span class="delta">${s.delta > 0 ? '+' + s.delta : ''}</span>
            <span class="total">${s.score}</span>
        </div>`).join('');

    if (!instant && d.winner && participant) {
        if (won) {
            Sfx.play('win');
            if (typeof confetti === 'function') confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        } else {
            Sfx.play('lose');
        }
    }
}
function backToLobby() { showLobby(); }

// ---------------------------------------------------------------------------
// TIMERS COMMUNS (décision / vote)
// ---------------------------------------------------------------------------
socket.on('timerUpdate', (time) => {
    const formatted = formatTime(time);
    const col = time <= 5 ? 'red' : 'var(--primary-color)';
    ['timer-display', 'timer-display-decision'].forEach(id => {
        const el = $(id);
        el.innerText = formatted;
        el.style.color = col;
    });
    if (time <= 5 && time > 0 && !isDead && !isSpectator) Sfx.play('tick');
});

// ---------------------------------------------------------------------------
// DIVERS : règles, touche Entrée, PWA
// ---------------------------------------------------------------------------
function toggleRules() { $('rules-modal').classList.toggle('hidden'); }

function onEnter(id, fn) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } });
}
onEnter('username', submitPseudo);
onEnter('room-code-input', checkCodeAndGo);
onEnter('game-word-input', submitWord);
onEnter('white-guess-input', submitWhiteGuess);
onEnter('custom-b', addCustomPair);

window.addEventListener('load', () => {
    $('mute-btn').textContent = Sfx.isMuted() ? '🔇' : '🔊';
    if (pendingRoomCode && pendingRoomCode.length === 4) goToPseudo('join');
    buildAvatars(myAvatarSeed || null);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });
});
