const socket = io();
let myName = "";
let myAvatarUrl = ""; 
let currentRoomId = "";
let isDead = false;
let pendingAction = "";
let pendingRoomCode = "";

// --- INITIALISATION ---
window.onload = () => {
    // 1. Liens d'invitation
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room');
    if (roomCode) {
        pendingRoomCode = roomCode.toUpperCase();
        goToPseudo('join');
    }

    // 2. Grille d'avatars
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
    const title = document.getElementById('pseudo-title');
    title.innerText = (action === 'join' && pendingRoomCode) ? `Rejoindre : ${pendingRoomCode}` : "Créer ton profil";
}

function checkCodeAndGo() {
    const codeInput = document.getElementById('room-code-input');
    const code = codeInput.value.trim().toUpperCase();
    if (!code || code.length !== 4) return alert("Code invalide (4 lettres) !");
    pendingRoomCode = code;
    goToPseudo('join');
}

function backToHome() {
    switchScreen('home-screen');
    pendingAction = ""; pendingRoomCode = "";
    window.history.pushState({},'', window.location.pathname);
}

function submitPseudo() {
    myName = document.getElementById('username').value.trim();
    if (!myName) return alert("Choisis un pseudo !");
    
    const playerData = { username: myName, avatar: myAvatarUrl, roomId: pendingRoomCode };
    if (pendingAction === 'create') {
        socket.emit('createGame', playerData);
    } else if (pendingAction === 'join') {
        if(!pendingRoomCode) return alert("Code manquant.");
        socket.emit('joinGame', playerData);
    }
}

// --- LOBBY ---
socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    switchScreen('lobby');
    document.getElementById('display-code').innerText = currentRoomId;
    const newUrl = window.location.href.split('?')[0] + '?room=' + currentRoomId;
    window.history.pushState({path:newUrl},'',newUrl);
});

socket.on('updatePlayerList', (playersList) => {
    const list = document.getElementById('players-list');
    const me = playersList.find(p => p.id === socket.id);
    
    // GESTION UI ADMIN
    const startBtn = document.getElementById('start-btn');
    const waitingMsg = document.getElementById('waiting-msg');

    if (me && me.isAdmin) {
        startBtn.classList.remove('hidden');
        waitingMsg.classList.add('hidden');
    } else {
        startBtn.classList.add('hidden');
        waitingMsg.classList.remove('hidden');
    }

    list.innerHTML = playersList.map(p => {
        const adminClass = p.isAdmin ? "admin" : "";
        const crown = p.isAdmin ? "👑 " : "";
        return `<div class="player-card ${adminClass}">
            <img src="${p.avatar}" alt="avatar">
            <span class="name">${crown}${p.name}</span>
        </div>`;
    }).join('');
});

// --- JEU ---
socket.on('gameStarted', (data) => {
    resetUI();
    switchScreen('game-screen');
    document.getElementById('role-display').innerText = data.word;
    updateTurnUI(data.currentPlayer);
});

socket.on('updateTurn', updateTurnUI);

function updateTurnUI(currentPlayerName) {
    if (isDead) return;
    const turnInfo = document.getElementById('turn-info');
    const nextBtn = document.getElementById('next-btn');

    if (currentPlayerName === myName) {
        turnInfo.innerHTML = "⭐ C'est à <strong>TOI</strong> de parler !";
        turnInfo.style.color = "var(--secondary-color)";
        nextBtn.classList.remove('hidden');
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    } else {
        turnInfo.innerHTML = `C'est au tour de <strong>${currentPlayerName}</strong>...`;
        turnInfo.style.color = "var(--primary-color)";
        nextBtn.classList.add('hidden');
    }
}

// --- FIN CYCLE / VOTE ---
socket.on('roundFinished', (data) => {
    if (isDead) {
        document.getElementById('turn-info').innerText = "Fin du cycle. Les vivants délibèrent...";
        return; 
    }
    document.getElementById('turn-info').innerText = "Tour terminé !";
    document.getElementById('decide-count').innerText = "0/" + data.total;
    document.getElementById('vote-section').classList.remove('hidden');
    document.getElementById('btn-more').disabled = false;
    setTimeout(() => { document.getElementById('vote-section').scrollIntoView({behavior: "smooth"}); }, 100);
});

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
        btn.innerHTML = `<img src="${p.avatar}" style="width:30px; height:30px; margin-right:10px; border-radius:50%;">${p.name}`;
        btn.onclick = () => submitVote(p.name);
        list.appendChild(btn);
    });
});

// --- RÉSULTATS ---
socket.on('gameResult', (data) => {
    switchScreen('game-screen');
    document.getElementById('vote-section').classList.add('hidden');
    
    const roleCard = document.getElementById('role-card');
    const turnInfo = document.getElementById('turn-info');
    
    roleCard.style.borderBottomColor = data.success ? "var(--secondary-color)" : "var(--danger-color)";
    document.getElementById('role-display').innerText = data.success ? "🎉 VICTOIRE !" : "💀 DÉFAITE...";
    
    // --- CONFETTIS ---
    if (data.success) {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    }

    let resText = `<strong>${data.message}</strong><br><br>`;
    resText += `🕵️ Imposteur(s) : <strong>${data.impostor}</strong>`;
    if(data.eliminated) resText += `<br>⚰️ Dernier éliminé : ${data.eliminated}`;
    
    turnInfo.innerHTML = resText;
    
    setTimeout(() => {
         switchScreen('lobby');
         document.getElementById('start-btn').innerText = "Rejouer ?";
    }, 6000); 
});

// --- UTILITAIRES ---
function switchScreen(screenId) {
    ['home-screen', 'pseudo-screen', 'lobby', 'game-screen', 'voting-screen'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

// Fonction toggle Modal
function toggleRules() {
    const modal = document.getElementById('rules-modal');
    modal.classList.toggle('hidden');
}

socket.on('youAreDead', () => {
    isDead = true;
    if (navigator.vibrate) navigator.vibrate(500);

    document.getElementById('role-card').classList.add('dead-screen');
    document.getElementById('role-display').innerText = "👻 ÉLIMINÉ";
    document.getElementById('role-display').classList.add('dead-text');
    document.getElementById('next-btn').classList.add('hidden');
    document.getElementById('vote-section').classList.add('hidden');
});

// Fonctions sockets
function startGame() { 
    socket.emit('startGame'); // Retour à l'appel simple sans arguments
}

function passTurn() { document.getElementById('next-btn').classList.add('hidden'); socket.emit('nextTurn'); }
function moreIndices() { if(isDead) return; document.getElementById('btn-more').disabled = true; socket.emit('requestMoreIndices'); }
function requestVote() { if(isDead) return; socket.emit('requestVotePhase'); }
function submitVote(targetName) { 
    document.getElementById('candidates-list').innerHTML = ""; 
    document.getElementById('vote-confirmation').classList.remove('hidden'); 
    socket.emit('castVote', targetName); 
}

socket.on('updateDecisionCount', (data) => document.getElementById('decide-count').innerText = `${data.count}/${data.total}`);

socket.on('timerUpdate', (time) => {
    const display = document.getElementById('timer-display');
    display.innerText = time;
    if(time <= 5) {
        display.style.color = "red";
    } else {
        display.style.color = "var(--primary-color)";
    }
});

socket.on('error', (msg) => alert(msg));
function copyLink() { navigator.clipboard.writeText(window.location.href).then(() => alert("Lien copié !")); }

function resetUI() {
    isDead = false;
    document.getElementById('role-card').classList.remove('dead-screen');
    document.getElementById('role-display').classList.remove('dead-text');
    document.getElementById('role-card').style.borderBottomColor = "var(--primary-color)";
}

socket.on('startNewCycle', (data) => {
    switchScreen('game-screen');
    document.getElementById('vote-section').classList.add('hidden');
    if(data.message) {
         const msg = document.getElementById('game-message'); 
         msg.innerText = data.message; msg.classList.remove('hidden'); 
         setTimeout(() => msg.classList.add('hidden'), 3000);
    }
    updateTurnUI(data.nextPlayer);
});