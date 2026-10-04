# 🎙️ Dictaphone DeepSeek FR

Dictée vocale **française, locale et gratuite** pour **DeepSeek**, **DeepSeek Harness** et leurs applications PWA.
Tu parles → le texte s'écrit tout seul dans le champ de saisie. Rien ne part sur Internet : la reconnaissance tourne sur ta **RTX 4050**.

```
   micro  ──►  extension Chrome  ──►  serveur local (Whisper GPU)  ──►  texte dans le composer
                    (capture)              (transcription)                 (DeepSeek / Harness)
```

---

## 0. Déjà vérifié sur ta machine

Tout a été testé de bout en bout sur ta configuration, pas seulement écrit :

| Vérification | Résultat mesuré |
|---|---|
| GPU utilisé | `cuda` / `float16` — RTX 4050 Laptop, 6 141 Mo |
| Vitesse | **9,5 s d'audio transcrites en 243 ms → ×39 le temps réel** |
| Chargement du modèle | 26 s la 1ʳᵉ fois (téléchargement), **1,8 s** ensuite |
| Découpage aux pauses | partiels en direct puis `FINAL` ~0,9 s après la pause |
| Phrase française test | *« Bonjour, ceci est un test de dicte vocale en français. Je dicte maintenant dans DeepSeek sans toucher au clavier. »* |
| Injection dans le composer Harness | ✅ état interne de l'éditeur **Lexical** vérifié |
| Chaîne complète extension → serveur → composer | ✅ **OK** |
| Commandes vocales (« Valider », « Stop ») | ✅ testées de bout en bout (envoi réel, arrêt sans envoi) |
| Correction ajoutée à chaud | ✅ appliquée sans redémarrer le serveur |
| Popup de l'extension | ✅ rendu, corrections, vocabulaire — aucune erreur JS |
| Arrêt de la dictée | ✅ 15/15 — Échap, clic, bascule, et **aucun micro fantôme** après une erreur |
| Démarrage automatique silencieux | ✅ serveur en ligne en 1,6 s, sans doublon |

Le seul écart restant est le mot « dictée » écrit « dicte » (accent), typique du modèle `small`.
Voir § 4 pour passer à `medium` si tu veux corriger ça.

---

## 1. Prérequis

| Élément | État |
|---|---|
| Windows + Chrome | ✅ |
| NVIDIA RTX 4050 (6 Go) + pilote récent | ✅ détecté |
| Python 3.10+ | ✅ détecté |
| ~1,8 Go d'espace disque libre | pour CUDA + le modèle Whisper |

---

## 2. Installation (une seule fois, ~5 min)

1. Double-clique sur **`install.bat`**.
   Il crée un environnement Python isolé (`.venv`), installe `faster-whisper` + les bibliothèques CUDA, puis télécharge le modèle `small` (~480 Mo).

2. Installe l'extension dans Chrome :
   - ouvre `chrome://extensions`
   - active **Mode développeur** (interrupteur en haut à droite)
   - clique **Charger l'extension non empaquetée**
   - choisis le dossier **`dictaphone\extension`**

3. C'est fini. Passe à l'utilisation.

---

## 3. Utilisation

1. Double-clique sur **`start.bat`** → une fenêtre noire s'ouvre et affiche `Pret.`
   *(laisse-la ouverte ; ferme-la pour arrêter le serveur)*

2. Ouvre DeepSeek ou DeepSeek Harness.

3. Place le curseur dans le champ de saisie, puis **`Ctrl + Shift + Espace`**.

4. **Parle normalement.** Le texte s'écrit phrase par phrase, à chaque pause.
   Un aperçu gris s'affiche en direct pendant que tu parles.

5. **`Ctrl + Shift + Espace`** à nouveau pour arrêter — ou n'importe quand, **`Échap`** annule.

> 💡 Tu peux aussi cliquer sur le **bouton micro flottant** en bas à droite, ou sur l'icône de l'extension dans la barre d'outils.
> Le bouton est **déplaçable** à la souris.

### Arrêter la dictée

Quatre moyens, tous équivalents :

| Moyen | Quand |
|---|---|
| **`Échap`** | Le plus rapide, la page doit avoir le focus |
| **Clic sur le bouton flottant** | Pendant l'écoute, le micro devient un **carré rouge d'arrêt** |
| **`Ctrl + Shift + Espace`** | Bascule marche/arrêt |
| **`Alt + Shift + D`** | Raccourci global de l'extension (`chrome://extensions/shortcuts` pour le changer) |

Pendant l'enregistrement, trois repères te disent que ça tourne : le bouton devient un carré rouge, le libellé affiche **REC — Échap pour arrêter**, et une pastille **REC** apparaît sur l'icône de l'extension.

Deux garde-fous automatiques, réglables dans **Options → Arrêt et sécurité** :

- **Arrêt si tu changes d'onglet** ou minimises la fenêtre (actif par défaut).
- **Durée maximale** d'une dictée, 5 minutes par défaut — le micro ne peut donc jamais rester ouvert indéfiniment.

### Commandes vocales

Dis le mot **seul**, après une pause, sans rien d'autre dans la phrase :

| Tu dis | Résultat |
|---|---|
| « Valider », « Envoyer », « C'est bon », « Vas-y » | **Envoie le message** (touche Entrée) et arrête la dictée |
| « Stop », « Arrête la dictée », « Termine » | Arrête la dictée **sans** envoyer |
| « À la ligne », « Nouveau paragraphe » | Insère un retour à la ligne |
| « Annuler », « Efface », « Oublie » | Annule ce qui vient d'être dicté |
| « Efface le dernier mot » | Annule le dernier morceau inséré |

La règle du **morceau entier** est ce qui évite les faux positifs : dire « je vais valider le formulaire » n'envoie rien, parce que la commande n'occupe pas tout le morceau (les morceaux sont les segments découpés par tes pauses). Tu peux assouplir cette règle dans les réglages, et changer les mots.

### Où ça marche

| Application | Statut |
|---|---|
| DeepSeek Harness — PWA (`DeepSeek Harness.lnk`) | ✅ |
| DeepSeek — PWA (`DeepSeek.lnk`) | ✅ |
| chat.deepseek.com dans Chrome | ✅ |
| http://127.0.0.1:3080 dans Chrome | ✅ |

Le raccourci **`Alt + Shift + D`** (défini dans `chrome://extensions/shortcuts`) fonctionne aussi, y compris au niveau du navigateur.

---

## 3 bis. Démarrage automatique (recommandé)

Pour ne plus jamais avoir à penser à `start.bat` : double-clique sur **`demarrage-auto.bat`** et choisis **`1`**.

Le serveur se lancera alors **tout seul, sans aucune fenêtre**, à chaque ouverture de session Windows — donc il sera déjà prêt quand tu ouvriras DeepSeek ou DeepSeek Harness.

| | |
|---|---|
| Coût quand tu ne dictes pas | ~60 Mo de RAM, **0 Mo de VRAM** |
| Première dictée après le démarrage | ~2 s de chargement du modèle, une seule fois |
| Journal | `logs\serveur.log` |
| Pour désactiver | relance `demarrage-auto.bat` → `2` |
| Pour voir l'état | relance `demarrage-auto.bat` → `3` |

Le modèle n'est **pas** préchargé au démarrage : c'est volontaire, pour ne pas immobiliser 0,8 Go de VRAM en permanence sur ta carte 6 Go. Si tu préfères qu'il soit chaud dès le début (au prix de la VRAM réservée), passe `"preload": true` dans `config.json`.

`start.bat` reste utile pour voir les messages en direct, changer de modèle en ligne de commande, ou dicter sans attendre le prochain démarrage de session.

---

## 4. Réglages

Clic droit sur l'icône de l'extension → **Options**, ou `chrome://extensions` → *Détails* → *Options de l'extension*.

- **Langue** — français par défaut. Force `fr` pour de meilleurs résultats (ne laisse pas « détection auto » si tu dictes surtout en français).
- **Modèle Whisper** — voir le tableau ci-dessous.
- **Raccourci clavier** — n'importe quelle combinaison, ex. `Ctrl+Shift+Space`, `Alt+D`, `F9`.
- **Écrire directement dans le champ de saisie** — décoche pour copier dans le presse-papier à la place.
- **Aperçu en direct** — la bulle grise pendant que tu parles.
- **Position** — ou fais simplement glisser le bouton micro.

### Quel modèle choisir ?

| Modèle | Taille | VRAM | Français | Vitesse (4050) |
|---|---|---|---|---|
| `tiny` | 75 Mo | ~0,3 Go | ⭐ | instantané |
| `base` | 145 Mo | ~0,4 Go | ⭐⭐ | instantané |
| **`small`** *(défaut)* | 480 Mo | ~0,8 Go | ⭐⭐⭐ | ~15× le temps réel |
| `medium` | 1,5 Go | ~1,8 Go | ⭐⭐⭐⭐ | ~6× le temps réel |
| `large-v3-turbo` | 1,6 Go | ~2,0 Go | ⭐⭐⭐⭐⭐ | ~8× le temps réel |

Avec 6 Go de VRAM, **`medium`** passe sans problème et est nettement meilleur en français.
Pour changer : Options → Modèle → *Enregistrer* (le serveur le charge à chaud).

En ligne de commande :

```bat
start.bat --model medium
start.bat --model large-v3-turbo
start.bat --cpu                  REM sans GPU (beaucoup plus lent)
```

---

## 4 bis. Améliorer la reconnaissance de tes mots

Tout se règle dans `config.json`, puis relance `start.bat`.

### 1. Le vocabulaire (le plus efficace)

Whisper est **fortement influencé** par ce texte : les mots que tu y mets sont reconnus
en priorité. C'est ce qui fait qu'il écrit « DeepSeek » et non « Dipsy et que ».

```json
"vocabulary": "DeepSeek, DeepSeek Harness, Claude Code, ChatGPT, WebSocket, FastAPI, Python, Whisper, Chrome, Windows, API, extension."
```

Ajoute-y tes noms de projets, de clients, tes termes métier… sans jamais dépasser ~40 mots
(au-delà, l'effet se dilue). Évite les mots courants isolés et les étiquettes du genre
« Vocabulaire : » : Whisper peut les recracher dans un passage silencieux.

### 2. Les remplacements (le filet de sécurité)

Pour corriger des formes que le modèle produit quand même :

```json
"cleanup": {
  "replacements": {
    "deep sea": "DeepSeek",
    "fast api": "FastAPI"
  }
}
```

### 4. Directement depuis le bouton de l'extension

Le clic sur l'icône ouvre un **popup** : état du serveur, bouton *Dicter dans cet onglet*, ajout de correction en deux champs, et ton vocabulaire.

Tout ce que tu y saisis (comme dans la page de réglages) prend effet **à la dictée suivante, sans redémarrer le serveur**.

Dans la page, un **bouton engrenage** est placé juste à gauche du micro : il ouvre directement les réglages. C'est le chemin le plus court quand tu es en train de dicter.

### 5. Depuis le bureau

Deux raccourcis sont posés sur ton bureau :

| Raccourci | Effet |
|---|---|
| **Dictaphone FR** | Ouvre le dossier du projet |
| **Dictaphone FR — réglages** | Démarre le serveur si besoin, puis ouvre les réglages de l'extension |

Une précision utile : **Chrome interdit d'ouvrir une URL `chrome://` ou `chrome-extension://` depuis un raccourci Windows** — elle est remplacée par un nouvel onglet. Le raccourci « réglages » passe donc par une page locale (`http://127.0.0.1:8765/reglages`) qui demande à l'extension de s'ouvrir elle-même. C'est le seul chemin qui fonctionne.

### 6. Les pauses

```json
"silence_ms": 700,
```
Durée de silence qui déclenche l'écriture du morceau. Baisse à `450` pour un rythme plus
nerveux, monte à `1000` si tu fais de longues pauses au milieu de tes phrases.

---

## 5. Dépannage

| Symptôme | Solution |
|---|---|
| **« Impossible de joindre le serveur de dictée »** | `start.bat` n'est pas lancé. Double-clique dessus et attends `Pret.` |
| **Le micro ne s'active pas** | Clique sur l'icône 🔒 / micro dans la barre d'adresse et autorise le microphone pour le site. |
| **Rien ne s'écrit** | Vérifie que le curseur est bien dans le champ de saisie. Sinon le texte est copié dans le presse-papier (Ctrl+V). |
| **C'est lent / ça rame** | Vérifie le GPU : ouvre <http://127.0.0.1:8765/health> → `"device": "cuda"`. Si c'est `cpu`, réinstalle avec `install.bat`. |
| **Erreurs d'accents / de mots** | Normal avec le modèle `small`. Passe à `medium` ou `large-v3-turbo` dans les options. |
| **Un mot technique est mal reconnu** | Voir § 4 bis ci-dessous. |
| **« Le moteur n'a pas pu être chargé »** | Relance `install.bat`. Vérifie que le pilote NVIDIA est à jour. |
| **Le micro reste bloqué** | `Échap`, puis clic sur le bouton flottant. Vérifie `document.getElementById("dsd-dictaphone-host").dataset.dsdMic` dans la console (F12) : il doit valoir `0` au repos. Sinon recharge la page (`F5`) — et signale-le. |
| **La dictée ne s'arrête pas quand je change d'onglet** | Options → Arrêt et sécurité → active « Arrêter si je change d'onglet ». |
| **L'arrêt par `Échap` ne marche pas** | La page doit avoir le focus. Sinon utilise `Alt + Shift + D`, qui fonctionne tant que la fenêtre Chrome est active. |

Vérifie l'état du moteur à tout moment : <http://127.0.0.1:8765/health>

---

## 6. Page de test

Sans extension, ouvre <http://127.0.0.1:8765> : une page permet de tester le micro et la transcription directement dans le navigateur. Pratique pour isoler un problème (micro vs extension vs serveur).

Et <http://127.0.0.1:8765/extension-test> simule le champ de saisie de DeepSeek : le texte dicté y arrive, mais **rien n'est envoyé à DeepSeek**. La page compte les envois, les annulations et les morceaux insérés — idéal pour vérifier les commandes vocales sans rien déclencher de réel.

### Scripts de diagnostic

```bat
REM Verifie le GPU, le VAD et transcrit tests\test-fr.wav
.venv\Scripts\python.exe tests\selftest.py small tests\test-fr.wav

REM Rejoue un WAV a travers le WebSocket, comme le fait le microphone
.venv\Scripts\python.exe tests\streamtest.py tests\test-fr.wav

REM Verifie les commandes vocales et le nettoyage (sans micro)
.venv\Scripts\python.exe outils\test-commandes.py

REM Verifie que le serveur repond
tests\tester.bat
```

Les fichiers de test (`test-fr.wav`, `test-commande-envoi.wav`, `test-commande-stop.wav`) vivent
dans **`tests\`**. `test-fr.wav` est un échantillon en français fourni avec le projet (voix de synthèse Windows).
`test-commande-envoi.wav` et `test-commande-stop.wav` contiennent une phrase puis un mot de commande, avec la pause necessaire.

Le dossier **`dev/`** contient les scripts qui ont servi à valider l'extension sans clic manuel
(Chrome isolé piloté via le protocole DevTools, avec un WAV branché en faux microphone) :

```bash
node dev/cdp-test.mjs            # injection dans le composer Lexical du Harness
node dev/ext-test.mjs extension  # chaine complete, de bout en bout
node dev/popup-test.mjs          # popup : rendu, corrections, vocabulaire
node dev/arret-test.mjs          # demarrage / arret / micro fantome (15 verifications)
node dev/verif-raccourci.mjs     # ouverture des reglages depuis le raccourci

# variantes (voir le haut de ext-test.mjs)
$env:TARGET="http://127.0.0.1:8765/extension-test"
$env:EXPECT="submit"             # text | submit | stop
$env:PRESET='{"replacements":{"bonjour":"SALUT"}}'
```

### Vérifier que le micro est bien relâché

L'extension publie son état interne sur son élément hôte, ce qui permet de diagnostiquer
sans outil particulier. Dans la console du navigateur (F12) sur une page DeepSeek :

```js
const h = document.getElementById("dsd-dictaphone-host");
h.dataset.dsdState   // "idle" | "starting" | "listening" | "stopping"
h.dataset.dsdMic     // nombre de captures micro actuellement retenues — doit valoir 0 au repos
h.dataset.dsdOpened  // total de captures ouvertes depuis le chargement de la page
```

Si `dsdMic` ne revient pas à `0` après un arrêt, c'est un bug : signale-le.

---

## 7. Fichiers

dictaphone/
├── README.md                            Ce fichier
├── install.bat                          Installation (une fois)
├── demarrage-auto.bat                   Activer le démarrage à l'ouverture de session
├── demarrer-serveur-silencieux.vbs      Lancement sans fenêtre (appelé au démarrage)
├── start.bat                            Démarre le serveur avec sa console
├── config.json                          Réglages, vocabulaire, commandes, remplacements
├── requirements.txt
├── logs/
│   └── serveur.log                      Journal du serveur silencieux
├── tests/
│   ├── tester.bat                       Vérifie que le serveur répond
│   ├── selftest.py                      Test GPU / VAD / transcription
│   ├── streamtest.py                    Test du flux temps réel (WebSocket)
│   ├── test-fr.wav                      Échantillon audio français pour les tests
│   ├── test-commande-envoi.wav          Phrase + « Valider » (test des commandes)
│   └── test-commande-stop.wav           Phrase + « Arrête la dictée »
├── outils/
│   ├── demarrage-auto.ps1               Active / désactive le démarrage auto
│   ├── ouvrir-reglages.vbs              Raccourci bureau → réglages de l'extension
│   ├── dictaphone.ico                   Icône des raccourcis
│   ├── test-commandes.py                Test des commandes vocales, sans micro
│   └── assembler-wav.py                 Fabrique les WAV de test (phrase + pause)
├── server/
│   ├── app.py                           Serveur HTTP + WebSocket
│   ├── stt.py                           Chargement Whisper / CUDA / VAD
│   ├── commands.py                      Commandes vocales (normalisation, détection)
│   ├── cleanup.py                       Ponctuation, majuscules, remplacements, typo FR
│   ├── webui.html                       Page de test micro
│   ├── testpage.html                    Page de diagnostic de l'extension
│   ├── reglages.html                    Point d'entrée des réglages depuis le bureau
│   └── worklet.js
├── extension/                           ← à charger dans chrome://extensions
│   ├── manifest.json
│   ├── background.js                    Connexion WebSocket + ouverture des réglages
│   ├── content.js                       Bouton micro, engrenage, écriture, commandes
│   ├── popup.html/.js                   Options rapides (icône de la barre d'outils)
│   ├── options.html/.js                 Réglages complets
│   ├── pcm-worklet.js                   Capture audio 16 kHz par blocs de 128 ms
│   └── icons/
└── dev/                                 Outils de validation automatisée
    ├── arret-test.mjs                   Démarrage / arrêt / micro fantôme
    ├── cdp-test.mjs
    ├── ext-test.mjs
    ├── popup-test.mjs
    └── verif-raccourci.mjs
```

---

## 8. Confidentialité & performances

- **Aucune donnée ne sort de ton PC.** Le serveur écoute uniquement sur `127.0.0.1` et le modèle tourne en local.
- L'audio est envoyé en PCM brut 16 kHz au serveur local via WebSocket (~256 kbit/s), jamais à un service tiers.
- Le texte est découpé **automatiquement aux pauses** (~0,7 s de silence) : tu vois les phrases apparaître au fur et à mesure, et la latence perçue reste sous la seconde.
- Le modèle reste chargé en VRAM entre deux dictées, donc aucune attente au deuxième usage.

---

## 9. Sous le capot

- **`faster-whisper`** (CTranslate2) — même qualité que Whisper d'OpenAI, 4 à 8× plus rapide, `float16` sur CUDA.
- **VAD Silero** (embarqué) — détecte la parole et les silences pour découper sans couper les mots.
- **`initial_prompt` glissant** — le texte déjà écrit est donné au modèle comme contexte, ce qui garde la ponctuation et le vocabulaire cohérents d'une phrase à l'autre.
- **Post-traitement local** (`cleanup.py`) — supprime les « euh », remet les majuscules, corrige les espaces avant ponctuation, applique ton dictionnaire maison. Aucun appel réseau.
- **Insertion navigateur** — le composer de DeepSeek Harness est un éditeur **Lexical** (`contenteditable`) ; le texte est inséré via `execCommand('insertText')`, que Lexical écoute nativement, avec repli sur `textarea`/`input` classiques.

---

## 10. API du serveur

Utile si tu veux brancher autre chose dessus.

| Route | Description |
|---|---|
| `GET /health` | état du moteur (modèle, device, VRAM, latence) |
| `GET /config` | configuration courante |
| `POST /model?name=medium` | change de modèle à chaud |
| `POST /transcribe` | corps = PCM16 LE mono 16 kHz → `{"text": "..."}` |
| `WS /ws` | binaire = PCM, texte = JSON (`start`, `stop`, `reset`) |

Exemple :

```bash
curl -X POST --data-binary @phrase.pcm "http://127.0.0.1:8765/transcribe?language=fr"
```


---

## Annexe — Mettre le projet sur une autre machine

Ces fichiers sont volontairement **absents du dépôt** (ils sont propres à chaque machine) :

| Fichier | Pourquoi | Que faire |
|---|---|---|
| `.venv/` | environnement Python (2 Go) | lancer `install.bat` |
| `native/key.pem` | clé privée de signature de l'extension (**secret**) | n'en as besoin que pour empaqueter un `.crx` ; Chrome peut aussi charger l'extension « non empaquetée » |
| `native/com.dictaphone.launcher.json` | contient un chemin absolu | copier `native/com.dictaphone.launcher.example.json`, y mettre le vrai chemin de `host.bat` et l'identifiant de l'extension affiché sur `chrome://extensions` |
| `tests/*.wav` | enregistrements de test de la voix de l'auteur | enregistrer ses propres fichiers (voir `outils/assembler-wav.py`) |
