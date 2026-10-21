import { getDoc, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { FirestoreOfflineManager } from './firestore-offline.js';
import {
  applySortingPreferences,
  moveItemRelativeTo,
  moveItemToAisleEnd,
  normalizeSortingItemKey,
  upsertSortingPreference
} from './lib/sortingPreferences.js';
import { startFamilyFeatures, stopFamilyFeatures } from './family-features.js';

let fm = null;
let db = null;
let auth = null;
let currentUser = null;
let userProfile = null;
let authenticatedAppInitialized = false;
let profileUnsubscribe = null;
const apiBaseUrl = (window.FAMILY_PRIME_API_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  return `${apiBaseUrl}${path}`;
}

const FIREBASE_CONFIG_CACHE_KEY = "familyPrimeFirebaseConfig";
const requiredFirebaseConfigKeys = ["apiKey", "authDomain", "projectId", "appId"];

function isValidFirebaseConfig(config) {
  return config && typeof config === "object" &&
    requiredFirebaseConfigKeys.every(key => typeof config[key] === "string" && config[key]);
}

function readCachedFirebaseConfig() {
  try {
    const cached = JSON.parse(localStorage.getItem(FIREBASE_CONFIG_CACHE_KEY) || "null");
    return isValidFirebaseConfig(cached) ? cached : null;
  } catch {
    return null;
  }
}

async function fetchFirebaseConfig() {
  const response = await fetch(apiUrl("/api/config"), { cache: "no-store" });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || "Configuration Firebase indisponible.");
  if (!isValidFirebaseConfig(config)) throw new Error("La configuration Firebase reçue est invalide.");
  try {
    localStorage.setItem(FIREBASE_CONFIG_CACHE_KEY, JSON.stringify(config));
  } catch (error) {
    console.warn("Unable to cache the public Firebase configuration:", error.message);
  }
  return config;
}

function refreshFirebaseConfig(cachedConfig) {
  fetchFirebaseConfig().then(freshConfig => {
    if (freshConfig.projectId !== cachedConfig.projectId || freshConfig.appId !== cachedConfig.appId) {
      window.location.reload();
    }
  }).catch(error => {
    console.warn("Unable to refresh cached Firebase configuration:", error.message);
  });
}

// Global state
let itemsArray = [];
let storesData = {};
let currentStore = null;
let loyaltyCards = [];
let editMode = false;
let isSorted = false; // Track if list is sorted
let promptHistory = [];
let sortingPreferences = {};
let pendingSortingPreferences = [];
let editingStoreName = null;
let lastAISortTime = 0; // Throttle AI sorting to max every 30s
let isOnline = navigator.onLine;

function showLoginMessage(message, isError = true) {
  const error = document.getElementById("error");
  error.textContent = message;
  error.classList.toggle("show", Boolean(message));
  error.classList.toggle("success", !isError && Boolean(message));
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("appContainer").classList.remove("show");
  document.getElementById("loginForm").hidden = false;
  document.getElementById("changePasswordForm").hidden = true;
}

async function callAuthenticatedApi(path, body, method = "POST") {
  if (!currentUser) throw new Error("Vous devez être connecté pour effectuer cette action.");
  const token = await currentUser.getIdToken();
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let result;
  try {
    result = await response.json();
  } catch {
    if (response.ok) throw new Error("Le serveur a renvoyé une réponse invalide.");
    result = {};
  }
  if (!response.ok) {
    throw new Error(result.error || `Erreur serveur (${response.status}).`);
  }
  return result;
}

async function loadSortingPreferences(storeName) {
  const result = await callAuthenticatedApi(
    `/api/shopping/preferences?store=${encodeURIComponent(storeName)}`,
    null,
    "GET"
  );
  if (!result.preferences || typeof result.preferences !== "object" || Array.isArray(result.preferences)) {
    throw new Error("Le serveur a renvoyé des préférences de tri invalides.");
  }
  sortingPreferences = { ...sortingPreferences, [storeName]: result.preferences };
  saveToLocalStorage();
  return result.preferences;
}

function queueSortingPreference(storeName, preference) {
  if (!storeName || !preference) return;
  const itemKey = normalizeSortingItemKey(preference.itemName);
  pendingSortingPreferences = pendingSortingPreferences.filter(entry =>
    entry.storeName !== storeName ||
    normalizeSortingItemKey(entry.preference?.itemName) !== itemKey
  );
  pendingSortingPreferences.push({ storeName, preference });
  sortingPreferences = upsertSortingPreference(
    sortingPreferences,
    storeName,
    { ...preference, updatedAt: Date.now() }
  );
  saveToLocalStorage();
}

async function syncPendingSortingPreferences() {
  if (!isOnline || !currentUser || pendingSortingPreferences.length === 0) return;

  const batchesByStore = new Map();
  for (const entry of pendingSortingPreferences) {
    if (!batchesByStore.has(entry.storeName)) batchesByStore.set(entry.storeName, []);
    batchesByStore.get(entry.storeName).push(entry.preference);
  }

  for (const [storeName, preferences] of batchesByStore) {
    await callAuthenticatedApi("/api/shopping/preferences", {
      storeName,
      preferences: preferences.map(preference => ({
        itemName: preference.itemName,
        aisle: preference.aisle,
        position: preference.position,
        beforeItemName: preference.beforeItemName,
        afterItemName: preference.afterItemName
      }))
    });
    await loadSortingPreferences(storeName);
    const syncedKeys = new Set(preferences.map(preference =>
      normalizeSortingItemKey(preference.itemName)
    ));
    pendingSortingPreferences = pendingSortingPreferences.filter(entry =>
      entry.storeName !== storeName ||
      !syncedKeys.has(normalizeSortingItemKey(entry.preference?.itemName))
    );
  }
  saveToLocalStorage();
}

async function signOutAfterPendingChanges() {
  if (pendingSortingPreferences.length > 0) {
    if (!isOnline) {
      alert("Reconnectez-vous pour synchroniser les corrections de tri avant de vous déconnecter.");
      return;
    }
    try {
      await syncPendingSortingPreferences();
    } catch (error) {
      console.error("Unable to save sorting preferences before sign-out:", error);
      alert(`Déconnexion annulée : les corrections de tri n'ont pas pu être synchronisées. ${error.message}`);
      return;
    }
    if (pendingSortingPreferences.length > 0) {
      alert("Déconnexion annulée : certaines corrections de tri restent à synchroniser.");
      return;
    }
  }
  await signOut(auth);
}

async function initializeAuthenticatedApp() {
  if (authenticatedAppInitialized) return;
  authenticatedAppInitialized = true;
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appContainer").classList.add("show");
  document.getElementById("adminUsersButton").hidden = userProfile.role !== "admin";

  loadFromLocalStorage();
  renderList();
  loadLoyaltyCards();
  updateStoreSelector();
  setupRealtimeListeners();
  startFamilyFeatures(db, currentUser, userProfile, callAuthenticatedApi);
  window.switchTab(window.location.hash === "#icebox" ? "icebox" : "courses");
  if (isOnline && pendingSortingPreferences.length > 0) {
    syncPendingSortingPreferences().catch(error => {
      console.error("Unable to synchronize pending sorting preferences:", error);
      alert(`Synchronisation des corrections de tri impossible : ${error.message}`);
    });
  }
}

async function handleAuthState(user) {
  currentUser = user;
  if (!user) {
    authenticatedAppInitialized = false;
    userProfile = null;
    if (profileUnsubscribe) {
      profileUnsubscribe();
      profileUnsubscribe = null;
    }
    stopFamilyFeatures();
    if (fm) fm.cleanup();
    localStorage.removeItem("familyPrimeData");
    localStorage.removeItem("auth");
    document.getElementById("password").value = "";
    document.getElementById("temporaryPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmNewPassword").value = "";
    document.getElementById("newDisplayName").value = "";
    closeProfileSettings();
    itemsArray = [];
    storesData = {};
    currentStore = null;
    loyaltyCards = [];
    promptHistory = [];
    sortingPreferences = {};
    pendingSortingPreferences = [];
    editingStoreName = null;
    showLogin();
    return;
  }

  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    if (auth.currentUser?.uid !== user.uid) return;
    if (!profileSnapshot.exists()) {
      showLoginMessage("Ce compte n'est pas encore rattaché à un espace famille.");
      await signOut(auth);
      return;
    }

    userProfile = profileSnapshot.data();
    if (userProfile.active !== true || userProfile.familyId !== "family-prime") {
      showLoginMessage("Ce compte n'a pas accès à cet espace famille.");
      await signOut(auth);
      return;
    }

    if (profileUnsubscribe) profileUnsubscribe();
    profileUnsubscribe = onSnapshot(doc(db, "users", user.uid), snapshot => {
      if (!snapshot.exists() || snapshot.data().active !== true) {
        if (auth.currentUser?.uid !== user.uid) return;
        showLoginMessage("Votre accès à l'espace famille a été désactivé.");
        signOut(auth).catch(error => console.error("Unable to close the disabled account session:", error));
        return;
      }
      if (auth.currentUser?.uid === user.uid) userProfile = snapshot.data();
    }, error => {
      console.error("Unable to monitor the account profile:", error);
    });

    if (userProfile.mustChangePassword === true) {
      document.getElementById("loginScreen").style.display = "flex";
      document.getElementById("loginForm").hidden = true;
      document.getElementById("changePasswordForm").hidden = false;
      showLoginMessage("Choisissez un nouveau mot de passe avant de continuer.", false);
      return;
    }

    await initializeAuthenticatedApp();
  } catch (error) {
    console.error("Unable to load the signed-in user's profile:", error);
    showLoginMessage("Impossible de vérifier votre compte. Vérifiez votre connexion puis réessayez.");
    await signOut(auth);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const loginButton = document.getElementById("loginBtn");
  loginButton.disabled = true;

  try {
    const cachedConfig = readCachedFirebaseConfig();
    const firebaseConfig = cachedConfig || await fetchFirebaseConfig();
    if (cachedConfig) refreshFirebaseConfig(cachedConfig);

    fm = new FirestoreOfflineManager(firebaseConfig);
    await fm.ready;
    db = fm.db;
    if (!db || !fm.app) throw new Error("Firebase n'a pas pu démarrer.");
    auth = getAuth(fm.app);

    document.getElementById("loginForm").addEventListener("submit", async event => {
      event.preventDefault();
      showLoginMessage("");
      loginButton.disabled = true;
      try {
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        await signInWithEmailAndPassword(auth, email, password);
        document.getElementById("password").value = "";
      } catch (error) {
        console.error("Sign-in failed:", error.code || error.message);
        showLoginMessage("Adresse e-mail ou mot de passe incorrect.");
      } finally {
        loginButton.disabled = false;
      }
    });
    loginButton.disabled = false;

    document.getElementById("changePasswordForm").addEventListener("submit", async event => {
      event.preventDefault();
      const temporaryPassword = document.getElementById("temporaryPassword").value;
      const newPassword = document.getElementById("newPassword").value;
      const confirmation = document.getElementById("confirmNewPassword").value;
      const displayName = document.getElementById("newDisplayName").value.trim();
      if (!displayName) {
        showLoginMessage("Choisissez un pseudo pour votre compte.");
        return;
      }
      if (newPassword.length < 12) {
        showLoginMessage("Le nouveau mot de passe doit contenir au moins 12 caractères.");
        return;
      }
      if (newPassword !== confirmation) {
        showLoginMessage("Les mots de passe ne correspondent pas.");
        return;
      }

      const button = document.getElementById("changePasswordBtn");
      button.disabled = true;
      try {
        await callAuthenticatedApi("/api/auth/change-password", { temporaryPassword, newPassword, displayName });
        document.getElementById("temporaryPassword").value = "";
        document.getElementById("newDisplayName").value = "";
        userProfile.mustChangePassword = false;
        userProfile.displayName = displayName;
        document.getElementById("newPassword").value = "";
        document.getElementById("confirmNewPassword").value = "";
        await initializeAuthenticatedApp();
      } catch (error) {
        console.error("Password update failed:", error.message);
        showLoginMessage(error.message || "Impossible de modifier le mot de passe.");
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("logoutButton").addEventListener("click", async () => {
      await signOutAfterPendingChanges();
    });
    document.getElementById("logoutFromPasswordBtn").addEventListener("click", async () => {
      await signOutAfterPendingChanges();
    });

    document.getElementById("createUserForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = document.getElementById("createUserButton");
      button.disabled = true;
      console.info("[admin/users] Account creation requested.");
      try {
        let result;
        try {
          result = await callAuthenticatedApi("/api/admin/users", {
            displayName: document.getElementById("newUserName").value,
            email: document.getElementById("newUserEmail").value
          });
        } catch (error) {
          console.error("[admin/users] Account creation failed:", error.message);
          alert(error.message);
          return;
        }

        const notice = document.getElementById("temporaryPasswordNotice");
        const message = document.getElementById("temporaryPasswordMessage");
        const password = document.getElementById("temporaryPasswordValue");
        const togglePasswordButton = document.getElementById("toggleTemporaryPasswordButton");
        message.textContent = `Compte créé pour ${result.user.email}.`;
        password.value = result.temporaryPassword;
        password.type = "password";
        togglePasswordButton.textContent = "Afficher";
        togglePasswordButton.setAttribute("aria-pressed", "false");
        notice.hidden = false;
        form.reset();
        console.info("[admin/users] Account created successfully.");
        try {
          await refreshUsersList();
        } catch (error) {
          console.error("[admin/users] Account created, but refreshing the users list failed:", error.message);
          alert(`Le compte a été créé, mais la liste des membres n'a pas pu être actualisée : ${error.message}`);
        }
      } catch (error) {
        console.error("[admin/users] Unable to display the temporary password:", error.message);
        alert("Le compte a été créé, mais une erreur a empêché l'affichage de son mot de passe provisoire. Consultez la console avant de fermer cette fenêtre.");
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("toggleTemporaryPasswordButton").addEventListener("click", event => {
      const password = document.getElementById("temporaryPasswordValue");
      const visible = password.type === "password";
      password.type = visible ? "text" : "password";
      event.currentTarget.textContent = visible ? "Masquer" : "Afficher";
      event.currentTarget.setAttribute("aria-pressed", String(visible));
    });

    document.getElementById("profileSettingsForm").addEventListener("submit", async event => {
      event.preventDefault();
      const button = document.getElementById("saveProfileSettingsButton");
      const displayName = document.getElementById("profileDisplayName").value.trim();
      const status = document.getElementById("profileSettingsStatus");
      if (!displayName) {
        status.textContent = "Choisissez un pseudo.";
        status.hidden = false;
        return;
      }

      button.disabled = true;
      status.hidden = true;
      console.info("[profile] Pseudo update requested.");
      try {
        const result = await callAuthenticatedApi("/api/profile", { displayName }, "PATCH");
        userProfile.displayName = result.displayName;
        document.getElementById("profileDisplayName").value = result.displayName;
        status.textContent = "Pseudo enregistré.";
        status.hidden = false;
        console.info("[profile] Pseudo updated successfully.");
      } catch (error) {
        console.error("[profile] Pseudo update failed:", error.message);
        status.textContent = error.message;
        status.hidden = false;
      } finally {
        button.disabled = false;
      }
    });

    onAuthStateChanged(auth, handleAuthState);
  } catch (error) {
    console.error("Application initialization failed:", error);
    showLoginMessage(error.message || "Impossible de démarrer l'application. Vérifiez sa configuration.");
  }
});

// --- Offline-first state from localStorage ---
function loadFromLocalStorage() {
  try {
    const local = localStorage.getItem('familyPrimeData');
    if (local) {
      const parsed = JSON.parse(local);
      itemsArray = parsed.items || [];
      storesData = parsed.stores || {};
      currentStore = parsed.currentStore || null;
      promptHistory = parsed.promptHistory || [];
      sortingPreferences = parsed.sortingPreferences || {};
      pendingSortingPreferences = Array.isArray(parsed.pendingSortingPreferences)
        ? parsed.pendingSortingPreferences
        : [];
      loyaltyCards = parsed.loyaltyCards || [];
    }
  } catch (e) {
    console.warn('Error loading from localStorage:', e);
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem('familyPrimeData', JSON.stringify({
      items: itemsArray,
      stores: storesData,
      currentStore: currentStore,
      promptHistory: promptHistory,
      sortingPreferences: sortingPreferences,
      pendingSortingPreferences: pendingSortingPreferences,
      loyaltyCards: loyaltyCards
    }));
  } catch (e) {
    console.warn('Error saving to localStorage:', e);
  }
}

function getCanonicalAisle(aisle) {
  const normalized = aisle && typeof aisle === 'string' ? aisle.trim() : '';
  if (!normalized) return null;
  if (currentStore && storesData[currentStore] && Array.isArray(storesData[currentStore].aisles)) {
    const match = storesData[currentStore].aisles.find(a => a.toLowerCase() === normalized.toLowerCase());
    return match || normalized;
  }
  return normalized;
}

// Load initial data from localStorage (will be called after DOM is ready)
// Note: renderList, renderCalendar, updateStoreSelector will be called after onSnapshot initializes

// --- Setup Real-time Listeners with Firestore Offline Persistence ---
function setupRealtimeListeners() {
  // Listen to shopping list updates
  fm.onDataChange('lists', 'shopping', (data) => {
    if (data) {
      itemsArray = data.items || [];
      storesData = data.stores || {};
      currentStore = data.currentStore || null;
      promptHistory = data.promptHistory || [];
      sortingPreferences = data.sortingPreferences || {};
      loyaltyCards = data.loyaltyCards || [];
      
      // Save to localStorage when Firebase updates
      saveToLocalStorage();
      
      // Si pas de magasin sélectionné mais qu'il y en a, en sélectionner un
      if (!currentStore && Object.keys(storesData).length > 0) {
        const firstStore = Object.keys(storesData)[0];
        currentStore = firstStore;
        persistShoppingChanges({ currentStore: firstStore }).catch(() => {});
      }
      
      // Update UI
      if (document.getElementById("list")) {
        renderList();
      }
      loadLoyaltyCards();
      updateStoreSelector();
    }
  });
}

async function persistShoppingChanges(changes) {
  const remainingChanges = { ...changes };
  try {
    if (Object.prototype.hasOwnProperty.call(remainingChanges, "items")) {
      const result = await callAuthenticatedApi("/api/shopping/items", {
        items: remainingChanges.items
      });
      itemsArray = result.items;
      saveToLocalStorage();
      delete remainingChanges.items;
    }
    if (Object.keys(remainingChanges).length > 0) {
      await fm.updateData("lists", "shopping", remainingChanges);
    }
  } catch (error) {
    console.error("Unable to save family data:", error);
    alert(`Enregistrement impossible : ${error.message}`);
    throw error;
  }
}

// --- Network status monitoring ---
window.addEventListener('online', () => {
  isOnline = true;
  console.log('✅ Online: syncing pending changes...');
  // Firestore will automatically sync
  syncPendingSortingPreferences().catch(error => {
    console.error("Unable to synchronize pending sorting preferences:", error);
    alert(`Synchronisation des corrections de tri impossible : ${error.message}`);
  });
});

window.addEventListener('offline', () => {
  isOnline = false;
  console.log('❌ Offline: changes will be queued');
});

// --- Tab Switch System ---
window.switchTab = function(tabName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const screenEl = document.getElementById(`tab-${tabName}`);
  if (screenEl) {
    screenEl.classList.add('active');
  }

  document.querySelector(`.nav-item[data-tab="${tabName}"]`)?.classList.add('active');
  if (tabName === "icebox") {
    history.replaceState(null, "", `${location.pathname}${location.search}#icebox`);
  } else if (location.hash) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
};

// --- Store Management ---
window.getOrderedStoreEntries = function() {
  return Object.entries(storesData).sort(([nameA, storeA], [nameB, storeB]) => {
    const orderA = Number.isFinite(storeA.order) ? storeA.order : (Number.isFinite(storeA.createdAt) ? storeA.createdAt : 0);
    const orderB = Number.isFinite(storeB.order) ? storeB.order : (Number.isFinite(storeB.createdAt) ? storeB.createdAt : 0);
    if (orderA !== orderB) return orderA - orderB;
    return nameA.localeCompare(nameB, 'fr', { sensitivity: 'base' });
  });
};

window.openStoreSettings = function() {
  const modal = document.getElementById("storeSettingsModal");
  const storeList = document.getElementById("storeList");
  storeList.innerHTML = "";
  
  const orderedStores = window.getOrderedStoreEntries();
  orderedStores.forEach(([storeName, storeData], index) => {
    const storeDiv = document.createElement("div");
    storeDiv.className = "store-item";
    storeDiv.innerHTML = `
      <div class="store-info">
        <h4>${storeName}</h4>
        <p class="aisles-text">${storeData.aisles.join(" • ")}</p>
      </div>
      <div class="store-actions">
        <button class="action-icon-btn" onclick="moveStoreUp('${storeName}')" ${index === 0 ? 'disabled' : ''}>⬆️</button>
        <button class="action-icon-btn" onclick="moveStoreDown('${storeName}')" ${index === orderedStores.length - 1 ? 'disabled' : ''}>⬇️</button>
        <button class="action-icon-btn" onclick="openEditStoreDialog('${storeName}')">✏️</button>
        <button class="action-icon-btn delete-item" onclick="deleteStore('${storeName}')">❌</button>
      </div>
    `;
    storeList.appendChild(storeDiv);
  });
  
  modal.classList.add("show");
};

window.openAddStoreDialog = function() {
  document.getElementById("storeDialogTitle").textContent = "Ajouter un magasin";
  document.getElementById("storeNameInput").value = "";
  document.getElementById("aislesInput").value = "";
  document.getElementById("storeNameInput").dataset.editMode = "false";
  document.getElementById("storeDialogModal").classList.add("show");
};

window.openEditStoreDialog = function(storeName) {
  document.getElementById("storeDialogTitle").textContent = `Éditer ${storeName}`;
  document.getElementById("storeNameInput").value = storeName;
  document.getElementById("storeNameInput").dataset.editMode = "true";
  document.getElementById("storeNameInput").dataset.originalName = storeName;
  document.getElementById("aislesInput").value = storesData[storeName].aisles.join(", ");
  document.getElementById("storeDialogModal").classList.add("show");
};

window.closeStoreSettings = function() {
  document.getElementById("storeSettingsModal").classList.remove("show");
};

window.closeStoreDialog = function() {
  document.getElementById("storeDialogModal").classList.remove("show");
};

window.saveStore = async function() {
  const storeName = document.getElementById("storeNameInput").value.trim();
  const aislesText = document.getElementById("aislesInput").value.trim();
  const isEditMode = document.getElementById("storeNameInput").dataset.editMode === "true";
  const originalName = document.getElementById("storeNameInput").dataset.originalName;
  
  if (!storeName) {
    alert("Veuillez entrer un nom de magasin.");
    return;
  }
  
  if (!aislesText) {
    alert("Veuillez entrer au moins un rayon.");
    return;
  }
  
  const aisles = aislesText.split(",").map(a => a.trim()).filter(a => a);
  
  let createdAt = new Date().getTime();
  let order = null;

  if (isEditMode) {
    // Editing existing store
    if (storeName !== originalName && storesData[storeName]) {
      alert("Ce magasin existe déjà.");
      return;
    }

    const existingStore = storesData[originalName];
    createdAt = existingStore?.createdAt ?? createdAt;
    order = existingStore?.order ?? createdAt;

    if (storeName !== originalName) {
      delete storesData[originalName];
      if (currentStore === originalName) {
        currentStore = storeName;
      }
    }
  } else {
    // Adding new store
    if (storesData[storeName]) {
      alert("Ce magasin existe déjà.");
      return;
    }

    const orders = Object.values(storesData).map(store => {
      if (Number.isFinite(store.order)) return store.order;
      if (Number.isFinite(store.createdAt)) return store.createdAt;
      return 0;
    });
    order = orders.length ? Math.max(...orders) + 1 : 0;
  }

  storesData[storeName] = {
    aisles: aisles,
    createdAt: createdAt,
    order: order
  };
  
  // Si c'est le premier magasin ou si on n'a pas de magasin sélectionné, on le sélectionne
  if (!currentStore) {
    currentStore = storeName;
  }
  
  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ stores: storesData, currentStore }).catch(() => {});
  }
  
  updateStoreSelector();
  closeStoreDialog();
  openStoreSettings(); // Refresh the store list
};

window.moveStoreUp = async function(storeName) {
  const orderedStores = window.getOrderedStoreEntries();
  const index = orderedStores.findIndex(([name]) => name === storeName);
  if (index <= 0) return;

  const currentOrder = orderedStores[index][1].order ?? orderedStores[index][1].createdAt ?? 0;
  const previousStore = orderedStores[index - 1][0];
  const previousOrder = orderedStores[index - 1][1].order ?? orderedStores[index - 1][1].createdAt ?? 0;

  storesData[storeName].order = previousOrder;
  storesData[previousStore].order = currentOrder;

  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ stores: storesData }).catch(() => {});
  }
  updateStoreSelector();
  openStoreSettings();
};

window.moveStoreDown = async function(storeName) {
  const orderedStores = window.getOrderedStoreEntries();
  const index = orderedStores.findIndex(([name]) => name === storeName);
  if (index < 0 || index >= orderedStores.length - 1) return;

  const currentOrder = orderedStores[index][1].order ?? orderedStores[index][1].createdAt ?? 0;
  const nextStore = orderedStores[index + 1][0];
  const nextOrder = orderedStores[index + 1][1].order ?? orderedStores[index + 1][1].createdAt ?? 0;

  storesData[storeName].order = nextOrder;
  storesData[nextStore].order = currentOrder;

  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ stores: storesData }).catch(() => {});
  }
  updateStoreSelector();
  openStoreSettings();
};

window.openCurrentStoreLoyaltyCard = function() {
  if (!currentStore) {
    alert('Sélectionnez d\'abord un magasin.');
    return;
  }

  const card = loyaltyCards.find(card => card.name === currentStore);
  if (!card) {
    if (confirm(`Aucune carte fidélité trouvée pour "${currentStore}". Voulez-vous en ajouter une ?`)) {
      switchTab('fidelity');
      openFidelityCardDialog();
      document.getElementById('fidelityStoreNameInput').value = currentStore;
    }
    return;
  }

  openLoyaltyCard(card.id);
};

window.deleteStore = async function(storeName) {
  if (!confirm(`Supprimer le magasin "${storeName}" ?`)) return;
  
  delete storesData[storeName];
  
  if (currentStore === storeName) {
    currentStore = Object.keys(storesData)[0] || null;
  }
  
  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ stores: storesData, currentStore }).catch(() => {});
  }
  
  openStoreSettings(); // Refresh the store list
};

function updateStoreSelector() {
  const storeSelector = document.getElementById("storeSelector");
  if (!storeSelector) return;
  
  storeSelector.innerHTML = '<option value="">-- Choisir un magasin --</option>';
  
  window.getOrderedStoreEntries().forEach(([storeName]) => {
    const option = document.createElement("option");
    option.value = storeName;
    option.text = storeName;
    if (storeName === currentStore) option.selected = true;
    storeSelector.appendChild(option);
  });
  
  const loyaltyBtn = document.getElementById('loyaltyBtn');
  if (loyaltyBtn) {
    loyaltyBtn.disabled = !currentStore || !storesData[currentStore];
  }
}

window.changeStore = async function() {
  const storeSelector = document.getElementById("storeSelector");
  const newStore = storeSelector.value;
  
  // Don't save if nothing selected
  if (!newStore) {
    return;
  }
  
  if (newStore !== currentStore) {
    currentStore = newStore;
    isSorted = false; // Reset sorted flag when changing store
    saveToLocalStorage();
    if (isOnline) {
      await persistShoppingChanges({ currentStore: newStore }).catch(() => {});
    }
    const loyaltyBtn = document.getElementById('loyaltyBtn');
    if (loyaltyBtn) loyaltyBtn.disabled = false;
    renderList(); // Re-render list with new store's aisle organization
  }
};

// --- Loyalty Cards ---
function loadLoyaltyCards() {
  try {
    const listEl = document.getElementById("fidelityCardsList");
    if (!listEl) return;

    if (!loyaltyCards.length) {
      listEl.innerHTML = '<div class="fidelity-card-empty">Aucune carte ajoutée pour le moment.</div>';
      return;
    }

    listEl.innerHTML = loyaltyCards.map(card => `
      <div class="fidelity-card-item" onclick="openLoyaltyCard('${card.id}')">
        ${card.logo ? `<img class="fidelity-card-logo" src="${card.logo}" alt="Carte ${card.name}">` : '<div class="fidelity-card-logo" style="display:flex;align-items:center;justify-content:center;font-size:20px;">🏪</div>'}
        <div class="fidelity-card-content">
          <div class="fidelity-card-title">${card.name}</div>
          <div class="fidelity-card-subtitle">Voir la carte</div>
        </div>
        <button class="fidelity-card-remove" onclick="event.stopPropagation(); deleteLoyaltyCard('${card.id}')">✕</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error rendering loyalty cards:', err);
  }
}

window.openFidelityCardDialog = function() {
  const modal = document.getElementById('fidelityCardModal');
  if (modal) {
    document.getElementById('fidelityStoreNameInput').value = '';
    document.getElementById('fidelityLogoInput').value = '';
    modal.classList.add('show');
  }
};

window.closeFidelityCardDialog = function() {
  const modal = document.getElementById('fidelityCardModal');
  if (modal) {
    modal.classList.remove('show');
  }
};

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

window.saveFidelityCard = async function() {
  const name = document.getElementById('fidelityStoreNameInput').value.trim();
  const fileInput = document.getElementById('fidelityLogoInput');
  const file = fileInput?.files?.[0];

  if (!name) {
    alert('Veuillez entrer le nom du magasin.');
    return;
  }

  if (!file) {
    alert('Veuillez ajouter une photo de la carte.');
    return;
  }

  try {
    const logo = await readFileAsDataUrl(file);

    loyaltyCards.unshift({
      id: Date.now().toString(),
      name,
      logo
    });

    saveToLocalStorage();
    if (isOnline) {
      await persistShoppingChanges({ loyaltyCards }).catch(() => {});
    }
    loadLoyaltyCards();
    closeFidelityCardDialog();
  } catch (err) {
    console.error('Error saving loyalty card:', err);
    alert('Erreur lors de l\'enregistrement de la carte.');
  }
};

window.openLoyaltyCard = function(cardId) {
  const card = loyaltyCards.find(item => item.id === cardId);
  if (!card) return;

  const modal = document.getElementById('fidelityCardPreviewModal');
  if (!modal) return;

  const previewImage = document.getElementById('fidelityCardPreviewImage');
  const previewTitle = document.getElementById('fidelityCardPreviewTitle');
  const deleteButton = document.getElementById('deleteFidelityCardButton');

  previewTitle.textContent = card.name;
  deleteButton.dataset.cardId = card.id;

  if (card.logo) {
    previewImage.src = card.logo;
    previewImage.style.display = 'block';
  } else {
    previewImage.src = '';
    previewImage.style.display = 'none';
  }

  modal.classList.add('show');
};

window.closeLoyaltyCardPreview = function() {
  const modal = document.getElementById('fidelityCardPreviewModal');
  if (modal) {
    modal.classList.remove('show');
  }
};

window.deleteLoyaltyCard = async function(cardId) {
  if (!cardId) return;

  if (!confirm('Supprimer cette carte de fidélité ?')) return;

  loyaltyCards = loyaltyCards.filter(card => card.id !== cardId);
  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ loyaltyCards }).catch(() => {});
  }
  loadLoyaltyCards();
  closeLoyaltyCardPreview();
};

window.toggleFullScreenImage = async function(imageId) {
  const imageEl = document.getElementById(imageId);
  if (!imageEl) return;

  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else if (imageEl.requestFullscreen) {
    await imageEl.requestFullscreen();
  }
};

// --- Google Gemini AI Sorting ---
async function callGeminiAPI(prompt) {
  try {
    if (!currentUser) throw new Error("Reconnectez-vous pour utiliser le tri IA.");
    const token = await currentUser.getIdToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

    let response;
    try {
      response = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ message: prompt }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch {
        errorData.error = "Réponse serveur invalide.";
      }
      
      if (response.status === 429) {
        throw new Error("Trop de demandes. Attendez 1-2 minutes avant de réessayer.");
      } else if (response.status === 401 || response.status === 403) {
        throw new Error("Votre session ne permet pas d'utiliser le tri IA. Reconnectez-vous.");
      } else if (response.status === 503) {
        throw new Error(errorData.error && errorData.error !== "The server could not complete this request."
          ? errorData.error
          : "Service Gemini indisponible. Vérifiez GOOGLE_API_KEY et GEMINI_MODEL dans Vercel.");
      } else if (response.status === 502) {
        throw new Error(errorData.error && errorData.error !== "The server could not complete this request."
          ? errorData.error
          : "Gemini n’a pas pu terminer le tri. Vérifiez les journaux de l’API sur Vercel.");
      } else if (response.status === 500) {
        throw new Error("Erreur interne de l’API. Vérifiez les journaux Vercel.");
      } else if (response.status === 400) {
        throw new Error("Requête invalide. Vérifiez les rayons du magasin.");
      } else if (response.status === 413) {
        throw new Error("La liste est trop longue pour être triée par IA en une seule demande.");
      } else {
        throw new Error(`Erreur API ${response.status}: ${errorData.error || 'erreur inconnue'}`);
      }
    }

    const result = await response.json();
    
    if (!result.reply && !result.choices && !result.generated_text) {
      throw new Error("Réponse API vide. Réessayez.");
    }
    
    return result.reply || result.choices?.[0]?.message?.content || result.generated_text || "";
  } catch (error) {
    console.error("Gemini error:", error);
    
    let userMessage = "Erreur lors de l'appel à l'IA";
    if (error.name === "AbortError") {
      userMessage = "Délai d'attente dépassé (45s). Vérifiez votre connexion.";
    } else {
      userMessage = error.message;
    }
    
    alert(userMessage);
    return null;
  }
}

window.sortListWithAI = async function() {
  try {
    // Throttle: max 1 sort per 30 seconds
    const now = Date.now();
    if (now - lastAISortTime < 30000) {
      const waitTime = Math.ceil((30000 - (now - lastAISortTime)) / 1000);
      alert(`Veuillez attendre ${waitTime}s avant de trier à nouveau.`);
      return;
    }
    lastAISortTime = now;
    
    if (!currentStore || !storesData[currentStore]) {
      alert("Veuillez sélectionner un magasin d'abord.");
      return;
    }

    if (itemsArray.length === 0) {
      alert("La liste est vide. Ajoutez des articles avant de trier.");
      return;
    }

    const selectedStoreName = currentStore;
    const storeAisles = Array.isArray(storesData[selectedStoreName].aisles)
      ? storesData[selectedStoreName].aisles
      : [];
    let selectedStorePreferences = sortingPreferences[selectedStoreName] || {};
    if (isOnline) {
      selectedStorePreferences = await loadSortingPreferences(selectedStoreName);
    }

    const items = itemsArray.map(it => it.name).join("\n");
    const aisles = storeAisles.join(", ");
    
    const systemPrompt = `Tu es un assistant de tri de liste de courses spécialisé.
Tâche: Trier la liste d'articles selon l'ordre des rayons du magasin.
Rayons disponibles (dans cet ordre): ${aisles}

Instructions:
- Une ligne par article
- Format: [Rayon] Nom de l'article
- Si un article ne correspond à aucun rayon, utilise [Autre]
- Pas de numérotation, pas d'explications
- Suis strictement l'ordre des rayons fournis`;

    const completePrompt = `${systemPrompt}\n\nListe à trier:\n${items}`;

    document.getElementById("sortBtn").disabled = true;
    document.getElementById("sortBtn").textContent = "Tri en cours...";

    const result = await callGeminiAPI(completePrompt);
    
    document.getElementById("sortBtn").disabled = false;
    document.getElementById("sortBtn").textContent = "🤖 Trier";

    if (!result) return;

    // Parse the result
    const sortedItems = result
      .split("\n")
      .filter(line => line.trim())
      .map(line => {
        const match = line.match(/\[([^\]]+)\]\s*(.*)/);
        return {
          aisle: match ? match[1] : "Autre",
          name: match ? match[2].trim() : line.trim()
        };
      });

    // Rebuild items in the exact order returned by the sorting assistant
    const orderedItems = [];
    const usedIndices = new Set();

    sortedItems.forEach(sortedItem => {
      const targetIndex = itemsArray.findIndex((item, idx) => {
        return !usedIndices.has(idx) &&
          normalizeSortingItemKey(item.name) === normalizeSortingItemKey(sortedItem.name);
      });
      if (targetIndex >= 0) {
        usedIndices.add(targetIndex);
        const newAisle = sortedItem.aisle || itemsArray[targetIndex].aisle || "Autre";
        orderedItems.push({
          ...itemsArray[targetIndex],
          aisle: newAisle
        });
        
      }
    });

    // Append any remaining items not found in assistant output
    itemsArray.forEach((item, idx) => {
      if (!usedIndices.has(idx)) {
        orderedItems.push({
          ...item,
          aisle: item.aisle || "Autre"
        });
      }
    });

    itemsArray = applySortingPreferences(
      orderedItems,
      { [selectedStoreName]: selectedStorePreferences },
      selectedStoreName,
      storeAisles
    );

    saveToLocalStorage();
    if (isOnline) {
      await persistShoppingChanges({ items: itemsArray }).catch(() => {});
    }
    isSorted = true; // Set sorted flag to true after successful sort
    renderList();
  } catch (error) {
    console.error("Error in sortListWithAI:", error);
    alert(`Une erreur est survenue lors du tri : ${error.message}`);
    document.getElementById("sortBtn").disabled = false;
    document.getElementById("sortBtn").textContent = "🤖 Trier";
  }
};

// --- Edit Mode (Drag & Drop) ---
window.toggleEditMode = function() {
  if (!currentStore || !storesData[currentStore]) {
    alert("Sélectionnez un magasin avant de modifier l'ordre des articles.");
    return;
  }
  editingStoreName = currentStore;
  editMode = true;
  const editBtn = document.getElementById("editBtn");
  const sortBtn = document.getElementById("sortBtn");
  const confirmBtn = document.getElementById("confirmEditBtn");
  const addButton = document.querySelector('.add-button');
  const itemInput = document.getElementById('item');
  const storeSelector = document.getElementById("storeSelector");
  
  if (editBtn) editBtn.hidden = true;
  if (sortBtn) {
    sortBtn.hidden = true;
    sortBtn.disabled = true;
  }
  if (confirmBtn) confirmBtn.hidden = false;
  if (storeSelector) storeSelector.disabled = true;
  if (addButton) addButton.disabled = true;
  if (itemInput) {
    itemInput.disabled = true;
    itemInput.placeholder = "Impossible d'ajouter en mode édition";
  }
  
  const list = document.getElementById("list");
  if (list) list.classList.add("edit-mode");
  renderList(); // Re-render to show aisle headers
  enableDragDrop();
};

window.confirmEditMode = async function() {
  const storeName = editingStoreName;
  editMode = false;
  editingStoreName = null;
  isSorted = false; // Reset sorted flag when exiting edit mode
  const editBtn = document.getElementById("editBtn");
  const sortBtn = document.getElementById("sortBtn");
  const confirmBtn = document.getElementById("confirmEditBtn");
  const addButton = document.querySelector('.add-button');
  const itemInput = document.getElementById('item');
  const storeSelector = document.getElementById("storeSelector");
  
  if (confirmBtn) confirmBtn.hidden = true;
  if (storeSelector) storeSelector.disabled = false;
  if (editBtn) editBtn.hidden = false;
  if (sortBtn) {
    sortBtn.hidden = false;
    sortBtn.disabled = false;
  }
  if (addButton) addButton.disabled = false;
  if (itemInput) {
    itemInput.disabled = false;
    itemInput.placeholder = "Nom de l'article";
  }
  
  const list = document.getElementById("list");
  if (list) list.classList.remove("edit-mode");
  disableDragDrop();
  
  saveToLocalStorage();
  if (isOnline) {
    try {
      await persistShoppingChanges({ items: itemsArray });
    } catch (error) {
      console.error("Error saving edited shopping items:", error);
    }
    try {
      await syncPendingSortingPreferences();
    } catch (error) {
      console.error("Error saving edited sorting preferences:", error);
      alert(`Les préférences de tri restent en attente de synchronisation : ${error.message}`);
    }
  } else if (pendingSortingPreferences.some(entry => entry.storeName === storeName)) {
    alert("Les corrections de tri sont conservées sur cet appareil et seront envoyées à Firebase dès le retour de la connexion.");
  }
  
  renderList(); // Re-render to hide aisle headers
};

let draggedItem = null;

function enableDragDrop() {
  const items = document.querySelectorAll("#list .item");
  const aisleHeaders = document.querySelectorAll("#list .aisle-drop-zone");
  
  if (!items || items.length === 0) return; // Guard: no items to enable
  
  items.forEach(item => {
    item.draggable = true;
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragend", handleDragEnd);
    item.addEventListener("dragover", handleDragOverItem);
    item.addEventListener("drop", handleDropOnItem);
  });
  
  // Make aisle headers drop zones
  aisleHeaders.forEach(header => {
    header.addEventListener("dragover", handleDragOverAisle);
    header.addEventListener("drop", handleDropOnAisle);
    header.addEventListener("dragleave", handleDragLeave);
  });
}

function disableDragDrop() {
  const items = document.querySelectorAll("#list .item");
  const aisleHeaders = document.querySelectorAll("#list .aisle-drop-zone");
  
  items.forEach(item => {
    item.draggable = false;
    item.classList.remove("dragging"); // Clean up dragging class
    item.removeEventListener("dragstart", handleDragStart);
    item.removeEventListener("dragend", handleDragEnd);
    item.removeEventListener("dragover", handleDragOverItem);
    item.removeEventListener("drop", handleDropOnItem);
  });
  
  aisleHeaders.forEach(header => {
    header.classList.remove("drag-over"); // Clean up drag-over class
    header.removeEventListener("dragover", handleDragOverAisle);
    header.removeEventListener("drop", handleDropOnAisle);
    header.removeEventListener("dragleave", handleDragLeave);
  });
  
  draggedItem = null; // Reset dragged item
}

function handleDragStart(e) {
  draggedItem = this;
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}

function handleDragOverAisle(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  this.classList.add("drag-over");
  return false;
}

function handleDragLeave(e) {
  if (e.target === this) {
    this.classList.remove("drag-over");
  }
}

function handleDragOverItem(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

function handleDropOnItem(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
  if (draggedItem && draggedItem.classList.contains("item")) {
    const draggedIndex = Number.parseInt(draggedItem.dataset.index, 10);
    const dropTarget = e.target.closest(".item");
    
    if (dropTarget && dropTarget !== draggedItem) {
      const targetIndex = Number.parseInt(dropTarget.dataset.index, 10);
      
      if (Number.isInteger(draggedIndex) && Number.isInteger(targetIndex)) {
        const targetRect = dropTarget.getBoundingClientRect();
        const placement = e.clientY < targetRect.top + targetRect.height / 2 ? "before" : "after";
        const result = moveItemRelativeTo(
          itemsArray,
          itemsArray[draggedIndex]?.id,
          itemsArray[targetIndex]?.id,
          placement
        );
        if (!result) return false;
        itemsArray = result.items;
        queueSortingPreference(editingStoreName, result.preference);
        saveToLocalStorage();
        renderList();
      }
    }
  }

  return false;
}

function handleDropOnAisle(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
  this.classList.remove("drag-over");
  
  if (draggedItem && draggedItem.classList.contains("item")) {
    const draggedIndex = Number.parseInt(draggedItem.dataset.index, 10);
    const targetAisle = this.dataset.aisle;
    
    if (Number.isInteger(draggedIndex) && targetAisle && itemsArray[draggedIndex]) {
      const result = moveItemToAisleEnd(
        itemsArray,
        itemsArray[draggedIndex].id,
        targetAisle
      );
      if (!result) return false;
      itemsArray = result.items;
      queueSortingPreference(editingStoreName, result.preference);
      saveToLocalStorage();
      renderList();
    }
  }

  return false;
}

function handleDragEnd(e) {
  this.classList.remove("dragging");
  document.querySelectorAll("#list .aisle-drop-zone").forEach(header => {
    header.classList.remove("drag-over");
  });
  draggedItem = null;
}

// --- Shopping List Management ---
const ul = document.getElementById("list");
const input = document.getElementById("item");
const optionsMenu = document.getElementById("optionsMenu");

function renderList() {
  // Guard: verify DOM element exists
  if (!ul) {
    console.error("ul element not found");
    return;
  }
  
  ul.innerHTML = "";
  
  // Guard: verify itemsArray is an array
  if (!Array.isArray(itemsArray)) {
    console.error("itemsArray is not an array");
    itemsArray = [];
    return;
  }
  
  // Group by aisle if available
  let groupedItems = {};
  itemsArray.forEach((item, index) => {
    // Guard: skip invalid items
    if (!item || !item.name) return;
    
    let aisle = getCanonicalAisle((item.aisle && item.aisle.trim()) || "Autre") || "Autre";
    
    if (!groupedItems[aisle]) groupedItems[aisle] = [];
    groupedItems[aisle].push({ item, index });
  });

  // If editing, show grouped by aisle for drag/drop into categories
  if (editMode) {
    const aislePriority = currentStore && storesData[currentStore] 
      ? storesData[currentStore].aisles.reduce((acc, aisle, idx) => {
          acc[aisle] = idx;
          return acc;
        }, {})
      : {};

    // Show ALL aisles from the store in edit mode, with Autre first
    let allAisles = [];
    if (currentStore && storesData[currentStore]) {
      // Use store aisles in their order
      allAisles = [...storesData[currentStore].aisles];
    }
    
    if (!allAisles.includes("Autre")) {
      allAisles.unshift("Autre");
    } else {
      allAisles = ["Autre", ...allAisles.filter(a => a !== "Autre")];
    }

    // Track which items have been rendered
    let renderedIndices = new Set();

    allAisles.forEach(aisle => {
      // Add aisle header as drop zone
      const header = document.createElement("li");
      header.className = "aisle-header aisle-drop-zone";
      header.dataset.aisle = aisle;
      header.textContent = aisle;
      ul.appendChild(header);

      // Add items in this aisle - using groupedItems which already has them sorted
      if (groupedItems[aisle]) {
        // Sort items within each aisle by their original order
        const sortedAisleItems = groupedItems[aisle].sort((a, b) => a.index - b.index);
        sortedAisleItems.forEach(({ item, index }) => {
          renderListItem(item, index);
          renderedIndices.add(index);
        });
      }
    });

    // Add any items that weren't assigned to any aisle
    itemsArray.forEach((item, index) => {
      if (!renderedIndices.has(index) && item && item.name) {
        renderListItem(item, index);
        renderedIndices.add(index);
      }
    });
  } else {
    // Normal view: show items ordered by category according to the store's aisle order
    // with "Autre" displayed first.
    let aisles = [];
    if (currentStore && storesData[currentStore] && Array.isArray(storesData[currentStore].aisles)) {
      const normalizedAisles = storesData[currentStore].aisles
        .map(a => a.trim())
        .filter(a => a);
      aisles = ['Autre', ...normalizedAisles.filter(a => a.toLowerCase() !== 'autre')];
    } else {
      aisles = ['Autre'];
    }

    // Add any other aisles that exist in groupedItems but aren't listed in the store definition
    Object.keys(groupedItems).forEach(a => {
      if (!aisles.includes(a)) aisles.push(a);
    });

    // Render items for each aisle in the computed order
    aisles.forEach(aisle => {
      if (groupedItems[aisle]) {
        groupedItems[aisle].forEach(({ item, index }) => {
          renderListItem(item, index);
        });
      }
    });
  }

  if (editMode) {
    enableDragDrop();
  }
}

function renderListItem(item, index) {
  let li = document.createElement("li");
  li.className = "item";
  if (item.bought) li.classList.add("bought");
  if (item.notFound) li.classList.add("not-found");
  li.dataset.index = index;

  const itemLeft = document.createElement("div");
  itemLeft.className = "item-left";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "small-checkbox";
  checkbox.checked = Boolean(item.bought);
  const content = document.createElement("div");
  content.className = "item-content";
  content.textContent = item.name;
  itemLeft.append(checkbox, content);

  if (item.aisle) {
    const aisle = document.createElement("span");
    aisle.className = "aisle-badge item-category";
    aisle.textContent = item.aisle;
    itemLeft.appendChild(aisle);
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";
  const notFound = document.createElement("button");
  notFound.className = "action-icon-btn not-found-button";
  notFound.type = "button";
  notFound.textContent = "🚫";
  const remove = document.createElement("button");
  remove.className = "action-icon-btn delete-item";
  remove.type = "button";
  remove.textContent = "❌";
  actions.append(notFound, remove);
  li.append(itemLeft, actions);

  checkbox.onclick = () => window.toggleBought(index);
  content.onclick = () => window.toggleBought(index);
  notFound.onclick = () => window.toggleNotFound(index);
  remove.onclick = () => window.deleteItem(index);

  ul.appendChild(li);
}

window.addItem = async function() {
  try {
    if (editMode) {
      alert("Impossible d'ajouter un article en mode édition. Confirmez d'abord les modifications.");
      return;
    }

    const inputElement = document.getElementById("item");
    if (!inputElement) {
      console.error("Item input element not found");
      return;
    }

    const val = inputElement.value.trim();
    
    if (!val) {
      alert("Veuillez entrer le nom d'un article.");
      return;
    }
    
    if (val.length > 100) {
      alert("Le nom de l'article est trop long (max 100 caractères).");
      return;
    }
    if (itemsArray.length >= 500) {
      alert("La liste est limitée à 500 articles.");
      return;
    }
    
    // Guard: verify itemsArray is an array
    if (!Array.isArray(itemsArray)) {
      console.error("itemsArray is not an array");
      itemsArray = [];
    }
    
    // Check for duplicates
    if (itemsArray.some(item => item && item.name && item.name.toLowerCase() === val.toLowerCase() && !item.bought)) {
      alert("Cet article est déjà dans la liste.");
      return;
    }
    
    // Suggest the learned aisle for this store only.
    let suggestedAisle = null;
    const itemKey = normalizeSortingItemKey(val);
    const learnedPreference = currentStore && sortingPreferences[currentStore]?.[itemKey];
    if (learnedPreference?.aisle) {
      suggestedAisle = getCanonicalAisle(learnedPreference.aisle);
    }
    
    itemsArray.push({
      id: crypto.randomUUID(),
      name: val,
      bought: false,
      notFound: false,
      aisle: suggestedAisle
    });
    isSorted = false; // Reset sorted flag when adding an item
    saveToLocalStorage();
    
    if (isOnline) {
      await persistShoppingChanges({ items: itemsArray }).catch(() => {});
    }
    
    inputElement.value = "";
    inputElement.focus();
    renderList();
  } catch (error) {
    console.error("Error adding item:", error);
    alert("Erreur lors de l'ajout de l'article. Réessayez.");
  }
};

window.toggleBought = async function(i) {
  // Guard: verify index is valid and item exists
  if (i < 0 || i >= itemsArray.length || !itemsArray[i]) {
    console.error("Invalid item index:", i);
    return;
  }
  
  itemsArray[i].bought = !itemsArray[i].bought;
  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ items: itemsArray }).catch(() => {});
  }
  renderList();
};

window.toggleNotFound = async function(i) {
  // Guard: verify index is valid and item exists
  if (i < 0 || i >= itemsArray.length || !itemsArray[i]) {
    console.error("Invalid item index:", i);
    return;
  }
  
  itemsArray[i].notFound = !itemsArray[i].notFound;
  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ items: itemsArray }).catch(() => {});
  }
  renderList();
};

window.deleteItem = async function(i) {
  // Guard: verify index is valid and item exists
  if (i < 0 || i >= itemsArray.length || !itemsArray[i]) {
    console.error("Invalid item index:", i);
    return;
  }
  
  if (!confirm("Es-tu sûr de vouloir supprimer cet article ?")) return;
  itemsArray.splice(i, 1);
  isSorted = false; // Reset sorted flag when deleting an item
  saveToLocalStorage();
  if (isOnline) {
    await persistShoppingChanges({ items: itemsArray }).catch(() => {});
  }
};

window.clearList = async function() {
  try {
    // Guard: verify itemsArray is an array
    if (!Array.isArray(itemsArray)) {
      itemsArray = [];
    }
    
    const notFoundItems = itemsArray.filter(it => it && it.notFound);
    const hasOtherItems = itemsArray.some(it => it && !it.notFound);
    
    if (notFoundItems.length > 0 && hasOtherItems) {
      if (confirm("Les articles non trouvés seront conservés. Supprimer le reste ?")) {
        itemsArray = itemsArray.filter(it => it && it.notFound);
        isSorted = false; // Reset sorted flag when clearing list
        saveToLocalStorage();
        if (isOnline) {
          await persistShoppingChanges({ items: itemsArray }).catch(() => {});
        }
        renderList();
      }
    } else if (hasOtherItems) {
      if (confirm("Supprimer toute la liste ?")) {
        itemsArray = [];
        saveToLocalStorage();
        if (isOnline) {
          await persistShoppingChanges({ items: itemsArray }).catch(() => {});
        }
        renderList();
      }
    } else {
      alert("La liste est déjà vide !");
    }
  } catch (error) {
    console.error("Error clearing list:", error);
    alert("Erreur lors du vidage de la liste. Réessayez.");
  }
};

window.downloadList = function() {
  // Filter out bought items and items already found
  let itemsToDownload = itemsArray.filter(it => it && !it.bought && !it.notFound);
  let text = itemsToDownload.map(it => `${it.aisle ? `[${it.aisle}] ` : ""}${it.name}`).join("\n");
  let blob = new Blob([text], { type: 'text/plain' });
  let a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "shopping-list.txt";
  a.click();
  URL.revokeObjectURL(a.href);
};

window.printList = function() {
  let printWindow = window.open('', '', 'width=800,height=600');
  printWindow.document.write('<html><head><title>Liste</title><style>body{font-family:Arial,sans-serif;font-size:18px;padding:20px;}ul{padding-left:20px;}li{margin-bottom:10px;}h1{text-align:center;}.aisle{font-weight:bold;color:#1E5631;margin-top:15px;}</style></head><body>');
  printWindow.document.write('<h1>Liste de Courses</h1><ul>');
  
  // Filter out bought items and items not found
  let itemsToPrint = itemsArray.filter(it => it && !it.bought && !it.notFound);
  
  // Group by aisle respecting store order
  let aisles = [];
  if (currentStore && storesData[currentStore] && Array.isArray(storesData[currentStore].aisles)) {
    aisles = ['Autre', ...storesData[currentStore].aisles.filter(a => a.toLowerCase() !== 'autre')];
  } else {
    aisles = ['Autre'];
  }
  
  // Add any other aisles that exist but aren't in the store definition
  itemsToPrint.forEach(it => {
    if (it.aisle && !aisles.includes(it.aisle)) aisles.push(it.aisle);
  });
  
  aisles.forEach(aisle => {
    const itemsInAisle = itemsToPrint.filter(it => (it.aisle || "Autre") === aisle);
    if (itemsInAisle.length > 0) {
      printWindow.document.write(`<li class="aisle"><strong>${aisle}</strong></li>`);
      itemsInAisle.forEach(it => {
        printWindow.document.write(`<li>${it.name}</li>`);
      });
    }
  });
  
  printWindow.document.write('</ul></body></html>');
  printWindow.document.close();
  printWindow.print();
};

window.shareList = function() {
  let text = itemsArray.map(it => `${it.aisle ? `[${it.aisle}] ` : ""}${it.name}`).join("\n");
  if (navigator.share) {
    navigator.share({ title: 'Liste de Courses', text: `Voici ma liste de courses :\n${text}` }).catch(console.error);
  } else alert("Partage non supporté sur ce navigateur.");
};

window.loadFile = async function(e) {
  let file = e.target.files[0];
  if (!file) return;
  let reader = new FileReader();
  reader.onload = async function(ev) {
    let lines = ev.target.result.split("\n")
      .map(n => {
        const match = n.match(/\[([^\]]+)\]\s*(.*)/);
        return {
          id: crypto.randomUUID(),
          name: match ? match[2].trim() : n.trim(),
          aisle: match ? match[1] : null,
          bought: false,
          notFound: false
        };
      })
      .filter(n => n.name);
    if (itemsArray.length + lines.length > 500 || lines.some(item => item.name.length > 100)) {
      alert("Le fichier dépasse les limites de la liste (500 articles, 100 caractères par nom).");
      e.target.value = "";
      return;
    }
    itemsArray.push(...lines);
    saveToLocalStorage();
    if (isOnline) {
      await persistShoppingChanges({ items: itemsArray }).catch(() => {});
    }
    renderList();
  };
  reader.readAsText(file);
};

window.toggleOptionsMenu = function() {
  const menu = document.getElementById("optionsMenu");
  if (!menu) return;
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
};

window.openProfileSettings = function() {
  document.getElementById("optionsMenu").style.display = "none";
  document.getElementById("profileDisplayName").value = userProfile?.displayName || "";
  document.getElementById("profileSettingsStatus").hidden = true;
  document.getElementById("profileSettingsModal").classList.add("show");
};

window.closeProfileSettings = function() {
  document.getElementById("profileSettingsModal").classList.remove("show");
};

async function refreshUsersList() {
  const { users } = await callAuthenticatedApi("/api/admin/users", null, "GET");
  const list = document.getElementById("usersList");
  list.replaceChildren();
  for (const user of users) {
    const row = document.createElement("div");
    row.className = "admin-user-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = user.displayName || user.email;
    const details = document.createElement("span");
    details.textContent = `${user.email} · ${user.active ? "Actif" : "Désactivé"}${user.mustChangePassword ? " · Mot de passe à modifier" : ""}`;
    info.append(name, details);
    row.appendChild(info);

    if (user.role !== "admin") {
      const actions = document.createElement("div");
      actions.className = "admin-user-actions";
      const toggle = document.createElement("button");
      toggle.className = "btn-cancel";
      toggle.type = "button";
      toggle.textContent = user.active ? "Désactiver" : "Réactiver";
      toggle.addEventListener("click", async () => {
        const action = user.active ? "Désactiver" : "Réactiver";
        if (!confirm(`${action} le compte de ${user.displayName || user.email} ?`)) return;
        toggle.disabled = true;
        try {
          await callAuthenticatedApi("/api/admin/users", { uid: user.uid, active: !user.active }, "PATCH");
          await refreshUsersList();
        } catch (error) {
          alert(error.message);
          toggle.disabled = false;
        }
      });

      const remove = document.createElement("button");
      remove.className = "btn-delete";
      remove.type = "button";
      remove.textContent = "Supprimer";
      remove.addEventListener("click", async () => {
        if (!confirm(`Supprimer définitivement le compte de ${user.displayName || user.email} ? Cette action est irréversible.`)) return;
        remove.disabled = true;
        try {
          await callAuthenticatedApi("/api/admin/users", { uid: user.uid }, "DELETE");
          console.info("[admin/users] Member account deleted from the management screen.");
        } catch (error) {
          console.error("[admin/users] Member account deletion failed:", error.message);
          alert(error.message);
          remove.disabled = false;
          return;
        }
        try {
          await refreshUsersList();
        } catch (error) {
          console.error("[admin/users] Member deleted, but refreshing the list failed:", error.message);
          alert(`Le compte a été supprimé, mais la liste n'a pas pu être actualisée : ${error.message}`);
        }
      });
      actions.append(toggle, remove);
      row.appendChild(actions);
    }
    list.appendChild(row);
  }
}

window.openUsersManager = async function() {
  document.getElementById("optionsMenu").style.display = "none";
  clearTemporaryPasswordNotice();
  document.getElementById("usersModal").classList.add("show");
  try {
    await refreshUsersList();
  } catch (error) {
    alert(error.message);
  }
};

window.closeUsersManager = function() {
  clearTemporaryPasswordNotice();
  document.getElementById("usersModal").classList.remove("show");
};

function clearTemporaryPasswordNotice() {
  document.getElementById("temporaryPasswordNotice").hidden = true;
  const password = document.getElementById("temporaryPasswordValue");
  password.value = "";
  password.type = "password";
  const toggleButton = document.getElementById("toggleTemporaryPasswordButton");
  toggleButton.textContent = "Afficher";
  toggleButton.setAttribute("aria-pressed", "false");
}

// Close options menu on click outside
document.addEventListener('click', function(e) {
  const container = document.querySelector('.options-container');
  if (container && !container.contains(e.target) && optionsMenu) {
    optionsMenu.style.display = 'none';
  }
});

// --- Keyboard & Mobile Improvements ---
// Allow pressing Enter to add an item
if (input) {
  input.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      if (editMode) {
        e.preventDefault();
        return;
      }
      window.addItem();
    }
  });
}

// Prevent dragging behavior on mobile for non-edit items
document.addEventListener('touchstart', function(e) {
  if (e.target && e.target.classList && e.target.classList.contains('item') && !editMode) {
    // Don't prevent default for touchstart with passive: true
  }
}, { passive: true });

// Improve checkbox tapping on mobile
if (ul) {
  ul.addEventListener('touchstart', function(e) {
    const checkbox = e.target.closest('.small-checkbox');
    const itemContent = e.target.closest('.item-content');
    const button = e.target.closest('button');
    
    if (checkbox || itemContent || button) {
      e.preventDefault();
    }
  }, { passive: true });
}
