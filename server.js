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
    // --- NOURRITURE & BOISSONS ---
    { normal: "Sable", imposteur: "Gravier" },
    { normal: "Pizza", imposteur: "Burger" },
    { normal: "Banane", imposteur: "Pomme" },
    { normal: "Thé", imposteur: "Café" },
    { normal: "Chocolat", imposteur: "Vanille" },
    { normal: "Crêpe", imposteur: "Gaufre" },
    { normal: "Ketchup", imposteur: "Mayonnaise" },
    { normal: "Pâtes", imposteur: "Riz" },
    { normal: "Pain", imposteur: "Brioche" },
    { normal: "Eau", imposteur: "Soda" },
    { normal: "Vin", imposteur: "Bière" },
    { normal: "Fraise", imposteur: "Framboise" },
    { normal: "Orange", imposteur: "Clémentine" },
    { normal: "Sel", imposteur: "Poivre" },
    { normal: "Sucre", imposteur: "Farine" },
    { normal: "Sushi", imposteur: "Maki" },
    { normal: "Salade", imposteur: "Épinard" },
    { normal: "Yaourt", imposteur: "Fromage blanc" },
    { normal: "Poulet", imposteur: "Dinde" },
    { normal: "Saumon", imposteur: "Thon" },
    { normal: "Chips", imposteur: "Pop-corn" },
    { normal: "Miel", imposteur: "Confiture" },
    { normal: "Lait", imposteur: "Crème" },
    { normal: "Oignon", imposteur: "Ail" },
    { normal: "Citron", imposteur: "Pamplemousse" },
    { normal: "Baguette", imposteur: "Croissant" },
    { normal: "Tacos", imposteur: "Kebab" },
    { normal: "Soupe", imposteur: "Bouillon" },
    { normal: "Cookie", imposteur: "Brownie" },
    { normal: "Melon", imposteur: "Pastèque" },
    { normal: "Champagne", imposteur: "Cidre" },
    { normal: "Oeuf", imposteur: "Omelette" },

    // --- ANIMAUX ---
    { normal: "Lion", imposteur: "Tigre" },
    { normal: "Chien", imposteur: "Loup" },
    { normal: "Chat", imposteur: "Renard" },
    { normal: "Cheval", imposteur: "Âne" },
    { normal: "Aigle", imposteur: "Faucon" },
    { normal: "Requin", imposteur: "Dauphin" },
    { normal: "Abeille", imposteur: "Guêpe" },
    { normal: "Mouche", imposteur: "Moustique" },
    { normal: "Grenouille", imposteur: "Crapaud" },
    { normal: "Poule", imposteur: "Canard" },
    { normal: "Vache", imposteur: "Taureau" },
    { normal: "Mouton", imposteur: "Chèvre" },
    { normal: "Souris", imposteur: "Rat" },
    { normal: "Lapin", imposteur: "Lièvre" },
    { normal: "Serpent", imposteur: "Lézard" },
    { normal: "Papillon", imposteur: "Libellule" },
    { normal: "Ours", imposteur: "Panda" },
    { normal: "Pingouin", imposteur: "Manchot" },
    { normal: "Gorille", imposteur: "Chimpanzé" },
    { normal: "Crocodile", imposteur: "Alligator" },
    { normal: "Chameau", imposteur: "Dromadaire" },
    { normal: "Fourmi", imposteur: "Araignée" },
    { normal: "Hibou", imposteur: "Chouette" },

    // --- OBJETS & MAISON ---
    { normal: "Stylo", imposteur: "Crayon" },
    { normal: "Chaise", imposteur: "Tabouret" },
    { normal: "Table", imposteur: "Bureau" },
    { normal: "Lit", imposteur: "Canapé" },
    { normal: "Fourchette", imposteur: "Cuillère" },
    { normal: "Assiette", imposteur: "Bol" },
    { normal: "Verre", imposteur: "Tasse" },
    { normal: "Lampe", imposteur: "Ampoule" },
    { normal: "Porte", imposteur: "Fenêtre" },
    { normal: "Clé", imposteur: "Serrure" },
    { normal: "Tapis", imposteur: "Moquette" },
    { normal: "Miroir", imposteur: "Vitre" },
    { normal: "Savon", imposteur: "Shampoing" },
    { normal: "Brosse à dents", imposteur: "Dentifrice" },
    { normal: "Serviette", imposteur: "Gant" },
    { normal: "Oreiller", imposteur: "Coussin" },
    { normal: "Couette", imposteur: "Couverture" },
    { normal: "Livre", imposteur: "Magazine" },
    { normal: "Cahier", imposteur: "Feuille" },
    { normal: "Ciseaux", imposteur: "Couteau" },
    { normal: "Marteau", imposteur: "Tournevis" },
    { normal: "Scie", imposteur: "Hache" },
    { normal: "Valise", imposteur: "Sac à dos" },
    { normal: "Parapluie", imposteur: "Imperméable" },
    { normal: "Montre", imposteur: "Horloge" },
    { normal: "Bague", imposteur: "Bracelet" },
    { normal: "Collier", imposteur: "Écharpe" },

    // --- VÊTEMENTS ---
    { normal: "Pantalon", imposteur: "Short" },
    { normal: "T-shirt", imposteur: "Chemise" },
    { normal: "Pull", imposteur: "Sweat" },
    { normal: "Manteau", imposteur: "Veste" },
    { normal: "Chaussette", imposteur: "Chaussure" },
    { normal: "Botte", imposteur: "Basket" },
    { normal: "Chapeau", imposteur: "Casquette" },
    { normal: "Gants", imposteur: "Moufles" },
    { normal: "Ceinture", imposteur: "Bretelles" },
    { normal: "Pyjama", imposteur: "Robe de chambre" },
    { normal: "Maillot de bain", imposteur: "Sous-vêtement" },
    { normal: "Lunettes", imposteur: "Lentilles" },

    // --- LIEUX & TRANSPORTS ---
    { normal: "Avion", imposteur: "Hélicoptère" },
    { normal: "Voiture", imposteur: "Camion" },
    { normal: "Océan", imposteur: "Lac" },
    { normal: "Train", imposteur: "Métro" },
    { normal: "Bus", imposteur: "Tramway" },
    { normal: "Vélo", imposteur: "Moto" },
    { normal: "Bateau", imposteur: "Paquebot" },
    { normal: "École", imposteur: "Collège" },
    { normal: "Lycée", imposteur: "Université" },
    { normal: "Cinéma", imposteur: "Théâtre" },
    { normal: "Piscine", imposteur: "Plage" },
    { normal: "Montagne", imposteur: "Colline" },
    { normal: "Forêt", imposteur: "Jungle" },
    { normal: "Rivière", imposteur: "Fleuve" },
    { normal: "Ville", imposteur: "Village" },
    { normal: "Maison", imposteur: "Appartement" },
    { normal: "Chambre", imposteur: "Salon" },
    { normal: "Cuisine", imposteur: "Salle de bain" },
    { normal: "Pharmacie", imposteur: "Hôpital" },
    { normal: "Boulangerie", imposteur: "Pâtisserie" },
    { normal: "Restaurant", imposteur: "Cantine" },
    { normal: "Parc", imposteur: "Jardin" },
    { normal: "Pont", imposteur: "Tunnel" },
    { normal: "Ascenseur", imposteur: "Escalier" },

    // --- LOISIRS & SPORTS ---
    { normal: "Piano", imposteur: "Guitare" },
    { normal: "Tennis", imposteur: "Ping-Pong" },
    { normal: "Ski", imposteur: "Snowboard" },
    { normal: "Football", imposteur: "Rugby" },
    { normal: "Basket", imposteur: "Handball" },
    { normal: "Natation", imposteur: "Plongée" },
    { normal: "Danse", imposteur: "Gymnastique" },
    { normal: "Peinture", imposteur: "Dessin" },
    { normal: "Cinéma", imposteur: "Netflix" },
    { normal: "Jeux vidéo", imposteur: "Jeux de société" },
    { normal: "Violon", imposteur: "Violoncelle" },
    { normal: "Batterie", imposteur: "Tambour" },
    { normal: "Flûte", imposteur: "Trompette" },
    { normal: "Judo", imposteur: "Karaté" },
    { normal: "Boxe", imposteur: "Lutte" },
    { normal: "Surf", imposteur: "Skate" },
    { normal: "Échecs", imposteur: "Dames" },
    { normal: "Carte", imposteur: "Dé" },

    // --- TECHNOLOGIE ---
    { normal: "Téléphone", imposteur: "Tablette" },
    { normal: "Ordinateur", imposteur: "Télévision" },
    { normal: "Clavier", imposteur: "Souris" },
    { normal: "Facebook", imposteur: "Instagram" },
    { normal: "Twitter", imposteur: "TikTok" },
    { normal: "Email", imposteur: "SMS" },
    { normal: "Wifi", imposteur: "4G" },
    { normal: "Chargeur", imposteur: "Batterie" },
    { normal: "Photo", imposteur: "Vidéo" },
    { normal: "Casque", imposteur: "Écouteurs" },
    { normal: "Google", imposteur: "Wikipedia" },
    { normal: "Apple", imposteur: "Samsung" },
    { normal: "PlayStation", imposteur: "Xbox" },

    // --- NATURE & MÉTÉO ---
    { normal: "Soleil", imposteur: "Lune" },
    { normal: "Pluie", imposteur: "Neige" },
    { normal: "Nuage", imposteur: "Brouillard" },
    { normal: "Vent", imposteur: "Tempête" },
    { normal: "Feu", imposteur: "Fumée" },
    { normal: "Glace", imposteur: "Eau" },
    { normal: "Terre", imposteur: "Sable" },
    { normal: "Pierre", imposteur: "Caillou" },
    { normal: "Arbre", imposteur: "Buisson" },
    { normal: "Fleur", imposteur: "Rose" },
    { normal: "Herbe", imposteur: "Feuille" },
    { normal: "Étoile", imposteur: "Planète" },
    { normal: "Jour", imposteur: "Nuit" },
    { normal: "Été", imposteur: "Hiver" },
    { normal: "Printemps", imposteur: "Automne" },

    // --- CORPS HUMAIN ---
    { normal: "Main", imposteur: "Pied" },
    { normal: "Doigt", imposteur: "Orteil" },
    { normal: "Oeil", imposteur: "Oreille" },
    { normal: "Nez", imposteur: "Bouche" },
    { normal: "Dent", imposteur: "Langue" },
    { normal: "Cheveux", imposteur: "Barbe" },
    { normal: "Bras", imposteur: "Jambe" },
    { normal: "Coude", imposteur: "Genou" },
    { normal: "Coeur", imposteur: "Poumon" },
    { normal: "Sang", imposteur: "Veine" },

    // --- MÉTIERS ---
    { normal: "Docteur", imposteur: "Infirmier" },
    { normal: "Policier", imposteur: "Pompier" },
    { normal: "Professeur", imposteur: "Élève" },
    { normal: "Boulanger", imposteur: "Cuisinier" },
    { normal: "Chanteur", imposteur: "Acteur" },
    { normal: "Juge", imposteur: "Avocat" },
    { normal: "Soldat", imposteur: "Général" },
    { normal: "Pilote", imposteur: "Chauffeur" },

    // --- CONCEPTS ABSTRAITS ---
    { normal: "Amour", imposteur: "Amitié" },
    { normal: "Joie", imposteur: "Bonheur" },
    { normal: "Peur", imposteur: "Surprise" },
    { normal: "Colère", imposteur: "Haine" },
    { normal: "Rêve", imposteur: "Cauchemar" },
    { normal: "Mensonge", imposteur: "Vérité" },
    { normal: "Question", imposteur: "Réponse" },
    { normal: "Début", imposteur: "Fin" },
    { normal: "Guerre", imposteur: "Paix" },
    { normal: "Travail", imposteur: "Vacances" },
    { normal: "Mariage", imposteur: "Divorce" },
    { normal: "Naître", imposteur: "Mourir" },
    { normal: "Gagner", imposteur: "Perdre" },
    { normal: "Donner", imposteur: "Recevoir" },
    { normal: "Acheter", imposteur: "Vendre" },
    { normal: "Parler", imposteur: "Crier" },
    { normal: "Marcher", imposteur: "Courir" }
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
            votes: {},
            voteToContinue: 0,
            impostorIds: [],
            whiteId: null,
            currentPair: {},
            timer: null,
            gameActive: false
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
        game.voteToContinue = 0;
        game.votes = {};
        game.impostorIds = [];
        game.whiteId = null;

        // Choix du mot aléatoire
        game.currentPair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
        
        // DISTRIBUTION DES RÔLES
        let availablePlayers = [...game.players];

        // 1. Nombre d'imposteurs (2 si >= 6 joueurs)
        const numberOfImpostors = game.players.length >= 6 ? 2 : 1;

        // 2. Assigner Imposteurs
        for (let i = 0; i < numberOfImpostors; i++) {
            const randomIndex = Math.floor(Math.random() * availablePlayers.length);
            game.impostorIds.push(availablePlayers[randomIndex].id);
            availablePlayers.splice(randomIndex, 1);
        }

        // 3. Assigner M. Blanc (si >= 5 joueurs)
        if (game.players.length >= 5 && availablePlayers.length > 0) {
            const whiteIndex = Math.floor(Math.random() * availablePlayers.length);
            game.whiteId = availablePlayers[whiteIndex].id;
        }

        // ENVOI
        game.players.forEach((p) => {
            let word = "";
            
            if (game.impostorIds.includes(p.id)) {
                word = game.currentPair.imposteur;
            } else if (p.id === game.whiteId) {
                word = "???"; 
            } else {
                word = game.currentPair.normal;
            }

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
            game.voteToContinue = 0;
            io.to(game.id).emit('roundFinished', { total: getAlivePlayers(game).length });
        } else {
            io.to(game.id).emit('updateTurn', game.players[game.currentTurn].name);
        }
    });

    // --- 5. LOGIQUE JEU ---
    socket.on('requestMoreIndices', () => {
        const game = games[socket.roomId];
        if (!game) return;
        game.voteToContinue++;
        const aliveTotal = getAlivePlayers(game).length;
        io.to(game.id).emit('updateDecisionCount', { count: game.voteToContinue, total: aliveTotal });

        if (game.voteToContinue >= aliveTotal) {
            startNewCycle(game, "Tout le monde veut refaire un tour !");
        }
    });

    function startNewCycle(game, message) {
        game.voteToContinue = 0;
        game.votes = {};
        game.currentTurn = 0;
        while (game.currentTurn < game.players.length && !game.players[game.currentTurn].alive) {
            game.currentTurn++;
        }
        io.to(game.id).emit('startNewCycle', { 
            nextPlayer: game.players[game.currentTurn].name,
            message: message 
        });
    }

    socket.on('requestVotePhase', () => {
        const game = games[socket.roomId];
        if (!game) return;
        startVotingPhase(game);
    });

    function startVotingPhase(game) {
        game.votes = {};
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
        game.votes[socket.id] = targetName;
        if (Object.keys(game.votes).length === getAlivePlayers(game).length) {
            finishVote(game);
        }
    });

    function finishVote(game) {
        clearInterval(game.timer);
        let counts = {};
        Object.values(game.votes).forEach(name => {
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

        // 1. Plus d'imposteurs -> Victoire Citoyens
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

        // 2. Imposteurs en surnombre -> Victoire Imposteurs
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

        // 3. Partie continue
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