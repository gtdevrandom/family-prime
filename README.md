# Migration Hugging Face → Google Gemini

Ce guide explique comment remplacer l'utilisation de l'API Hugging Face par l'API Google Gemini dans ce projet.

---

## 1. Pourquoi changer ?

L'ancienne version utilisait Hugging Face :
- Token Hugging Face obligatoire
- Problèmes possibles de CORS côté navigateur
- Gestion parfois complexe des modèles

La nouvelle version utilise Google Gemini :
- API simple
- Compatible avec Vercel
- Clé protégée avec les variables d'environnement
- Pas besoin d'exposer la clé côté client

---

# Étape 1 — Créer une clé Gemini

1. Aller sur Google AI Studio : https://aistudio.google.com/
2. Se connecter avec un compte Google
3. Cliquer sur : **Get API key**
4. Créer une nouvelle clé API

La clé ressemble à :
```
AIzaSyxxxxxxxxxxxxxxxxxxxx
```

⚠️ **Ne jamais mettre cette clé directement dans le code.**

---

# Étape 2 — Ajouter la clé dans Vercel

Dans Vercel :
```
Project → Settings → Environment Variables
```

Créer :
```
Key: GOOGLE_API_KEY
Valeur: AIzaSyxxxxxxxxxxxxxxxxxxxx
```

Activer :
- ✅ Production
- ✅ Preview
- ✅ Development

Puis sauvegarder.

---

# Étape 3 — Installer le SDK Gemini

```bash
npm install @google/generative-ai
```

---

# Étape 4 — Architecture mise à jour

## Ancien code (Hugging Face)

```javascript
const response = await fetch("https://api-inference.huggingface.co/models/...", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${HF_TOKEN}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    inputs: message
  })
});
```

## Nouveau code (Gemini)

**Serveur** (`api/chat.js`) :
```javascript
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  const genAI = new GoogleGenerativeAI(
    process.env.GOOGLE_API_KEY
  );
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash"
  });
  
  const result = await model.generateContent(
    req.body.message
  );
  
  res.status(200).json({
    reply: result.response.text()
  });
}
```

**Frontend** (`app.js`) :
```javascript
fetch("/api/chat", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    message: userMessage
  })
});
```

---

# Étape 5 — Fichier `.env.local` (développement)

Créer un fichier `.env.local` à la racine du projet :
```
GOOGLE_API_KEY=AIzaSyCWPXWBzjIwGk5LXsNCj2F-f3sInFnKICQ
```

⚠️ **N'ajouter jamais `.env.local` au Git**

Le fichier `.gitignore` contient déjà :
```
.env
.env.local
.env.*.local
```

---

# Étape 6 — Supprimer Hugging Face

Retirer :
- ❌ Ancienne variable : `HF_TOKEN`
- ❌ Anciennes URLs : `api-inference.huggingface.co`
- ❌ Ancien code : `Authorization: Bearer ...`

---

# Étape 7 — Tester en local

```bash
# Installer les dépendances
npm install

# Démarrer le serveur de développement
npm run dev
```

Tester : http://localhost:3000

---

# Étape 8 — Déployer sur Vercel

```bash
git add .
git commit -m "Migration Hugging Face vers Gemini"
git push
```

Vercel redéploiera automatiquement.

---

# Résultat final

Architecture :
```
Utilisateur
    ↓
Frontend (HTML/React)
    ↓
/api/chat (Vercel Serverless)
    ↓
Google Gemini API
```

**La clé API n'est jamais visible par les utilisateurs.**

---

# Modèles Gemini disponibles

- `gemini-2.5-flash` : Rapide et économique (recommandé)
- `gemini-2.5-pro` : Plus puissant pour les tâches complexes
- `gemini-1.5-flash` : Ancien modèle flash (gratuit)
- `gemini-1.5-pro` : Ancien modèle pro

---

# Dépannage

## Erreur : "GOOGLE_API_KEY not configured"
- Vérifier que `.env.local` contient `GOOGLE_API_KEY`
- Vérifier que Vercel a `GOOGLE_API_KEY` en variables d'environnement

## Erreur : "Invalid API key"
- Vérifier que la clé est correcte
- Vérifier que la clé n'a pas d'espaces
- Créer une nouvelle clé si nécessaire

## Erreur : "Quota exceeded"
- Google Gemini a des limites gratuites
- Attendre 60 secondes ou améliorer le plan

---

✅ **Migration terminée**

Votre application utilise maintenant Google Gemini en toute sécurité !
