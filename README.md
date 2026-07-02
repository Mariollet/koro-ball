# Koro-ball 🐙

[![CI](https://github.com/Mariollet/koro-ball/actions/workflows/ci.yml/badge.svg)](https://github.com/Mariollet/koro-ball/actions/workflows/ci.yml)

Une petite tête de Koro-sensei pendue à une corde, en haut de ton écran.
Il sourit. Il te regarde. Il esquive à Mach 20. *Nurufufufu~*

Et surtout : **il ne gêne jamais ton travail** — tes clics passent à travers lui,
sauf quand tu décides de l'attraper.

## Lancer

Va sur [**Releases**](https://github.com/Mariollet/koro-ball/releases/latest) et télécharge :

- `Koro-ball-Setup-X.Y.Z.exe` — installeur (recommandé, raccourcis + désinstallation propre)
- `Koro-ball-X.Y.Z.exe` — portable (aucune installation, se lance directement)

> Windows SmartScreen au premier lancement (exe non signé) :
> *Informations complémentaires* → *Exécuter quand même*.

### Depuis les sources (développement)

```bash
git clone https://github.com/Mariollet/koro-ball.git
cd koro-ball
npm install
npm start
```

## Le manuel de l'assassin

| Toi | Lui |
| --- | --- |
| Tu approches la souris | Ses yeux te suivent 👀 |
| Tu cliques et tu tires | Attrapé ! (relâche pour le lancer) |
| Tu fonces dessus | Coup de patte... ou **esquive Mach 20** et il te nargue 😏 |
| Tu t'acharnes | La corde rougit, s'amincit... et **casse** 💥 |
| Tu attends 3 secondes | Il redescend du plafond, l'air de rien ⭕ |
| Tu le laisses tranquille | Il s'endort. Et ne bouge plus **du tout** 💤 |

## Ses humeurs

Comme le vrai, sa tête change de couleur selon son état :

| Tête | Ça veut dire |
| --- | --- |
| 🟡 Jaune, grand sourire | Tout va bien |
| 🟢 Rayures vertes | Il vient d'esquiver ton coup (et il est fier) |
| 🔵 Bleu + sueur | Tu l'as attrapé / lancé trop fort |
| 🩵 Bleu clair + larmes | Tu l'as écrasé contre un bord, bravo |
| 🔴 Rouge + veine | Il commence à s'énerver (la corde fatigue) |
| ⚫ Noir + aura | DANGER. La corde va lâcher |
| 🟣 Violet + X rouge | Raté... il tombe |
| 🟠 Orange + cercle | « Tout juste ! » — il est de retour |
| 🩷 Rose + zzz | Il dort (c'est le seul moment où il est vulnérable) |

Astuce : plus il est énervé, plus il esquive. Comme le vrai.

## Raccourcis

- **Pause / reprise** : `Ctrl+Alt+P`
- **Quitter** : `Ctrl+Alt+Q`
- **Tout le reste** : clic droit sur l'icône 🐙 dans la zone de notification
  (Paramètres, recentrer, démarrage avec Windows...)

## Le personnaliser

Icône de la zone de notification → **Paramètres…**
Couleur, taille, longueur de corde, fragilité, position du crochet —
tout s'applique en direct, sur tous les écrans à la fois.

## Fabriquer le .exe

```bash
npm run dist
```

→ `dist/Koro-ball-Setup-X.Y.Z.exe` (installeur) et `dist/Koro-ball-X.Y.Z.exe` (portable).

### Release automatique

Pousser un tag `v*` (ex. `git tag v1.1.0 && git push --tags`) déclenche une build
sur GitHub Actions qui publie l'installeur et le portable sur une Release GitHub.
Déclenchable aussi à la main depuis l'onglet **Actions** (`workflow_dispatch`).

## Sous le capot

Electron, un canvas, une corde en intégration de Verlet, zéro dépendance native,
zéro écoute clavier. Le process main gère l'overlay transparent click-through,
le renderer fait la physique et les humeurs. C'est tout.

## Licence

MIT — cible autorisée pour tous les élèves. 🎓
