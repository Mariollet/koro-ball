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
  rougit, s'amincit, puis rompt — la balle tombe. Quelques secondes plus tard, une nouvelle
  balle redescend du haut et se re-suspend. La corde cicatrise si tu la laisses tranquille.
- **Repos total** : sans mouvement de souris, la balle reste parfaitement immobile
  (mise en sommeil ; elle se réveille au coup de patte ou quand on l'attrape).
- **Personnalisable** : fenêtre de réglages (couleur/taille de la balle, longueur/raideur/
  couleur de la corde, sensibilité de la casse, écran cible, position du crochet…).
- **Démarrage automatique** avec Windows (optionnel).
- **Click-through intelligent** : l'overlay laisse passer tes clics partout, sauf sur le jouet.
- **Ne vole jamais le focus** : tu continues de taper dans VSCode / ailleurs sans interruption.

## Prérequis

- [Node.js](https://nodejs.org/) (testé avec v22)

## Installation

```bash
git clone https://github.com/Mariollet/desktop-cat-toy.git
cd desktop-cat-toy
npm install          # installe Electron + electron-builder
npm run geticon      # génère les icônes (assets/tray.png + build/icon.png)
```

## Lancer (dev)

```bash
npm start
```

Un jouet apparaît suspendu en haut de l'écran, et une icône « Cat Toy » dans la zone de
notification de Windows.

## Réglages

Clic droit (ou double-clic) sur l'icône de la zone de notification → **Paramètres…**.
Les changements s'appliquent **en direct**. Réglages disponibles :

- **Balle** : couleur, taille.
- **Corde** : couleur, longueur, raideur.
- **Casse & réapparition** : activer/désactiver, fragilité, délai de retour de la balle.
- **Placement** : écran cible (multi-moniteur), position du crochet le long du haut.
- **Système** : démarrage automatique avec Windows.

Les réglages sont persistés dans `settings.json` (dossier `userData` de l'app).

## Contrôles

| Action | Comment |
| --- | --- |
| Attraper / lancer | Clic gauche sur la boule, glisse, relâche |
| Coup de patte | Passe la souris rapidement près de la boule |
| Paramètres | Icône zone de notification → « Paramètres… » (ou double-clic) |
| Pause / reprise | `Ctrl+Alt+P` ou menu de l'icône |
| Recentrer | Menu de l'icône → « Recentrer le jouet » |
| Quitter | `Ctrl+Alt+Q` ou menu de l'icône → « Quitter » |

## Construire l'exécutable Windows

```bash
npm run dist
```

Produit dans `dist/` :

- `Cat Toy Setup <version>.exe` — **installeur** (NSIS, raccourci bureau + menu Démarrer).
- `Cat Toy <version>.exe` — **portable** (double-clic, sans installation).

> ℹ️ L'exécutable n'est **pas signé** : au premier lancement, Windows SmartScreen affiche
> « Éditeur inconnu » → *Informations complémentaires* → *Exécuter quand même*. Un certificat
> de signature de code lèverait cet avertissement.

## Structure

```
desktop-cat-toy/
├── main.js            # process principal : overlay, click-through, tray, raccourcis, réglages
├── preload.js         # pont sécurisé renderer <-> main (IPC)
├── renderer/          # l'overlay transparent
│   ├── index.html
│   ├── style.css
│   └── toy.js         # physique de corde + rendu canvas + interactions
├── settings/          # la fenêtre de réglages
│   ├── index.html
│   ├── settings.css
│   └── settings.js
├── scripts/
│   └── gen-icon.js    # génère les icônes (PNG, sans dépendance)
├── assets/tray.png    # icône du tray (générée)
└── build/icon.png     # icône de l'app pour le packaging (générée)
```

## Idées d'évolution

- Image / PNG custom pour le jouet (au lieu du grelot dessiné).
- Plusieurs jouets à la fois.
- Thèmes prédéfinis (souris, plume, araignée d'Halloween…).
- Signature de code pour supprimer l'avertissement SmartScreen.

## Licence

MIT — voir [LICENSE](LICENSE).
