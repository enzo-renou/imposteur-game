const socket = io();
let myName = "";
let myAvatarUrl = ""; 
let currentRoomId = "";
let isDead = false;
let pendingAction = "";
let pendingRoomCode = "";
let myRole = ""; // "white", "impostor", "citizen"

// --- INITIALISATION ---
window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (roomCode) {
        pendingRoomCode = roomCode.toUpperCase();
        goToPseudo('join');
    }
    const grid = document.getElementById('avatar-grid');
    const baseUrl = "https://api.dicebear.com/7.x/bottts/svg?seed=";
    for (let i = 0; i < 9; i++) {
        const seed = Math.random().toString(36).substring(7);
        const url = baseUrl + seed;
        const img = document.createElement('img');
        img.src = url;
        img.className = 'avatar-option';
        img.onclick = () => selectAvatar(url, img);
        grid.appendChild(img);
    }
    if (grid.firstChild) grid.firstChild.click();
};

function selectAvatar(url, element) {
    myAvatarUrl = url;
    document.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');
}

// --- NAVIGATION ---
function goToPseudo(action) {
    pendingAction = action;
    switchScreen('pseudo-screen');
    document.getElementById('username').focus();
    document.getElementById('pseudo-title').innerText = (action === 'join' && pendingRoomCode) ? `Rejoindre : ${pendingRoomCode}` : "Créer ton profil";
}

function checkCodeAndGo() {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!code || code.length !== 4) return alert("Code invalide !");
    pendingRoomCode = code;
    goToPseudo('join');
}

function backToHome() {
    switchScreen('home-screen');
    pendingAction = ""; pendingRoomCode = "";
}

function submitPseudo() {
    myName = document.getElementById('username').value.trim();
    if (!myName) return alert("Choisis un pseudo !");
    const playerData = { username: myName, avatar: myAvatarUrl, roomId: pendingRoomCode };
    if (pendingAction === 'create') socket.emit('createGame', playerData);
    else if (pendingAction === 'join') socket.emit('joinGame', playerData);
}

// --- LOBBY ---
socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    switchScreen('lobby');
    document.getElementById('display-code').innerText = currentRoomId;
});

socket.on('updatePlayerList', (playersList) => {
    const list = document.getElementById('players-list');
    const me = playersList.find(p => p.id === socket.id);
    if (me && me.isAdmin) {
        document.getElementById('start-btn').classList.remove('hidden');
        document.getElementById('waiting-msg').classList.add('hidden');
    } else {
        document.getElementById('start-btn').classList.add('hidden');
        document.getElementById('waiting-msg').classList.remove('hidden');
    }
    list.innerHTML = playersList.map(p => {
        return `<div class="player-card ${p.isAdmin ? "admin" : ""}">
            <img src="${p.avatar}" alt="avatar">
            <span class="name">${p.isAdmin ? "👑 " : ""}${p.name}</span>
        </div>`;
    }).join('');
});

// --- JEU ---
socket.on('gameStarted', (data) => {
    resetUI();
    switchScreen('game-screen');
    document.getElementById('role-display').innerText = data.word;
    document.getElementById('emergency-container').classList.add('hidden');
    
    // Détection du rôle local
    if(data.word === "???") myRole = "white";
    else myRole = "citizen"; 
    
    updateTurnUI(data.currentPlayer);
});

socket.on('updateTurn', updateTurnUI);

function updateTurnUI(currentPlayerName) {
    if (isDead) return;
    const turnInfo = document.getElementById('turn-info');
    const inputArea = document.getElementById('word-input-area');

    if (currentPlayerName === myName) {
        turnInfo.innerHTML = "⭐ C'est à <strong>TOI</strong> d'écrire !";
        turnInfo.style.color = "var(--secondary-color)";
        inputArea.classList.remove('hidden');
        document.getElementById('game-word-input').value = "";
        document.getElementById('game-word-input').focus();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else {
        turnInfo.innerHTML = `C'est au tour de <strong>${currentPlayerName}</strong> d'écrire...`;
        turnInfo.style.color = "var(--primary-color)";
        inputArea.classList.add('hidden');
    }
}

// Timer Tour (1m30)
socket.on('turnTimerUpdate', (time) => {
    document.getElementById('turn-timer').innerText = formatTime(time);
});

function submitWord() {
    const word = document.getElementById('game-word-input').value.trim();
    document.getElementById('word-input-area').classList.add('hidden');
    socket.emit('submitWord', word);
}

// --- NOUVEAU CYCLE (Indices) ---
socket.on('startNewCycle', (data) => {
    switchScreen('game-screen');
    if(data.message) {
         const msg = document.getElementById('game-message'); 
         msg.innerText = data.message; msg.classList.remove('hidden'); 
         setTimeout(() => msg.classList.add('hidden'), 4000);
    }
    
    // Reset Urgence
    const emerContainer = document.getElementById('emergency-container');
    document.getElementById('emergency-count').innerText = "0";
    document.getElementById('emergency-btn').disabled = false;
    document.getElementById('emergency-needed').innerText = data.emergencyThreshold;
    
    if (data.showEmergency && !isDead) emerContainer.classList.remove('hidden');
    else emerContainer.classList.add('hidden');

    updateTurnUI(data.nextPlayer);
});

// --- DECISION ---
socket.on('decisionPhaseStarted', (data) => {
    if (isDead) { document.getElementById('turn-info').innerText = "Fin du tour. Décision..."; return; }
    switchScreen('decision-screen');
    document.getElementById('decision-choices').classList.remove('hidden');
    document.getElementById('decision-wait-msg').classList.add('hidden');
    document.getElementById('timer-display-decision').innerText = data.timer;
});
function makeDecision(c) {
    document.getElementById('decision-choices').classList.add('hidden');
    document.getElementById('decision-wait-msg').classList.remove('hidden');
    socket.emit('submitDecision', c);
}

// --- VOTE ---
socket.on('votingStarted', (data) => {
    switchScreen('voting-screen');
    document.getElementById('vote-confirmation').classList.add('hidden');
    if (isDead) {
        document.getElementById('voting-controls').classList.add('hidden');
        document.getElementById('spectator-msg').classList.remove('hidden');
        return;
    }
    document.getElementById('spectator-msg').classList.add('hidden');
    document.getElementById('voting-controls').classList.remove('hidden');
    const list = document.getElementById('candidates-list');
    list.innerHTML = "";
    
    data.players.forEach(p => {
        const btn = document.createElement('button');
        btn.className = "candidate-btn secondary-btn";
        btn.innerHTML = `
            <div><img src="${p.avatar}" style="width:30px; height:30px; vertical-align:middle; border-radius:50%; margin-right:5px;">${p.name}</div>
            <div class="last-word-display">"${p.lastWord}"</div>
        `;
        btn.onclick = () => submitVote(p.name);
        list.appendChild(btn);
    });
});
function submitVote(name) { 
    document.getElementById('candidates-list').innerHTML = ""; 
    document.getElementById('vote-confirmation').classList.remove('hidden'); 
    socket.emit('castVote', name); 
}

// --- LOGIQUE M. BLANC ---
socket.on('mrWhiteLastChance', () => {
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('voting-screen').classList.add('hidden');
    document.getElementById('white-guess-screen').classList.remove('hidden');
    myRole = "white"; // Confirmation
});

socket.on('waitingForWhite', (data) => {
    document.getElementById('game-screen').classList.add('hidden');
    document.getElementById('voting-screen').classList.add('hidden');
    document.getElementById('wait-white-screen').classList.remove('hidden');
    document.getElementById('white-name-display').innerText = data.name;
});

function submitWhiteGuess() {
    const guess = document.getElementById('white-guess-input').value.trim();
    if (!guess) return alert("Écris un mot !");
    socket.emit('mrWhiteGuess', guess);
}

// --- RÉSULTATS ---
socket.on('gameResult', (data) => {
    document.getElementById('white-guess-screen').classList.add('hidden');
    document.getElementById('wait-white-screen').classList.add('hidden');
    switchScreen('game-screen');
    document.getElementById('emergency-container').classList.add('hidden');
    
    const roleCard = document.getElementById('role-card');
    const turnInfo = document.getElementById('turn-info');
    
    // LOGIQUE VICTOIRE LOCALE
    let isVictory = false;
    
    if (data.winner === 'white') {
        if (myRole === 'white') isVictory = true;
    } 
    else if (data.winner === 'impostors') {
        // Pour les imposteurs, on n'a pas mis de flag explicite localement
        // mais si le serveur dit "impostors" et que je ne suis pas "white",
        // si je suis citoyen j'ai perdu. Si je suis imposteur j'ai gagné.
        // Simplification : On affiche le message du serveur qui est clair.
    }
    
    // Affichage spécifique VICTOIRE pour Mr White
    if (data.winner === 'white' && myRole === 'white') {
        roleCard.style.borderBottomColor = "var(--secondary-color)"; // Vert
        document.getElementById('role-display').innerText = "🎉 VICTOIRE !";
    } else {
        // Comportement par défaut (affiche Titre serveur si besoin, ou juste le message)
        roleCard.style.borderBottomColor = (data.winner === 'citizens' && myRole !== 'white') ? "var(--secondary-color)" : "var(--primary-color)";
        // On laisse le message du serveur parler, sauf si c'est une défaite explicite
        document.getElementById('role-display').innerText = "FIN DE PARTIE";
    }
    
    if (data.success || (data.winner === 'white' && myRole === 'white')) {
         confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }

    let resText = `<strong>${data.message}</strong><br><br>`;
    resText += `🕵️ Imposteur(s) : <strong>${data.impostor}</strong>`;
    if(data.eliminated) resText += `<br>⚰️ Dernier éliminé : ${data.eliminated}`;
    
    turnInfo.innerHTML = resText;
    
    setTimeout(() => { switchScreen('lobby'); document.getElementById('start-btn').innerText = "Rejouer ?"; }, 8000); 
});

// --- UTILS ---
function switchScreen(screenId) {
    const ids = ['home-screen', 'pseudo-screen', 'lobby', 'game-screen', 'voting-screen', 'decision-screen', 'white-guess-screen', 'wait-white-screen'];
    ids.forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById(screenId).classList.remove('hidden');
}
function toggleRules() { document.getElementById('rules-modal').classList.toggle('hidden'); }
socket.on('youAreDead', () => {
    isDead = true;
    if (navigator.vibrate) navigator.vibrate(500);
    document.getElementById('role-card').classList.add('dead-screen');
    document.getElementById('role-display').innerText = "👻 ÉLIMINÉ";
    document.getElementById('role-display').classList.add('dead-text');
    document.getElementById('word-input-area').classList.add('hidden');
    document.getElementById('emergency-container').classList.add('hidden');
    document.getElementById('decision-choices').classList.add('hidden');
});
function clickEmergency() { if (isDead) return; document.getElementById('emergency-btn').disabled = true; socket.emit('triggerEmergency'); }
socket.on('updateEmergencyState', (data) => { document.getElementById('emergency-count').innerText = data.count; document.getElementById('emergency-needed').innerText = data.required; });

socket.on('timerUpdate', (time) => {
    const formatted = formatTime(time);
    const d1 = document.getElementById('timer-display'); 
    const d2 = document.getElementById('timer-display-decision');
    if(d1) d1.innerText = formatted; 
    if(d2) d2.innerText = formatted;
    const col = time <= 5 ? "red" : "var(--primary-color)";
    if(d1) d1.style.color = col; 
    if(d2) d2.style.color = col;
});

// Helper pour format mm:ss
function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m < 10 ? '0'+m : m}:${s < 10 ? '0'+s : s}`;
}

// Fonction copier propre
function copyLink() {
    const url = window.location.origin + '/?room=' + currentRoomId;
    navigator.clipboard.writeText(url).then(() => {
        const feedback = document.getElementById('copy-feedback');
        feedback.classList.remove('hidden');
        setTimeout(() => feedback.classList.add('hidden'), 2000);
    }).catch(err => {
        alert("Erreur copie : " + err);
    });
}

socket.on('error', (msg) => alert(msg));
function resetUI() {
    isDead = false;
    document.getElementById('role-card').classList.remove('dead-screen');
    document.getElementById('role-display').classList.remove('dead-text');
    document.getElementById('role-card').style.borderBottomColor = "var(--primary-color)";
    document.getElementById('white-guess-input').value = "";
}
function startGame() { socket.emit('startGame'); }
function passTurn() { document.getElementById('next-btn').classList.add('hidden'); socket.emit('nextTurn'); }