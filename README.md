# Family Prime

Family Prime est une application web familiale, adaptée au mobile, pour gérer une liste de courses partagée, les événements familiaux et le contenu du congélateur. Elle permet de classer les articles par magasin et par rayon, d’utiliser Gemini pour aider au tri, et de conserver les cartes de fidélité des magasins.

Le site est une application statique publiée sur GitHub Pages. Les fonctions serveur sont hébergées sur Vercel et utilisent Firebase Authentication, Cloud Firestore et Firebase Admin. Les clés privées restent côté serveur.

> **Périmètre actuel :** les fonctionnalités utilisables sont la liste de courses, la gestion des magasins, les cartes de fidélité, les comptes membres, le calendrier familial et la liste partagée Icebox.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Parcours utilisateur](#parcours-utilisateur)
- [Architecture et fichiers](#architecture-et-fichiers)
- [Données et sécurité](#données-et-sécurité)
- [Développement local](#développement-local)
- [Déploiement GitHub Pages et Vercel](#déploiement-github-pages-et-vercel)
- [Configurer Firebase](#configurer-firebase)
- [Créer le premier administrateur](#créer-le-premier-administrateur)
- [Migration facultative](#migration-facultative)
- [Variables d’environnement](#variables-denvironnement)
- [Fonctionnement hors ligne](#fonctionnement-hors-ligne)
- [Tests](#tests)
- [Limites et améliorations possibles](#limites-et-améliorations-possibles)

## Fonctionnalités

### Liste de courses

- Ajouter des articles, jusqu’à 500 éléments et 100 caractères par nom.
- Empêcher l’ajout d’un doublon non acheté.
- Choisir un magasin et afficher les articles associés à leurs rayons.
- Marquer un article comme acheté ou non trouvé, le supprimer individuellement, ou vider la liste en conservant les articles non trouvés.
- Réorganiser manuellement les articles et les déplacer entre les rayons par glisser-déposer.
- Télécharger la liste restante sous forme de fichier texte, l’imprimer ou la partager avec les fonctions natives du navigateur quand elles sont disponibles.
- Importer un fichier texte, avec un article par ligne. Le format `[Rayon] Nom de l’article` permet également de préciser le rayon.
- Afficher sous chaque article le pseudo du membre qui l’a ajouté.

### Magasins et cartes de fidélité

- Créer, modifier et supprimer des magasins.
- Définir la liste et l’ordre des rayons de chaque magasin, puis réordonner les magasins.
- Ajouter une image de carte de fidélité, l’afficher en grand écran et la supprimer.
- Ouvrir la carte correspondant au magasin sélectionné depuis la liste de courses.

### Calendrier familial et Icebox

- Créer, modifier et supprimer ses événements, choisir une date et une heure, sélectionner les membres concernés et définir une répétition quotidienne, hebdomadaire, mensuelle ou annuelle, avec une date de fin facultative.
- Parcourir le calendrier mensuel et afficher les événements d’une journée. Seul le membre qui a créé un événement peut le modifier ou le supprimer.
- Gérer la liste partagée des glaces du congélateur, leur saveur et leur quantité. Tous les membres actifs peuvent ajuster les quantités et supprimer des entrées.
- Enregistrer les événements et les glaces dans le document partagé `lists/shopping`, avec la liste de courses. L’API importe automatiquement les données déjà présentes dans les anciennes collections `familyEvents` et `iceboxItems`; ces collections restent conservées comme archive.

### Aide au tri par IA

- Demander à Gemini de classer les articles dans l’ordre des rayons du magasin sélectionné.
- Apprendre les corrections faites avec **Éditer**, puis les réappliquer automatiquement au prochain tri dans le même magasin.
- Enregistrer séparément, par magasin et par nom d’article normalisé, le rayon choisi et la position par rapport à un article voisin (ou en fin de rayon).
- Conserver les corrections non synchronisées sur l’appareil hors ligne, les envoyer au retour de la connexion et empêcher la déconnexion tant qu’elles ne sont pas synchronisées.
- Continuer à trier même si un article mémorisé ou son rayon n’existe plus : la préférence invalide est ignorée.
- L’API impose une limite de taille de requête et un délai minimal de 30 secondes entre les demandes d’un même compte.

### Comptes et pseudos

- Connexion avec une adresse e-mail et un mot de passe gérés par Firebase Authentication.
- Comptes membres créés par un administrateur ; aucune inscription publique n’est proposée.
- Mot de passe provisoire généré à la création, affiché masqué avec une action **Afficher**, puis effacé quand la fenêtre d’administration est fermée.
- Au premier accès, choix obligatoire d’un nouveau mot de passe (12 caractères minimum) et d’un pseudo.
- Modification du pseudo à tout moment dans **⚙️ → Mon pseudo**. Le changement met également à jour le nom affiché sur les articles déjà attribués au membre.
- Depuis la gestion des comptes, un administrateur peut désactiver/réactiver ou supprimer définitivement un compte membre. La suppression demande confirmation et ne peut pas être utilisée pour supprimer un compte administrateur.
- Lors de l’actualisation de la liste des membres, les profils Firestore dont l’utilisateur Firebase Authentication a été supprimé manuellement sont nettoyés.

### Application installable

- Interface responsive et manifest PWA pour installation sur les navigateurs compatibles.
- Service worker pour mettre en cache les ressources statiques.
- Indicateur de connexion et cache Firestore local IndexedDB quand le navigateur le permet.

## Parcours utilisateur

1. Le frontend récupère la configuration publique Firebase auprès de `GET /api/config`.
2. Le membre s’authentifie avec Firebase Authentication.
3. L’application vérifie son profil `users/{uid}` : il doit être actif, appartenir à la famille `family-prime` et avoir terminé son changement de mot de passe obligatoire.
4. Les comptes membres autorisés lisent en temps réel le document partagé `lists/shopping`.
5. Les modifications des articles sont envoyées à `POST /api/shopping/items`. Le serveur vérifie l’identité, valide la liste, attribue l’auteur des nouveaux articles et préserve celui des articles existants.
6. Les changements de profil passent par `PATCH /api/profile`. Les opérations administrateur passent par `/api/admin/users`.
7. Le tri IA passe par `POST /api/chat` ; la clé Gemini n’est utilisée que par le serveur.
8. Les modifications du calendrier et d’Icebox passent par `POST /api/family-data` et sont enregistrées dans le même document Firestore que les courses.

## Architecture et fichiers

| Fichier ou dossier | Rôle |
| --- | --- |
| `index.html`, `styles.css` | Interface, formulaires, modales et mise en page mobile. |
| `app.js` | Authentification, interface, liste, magasins, cartes, profil et interactions. |
| `family-features.js`, `lib/calendarDates.js` | Calendrier familial et Icebox synchronisés avec Firestore. |
| `firestore-offline.js` | Initialisation Firestore, cache IndexedDB et état de connexion. |
| `api/config.js` | Renvoie uniquement les paramètres publics du SDK Firebase Web. |
| `api/shopping/items.js` | Validation et enregistrement sécurisé des articles et auteurs. |
| `api/shopping/preferences.js` | Lecture et enregistrement serveur des préférences de tri par magasin. |
| `api/admin/users.js` | Création, activation, désactivation et suppression des comptes membres. |
| `api/members.js` | Liste des pseudos des membres actifs pour l’attribution des événements. |
| `api/family-data.js` | Migration et modifications authentifiées du calendrier et d’Icebox dans `lists/shopping`. |
| `api/auth/change-password.js` | Validation du mot de passe provisoire et changement initial du mot de passe et du pseudo. |
| `api/profile.js` | Modification du pseudo et mise à jour des articles concernés. |
| `api/chat.js` | Relais authentifié vers Gemini avec limites de taille et de fréquence. |
| `lib/firebaseAdmin.js` | Initialisation Firebase Admin et vérification des comptes et rôles. |
| `lib/accountProfiles.js`, `lib/accountPasswords.js` | Validation des pseudos et gestion sécurisée du secret provisoire. |
| `lib/shoppingItems.js` | Validation des articles et gestion de leur auteur. |
| `lib/sortingPreferences.js` | Identité normalisée des articles, application des préférences et déplacements dans l’éditeur. |
| `firestore.rules`, `firebase.json` | Règles d’accès et configuration Firebase/émulateurs. |
| `scripts/bootstrap-admin.js` | Amorçage ponctuel du premier administrateur. |
| `scripts/migrate-firestore.js` | Export/import facultatif du document de courses. |
| `service-worker.js`, `manifest.json` | Cache de ressources et configuration de l’application installable. |
| `api/`, `vercel.json` | Fonctions Node serverless déployées sur Vercel. |
| `.github/workflows/deploy-pages.yml` | Génère la configuration d’API publique et déploie les fichiers statiques sur GitHub Pages. |
| `deployment-config.js` | Configuration d’URL API locale ; en production, elle est générée par le workflow Pages. |
| `.env.example` | Noms des variables nécessaires au développement. |

## Données et sécurité

Les données de l’application sont regroupées dans le document Firestore `lists/shopping`.

| Document ou champ | Contenu |
| --- | --- |
| `lists/shopping` | Articles, magasins, historique de demandes IA et cartes de fidélité. |
| `items` | Articles, état acheté/non trouvé, catégorie et attribution de l’auteur (`addedByUid`, `addedByName`, initiale affichée dans la liste). |
| `stores` | Magasins, rayons et ordre d’affichage. |
| `currentStore` | Magasin actuellement sélectionné. |
| `sortingPreferences` | Préférences de classement indexées par nom de magasin puis nom d’article normalisé. Écrites uniquement par l’API serveur. Un changement de nom de magasin crée actuellement une nouvelle portée de préférences. |
| `promptHistory` | Ancien historique global conservé pour compatibilité ; il n’est plus utilisé pour le tri et ne doit pas être alimenté. |
| `loyaltyCards` | Cartes et images encodées en Data URL. |
| `familyEvents` | Événements, récurrence, auteur et membres concernés. |
| `iceboxItems` | Nom, saveur et quantité des glaces. |
| `familyFeaturesMigrated` | Indique que les anciennes collections de calendrier et Icebox ont été importées dans ce document. |

Les profils sont stockés dans `users/{uid}`. Les empreintes des mots de passe provisoires, à forte entropie, sont temporairement stockées dans `accountSecrets/{uid}` et supprimées après leur utilisation. Les limites de fréquence IA sont enregistrées dans `aiRateLimits/{uid}`.

- Les règles Firestore refusent par défaut tout accès non explicitement autorisé. Les modifications du calendrier et d’Icebox passent par l’API authentifiée ; le serveur vérifie que seul l’auteur peut modifier ou supprimer un événement. Les anciennes collections sont conservées en archive et ne sont plus accessibles aux clients.
- Les préférences de tri sont lues via `GET /api/shopping/preferences?store=...` et enregistrées via `POST /api/shopping/preferences`. Seul le serveur Firebase Admin peut modifier le champ partagé `sortingPreferences`.
- Les routes serveur vérifient les jetons Firebase et les rôles avec Firebase Admin.
- CORS n’autorise que les origines définies dans `FAMILY_PRIME_ALLOWED_ORIGINS`.
- La clé Gemini (`GOOGLE_API_KEY`) et le compte de service Firebase Admin (`FIREBASE_SERVICE_ACCOUNT_JSON`) sont des secrets serveur. Ne pas les placer dans GitHub Pages, dans le code client, dans le dépôt ou dans une variable `VITE_*`.
- Les identifiants Firebase Web sont visibles dans le navigateur par conception ; ils identifient le projet. Ils ne remplacent pas les règles Firestore ni les vérifications d’authentification.
- Les pseudos sont affichés publiquement aux membres de cette famille dans la liste partagée. Ils ne doivent donc pas contenir d’information sensible.
- L’identité d’un article appris repose sur son nom normalisé (casse, accents et ponctuation neutralisés), car l’identifiant UUID des articles est renouvelé lorsqu’ils sont ajoutés à une nouvelle liste. Renommer un article crée donc une nouvelle préférence.
- La suppression d’un compte retire son compte Firebase Authentication, son profil et son secret provisoire. Les articles historiques qu’il a ajoutés restent dans la liste et conservent le pseudo mémorisé au moment du dernier changement de profil.

## Développement local

### Prérequis

- Node.js 18 ou supérieur.
- Un projet Firebase configuré (voir [Configurer Firebase](#configurer-firebase)).
- Vercel CLI pour lancer localement le frontend et les routes serveur.
- Une clé Google Gemini si le tri IA doit être testé.

### Lancement

1. Installer les dépendances :

   ```powershell
   npm.cmd install
   ```

2. Créer `.env.local` à partir de `.env.example` et y renseigner les paramètres Firebase Web, le compte de service serveur et les valeurs suivantes :

   ```dotenv
   GOOGLE_API_KEY=votre_cle_gemini
   FAMILY_PRIME_ALLOWED_ORIGINS=http://localhost:3000
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account", "...":"..."}
   ```

   `.env.local` et les fichiers de compte de service ne doivent jamais être commités.

3. Démarrer le serveur local :

   ```powershell
   npx vercel dev
   ```

4. Ouvrir l’adresse locale indiquée par Vercel. Ne pas ouvrir `index.html` directement avec `file://` : les modules Firebase et les API nécessitent un serveur HTTP(S).

Les commandes npm du projet :

| Commande | Action |
| --- | --- |
| `npm.cmd test` | Exécute les tests unitaires Node. |
| `npm.cmd run firebase:bootstrap -- --confirm-bootstrap` | Crée le profil du premier administrateur, après définition des variables d’amorçage requises. |
| `npm.cmd run firebase:migrate -- export <fichier>` | Exporte le document de courses du projet source. |
| `npm.cmd run firebase:migrate -- import <fichier>` | Importe le document dans le projet cible sans l’écraser par défaut. |

## Déploiement GitHub Pages et Vercel

Le déploiement utilise deux services : **GitHub Pages héberge l’interface statique** et **Vercel héberge les fonctions serveur**. GitHub Pages ne peut pas exécuter Firebase Admin ou protéger une clé Gemini.

### API Vercel

1. Importer le dépôt dans Vercel et conserver `vercel.json`.
2. Ajouter à Vercel les variables de [Variables d’environnement](#variables-denvironnement).
3. Définir `FAMILY_PRIME_ALLOWED_ORIGINS` à l’origine exacte du site Pages, par exemple `https://MON-UTILISATEUR.github.io` (sans chemin ni slash final). Ajouter les origines locales/preview nécessaires explicitement.
4. Déployer l’API et noter son origine HTTPS, par exemple `https://mon-projet.vercel.app`.

### Site GitHub Pages

1. Dans **Settings → Pages**, choisir **GitHub Actions** comme source.
2. Dans **Settings → Secrets and variables → Actions → Variables**, définir `API_BASE_URL` à l’origine HTTPS de Vercel, sans chemin.
3. Dans **Settings → Actions → General**, autoriser les permissions de déploiement Pages demandées par le workflow.
4. Pousser sur `main` ou lancer le workflow **Deploy GitHub Pages**.
5. Vérifier le succès dans l’onglet Actions puis ouvrir l’URL Pages de l’environnement `github-pages`.

Le workflow génère le fichier `deployment-config.js` en production. `API_BASE_URL` est une URL publique, pas un secret. Les secrets Firebase Admin et Gemini restent exclusivement dans les variables Vercel. Après tout changement de variable Vercel, redéployer l’API ; après tout changement d’URL Vercel, mettre aussi à jour `API_BASE_URL` puis redéployer Pages.

Le workflow Pages copie aussi les modules importés par le client. Les API des préférences et du tri sont automatiquement publiées par Vercel avec les autres fichiers sous `api/`.

Pour un dépôt classique, l’URL du site Pages inclut le nom du dépôt, mais l’origine à autoriser reste uniquement le domaine, par exemple `https://MON-UTILISATEUR.github.io`.

## Configurer Firebase

1. Créer un projet Firebase et une application Web.
2. Dans **Authentication → Sign-in method**, activer **E-mail/Mot de passe**. Ne pas activer l’inscription publique pour le flux prévu.
3. Dans **Authentication → Settings → Authorized domains**, ajouter le domaine GitHub Pages et les domaines personnalisés/locaux nécessaires.
4. Créer Cloud Firestore puis publier les règles du dépôt :

   ```powershell
   npx firebase-tools login
   npx firebase-tools deploy --only firestore:rules --project votre-project-id
   ```

5. Créer un compte de service dédié et limiter ses permissions à celles nécessaires pour Firebase Authentication et Firestore. Ne pas déposer sa clé JSON dans le dépôt.
6. Ajouter les variables Firebase et les secrets requis à Vercel.
7. Amorcer le premier administrateur puis tester la connexion, la gestion des utilisateurs et la liste avant de partager l’URL.

## Créer le premier administrateur

Le premier administrateur doit être préparé manuellement dans Firebase Console ; aucun endpoint public ne permet de s’attribuer le rôle admin.

1. Dans **Authentication → Users**, créer l’utilisateur et copier son UID.
2. Télécharger la clé JSON du compte de service du bon projet et la conserver hors du dépôt.
3. Dans PowerShell, depuis la racine du dépôt :

   ```powershell
   $env:FIREBASE_SERVICE_ACCOUNT_PATH = (Resolve-Path ".\firebase-admin-service-account.json").Path
   $env:BOOTSTRAP_ADMIN_UID = "UID_COPIE_DE_FIREBASE_AUTH"
   npm.cmd run firebase:bootstrap -- --confirm-bootstrap
   Remove-Item Env:FIREBASE_SERVICE_ACCOUNT_PATH
   Remove-Item Env:BOOTSTRAP_ADMIN_UID
   ```

Le script rattache le profil au groupe `family-prime`, lui attribue le rôle `admin` et initialise une liste vide si nécessaire. Il refuse l’opération si un administrateur existe déjà. Déployer ensuite les variables Vercel et se connecter avec le compte créé.

## Migration facultative

`scripts/migrate-firestore.js` permet de copier le document `lists/shopping` d’un ancien projet Firebase vers le nouveau. Les comptes ne sont pas migrés. Les anciens articles sans attribution sont marqués comme import historique.

Utiliser deux comptes de service différents, conservés hors du dépôt :

```powershell
$env:SOURCE_FIREBASE_SERVICE_ACCOUNT_PATH = (Resolve-Path ".\source-service-account.json").Path
$env:TARGET_FIREBASE_SERVICE_ACCOUNT_PATH = (Resolve-Path ".\target-service-account.json").Path
npm.cmd run firebase:migrate -- export .\migration-backup.json
npm.cmd run firebase:migrate -- import .\migration-backup.json
```

Examiner l’export avant import. L’import refuse d’écraser un document existant, sauf si l’option `--replace` est explicitement demandée. Le fichier exporté contient des données familiales : le garder en lieu sûr et le supprimer lorsque la migration est vérifiée.

## Variables d’environnement

### Variables Vercel

| Variable | Requise | Usage |
| --- | --- | --- |
| `FIREBASE_API_KEY` | Oui | Configuration publique du SDK Firebase Web. |
| `FIREBASE_AUTH_DOMAIN` | Oui | Domaine Firebase Authentication. |
| `FIREBASE_PROJECT_ID` | Oui | Projet Firebase utilisé par l’application et Firebase Admin. |
| `FIREBASE_STORAGE_BUCKET` | Oui | Configuration Web Firebase. |
| `FIREBASE_MESSAGING_SENDER_ID` | Oui | Configuration Web Firebase. |
| `FIREBASE_APP_ID` | Oui | Identifiant de l’application Web Firebase. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Oui | JSON privé du compte de service, utilisé par Firebase Admin. |
| `GOOGLE_API_KEY` | Pour l’IA | Clé API Google Gemini, exclusivement serveur. |
| `GEMINI_MODEL` | Non | Modèle Gemini ; par défaut `gemini-2.5-flash-lite`. Laisser vide pour utiliser le modèle par défaut si l’ancien modèle configuré ne répond plus. |
| `FAMILY_PRIME_ALLOWED_ORIGINS` | Oui | Liste séparée par des virgules des origines frontend autorisées. |
| `FIREBASE_MEASUREMENT_ID` | Non | Identifiant Analytics facultatif. |

### Variable GitHub Actions

| Variable | Usage |
| --- | --- |
| `API_BASE_URL` | Origine publique Vercel utilisée pour générer la configuration de l’interface Pages. Ce n’est pas un secret. |

## Fonctionnement hors ligne

- Le service worker sert immédiatement les ressources statiques déjà en cache et les actualise en arrière-plan (stratégie stale-while-revalidate). La configuration publique Firebase déjà chargée est également mise en cache localement pour éviter d’attendre l’API de configuration à chaque ouverture.
- Firestore utilise la persistance locale IndexedDB si le navigateur la prend en charge.
- L’application conserve une copie locale des données et présente l’état de connexion.
- La sauvegarde des articles passe toutefois par l’API Vercel. Une modification faite sans connexion peut rester visible localement sans être sauvegardée côté serveur ni synchronisée automatiquement. Ne pas considérer l’indicateur local comme une confirmation de sauvegarde.
- Le tri Gemini, l’administration des comptes et les changements de pseudo nécessitent le réseau.

## Tests

Exécuter la suite :

```powershell
npm.cmd test
```

Les tests unitaires couvrent la validation des articles et des pseudos, l’attribution fiable des auteurs, les mots de passe provisoires, CORS et la configuration Firebase publique. Ils ne lancent pas encore Firebase Emulator Suite et ne remplacent pas un test de bout en bout sur un projet de préproduction.

## Limites et améliorations possibles

### Priorité élevée

1. **Vraie synchronisation hors ligne** : mettre en place une file persistante IndexedDB, une stratégie de fusion des modifications concurrentes et un indicateur « en attente / synchronisé / échec ».
2. **Modèle Firestore évolutif** : déplacer les articles dans une sous-collection plutôt que de tout stocker dans `lists/shopping`; appliquer des limites de taille et de pagination au niveau des données.
3. **Stockage des images** : déplacer les images de cartes de fidélité vers Firebase Storage et ne garder que leurs références dans Firestore.
4. **Suppression conforme des données** : clarifier la durée de conservation des articles d’un compte supprimé et fournir une action distincte pour anonymiser ou retirer ses anciennes attributions si nécessaire.
5. **Tests d’intégration** : ajouter les tests des règles Firestore, des routes API (autorisations admin/membre, suppression, pseudo) et des scénarios de connexion avec Firebase Emulator Suite.

### IA

- Remplacer le protocole de réponse texte libre par une sortie JSON structurée, validée côté serveur avant d’appliquer le tri.
- Comparer la réponse avec la liste originale : détecter les articles omis, dupliqués, modifiés ou les rayons inconnus avant de persister.
- Ajouter un retour utilisateur sur l’incertitude, la possibilité de prévisualiser le résultat et de l’annuler.
- Configurer quotas et alertes de coût côté Google Cloud, en plus de la limite de fréquence applicative.
- Rendre le modèle, les limites et éventuellement le prompt configurables côté serveur, et suivre latence/erreurs sans journaliser le contenu privé de la liste.

### Comptes, connexion et exploitation

- Ajouter une récupération de mot de passe via Firebase et des invitations e-mail sécurisées, plutôt que la transmission manuelle du mot de passe provisoire.
- Ajouter des règles de robustesse et une procédure de rotation/révocation du compte de service.
- Vérifier les règles Firestore avec l’émulateur dans la CI et ajouter des tests navigateur automatisés des parcours critiques.
- Ajouter des états de sauvegarde explicites, une meilleure gestion des erreurs réseau et un diagnostic simplifié pour les utilisateurs.
- Ajouter un journal d’audit des actions d’administration (création, désactivation, suppression) sans enregistrer de secrets.

### Fonctionnalités futures

- Plusieurs foyers indépendants au lieu de l’identifiant unique `family-prime`.
- Historique des listes et possibilité de créer plusieurs listes ou événements.
- Gestion des tâches et calendrier : ces fonctions ne sont pas présentes dans l’application actuelle malgré certains textes historiques du projet.
- Recherche, filtres, quantités, notes et suggestions de réapprovisionnement.
- Compression et validation des images avant stockage.
- Accessibilité renforcée (navigation clavier, contrastes, annonces des changements) et internationalisation.

## Technologies

- HTML, CSS et JavaScript natif avec modules ES.
- Firebase Authentication, Cloud Firestore et Firebase Admin SDK.
- Google Gemini via `@google/generative-ai`.
- Vercel Functions, GitHub Pages, GitHub Actions et Service Worker/PWA.
