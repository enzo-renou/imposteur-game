# 🕵️ L'Imposteur — version 3

## Lancer

```bash
npm install
npm start          # http://localhost:3000
```

Sur un hébergeur (Render, Railway…), la commande de démarrage reste `node server.js` ; le port est lu dans `PORT`.

## Structure

```
server.js          serveur (Express + Socket.IO), toute la logique de jeu
words.js           paires de mots classées par catégorie (à compléter librement)
public/            tout ce que le navigateur télécharge (le code serveur n'est plus exposé)
  index.html
  script.js        interface
  avatars.js       avatars générés localement
  sw.js, manifest.webmanifest, icon-*.png   PWA (installable sur l'écran d'accueil)
```

## Ajouter des mots

Dans `words.js`, ajoute une ligne `["Mot citoyens", "Mot imposteur"]` dans une catégorie, ou crée une nouvelle catégorie
(`emoji`, `label`, `pairs`). Elle apparaît toute seule dans les réglages du lobby.

## Réglages utiles (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | port d'écoute |
| `RATE_MAX` | 40 | événements max par joueur toutes les 5 s (anti-spam) |

## Détails de fonctionnement

- **Reconnexion** : l'identité d'un joueur est un identifiant stocké dans son navigateur. Recharger la page ou perdre le réseau
  ne l'éjecte plus : il retrouve son rôle, son mot et l'historique. Délai de grâce : 30 s au lobby, 2 min en partie.
  Un joueur absent n'a que 15 s pour son tour d'indice.
- **Hôte** : s'il est absent plus de 10 s ou quitte, le rôle passe automatiquement à un autre joueur.
- **Scores** (cumulés tant que la salle existe) : citoyens gagnants +2, imposteurs gagnants +3, M. White qui trouve le mot +4.
- **Nettoyage** : une salle vide depuis 10 min, ou sans aucune activité depuis 2 h, est supprimée.
- **PWA** : l'installation sur l'écran d'accueil demande du HTTPS (ou `localhost`).
