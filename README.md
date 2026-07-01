# Cat Toy 🐾

Un jouet à chat interactif (boule à grelot au bout d'une corde) suspendu en haut de ton écran.
Overlay **Electron transparent, always-on-top**, qui ne gêne pas ton travail : les clics
traversent vers les applis en dessous, sauf quand tu attrapes le jouet.

## Fonctionnalités

- **Physique de corde** réaliste (intégration de Verlet) : oscillation, inertie, rebond.
- **Attraper / lancer** : clique sur la boule, déplace-la, relâche pour la lancer.
- **Réaction souris** : un mouvement rapide près de la boule lui donne un coup de patte
  et la fait tinter — aucun module natif, aucune écoute clavier.
- **La corde s'use et casse** : si tu joues trop (tirage fort, coups répétés), la corde
  rougit, s'amincit, puis rompt — la balle tombe. ~2,6 s plus tard, une nouvelle balle
  redescend du haut et se re-suspend. La corde cicatrise si tu la laisses tranquille.
- **Repos total** : sans mouvement de souris, la balle reste parfaitement immobile
  (mise en sommeil ; elle se réveille au coup de patte ou quand on l'attrape).
- **Click-through intelligent** : l'overlay laisse passer tes clics partout, sauf sur le jouet.
- **Ne vole jamais le focus** : tu continues de taper dans VSCode / ailleurs sans interruption.

## Prérequis

- [Node.js](https://nodejs.org/) (testé avec v22)

## Installation

```bash
cd C:\laragon\www\cat-toy
npm install          # installe Electron
npm run geticon      # génère l'icône du tray (assets/tray.png)
```

## Lancer

```bash
npm start
```

Un jouet apparaît suspendu en haut de l'écran.

## Contrôles

| Action | Comment |
| --- | --- |
| Attraper / lancer | Clic gauche sur la boule, glisse, relâche |
| Coup de patte | Passe la souris rapidement près de la boule |
| Pause / reprise | `Ctrl+Alt+P` ou menu de l'icône (barre des tâches, zone de notification) |
| Recentrer | Menu de l'icône → « Recentrer le jouet » |
| Quitter | `Ctrl+Alt+Q` ou menu de l'icône → « Quitter » |

## Structure

```
cat-toy/
├── main.js            # process principal : fenêtre overlay, click-through, tray, raccourcis
├── preload.js         # pont sécurisé renderer <-> main
├── renderer/
│   ├── index.html
│   ├── style.css
│   └── toy.js         # physique de corde + rendu canvas + interactions
├── scripts/
│   └── gen-icon.js    # génère l'icône du tray (PNG, sans dépendance)
└── assets/
    └── tray.png       # généré par npm run geticon
```

## Idées d'évolution

- Choix du jouet (plume, souris, image custom) via le menu tray.
- Plusieurs jouets à la fois.
- Réglage de la position d'accroche (glisser le crochet le long du haut de l'écran).
- Lancement automatique au démarrage de Windows.
- Support multi-écrans.
