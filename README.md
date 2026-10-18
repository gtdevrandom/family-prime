# Family Prime

Family Prime est une application web mobile pour gérer une liste de courses familiale. Elle permet d’organiser les magasins et leurs rayons, de trier la liste avec Gemini et de consulter des cartes de fidélité. L’application est installable comme PWA et utilise Firebase Authentication et Cloud Firestore.

> **Hébergement :** GitHub Pages héberge l’interface statique ; Vercel exécute les API serveur (`/api`) qui protègent Firebase Admin et la clé Gemini. GitHub Pages seul ne peut pas exécuter ces API. La configuration Firebase est fournie par l’API Vercel et aucun secret serveur n’est publié avec le site.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Fonctionnement](#fonctionnement)
- [Architecture](#architecture)
- [Données et sécurité](#données-et-sécurité)
- [Installation et développement local](#installation-et-développement-local)
- [Publier sur GitHub Pages et Vercel](#publier-sur-github-pages-et-vercel)
- [Créer le projet Firebase](#créer-le-projet-firebase)
- [Initialiser le premier administrateur](#initialiser-le-premier-administrateur)
- [Migrer les données de l’ancien projet](#migrer-les-données-de-lancien-projet)
- [Secrets Vercel et GitHub](#secrets-vercel-et-github)
- [Mode hors ligne](#mode-hors-ligne)
- [Tests](#tests)
- [Limites et évolutions](#limites-et-évolutions)

## Fonctionnalités

- Ajouter/supprimer des articles, les marquer achetés ou non trouvés, et vider la liste en conservant les articles non trouvés.
- Définir des magasins, leurs rayons et leur ordre d’affichage.
- Répartir les articles par rayon avec Gemini ou corriger le classement manuellement.
- Ajouter des cartes de fidélité avec photo et les afficher en plein écran.
- Créer des comptes individuels depuis le menu administrateur ; chaque compte reçoit un mot de passe provisoire à remplacer lors de sa première connexion.
- Désactiver ou réactiver les comptes membres.
- Afficher le nom de la personne ayant ajouté chaque article.
- Installer l’application comme PWA sur les navigateurs compatibles.

## Fonctionnement

1. Au chargement, le navigateur appelle `GET /api/config`. Cette route ne retourne que la configuration publique du SDK Firebase, jamais la clé Gemini ni la clé de service Firebase Admin.
2. Le membre se connecte avec son adresse e-mail et son mot de passe via Firebase Authentication.
3. L’application lit `users/{uid}`. Seuls les comptes actifs associés à `family-prime` accèdent à l’espace ; les comptes provisoires doivent changer leur mot de passe avant le chargement des données.
4. Un administrateur gère les comptes par `/api/admin/users`. La fonction vérifie le jeton Firebase ID et le rôle dans Firestore avec le SDK Admin.
5. Firestore diffuse le document de courses `lists/shopping` en temps réel. Le navigateur conserve également un cache local.
6. Les changements des champs autres que `items` sont écrits dans Firestore par le SDK client et contrôlés par les règles. Les mises à jour des articles passent par `/api/shopping/items` : le serveur vérifie le membre, valide les articles, attribue l’auteur des nouveaux éléments et préserve l’auteur historique des éléments modifiés.
7. Le tri IA envoie les noms d’articles et les rayons à `/api/chat`. La fonction authentifie le membre, limite la taille du prompt et espace les appels, puis appelle Gemini avec `GOOGLE_API_KEY`, conservée côté serveur.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `index.html`, `styles.css` | Interface, formulaires, modales et présentation mobile. |
| `app.js` | Connexion Firebase, état et interactions de l’application. |
| `firestore-offline.js` | Initialisation Firestore, cache IndexedDB et écouteurs temps réel. |
| `api/config.js` | Renvoie uniquement les paramètres publics Firebase au navigateur. |
| `lib/cors.js` | Autorise les requêtes navigateur uniquement depuis les origines configurées. |
| `api/admin/users.js` | Création et activation/désactivation des comptes par un administrateur. |
| `api/auth/change-password.js` | Remplacement serveur du mot de passe provisoire. |
| `api/shopping/items.js` | Validation et sauvegarde des articles avec attribution d’auteur. |
| `api/chat.js` | Relais Gemini authentifié avec limite de fréquence et de taille. |
| `lib/firebaseAdmin.js` | Initialisation Admin, vérification des jetons et rôles. |
| `lib/shoppingItems.js` | Validation des articles et attribution d’auteur, couverte par les tests unitaires. |
| `firestore.rules` | Règles d’accès Firestore ; seules les API serveur peuvent changer les articles. |
| `firebase.json` | Chemin des règles et configuration facultative des émulateurs. |
| `scripts/bootstrap-admin.js` | Amorçage unique du premier compte administrateur. |
| `scripts/migrate-firestore.js` | Export et import contrôlés du document de courses entre projets. |
| `service-worker.js`, `manifest.json` | Cache statique et métadonnées PWA. |
| `deployment-config.js` | URL publique de l’API ; GitHub Actions la génère pour Pages à partir de la variable `API_BASE_URL`. |
| `.github/workflows/deploy-pages.yml` | Publie les seuls fichiers du frontend sur GitHub Pages à chaque push sur `main`. |
| `vercel.json` | Routage de l’application et des fonctions `/api`. |
| `.env.example` | Noms et exemples des variables de configuration. |

Le frontend est servi comme fichiers statiques et utilise les modules Firebase hébergés sur `gstatic.com`. Les routes `api/` sont des fonctions serveur Vercel et utilisent les dépendances Node du projet.

## Données et sécurité

Le modèle initial conserve les données partagées dans le document Firestore `lists/shopping` :

| Champ | Contenu |
| --- | --- |
| `items` | Articles avec identifiant, nom, état, rayon et `addedByUid`/`addedByName`. |
| `stores` | Magasins, rayons et ordre. |
| `currentStore` | Magasin sélectionné. |
| `promptHistory` | Exemples de correction utilisés pour les tris, limités à 50 entrées côté application. |
| `loyaltyCards` | Cartes et images encodées en Data URL. |

Les profils sont enregistrés sous `users/{uid}` avec `email`, `displayName`, `role`, `active`, `mustChangePassword` et `familyId`. La famille actuelle a l’identifiant fixe `family-prime`. Lorsqu’un compte provisoire est créé, seul son condensat SHA-256 à forte entropie est conservé temporairement dans `accountSecrets/{uid}` ; ce document est inaccessible directement aux navigateurs et supprimé après le changement de mot de passe. Les limites de fréquence IA sont dans `aiRateLimits/{uid}`.

Les règles dans `firestore.rules` autorisent la lecture du document partagé aux membres actifs et interdisent la modification directe de `items` et des profils. L’API serveur utilise Firebase Admin pour les opérations réservées. La configuration Firebase web (API key, projet, app ID) est visible dans le navigateur par conception : elle identifie le projet, mais ne confère pas à elle seule les droits d’accès. Ce sont les règles Firestore qui protègent les données.

La clé Gemini et le compte de service Admin sont des secrets serveur. Ne les placez jamais dans `app.js`, dans le dépôt, ni dans une variable client `VITE_*`. Un mot de passe provisoire est généré aléatoirement, masqué par défaut et révélable avec le bouton **Afficher** après la création du compte. Il est effacé à la fermeture de la fenêtre et ne peut pas être récupéré ensuite ; transmettez-le au membre par un canal sûr.

## Installation et développement local

### Prérequis

- Node.js 18 ou supérieur.
- Un projet Firebase configuré selon [Créer le projet Firebase](#créer-le-projet-firebase).
- Une clé API Google Gemini pour activer le tri IA.
- Le CLI Vercel pour exécuter localement les fonctions serveur.

### Démarrer l’application

1. Installer les dépendances :

   ```powershell
   npm.cmd install
   ```

2. Créer `.env.local` depuis `.env.example`, puis renseigner au minimum :

   ```dotenv
   GOOGLE_API_KEY=votre_cle_gemini
   FIREBASE_API_KEY=cle_web_firebase
   FIREBASE_AUTH_DOMAIN=votre-projet.firebaseapp.com
   FIREBASE_PROJECT_ID=votre-projet
   FIREBASE_STORAGE_BUCKET=votre-projet.firebasestorage.app
   FIREBASE_MESSAGING_SENDER_ID=votre_sender_id
   FIREBASE_APP_ID=votre_app_id
   FAMILY_PRIME_ALLOWED_ORIGINS=http://localhost:3000
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account", "...":"..."}
   ```

   La clé de service Admin est un JSON privé, à conserver uniquement dans les variables d’environnement locales ignorées par Git et dans les secrets d’exécution Vercel.

3. Démarrer Vercel en local :

   ```powershell
   npx vercel dev
   ```

4. Ouvrir l’URL locale affichée. Il faut servir l’application en HTTP(S), et non ouvrir `index.html` directement.

La route IA nécessite une connexion et un profil membre valide. L’interface d’administration des comptes reste inaccessible tant qu’un administrateur n’a pas été amorcé.

## Publier sur GitHub Pages et Vercel

Le dépôt GitHub contient le code source, mais le déploiement est partagé entre deux services : **GitHub Pages sert le frontend** et **Vercel héberge le backend**. Les fonctions Firebase Admin et Gemini ne peuvent pas être hébergées sur GitHub Pages.

### 1. Déployer l’API sur Vercel

1. Créer/configurer le projet Firebase selon [Créer le projet Firebase](#créer-le-projet-firebase).
2. Sur Vercel, importer ce dépôt GitHub comme un nouveau projet. Conserver la configuration Vercel du dépôt (`vercel.json`) ; les fonctions sous `api/` seront déployées comme API serverless.
3. Dans **Project Settings → Environment Variables**, ajouter les paramètres Firebase web et les secrets serveur listés à la section [Secrets Vercel](#secrets-vercel-et-github).
4. Ajouter `FAMILY_PRIME_ALLOWED_ORIGINS` avec l’origine GitHub Pages, par exemple `https://MON-UTILISATEUR.github.io`. Pour plusieurs origines, les séparer par des virgules. Ajouter aussi l’origine locale utilisée pour les tests, si nécessaire. Utiliser uniquement des origines exactes, sans chemin ni barre oblique finale (en production, utiliser HTTPS).
5. Déployer sur Vercel et noter l’origine de l’API, par exemple `https://family-prime-api.vercel.app` (sans chemin ni barre oblique finale). Les API refusent les requêtes navigateur dont l’origine n’est pas dans `FAMILY_PRIME_ALLOWED_ORIGINS`.

### 2. Activer GitHub Pages

1. Pousser le dépôt sur GitHub, en conservant le workflow `.github/workflows/deploy-pages.yml` et la branche `main`.
2. Dans **Settings → Pages → Build and deployment**, choisir **GitHub Actions** comme source.
3. Dans **Settings → Secrets and variables → Actions → Variables**, créer la variable de dépôt `API_BASE_URL` et lui attribuer l’origine Vercel notée ci-dessus, par exemple `https://family-prime-api.vercel.app`. C’est une URL publique, pas un secret.
4. Dans **Settings → Actions → General**, autoriser le workflow à obtenir l’accès de déploiement Pages si GitHub le demande.
5. Pousser un changement sur `main` ou lancer **Actions → Deploy GitHub Pages → Run workflow**. Le workflow valide l’URL, génère le fichier de configuration client, puis ne publie que les ressources du frontend.
6. Attendre le succès du workflow et ouvrir l’adresse GitHub Pages affichée dans l’environnement `github-pages`.

À chaque push sur `main`, Vercel met à jour les fonctions et le workflow GitHub met à jour l’interface. Si l’URL Vercel change, modifier la variable `API_BASE_URL` dans GitHub et redéployer Pages ; mettre également à jour `FAMILY_PRIME_ALLOWED_ORIGINS` dans Vercel si le domaine de l’interface change.

Pour un dépôt nommé `MON-UTILISATEUR.github.io`, l’adresse Pages est généralement `https://MON-UTILISATEUR.github.io/`. Pour les autres dépôts, elle inclut le nom du dépôt, par exemple `https://MON-UTILISATEUR.github.io/mon-depot/`. Dans les deux cas, l’origine à autoriser est uniquement `https://MON-UTILISATEUR.github.io` (sans le chemin du dépôt). Si un domaine personnalisé est utilisé, ajouter son origine à Firebase Authentication et à `FAMILY_PRIME_ALLOWED_ORIGINS`.

Ne pas ajouter les clés Firebase Admin ou Gemini dans les variables GitHub, dans `deployment-config.js`, dans le workflow ou dans des fichiers du dépôt. Seule l’URL publique Vercel est envoyée au navigateur.

## Créer le projet Firebase

1. Créer un **nouveau projet Firebase** et une application Web. Garder l’ancien projet actif jusqu’à la fin de la vérification et de la migration.
2. Dans **Authentication → Sign-in method**, activer **E-mail/Mot de passe**. Ne pas activer l’inscription publique ni la connexion anonyme pour ce flux.
3. Dans **Authentication → Settings → Authorized domains**, ajouter le domaine GitHub Pages (`MON-UTILISATEUR.github.io`), le domaine personnalisé éventuel, et le domaine local utilisé pour le développement. L’URL Vercel sert les API ; l’authentification Firebase est initiée depuis le domaine GitHub Pages.
4. Créer la base Cloud Firestore.
5. Déployer les règles de ce dépôt avec Firebase CLI, une fois connecté à Firebase :

   ```powershell
   npx firebase-tools deploy --only firestore:rules --project votre-project-id
   ```

6. Créer un compte de service avec uniquement les autorisations nécessaires pour vérifier les comptes, créer/modifier des utilisateurs Firebase Auth et accéder à Firestore. Ne pas utiliser un compte de service personnel.
7. Ajouter les variables publiques client `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID` et `FIREBASE_APP_ID` à l’environnement local/Vercel. `FIREBASE_PROJECT_ID` doit correspondre au `project_id` du compte de service.
8. Ajouter côté serveur `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON privé) et `GOOGLE_API_KEY`. `FIREBASE_MEASUREMENT_ID` est facultatif.
9. Amorcer le premier administrateur, puis ouvrir l’application et créer les comptes membres depuis le menu ⚙️.

Les fonctions serveur n’accordent pas de droits à un utilisateur anonyme. Les règles Firestore refusent par défaut toute collection non explicitement autorisée.

## Initialiser le premier administrateur

Le premier compte est créé manuellement afin qu’il n’existe aucune route publique permettant de se promouvoir administrateur.

1. Dans Firebase Console, créer un utilisateur dans **Authentication → Users** avec e-mail/mot de passe. Copier son UID ; le mot de passe choisi ici est le vrai mot de passe de l’administrateur, pas un mot de passe provisoire.
2. Télécharger la clé JSON d’un compte de service du **nouveau projet** et la conserver hors du dépôt. Vérifier que le fichier est ignoré par Git (les noms contenant `service-account` le sont par `.gitignore`).
3. Dans PowerShell, exécuter le script une seule fois en fournissant le chemin du compte de service et l’UID :

   ```powershell
   $env:FIREBASE_SERVICE_ACCOUNT_PATH = (Resolve-Path ".\firebase-admin-service-account.json").Path
   $env:BOOTSTRAP_ADMIN_UID = "UID_COPIE_DE_FIREBASE_AUTH"
   npm.cmd run firebase:bootstrap -- --confirm-bootstrap
   Remove-Item Env:FIREBASE_SERVICE_ACCOUNT_PATH
   Remove-Item Env:BOOTSTRAP_ADMIN_UID
   ```

   Le script crée le profil admin avec rôle `admin`, rattache le compte à `family-prime`, et crée une liste vide si elle n’existe pas. Il refuse de s’exécuter dès qu’un profil admin existe.
4. Ajouter les secrets d’exécution Vercel et déployer. Seul ce compte admin peut alors créer ou désactiver les comptes membres.

## Migrer les données de l’ancien projet

La migration reprend le document `lists/shopping`, ajoute des identifiants aux anciens articles et les marque « Import ancien projet » (leur auteur individuel n’est pas récupérable). Elle n’importe pas les anciens comptes ni l’ancien mécanisme de mot de passe. L’export est un fichier privé local ; les comptes de service source et cible ne sont jamais intégrés au code.

1. Créer deux comptes de service ou clés à privilèges limités : un avec lecture de l’ancien document et un avec écriture dans le nouveau projet. Télécharger les fichiers hors du dépôt, par exemple `source-service-account.json` et `target-service-account.json`.
2. Définir les chemins et exporter l’ancien document :

   ```powershell
   $env:SOURCE_FIREBASE_SERVICE_ACCOUNT_PATH = (Resolve-Path ".\source-service-account.json").Path
   $env:TARGET_FIREBASE_SERVICE_ACCOUNT_PATH = (Resolve-Path ".\target-service-account.json").Path
   npm.cmd run firebase:migrate -- export .\migration-backup.json
   ```

3. Vérifier que l’export contient les magasins, rayons, cartes et articles attendus. Le fichier `migration-backup.json` est ignoré par Git ; le conserver de manière sécurisée et supprimer la copie locale lorsque la migration est validée.
4. Importer d’abord dans le **nouveau projet**. Le script refuse d’écraser un document cible existant :

   ```powershell
   npm.cmd run firebase:migrate -- import .\migration-backup.json
   ```

5. Amorcer l’administrateur du nouveau projet, déployer ses règles et tester les données avant de basculer le domaine.
6. N’utiliser `--replace` que si le document cible peut être écrasé volontairement :

   ```powershell
   npm.cmd run firebase:migrate -- import .\migration-backup.json --replace
   ```

Si l’ancien projet n’est plus accessible ou si ses données ne doivent pas être reprises, ignorez l’export/import : l’amorçage de l’administrateur crée une liste de courses vide dans le nouveau projet.

Si le document dépasse environ 900 Ko ou contient plus de 500 articles, l’import est arrêté avant la limite Firestore ou la limite applicative. Les photos de cartes devront alors être déplacées vers Firebase Storage avant la migration. Les variables de chemin peuvent être supprimées de la session PowerShell après l’opération :

```powershell
Remove-Item Env:SOURCE_FIREBASE_SERVICE_ACCOUNT_PATH
Remove-Item Env:TARGET_FIREBASE_SERVICE_ACCOUNT_PATH
```

## Secrets Vercel et GitHub

Dans **Vercel → Project Settings → Environment Variables**, configurer pour les environnements nécessaires (Production et, si souhaité, Preview/Development) :

- `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID` et `FIREBASE_APP_ID` : paramètres du SDK Firebase Web ; ils sont publics par nature, mais doivent correspondre au projet Firebase utilisé.
- `FIREBASE_SERVICE_ACCOUNT_JSON` : JSON privé du compte de service Firebase Admin.
- `GOOGLE_API_KEY` : clé serveur Google Gemini.
- `FAMILY_PRIME_ALLOWED_ORIGINS` : origine(s) exacte(s) du frontend autorisé, par exemple `https://MON-UTILISATEUR.github.io`. Séparer les origines par des virgules sans ajouter de chemin.
- `FIREBASE_MEASUREMENT_ID` : facultatif.

Après avoir ajouté ou modifié une variable Vercel, redéployer le projet pour que les fonctions serveur la reçoivent.

Dans **GitHub → Settings → Secrets and variables → Actions → Variables**, `API_BASE_URL` contient uniquement l’origine publique Vercel utilisée par le frontend. Il ne s’agit pas d’un secret. Les secrets Firebase Admin et Gemini restent exclusivement dans Vercel : une variable GitHub ou un GitHub Secret n’est pas automatiquement transmis à l’exécution des fonctions Vercel.

Le frontend est statique et ne nécessite pas de compilation. `vercel.json` route `/api/*` vers les fonctions serveur et le reste vers `index.html`.

## Mode hors ligne

- Le service worker met en cache les ressources statiques et utilise une stratégie réseau puis cache pour les requêtes GET prises en charge.
- Firestore active la persistance IndexedDB lorsque le navigateur le permet.
- L’application garde une copie locale de l’état et affiche l’état du réseau.
- **Les écritures des articles nécessitent actuellement l’accès au serveur `/api/shopping/items`.** Hors ligne, l’état local peut rester visible, mais les modifications ne sont pas synchronisées de façon fiable au retour du réseau ; ne considérez pas ces changements comme sauvegardés.
- Le tri Gemini nécessite une connexion et les routes Vercel disponibles.

## Tests

Exécuter les tests unitaires disponibles :

```powershell
npm.cmd test
```

Ils valident la forme des articles et démontrent que l’API attribue le créateur depuis l’identité vérifiée du serveur, ignore les auteurs fournis par le navigateur et préserve l’auteur lors d’une modification.

Ces tests unitaires ne lancent pas encore Firebase Emulator Suite : les règles Firestore doivent être vérifiées dans l’émulateur ou un projet de préproduction avant le déploiement.

## Limites et évolutions

- L’instance est actuellement destinée à une seule famille (`family-prime`), avec une liste partagée unique.
- Les articles restent regroupés dans un document Firestore partagé. Une croissance de la liste ou des images peut atteindre la limite de taille d’un document ; l’API bloque les écritures d’articles au-delà d’environ 900 Ko.
- L’API limite la liste à 500 articles par document.
- Les images de fidélité sont encore des Data URL dans Firestore ; Firebase Storage est recommandé pour éviter la limite de document.
- Les modifications hors ligne ne sont pas mises en file d’attente de façon persistante.
- Le tri IA utilise une réponse texte libre interprétée par le client. Une réponse structurée et validée avant application serait plus robuste.
- La fonction de récupération de mot de passe et l’envoi automatisé d’invitations e-mail ne sont pas implémentés. Le mot de passe provisoire est communiqué manuellement par l’administrateur.
- Le premier compte admin est une opération manuelle/unique documentée ; ne pas exposer un endpoint de bootstrap en production.
- L’API Gemini applique une limite de fréquence par compte dans Firestore, mais une politique de budget/quota doit aussi être configurée dans Google Cloud.
- `npm audit --omit=dev` signale encore des avis modérés dans la dépendance transitive `uuid` de Firebase Admin. La mise à niveau automatique proposée exigerait Firebase Admin 14, qui demande Node.js 22, alors que ce projet conserve Node.js 18+.

## Technologies

- HTML, CSS et JavaScript natif (modules ES).
- Firebase Authentication, Cloud Firestore et Firebase Admin SDK.
- Google Gemini via `@google/generative-ai`.
- API Node serverless sur Vercel, service worker et PWA.
