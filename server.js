const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Stockage des parties
const games = {}; 

// Liste des mots
const wordPairs = [
    { normal: "Sable", imposteur: "Gravier" },
    { normal: "Lion", imposteur: "Tigre" },
    { normal: "Avion", imposteur: "Hélicoptère" },
    { normal: "Pizza", imposteur: "Burger" },
    { normal: "Piano", imposteur: "Guitare" },
    { normal: "Océan", imposteur: "Lac" },
    { normal: "Chien", imposteur: "Loup" },
    { normal: "Banane", imposteur: "Pomme" },
    { normal: "Voiture", imposteur: "Camion" },
    { normal: "Stylo", imposteur: "Crayon" },
    { normal: "Thé", imposteur: "Café" },
    { normal: "Tennis", imposteur: "Ping-Pong" },
    { normal: "Soleil", imposteur: "Lune" },
    { normal: "Chaise", imposteur: "Tabouret" },
    { normal: "Chocolat", imposteur: "Vanille" },
    { normal: "Ski", imposteur: "Snowboard" }
];

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

function generateRoomId() {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 4; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function getAlivePlayers(game) {
    return game.players.filter(p => p.alive);
}

io.on('connection', (socket) => {
    
    // --- 1. CRÉATION ---
    socket.on('createGame', (data) => {
        const username = data.username;
        const avatar = data.avatar;
        const roomId = generateRoomId();
        
        games[roomId] = {
            id: roomId,
            players: [],
            currentTurn: 0,
            
            // Gestion des votes
            votingVotes: {},     // Pour éliminer qqn
            decisionVotes: {},   // Pour choisir Vote vs Cycle
            emergencyVotes: new Set(), // Pour forcer le vote (Set pour éviter doublons)
            
            impostorIds: [],
            whiteId: null,
            currentPair: {},
            timer: null,
            gameActive: false,
            roundCount: 0 // Pour savoir si on affiche le bouton urgence
        };

        joinRoom(socket, roomId, username, avatar, true);
    });

    // --- 2. REJOINDRE ---
    socket.on('joinGame', (data) => {
        const username = data.username;
        let roomId = data.roomId;
        const avatar = data.avatar;

        if (!roomId) return socket.emit('error', "Code de salle manquant !");
        roomId = roomId.toUpperCase(); 
        
        if (!games[roomId]) return socket.emit('error', "Cette salle n'existe pas !");
        if (games[roomId].gameActive) return socket.emit('error', "La partie est déjà en cours !");
        
        const nameExists = games[roomId].players.some(p => p.name.toLowerCase() === username.toLowerCase());
        if (nameExists) return socket.emit('error', "Ce pseudo est déjà pris dans cette salle !");

        joinRoom(socket, roomId, username, avatar, false);
    });

    function joinRoom(socket, roomId, username, avatar, isAdmin) {
        socket.join(roomId);
        socket.roomId = roomId; 
        socket.username = username;

        const game = games[roomId];
        game.players.push({ 
            id: socket.id, 
            name: username, 
            avatar: avatar, 
            alive: true, 
            isAdmin: isAdmin 
        });

        socket.emit('roomJoined', { roomId: roomId, isAdmin: isAdmin });
        io.to(roomId).emit('updatePlayerList', game.players);
    }

    // --- 3. DÉMARRAGE ---
    socket.on('startGame', () => {
        const game = games[socket.roomId];
        if (!game) return;

        const player = game.players.find(p => p.id === socket.id);
        if (!player || !player.isAdmin) return;
        
        if (game.players.length < 3) return socket.emit('error', "Il faut au moins 3 joueurs !");

        game.gameActive = true;
        game.players.forEach(p => p.alive = true);
        game.currentTurn = 0;
        
        // Reset des états
        game.votingVotes = {};
        game.decisionVotes = {};
        game.emergencyVotes = new Set();
        game.impostorIds = [];
        game.whiteId = null;
        game.roundCount = 0;

        game.currentPair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
        
        // Rôles
        let availablePlayers = [...game.players];
        const numberOfImpostors = game.players.length >= 6 ? 2 : 1;

        for (let i = 0; i < numberOfImpostors; i++) {
            const randomIndex = Math.floor(Math.random() * availablePlayers.length);
            game.impostorIds.push(availablePlayers[randomIndex].id);
            availablePlayers.splice(randomIndex, 1);
        }

        if (game.players.length >= 5 && availablePlayers.length > 0) {
            const whiteIndex = Math.floor(Math.random() * availablePlayers.length);
            game.whiteId = availablePlayers[whiteIndex].id;
        }

        game.players.forEach((p) => {
            let word = "";
            if (game.impostorIds.includes(p.id)) word = game.currentPair.imposteur;
            else if (p.id === game.whiteId) word = "???"; 
            else word = game.currentPair.normal;

            io.to(p.id).emit('gameStarted', { 
                word: word, 
                currentPlayer: game.players[game.currentTurn].name 
            });
        });
    });

    // --- 4. TOUR PAR TOUR ---
    socket.on('nextTurn', () => {
        const game = games[socket.roomId];
        if (!game) return;

        do {
            game.currentTurn++;
        } while (game.currentTurn < game.players.length && !game.players[game.currentTurn].alive);

        if (game.currentTurn >= game.players.length) {
            // FIN DU TOUR -> PHASE DE DÉCISION
            startDecisionPhase(game);
        } else {
            io.to(game.id).emit('updateTurn', game.players[game.currentTurn].name);
        }
    });

    // --- 5. NOUVELLE PHASE : DÉCISION (Vote vs Indices) ---
    function startDecisionPhase(game) {
        game.decisionVotes = {};
        game.roundCount++; // On a fini un tour complet
        
        let timeLeft = 30;
        io.to(game.id).emit('decisionPhaseStarted', { timer: timeLeft });

        if (game.timer) clearInterval(game.timer);
        game.timer = setInterval(() => {
            timeLeft--;
            io.to(game.id).emit('timerUpdate', timeLeft); // On réutilise l'event timer
            if (timeLeft <= 0) {
                resolveDecision(game);
            }
        }, 1000);
    }

    socket.on('submitDecision', (choice) => {
        // choice = 'vote' ou 'cycle'
        const game = games[socket.roomId];
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        game.decisionVotes[socket.id] = choice;

        // Si tout le monde a choisi, on résout tout de suite
        if (Object.keys(game.decisionVotes).length === getAlivePlayers(game).length) {
            resolveDecision(game);
        }
    });

    function resolveDecision(game) {
        clearInterval(game.timer);
        
        let votesForKick = 0;
        let votesForCycle = 0;

        Object.values(game.decisionVotes).forEach(v => {
            if (v === 'vote') votesForKick++;
            if (v === 'cycle') votesForCycle++;
        });

        // Logique : Il faut une majorité stricte pour le vote
        // Si égalité -> Cycle
        if (votesForKick > votesForCycle) {
            startVotingPhase(game);
        } else {
            startNewCycle(game, "La majorité veut refaire un tour d'indices !");
        }
    }

    // --- 6. GESTION BOUTON URGENCE ---
    socket.on('triggerEmergency', () => {
        const game = games[socket.roomId];
        if (!game) return;
        const player = game.players.find(p => p.id === socket.id);
        if (!player || !player.alive) return;

        // Ajouter le vote (Set gère l'unicité)
        game.emergencyVotes.add(socket.id);

        const aliveCount = getAlivePlayers(game).length;
        // Seuil : Strictement supérieur à la moitié
        // ex: 5 joueurs. 5/2 = 2.5. Il faut 3 votes.
        // ex: 4 joueurs. 4/2 = 2. Il faut 3 votes.
        const threshold = Math.floor(aliveCount / 2) + 1;

        io.to(game.id).emit('updateEmergencyState', { 
            count: game.emergencyVotes.size, 
            required: threshold 
        });

        if (game.emergencyVotes.size >= threshold) {
            startVotingPhase(game);
        }
    });

    // --- 7. LOGIQUE JEU (Cycle & Vote) ---

    function startNewCycle(game, message) {
        game.votingVotes = {};
        game.decisionVotes = {};
        game.emergencyVotes = new Set(); // Reset des votes d'urgence
        
        game.currentTurn = 0;
        while (game.currentTurn < game.players.length && !game.players[game.currentTurn].alive) {
            game.currentTurn++;
        }
        
        // Calcul du seuil pour l'affichage client
        const aliveCount = getAlivePlayers(game).length;
        const threshold = Math.floor(aliveCount / 2) + 1;

        io.to(game.id).emit('startNewCycle', { 
            nextPlayer: game.players[game.currentTurn].name,
            message: message,
            showEmergency: game.roundCount > 0, // Affiche le bouton seulement après le 1er tour
            emergencyThreshold: threshold
        });
    }

    function startVotingPhase(game) {
        game.votingVotes = {};
        let timeLeft = 30;
        const alivePlayers = getAlivePlayers(game);
        const voteData = alivePlayers.map(p => ({ id: p.id, name: p.name, avatar: p.avatar }));
        
        io.to(game.id).emit('votingStarted', { players: voteData, timer: timeLeft });

        if (game.timer) clearInterval(game.timer);
        game.timer = setInterval(() => {
            timeLeft--;
            io.to(game.id).emit('timerUpdate', timeLeft);
            if (timeLeft <= 0) {
                finishVote(game);
            }
        }, 1000);
    }

    socket.on('castVote', (targetName) => {
        const game = games[socket.roomId];
        if (!game) return;
        game.votingVotes[socket.id] = targetName;
        if (Object.keys(game.votingVotes).length === getAlivePlayers(game).length) {
            finishVote(game);
        }
    });

    function finishVote(game) {
        clearInterval(game.timer);
        let counts = {};
        Object.values(game.votingVotes).forEach(name => {
            counts[name] = (counts[name] || 0) + 1;
        });

        let eliminatedName = "";
        let maxVotes = 0;
        let equality = false;

        for (let name in counts) {
            if (counts[name] > maxVotes) {
                maxVotes = counts[name];
                eliminatedName = name;
                equality = false;
            } else if (counts[name] === maxVotes) {
                equality = true;
            }
        }

        if (equality || maxVotes === 0) {
            startNewCycle(game, "Égalité ou aucun vote ! Personne n'est éliminé.");
            return;
        }

        const eliminatedPlayer = game.players.find(p => p.name === eliminatedName);
        if (!eliminatedPlayer) return startNewCycle(game, "Erreur lors du vote.");

        eliminatedPlayer.alive = false; 
        io.to(eliminatedPlayer.id).emit('youAreDead');

        // --- CONDITIONS VICTOIRE ---
        const aliveImpostors = game.players.filter(p => p.alive && game.impostorIds.includes(p.id));
        const aliveOthers = game.players.filter(p => p.alive && !game.impostorIds.includes(p.id));
        
        const allImpostorNames = game.players
            .filter(p => game.impostorIds.includes(p.id))
            .map(p => p.name).join(' & ');

        if (aliveImpostors.length === 0) {
            game.gameActive = false;
            io.to(game.id).emit('gameResult', { 
                success: true, 
                message: "VICTOIRE DES CITOYENS ! Tous les imposteurs sont éliminés.",
                impostor: allImpostorNames,
                eliminated: eliminatedName
            });
            return;
        }

        if (aliveImpostors.length >= aliveOthers.length) {
            game.gameActive = false;
            io.to(game.id).emit('gameResult', { 
                success: false, 
                message: "LES IMPOSTEURS ONT GAGNÉ ! (Majorité numérique)",
                impostor: allImpostorNames,
                eliminated: eliminatedName
            });
            return;
        }

        if (game.impostorIds.includes(eliminatedPlayer.id)) {
            startNewCycle(game, `🔥 BRAVO ! ${eliminatedName} était un IMPOSTEUR ! Mais attention, il n'est pas seul...`);
            return;
        }

        if (eliminatedPlayer.id === game.whiteId) {
            startNewCycle(game, `⚠️ C'ÉTAIT M. BLANC ! (${eliminatedName} éliminé). Les imposteurs sont toujours là...`);
            return;
        }

        startNewCycle(game, `${eliminatedName} a été éliminé... C'était un simple Citoyen !`);
    }

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId || !games[roomId]) return;
        const game = games[roomId];
        
        const leavingPlayer = game.players.find(p => p.id === socket.id);
        game.players = game.players.filter(p => p.id !== socket.id);

        if (game.players.length === 0) {
            if (game.timer) clearInterval(game.timer);
            delete games[roomId];
            return;
        }

        if (leavingPlayer && leavingPlayer.isAdmin && game.players.length > 0) {
            game.players[0].isAdmin = true;
        }

        if (game.gameActive) {
            game.gameActive = false;
            if (game.timer) clearInterval(game.timer);
            io.to(game.id).emit('gameResult', { 
                success: true, 
                message: "PARTIE INTERROMPUE ! Un joueur clé a quitté.",
                impostor: "N/A",
                eliminated: "Abandon"
            });
        }
        io.to(game.id).emit('updatePlayerList', game.players);
    });
});

// On utilise process.env.PORT (donné par l'hébergeur) ou 3000 (sur ton PC)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});