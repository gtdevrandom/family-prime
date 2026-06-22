import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, updateDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// === Logger Utility ===
const Logger = {
  info: (msg, data) => console.log(`✅ [INFO] ${msg}`, data || ''),
  error: (msg, err) => console.error(`❌ [ERROR] ${msg}`, err || ''),
  warn: (msg, data) => console.warn(`⚠️ [WARN] ${msg}`, data || ''),
  debug: (msg, data) => console.debug(`🔍 [DEBUG] ${msg}`, data || '')
};

const firebaseConfig = {
  apiKey: "AIzaSyBGyhISFdzVklC1K7Y3TNyQpQ-QJWUXPIo",
  authDomain: "shopngo-2008.firebaseapp.com",
  projectId: "shopngo-2008",
  storageBucket: "shopngo-2008.firebasestorage.app",
  messagingSenderId: "931959995203",
  appId: "1:931959995203:web:f06465bad7af5899868df6",
  measurementId: "G-CJ2KZ8DCS6"
};

Logger.info("Initializing Firebase", firebaseConfig.projectId);

// Global application authentication guard applied to the entire app setup
function checkAuth() {
  Logger.debug("Checking authentication");
  if (localStorage.getItem("auth") === "true") {
    const loginScreen = document.getElementById("loginScreen");
    const appContainer = document.getElementById("appContainer");
    if (loginScreen) {
      loginScreen.style.display = "none";
      Logger.info("Auth check passed - hiding login");
    }
    if (appContainer) {
      appContainer.classList.add("show");
      Logger.info("App container shown");
    }
    return true;
  }
  Logger.warn("Auth check failed - user not logged in");
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
  Logger.info("DOM loaded - checking auth");
  checkAuth();
});

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ref = doc(db, "lists", "shopping");

Logger.info("Firebase initialized", { app: app.name, db: db.app?.name });

// Global state
let itemsArray = [];
let calendarEventsArray = [];
let storesData = {};
let currentStore = null;
let editMode = false;
let promptHistory = [];

// --- Dynamic Firestore Live Sync for all features ---
const unsubscribe = onSnapshot(ref, snap => {
  try {
    const data = snap.data() || {};
    itemsArray = data.items || [];
    calendarEventsArray = data.calendarEvents || [];
    storesData = data.stores || {};
    currentStore = data.currentStore || null;
    promptHistory = data.promptHistory || [];
    
    Logger.debug("Firestore data synced", {
      items: itemsArray.length,
      events: calendarEventsArray.length,
      stores: Object.keys(storesData).length,
      currentStore
    });
    
    // Si pas de magasin sélectionné mais qu'il y en a, en sélectionner un
    if (!currentStore && Object.keys(storesData).length > 0) {
      const firstStore = Object.keys(storesData)[0];
      currentStore = firstStore;
      Logger.info("Auto-selecting first store", { store: firstStore });
      updateDoc(ref, { currentStore: firstStore }).catch(err => Logger.error("Error setting currentStore", err));
    }
    
    renderList();
    renderCalendar();
    updateStoreSelector();
  } catch (error) {
    Logger.error("Error in onSnapshot listener", error);
  }
}, error => {
  Logger.error("Firestore listener error", error);
});

// --- Authentication Logic ---
async function hashSHA256(str) {
  try {
    const enc = new TextEncoder().encode(str);
    const buff = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buff)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    Logger.error("Hash error", error);
    throw error;
  }
}

const loginBtn = document.querySelector("#loginBtn");
if (loginBtn) {
  loginBtn.addEventListener("click", async () => {
    const pwd = document.querySelector("#password")?.value;
    const errorEl = document.querySelector("#error");
    
    if (!pwd) {
      Logger.warn("Login attempt - empty password");
      if (errorEl) errorEl.textContent = "Veuillez entrer un mot de passe.";
      return;
    }

    try {
      Logger.info("Login attempt");
      const authRef = doc(db, "config", "auth");
      const snap = await getDoc(authRef);
      
      if (!snap.exists()) {
        throw new Error("Auth config not found in database");
      }
      
      const authData = snap.data();
      const salt = authData?.salt;
      const rightHash = authData?.passwordHash;
      
      if (!salt || !rightHash) {
        throw new Error("Invalid auth config");
      }

      const userHash = await hashSHA256(salt + pwd);

      if (userHash === rightHash) {
        Logger.info("Login successful");
        localStorage.setItem("auth", "true");
        checkAuth();
      } else {
        Logger.warn("Login failed - incorrect password");
        if (errorEl) errorEl.classList.add("show");
      }
    } catch (err) {
      Logger.error("Auth error", err);
      if (errorEl) {
        errorEl.textContent = "Erreur de connexion: " + (err.message || "Erreur inconnue");
        errorEl.classList.add("show");
      }
    }
  });
}

// --- Tab Switch System ---
window.switchTab = function(tabName) {
  Logger.debug("Switching tab", { tab: tabName });
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const tabEl = document.getElementById(`tab-${tabName}`);
  if (tabEl) {
    tabEl.classList.add('active');
  } else {
    Logger.warn("Tab element not found", { tab: tabName });
  }
  
  const idx = ['calendrier', 'courses'].indexOf(tabName);
  if (idx >= 0) {
    document.querySelectorAll('.nav-item')[idx]?.classList.add('active');
  }
};

// --- Calendar Management Features ---
window.addCalendarEvent = async function() {
  try {
    const dateVal = document.getElementById("calendarDateInput")?.value;
    const nameVal = document.getElementById("calendarEventInput")?.value.trim();
    
    Logger.debug("Adding calendar event", { date: dateVal, name: nameVal });
    
    if (!dateVal || !nameVal) {
      Logger.warn("Invalid calendar event input");
      alert("Veuillez remplir la date et le nom de l'événement.");
      return;
    }
    
    calendarEventsArray.push({ date: dateVal, name: nameVal });
    await updateDoc(ref, { calendarEvents: calendarEventsArray });
    Logger.info("Calendar event added");
    
    const inputEl = document.getElementById("calendarEventInput");
    if (inputEl) inputEl.value = "";
  } catch (error) {
    Logger.error("Error adding calendar event", error);
    alert("Erreur lors de l'ajout de l'événement.");
  }
};

window.deleteCalendarEvent = async function(index) {
  if (!confirm("Supprimer cet événement ?")) return;
  
  try {
    Logger.debug("Deleting calendar event", { index });
    calendarEventsArray.splice(index, 1);
    await updateDoc(ref, { calendarEvents: calendarEventsArray });
    Logger.info("Calendar event deleted");
  } catch (error) {
    Logger.error("Error deleting calendar event", error);
  }
};

function renderCalendar() {
  try {
    const listEl = document.getElementById("calendarEventsList");
    if (!listEl) {
      Logger.warn("Calendar events list element not found");
      return;
    }
    
    listEl.innerHTML = "";
    const sortedEvents = [...calendarEventsArray].sort((a, b) => new Date(a.date) - new Date(b.date));
    Logger.debug("Rendering calendar", { events: sortedEvents.length });

    sortedEvents.forEach((evt) => {
      const originalIndex = calendarEventsArray.findIndex(item => item === evt);
      
      let li = document.createElement("li");
      li.className = "item";
      
      const dateObj = new Date(evt.date);
      const formattedDate = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

      li.innerHTML = `
        <div class="item-left">
          <div style="font-size: 18px; margin-right: 4px;">📌</div>
          <div class="item-content"><strong>${formattedDate}</strong> : ${evt.name}</div>
        </div>
        <button class="action-icon-btn delete-item" onclick="deleteCalendarEvent(${originalIndex})">❌</button>
      `;
      listEl.appendChild(li);
    });
  } catch (error) {
    Logger.error("Error rendering calendar", error);
  }
}

// --- Store Management ---
window.openStoreSettings = function() {
  try {
    const modal = document.getElementById("storeSettingsModal");
    const storeList = document.getElementById("storeList");
    
    if (!modal || !storeList) {
      Logger.warn("Store settings modal or list not found");
      return;
    }
    
    Logger.debug("Opening store settings", { stores: Object.keys(storesData).length });
    storeList.innerHTML = "";
    
    Object.keys(storesData).forEach(storeName => {
      const storeDiv = document.createElement("div");
      storeDiv.className = "store-item";
      storeDiv.innerHTML = `
        <div class="store-info">
          <h4>${storeName}</h4>
          <p class="aisles-text">${storesData[storeName].aisles.join(" • ")}</p>
        </div>
        <div class="store-actions">
          <button class="action-icon-btn" onclick="openEditStoreDialog('${storeName}')">✏️</button>
          <button class="action-icon-btn delete-item" onclick="deleteStore('${storeName}')">❌</button>
        </div>
      `;
      storeList.appendChild(storeDiv);
    });
    
    modal.classList.add("show");
  } catch (error) {
    Logger.error("Error opening store settings", error);
  }
};

window.openAddStoreDialog = function() {
  try {
    const titleEl = document.getElementById("storeDialogTitle");
    const nameInput = document.getElementById("storeNameInput");
    const aislesInput = document.getElementById("aislesInput");
    const modal = document.getElementById("storeDialogModal");
    
    if (!titleEl || !nameInput || !aislesInput || !modal) {
      Logger.warn("Store dialog elements not found");
      return;
    }
    
    Logger.debug("Opening add store dialog");
    titleEl.textContent = "Ajouter un magasin";
    nameInput.value = "";
    aislesInput.value = "";
    nameInput.dataset.editMode = "false";
    modal.classList.add("show");
  } catch (error) {
    Logger.error("Error opening add store dialog", error);
  }
};

window.openEditStoreDialog = function(storeName) {
  try {
    const titleEl = document.getElementById("storeDialogTitle");
    const nameInput = document.getElementById("storeNameInput");
    const aislesInput = document.getElementById("aislesInput");
    const modal = document.getElementById("storeDialogModal");
    
    if (!titleEl || !nameInput || !aislesInput || !modal) {
      Logger.warn("Store dialog elements not found");
      return;
    }
    
    Logger.debug("Opening edit store dialog", { store: storeName });
    const store = storesData[storeName];
    if (!store) {
      Logger.warn("Store not found", { store: storeName });
      return;
    }
    
    titleEl.textContent = `Éditer ${storeName}`;
    nameInput.value = storeName;
    nameInput.dataset.editMode = "true";
    nameInput.dataset.originalName = storeName;
    aislesInput.value = store.aisles.join(", ");
    modal.classList.add("show");
  } catch (error) {
    Logger.error("Error opening edit store dialog", error);
  }
};

window.closeStoreSettings = function() {
  const modal = document.getElementById("storeSettingsModal");
  if (modal) modal.classList.remove("show");
};

window.closeStoreDialog = function() {
  const modal = document.getElementById("storeDialogModal");
  if (modal) modal.classList.remove("show");
};

window.saveStore = async function() {
  try {
    const nameInput = document.getElementById("storeNameInput");
    const aislesInput = document.getElementById("aislesInput");
    
    if (!nameInput || !aislesInput) {
      Logger.warn("Store input elements not found");
      return;
    }
    
    const storeName = nameInput.value.trim();
    const aislesText = aislesInput.value.trim();
    const isEditMode = nameInput.dataset.editMode === "true";
    const originalName = nameInput.dataset.originalName;
    
    Logger.debug("Saving store", { name: storeName, isEdit: isEditMode });
    
    if (!storeName) {
      alert("Veuillez entrer un nom de magasin.");
      return;
    }
    
    if (!aislesText) {
      alert("Veuillez entrer au moins un rayon.");
      return;
    }
    
    const aisles = aislesText.split(",").map(a => a.trim()).filter(a => a);
    
    if (isEditMode) {
      if (storeName !== originalName && storesData[storeName]) {
        Logger.warn("Store already exists", { store: storeName });
        alert("Ce magasin existe déjà.");
        return;
      }
      
      if (storeName !== originalName) {
        delete storesData[originalName];
        if (currentStore === originalName) {
          currentStore = storeName;
        }
      }
    } else {
      if (storesData[storeName]) {
        Logger.warn("Store already exists", { store: storeName });
        alert("Ce magasin existe déjà.");
        return;
      }
    }
    
    storesData[storeName] = {
      aisles: aisles,
      createdAt: new Date().getTime()
    };
    
    if (!currentStore) {
      currentStore = storeName;
    }
    
    await updateDoc(ref, { stores: storesData, currentStore });
    Logger.info("Store saved", { store: storeName, aisles: aisles.length });
    updateStoreSelector();
    
    closeStoreDialog();
    openStoreSettings();
  } catch (error) {
    Logger.error("Error saving store", error);
    alert("Erreur lors de la sauvegarde du magasin.");
  }
};

window.deleteStore = async function(storeName) {
  if (!confirm(`Supprimer le magasin "${storeName}" ?`)) return;
  
  try {
    Logger.debug("Deleting store", { store: storeName });
    delete storesData[storeName];
    
    if (currentStore === storeName) {
      currentStore = Object.keys(storesData)[0] || null;
      Logger.info("Current store switched", { newStore: currentStore });
    }
    
    await updateDoc(ref, { stores: storesData, currentStore });
    Logger.info("Store deleted");
    openStoreSettings();
  } catch (error) {
    Logger.error("Error deleting store", error);
  }
};

function updateStoreSelector() {
  try {
    const storeSelector = document.getElementById("storeSelector");
    if (!storeSelector) {
      Logger.warn("Store selector not found");
      return;
    }
    
    Logger.debug("Updating store selector", { stores: Object.keys(storesData).length });
    storeSelector.innerHTML = '<option value="">-- Choisir un magasin --</option>';
    
    Object.keys(storesData).forEach(storeName => {
      const option = document.createElement("option");
      option.value = storeName;
      option.text = storeName;
      if (storeName === currentStore) option.selected = true;
      storeSelector.appendChild(option);
    });
  } catch (error) {
    Logger.error("Error updating store selector", error);
  }
}

window.changeStore = async function() {
  try {
    const storeSelector = document.getElementById("storeSelector");
    if (!storeSelector) {
      Logger.warn("Store selector not found");
      return;
    }
    
    const newStore = storeSelector.value;
    Logger.debug("Store changed", { newStore });
    
    if (!newStore) {
      return;
    }
    
    if (newStore !== currentStore) {
      currentStore = newStore;
      await updateDoc(ref, { currentStore: newStore });
      Logger.info("Current store updated");
    }
  } catch (error) {
    Logger.error("Error changing store", error);
  }
};

// --- Google Gemini AI Sorting ---
let lastApiCallTime = 0;
const API_CALL_DELAY = 2000;

async function callGeminiAPI(prompt) {
  try {
    Logger.info("Calling Gemini API", { promptLength: prompt.length });
    
    const timeSinceLastCall = Date.now() - lastApiCallTime;
    if (timeSinceLastCall < API_CALL_DELAY) {
      const waitTime = API_CALL_DELAY - timeSinceLastCall;
      Logger.debug("Rate limiting - waiting", { waitMs: waitTime });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastApiCallTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    Logger.debug("API response received", { status: response.status });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 429) {
        throw new Error("Trop de demandes. Attendez 1-2 minutes avant de réessayer.");
      } else if (response.status === 500 || response.status === 503) {
        throw new Error("Service IA indisponible. Vérifiez votre clé API Gemini sur Vercel.");
      } else if (response.status === 400) {
        throw new Error("Requête invalide. Vérifiez les rayons du magasin.");
      } else {
        throw new Error(`Erreur API ${response.status}: ${errorData.error || 'erreur inconnue'}`);
      }
    }

    const result = await response.json();
    Logger.debug("API result parsed", { hasReply: !!result.reply });
    
    if (!result.reply && !result.choices && !result.generated_text) {
      throw new Error("Réponse API vide. Réessayez.");
    }
    
    return result.reply || result.choices?.[0]?.message?.content || result.generated_text || "";
  } catch (error) {
    Logger.error("Gemini API error", error);
    
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
    Logger.info("Sort with AI started");
    
    if (!currentStore || !storesData[currentStore]) {
      Logger.warn("No store selected");
      alert("Veuillez sélectionner un magasin d'abord.");
      return;
    }

    if (itemsArray.length === 0) {
      Logger.warn("List is empty");
      alert("La liste est vide. Ajoutez des articles avant de trier.");
      return;
    }

    const items = itemsArray.map(it => it.name).join("\n");
    const aisles = storesData[currentStore].aisles.join(", ");
    
    Logger.debug("Sorting with AI", { items: itemsArray.length, aisles: storesData[currentStore].aisles.length });
    
    let systemPrompt = `Tu es un assistant de tri de liste de courses spécialisé.
Tâche: Trier la liste d'articles selon l'ordre des rayons du magasin.
Rayons disponibles (dans cet ordre): ${aisles}

Instructions:
- Une ligne par article
- Format: [Rayon] Nom de l'article
- Si un article ne correspond à aucun rayon, utilise [Autre]
- Pas de numérotation, pas d'explications
- Suis strictement l'ordre des rayons fournis`;

    if (promptHistory.length > 0) {
      systemPrompt += `\n\nExemples de placements corrects (historique):`;
      promptHistory.slice(-3).forEach((entry) => {
        systemPrompt += `\n- ${entry.item} -> [${entry.aisle}]`;
      });
    }

    systemPrompt += `\n\nListe à trier:\n${items}`;

    const sortBtn = document.getElementById("sortBtn");
    if (sortBtn) {
      sortBtn.disabled = true;
      sortBtn.textContent = "Tri en cours...";
    }

    const result = await callGeminiAPI(systemPrompt);
    
    if (sortBtn) {
      sortBtn.disabled = false;
      sortBtn.textContent = "🤖 Trier";
    }

    if (!result) {
      Logger.warn("Empty result from Gemini");
      return;
    }

    Logger.debug("Parsing AI response", { responseLength: result.length });

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

    Logger.debug("Sorted items parsed", { count: sortedItems.length });

    itemsArray = itemsArray.map(item => {
      const sortedItem = sortedItems.find(si => si.name.toLowerCase() === item.name.toLowerCase());
      return {
        ...item,
        aisle: sortedItem ? sortedItem.aisle : item.aisle || "Autre"
      };
    });

    const aislePriority = storesData[currentStore].aisles.reduce((acc, aisle, idx) => {
      acc[aisle] = idx;
      return acc;
    }, {});

    itemsArray.sort((a, b) => {
      const priorityA = aislePriority[a.aisle] ?? 999;
      const priorityB = aislePriority[b.aisle] ?? 999;
      return priorityA - priorityB;
    });

    await updateDoc(ref, { items: itemsArray });
    Logger.info("AI sorting completed and saved");
    renderList();
  } catch (error) {
    Logger.error("Error in sortListWithAI", error);
    alert("Une erreur est survenue lors du tri. Veuillez réessayer.");
    const sortBtn = document.getElementById("sortBtn");
    if (sortBtn) {
      sortBtn.disabled = false;
      sortBtn.textContent = "🤖 Trier";
    }
  }
};

// --- Edit Mode (Drag & Drop) ---
window.toggleEditMode = function() {
  try {
    Logger.debug("Toggle edit mode", { newMode: true });
    editMode = true;
    const editBtn = document.getElementById("editBtn");
    const sortBtn = document.getElementById("sortBtn");
    const confirmBtn = document.getElementById("confirmEditBtn");
    
    if (editBtn) editBtn.hidden = true;
    if (sortBtn) {
      sortBtn.hidden = true;
      sortBtn.disabled = true;
    }
    if (confirmBtn) confirmBtn.hidden = false;
    
    const list = document.getElementById("list");
    if (list) list.classList.add("edit-mode");
    enableDragDrop();
  } catch (error) {
    Logger.error("Error toggling edit mode", error);
  }
};

window.confirmEditMode = async function() {
  try {
    Logger.debug("Confirm edit mode");
    editMode = false;
    const editBtn = document.getElementById("editBtn");
    const sortBtn = document.getElementById("sortBtn");
    const confirmBtn = document.getElementById("confirmEditBtn");
    
    if (confirmBtn) confirmBtn.hidden = true;
    if (editBtn) editBtn.hidden = false;
    if (sortBtn) {
      sortBtn.hidden = false;
      sortBtn.disabled = false;
    }
    
    const list = document.getElementById("list");
    if (list) list.classList.remove("edit-mode");
    disableDragDrop();
    
    await updateDoc(ref, { items: itemsArray });
    Logger.info("Edit mode saved");
  } catch (error) {
    Logger.error("Error saving edit mode", error);
  }
};

let draggedItem = null;

function enableDragDrop() {
  try {
    const items = document.querySelectorAll("#list .item");
    Logger.debug("Enabling drag-drop", { itemCount: items.length });
    items.forEach(item => {
      item.draggable = true;
      item.addEventListener("dragstart", handleDragStart);
      item.addEventListener("dragover", handleDragOver);
      item.addEventListener("drop", handleDrop);
      item.addEventListener("dragend", handleDragEnd);
    });
  } catch (error) {
    Logger.error("Error enabling drag-drop", error);
  }
}

function disableDragDrop() {
  try {
    const items = document.querySelectorAll("#list .item");
    Logger.debug("Disabling drag-drop", { itemCount: items.length });
    items.forEach(item => {
      item.draggable = false;
      item.removeEventListener("dragstart", handleDragStart);
      item.removeEventListener("dragover", handleDragOver);
      item.removeEventListener("drop", handleDrop);
      item.removeEventListener("dragend", handleDragEnd);
    });
  } catch (error) {
    Logger.error("Error disabling drag-drop", error);
  }
}

function handleDragStart(e) {
  draggedItem = this;
  this.style.opacity = "0.5";
  Logger.debug("Drag started");
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (draggedItem !== this) {
    try {
      const allItems = Array.from(document.querySelectorAll("#list .item"));
      const draggedIndex = allItems.indexOf(draggedItem);
      const targetIndex = allItems.indexOf(this);
      
      Logger.debug("Dropping item", { from: draggedIndex, to: targetIndex });
      
      if (draggedIndex >= 0 && targetIndex >= 0 && draggedIndex < itemsArray.length && targetIndex < itemsArray.length) {
        [itemsArray[draggedIndex], itemsArray[targetIndex]] = [itemsArray[targetIndex], itemsArray[draggedIndex]];
        
        const draggedItemData = itemsArray[targetIndex];
        if (draggedItemData.aisle) {
          promptHistory.push({
            item: draggedItemData.name,
            aisle: draggedItemData.aisle,
            timestamp: new Date().toISOString()
          });
          if (promptHistory.length > 50) promptHistory.shift();
        }
        
        updateDoc(ref, { items: itemsArray, promptHistory });
        Logger.info("Item reordered");
        renderList();
      } else {
        Logger.warn("Invalid drag indices", { draggedIndex, targetIndex, arrayLength: itemsArray.length });
      }
    } catch (error) {
      Logger.error("Error handling drop", error);
    }
  }

  return false;
}

function handleDragEnd(e) {
  this.style.opacity = "1";
  Logger.debug("Drag ended");
}

// --- Shopping List Management ---
const ul = document.getElementById("list");
const input = document.getElementById("item");
const optionsMenu = document.getElementById("optionsMenu");

function renderList() {
  try {
    if (!ul) {
      Logger.warn("List element not found");
      return;
    }
    
    Logger.debug("Rendering list", { items: itemsArray.length });
    ul.innerHTML = "";
    
    let groupedItems = {};
    itemsArray.forEach((item, index) => {
      const aisle = item.aisle || "Autre";
      if (!groupedItems[aisle]) groupedItems[aisle] = [];
      groupedItems[aisle].push({ item, index });
    });

    if (editMode) {
      itemsArray.forEach((item, index) => {
        renderListItem(item, index);
      });
    } else {
      const aislePriority = currentStore && storesData[currentStore] 
        ? storesData[currentStore].aisles.reduce((acc, aisle, idx) => {
            acc[aisle] = idx;
            return acc;
          }, {})
        : {};

      const aisles = Object.keys(groupedItems).sort((a, b) => {
        const priorityA = aislePriority[a] ?? 999;
        const priorityB = aislePriority[b] ?? 999;
        return priorityA - priorityB;
      });

      aisles.forEach(aisle => {
        const header = document.createElement("li");
        header.className = "aisle-header";
        header.textContent = aisle;
        ul.appendChild(header);

        groupedItems[aisle].forEach(({ item, index }) => {
          renderListItem(item, index);
        });
      });
    }

    if (editMode) {
      enableDragDrop();
    }
  } catch (error) {
    Logger.error("Error rendering list", error);
  }
}

function renderListItem(item, index) {
  try {
    let li = document.createElement("li");
    li.className = "item";
    if (item.bought) li.classList.add("bought");
    if (item.notFound) li.classList.add("not-found");
    li.dataset.index = index;

    li.innerHTML = `
      <div class="item-left">
        <input type="checkbox" class="small-checkbox" ${item.bought ? "checked" : ""}>
        <div class="item-content">${item.name}</div>
        ${item.aisle ? `<span class="aisle-badge">${item.aisle}</span>` : ""}
      </div>
      <div class="item-actions">
        <button class="action-icon-btn not-found-button">🚫</button>
        <button class="action-icon-btn delete-item">❌</button>
      </div>
    `;

    const checkbox = li.querySelector(".small-checkbox");
    const content = li.querySelector(".item-content");
    const notFoundBtn = li.querySelector(".not-found-button");
    const deleteBtn = li.querySelector(".delete-item");
    
    if (checkbox) checkbox.onclick = () => window.toggleBought(index);
    if (content) content.onclick = () => window.toggleBought(index);
    if (notFoundBtn) notFoundBtn.onclick = () => window.toggleNotFound(index);
    if (deleteBtn) deleteBtn.onclick = () => window.deleteItem(index);

    ul.appendChild(li);
  } catch (error) {
    Logger.error("Error rendering list item", error);
  }
}

window.addItem = async function() {
  try {
    if (!input) {
      Logger.warn("Input element not found");
      return;
    }
    
    const val = input.value.trim();
    Logger.debug("Adding item", { name: val });
    
    if (!val) {
      Logger.warn("Empty item name");
      alert("Veuillez entrer le nom d'un article.");
      return;
    }
    
    if (val.length > 100) {
      Logger.warn("Item name too long", { length: val.length });
      alert("Le nom de l'article est trop long (max 100 caractères).");
      return;
    }
    
    if (itemsArray.some(item => item.name.toLowerCase() === val.toLowerCase() && !item.bought)) {
      Logger.warn("Duplicate item");
      alert("Cet article est déjà dans la liste.");
      return;
    }
    
    itemsArray.push({ name: val, bought: false, notFound: false, aisle: null });
    await updateDoc(ref, { items: itemsArray });
    Logger.info("Item added");
    input.value = "";
    input.focus();
  } catch (error) {
    Logger.error("Error adding item", error);
    alert("Erreur lors de l'ajout de l'article. Réessayez.");
  }
};

window.toggleBought = async function(i) {
  try {
    Logger.debug("Toggling bought", { index: i });
    itemsArray[i].bought = !itemsArray[i].bought;
    await updateDoc(ref, { items: itemsArray });
  } catch (error) {
    Logger.error("Error toggling bought", error);
  }
};

window.toggleNotFound = async function(i) {
  try {
    Logger.debug("Toggling not found", { index: i });
    itemsArray[i].notFound = !itemsArray[i].notFound;
    await updateDoc(ref, { items: itemsArray });
  } catch (error) {
    Logger.error("Error toggling not found", error);
  }
};

window.deleteItem = async function(i) {
  if (!confirm("Es-tu sûr de vouloir supprimer cet article ?")) return;
  
  try {
    Logger.debug("Deleting item", { index: i });
    itemsArray.splice(i, 1);
    await updateDoc(ref, { items: itemsArray });
    Logger.info("Item deleted");
  } catch (error) {
    Logger.error("Error deleting item", error);
  }
};

window.clearList = async function() {
  try {
    Logger.debug("Clearing list");
    const notFoundItems = itemsArray.filter(it => it.notFound);
    if (notFoundItems.length > 0) {
      if (confirm("Les non trouvés seront conservés, supprimer le reste ?")) {
        itemsArray = itemsArray.filter(it => it.notFound);
        await updateDoc(ref, { items: itemsArray });
        Logger.info("List cleared (keeping not found items)");
      }
    } else if (confirm("Supprimer toute la liste ?")) {
      itemsArray = [];
      await updateDoc(ref, { items: itemsArray });
      Logger.info("List cleared");
    }
  } catch (error) {
    Logger.error("Error clearing list", error);
  }
};

window.downloadList = function() {
  try {
    Logger.debug("Downloading list");
    let text = itemsArray.map(it => `${it.aisle ? `[${it.aisle}] ` : ""}${it.name}`).join("\n");
    let blob = new Blob([text], { type: 'text/plain' });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "shopping-list.txt";
    a.click();
    URL.revokeObjectURL(a.href);
    Logger.info("List downloaded");
  } catch (error) {
    Logger.error("Error downloading list", error);
  }
};

window.printList = function() {
  try {
    Logger.debug("Printing list");
    let printWindow = window.open('', '', 'width=800,height=600');
    printWindow.document.write('<html><head><title>Liste</title><style>body{font-family:Arial,sans-serif;font-size:18px;padding:20px;}ul{padding-left:20px;}li{margin-bottom:10px;}h1{text-align:center;}.aisle{font-weight:bold;color:#1E5631;margin-top:15px;}</style></head><body>');
    printWindow.document.write('<h1>Liste de Courses</h1><ul>');
    
    let currentAisle = null;
    itemsArray.forEach(it => {
      if (it.aisle !== currentAisle) {
        if (currentAisle !== null) printWindow.document.write('</ul><ul>');
        printWindow.document.write(`<li class="aisle"><strong>${it.aisle || "Autre"}</strong></li>`);
        currentAisle = it.aisle;
      }
      printWindow.document.write(`<li>${it.name}</li>`);
    });
    
    printWindow.document.write('</ul></body></html>');
    printWindow.document.close();
    printWindow.print();
    Logger.info("List printed");
  } catch (error) {
    Logger.error("Error printing list", error);
  }
};

window.shareList = function() {
  try {
    Logger.debug("Sharing list");
    let text = itemsArray.map(it => `${it.aisle ? `[${it.aisle}] ` : ""}${it.name}`).join("\n");
    if (navigator.share) {
      navigator.share({ title: 'Liste de Courses', text: `Voici ma liste de courses :\n${text}` })
        .then(() => Logger.info("List shared"))
        .catch(err => Logger.warn("Share cancelled", err));
    } else {
      Logger.warn("Share not supported");
      alert("Partage non supporté sur ce navigateur.");
    }
  } catch (error) {
    Logger.error("Error sharing list", error);
  }
};

window.loadFile = async function(e) {
  try {
    Logger.debug("Loading file");
    let file = e.target.files[0];
    if (!file) {
      Logger.warn("No file selected");
      return;
    }
    
    let reader = new FileReader();
    reader.onload = function(ev) {
      try {
        let lines = ev.target.result.split("\n")
          .map(n => {
            const match = n.match(/\[([^\]]+)\]\s*(.*)/);
            return {
              name: match ? match[2].trim() : n.trim(),
              aisle: match ? match[1] : null,
              bought: false,
              notFound: false
            };
          })
          .filter(n => n.name);
        itemsArray.push(...lines);
        updateDoc(ref, { items: itemsArray });
        Logger.info("File loaded", { items: lines.length });
      } catch (error) {
        Logger.error("Error processing loaded file", error);
      }
    };
    reader.readAsText(file);
  } catch (error) {
    Logger.error("Error loading file", error);
  }
};

window.toggleOptionsMenu = function() {
  try {
    if (optionsMenu) {
      optionsMenu.style.display = optionsMenu.style.display === 'block' ? 'none' : 'block';
      Logger.debug("Options menu toggled");
    }
  } catch (error) {
    Logger.error("Error toggling options menu", error);
  }
};

document.addEventListener('click', function(e) {
  try {
    const container = document.querySelector('.options-container');
    if (container && !container.contains(e.target) && optionsMenu) {
      optionsMenu.style.display = 'none';
    }
  } catch (error) {
    Logger.error("Error closing options menu", error);
  }
});

if (input) {
  input.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      window.addItem();
    }
  });
}

document.addEventListener('touchstart', function(e) {
  if (e.target && e.target.classList && e.target.classList.contains('item') && !editMode) {
    // passive event
  }
}, { passive: true });

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

Logger.info("App initialized successfully");

// --- Dynamic Firestore Live Sync for all features ---
onSnapshot(ref, snap => {
  const data = snap.data() || {};
  itemsArray = data.items || [];
  calendarEventsArray = data.calendarEvents || [];
  storesData = data.stores || {};
  currentStore = data.currentStore || null;
  promptHistory = data.promptHistory || [];
  
  // Si pas de magasin sélectionné mais qu'il y en a, en sélectionner un
  if (!currentStore && Object.keys(storesData).length > 0) {
    const firstStore = Object.keys(storesData)[0];
    currentStore = firstStore;
    updateDoc(ref, { currentStore: firstStore }).catch(err => console.error("Error setting currentStore:", err));
  }
  
  renderList();
  renderCalendar();
  updateStoreSelector();
});

// --- Authentication Logic ---
async function hashSHA256(str) {
  const enc = new TextEncoder().encode(str);
  const buff = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buff)).map(b => b.toString(16).padStart(2, '0')).join('');
}

document.querySelector("#loginBtn").addEventListener("click", async () => {
  const pwd = document.querySelector("#password").value;
  try {
    const authRef = doc(db, "config", "auth");
    const snap = await getDoc(authRef);
    const salt = snap.data().salt;
    const rightHash = snap.data().passwordHash;

    const userHash = await hashSHA256(salt + pwd);

    if (userHash === rightHash) {
      localStorage.setItem("auth", "true");
      checkAuth();
    } else {
      document.querySelector("#error").classList.add("show");
    }
  } catch (err) {
    console.error("Auth error:", err);
    document.querySelector("#error").textContent = "Erreur de connexion.";
    document.querySelector("#error").classList.add("show");
  }
});

// --- Tab Switch System ---
window.switchTab = function(tabName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  document.getElementById(`tab-${tabName}`).classList.add('active');
  
  const idx = ['calendrier', 'courses'].indexOf(tabName);
  document.querySelectorAll('.nav-item')[idx].classList.add('active');
};

// --- Calendar Management Features ---
window.addCalendarEvent = async function() {
  const dateVal = document.getElementById("calendarDateInput").value;
  const nameVal = document.getElementById("calendarEventInput").value.trim();
  if (!dateVal || !nameVal) {
    alert("Veuillez remplir la date et le nom de l'événement.");
    return;
  }
  
  calendarEventsArray.push({ date: dateVal, name: nameVal });
  await updateDoc(ref, { calendarEvents: calendarEventsArray });
  document.getElementById("calendarEventInput").value = "";
};

window.deleteCalendarEvent = async function(index) {
  if (!confirm("Supprimer cet événement ?")) return;
  calendarEventsArray.splice(index, 1);
  await updateDoc(ref, { calendarEvents: calendarEventsArray });
};

function renderCalendar() {
  const listEl = document.getElementById("calendarEventsList");
  listEl.innerHTML = "";
  
  const sortedEvents = [...calendarEventsArray].sort((a,b) => new Date(a.date) - new Date(b.date));

  sortedEvents.forEach((evt) => {
    const originalIndex = calendarEventsArray.findIndex(item => item === evt);
    
    let li = document.createElement("li");
    li.className = "item";
    
    const dateObj = new Date(evt.date);
    const formattedDate = dateObj.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

    li.innerHTML = `
      <div class="item-left">
        <div style="font-size: 18px; margin-right: 4px;">📌</div>
        <div class="item-content"><strong>${formattedDate}</strong> : ${evt.name}</div>
      </div>
      <button class="action-icon-btn delete-item" onclick="deleteCalendarEvent(${originalIndex})">❌</button>
    `;
    listEl.appendChild(li);
  });
}

// --- Store Management ---
window.openStoreSettings = function() {
  const modal = document.getElementById("storeSettingsModal");
  const storeList = document.getElementById("storeList");
  storeList.innerHTML = "";
  
  Object.keys(storesData).forEach(storeName => {
    const storeDiv = document.createElement("div");
    storeDiv.className = "store-item";
    storeDiv.innerHTML = `
      <div class="store-info">
        <h4>${storeName}</h4>
        <p class="aisles-text">${storesData[storeName].aisles.join(" • ")}</p>
      </div>
      <div class="store-actions">
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
  
  if (isEditMode) {
    // Editing existing store
    if (storeName !== originalName && storesData[storeName]) {
      alert("Ce magasin existe déjà.");
      return;
    }
    
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
  }
  
  storesData[storeName] = {
    aisles: aisles,
    createdAt: new Date().getTime()
  };
  
  // Si c'est le premier magasin ou si on n'a pas de magasin sélectionné, on le sélectionne
  if (!currentStore) {
    currentStore = storeName;
  }
  
  await updateDoc(ref, { stores: storesData, currentStore });
  updateStoreSelector();
  
  closeStoreDialog();
  openStoreSettings(); // Refresh the store list
};

window.deleteStore = async function(storeName) {
  if (!confirm(`Supprimer le magasin "${storeName}" ?`)) return;
  
  delete storesData[storeName];
  
  if (currentStore === storeName) {
    currentStore = Object.keys(storesData)[0] || null;
  }
  
  await updateDoc(ref, { stores: storesData, currentStore });
  openStoreSettings(); // Refresh the store list
};

function updateStoreSelector() {
  const storeSelector = document.getElementById("storeSelector");
  if (!storeSelector) return;
  
  storeSelector.innerHTML = '<option value="">-- Choisir un magasin --</option>';
  
  Object.keys(storesData).forEach(storeName => {
    const option = document.createElement("option");
    option.value = storeName;
    option.text = storeName;
    if (storeName === currentStore) option.selected = true;
    storeSelector.appendChild(option);
  });
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
    await updateDoc(ref, { currentStore: newStore });
  }
};

// --- Google Gemini AI Sorting ---
let lastApiCallTime = 0;
const API_CALL_DELAY = 2000; // 2 seconds between calls

async function callGeminiAPI(prompt) {
  try {
    // Rate limiting: wait at least 2 seconds between calls
    const timeSinceLastCall = Date.now() - lastApiCallTime;
    if (timeSinceLastCall < API_CALL_DELAY) {
      await new Promise(resolve => setTimeout(resolve, API_CALL_DELAY - timeSinceLastCall));
    }
    lastApiCallTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45 second timeout

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message: prompt
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      if (response.status === 429) {
        throw new Error("Trop de demandes. Attendez 1-2 minutes avant de réessayer.");
      } else if (response.status === 500 || response.status === 503) {
        throw new Error("Service IA indisponible. Vérifiez votre clé API Gemini sur Vercel.");
      } else if (response.status === 400) {
        throw new Error("Requête invalide. Vérifiez les rayons du magasin.");
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
    if (!currentStore || !storesData[currentStore]) {
      alert("Veuillez sélectionner un magasin d'abord.");
      return;
    }

    if (itemsArray.length === 0) {
      alert("La liste est vide. Ajoutez des articles avant de trier.");
      return;
    }

    const items = itemsArray.map(it => it.name).join("\n");
    const aisles = storesData[currentStore].aisles.join(", ");
    
    let systemPrompt = `Tu es un assistant de tri de liste de courses spécialisé.
Tâche: Trier la liste d'articles selon l'ordre des rayons du magasin.
Rayons disponibles (dans cet ordre): ${aisles}

Instructions:
- Une ligne par article
- Format: [Rayon] Nom de l'article
- Si un article ne correspond à aucun rayon, utilise [Autre]
- Pas de numérotation, pas d'explications
- Suis strictement l'ordre des rayons fournis`;

    if (promptHistory.length > 0) {
      systemPrompt += `\n\nExemples de placements corrects (historique):`;
      promptHistory.slice(-3).forEach((entry) => {
        systemPrompt += `\n- ${entry.item} -> [${entry.aisle}]`;
      });
    }

    systemPrompt += `\n\nListe à trier:\n${items}`;

    document.getElementById("sortBtn").disabled = true;
    document.getElementById("sortBtn").textContent = "Tri en cours...";

    const result = await callGeminiAPI(systemPrompt);
    
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

    // Update items with aisle information
    itemsArray = itemsArray.map(item => {
      const sortedItem = sortedItems.find(si => si.name.toLowerCase() === item.name.toLowerCase());
      return {
        ...item,
        aisle: sortedItem ? sortedItem.aisle : item.aisle || "Autre"
      };
    });

    // Sort by aisle order
    const aislePriority = storesData[currentStore].aisles.reduce((acc, aisle, idx) => {
      acc[aisle] = idx;
      return acc;
    }, {});

    itemsArray.sort((a, b) => {
      const priorityA = aislePriority[a.aisle] ?? 999;
      const priorityB = aislePriority[b.aisle] ?? 999;
      return priorityA - priorityB;
    });

    await updateDoc(ref, { items: itemsArray });
    renderList();
  } catch (error) {
    console.error("Error in sortListWithAI:", error);
    alert("Une erreur est survenue lors du tri. Veuillez réessayer.");
    document.getElementById("sortBtn").disabled = false;
    document.getElementById("sortBtn").textContent = "🤖 Trier";
  }
};

// --- Edit Mode (Drag & Drop) ---
window.toggleEditMode = function() {
  editMode = true;
  const editBtn = document.getElementById("editBtn");
  const sortBtn = document.getElementById("sortBtn");
  const confirmBtn = document.getElementById("confirmEditBtn");
  
  if (editBtn) editBtn.hidden = true;
  if (sortBtn) {
    sortBtn.hidden = true;
    sortBtn.disabled = true;
  }
  if (confirmBtn) confirmBtn.hidden = false;
  
  const list = document.getElementById("list");
  if (list) list.classList.add("edit-mode");
  enableDragDrop();
};

window.confirmEditMode = async function() {
  editMode = false;
  const editBtn = document.getElementById("editBtn");
  const sortBtn = document.getElementById("sortBtn");
  const confirmBtn = document.getElementById("confirmEditBtn");
  
  if (confirmBtn) confirmBtn.hidden = true;
  if (editBtn) editBtn.hidden = false;
  if (sortBtn) {
    sortBtn.hidden = false;
    sortBtn.disabled = false;
  }
  
  const list = document.getElementById("list");
  if (list) list.classList.remove("edit-mode");
  disableDragDrop();
  
  // Sauvegarder l'ordre des articles dans Firestore
  try {
    await updateDoc(ref, { items: itemsArray });
  } catch (error) {
    console.error("Error saving items:", error);
  }
};

let draggedItem = null;

function enableDragDrop() {
  const items = document.querySelectorAll("#list .item");
  items.forEach(item => {
    item.draggable = true;
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);
  });
}

function disableDragDrop() {
  const items = document.querySelectorAll("#list .item");
  items.forEach(item => {
    item.draggable = false;
    item.removeEventListener("dragstart", handleDragStart);
    item.removeEventListener("dragover", handleDragOver);
    item.removeEventListener("drop", handleDrop);
    item.removeEventListener("dragend", handleDragEnd);
  });
}

function handleDragStart(e) {
  draggedItem = this;
  this.style.opacity = "0.5";
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = "move";
  return false;
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }

  if (draggedItem !== this) {
    const draggedIndex = Array.from(document.querySelectorAll("#list .item")).indexOf(draggedItem);
    const targetIndex = Array.from(document.querySelectorAll("#list .item")).indexOf(this);
    
    [itemsArray[draggedIndex], itemsArray[targetIndex]] = [itemsArray[targetIndex], itemsArray[draggedIndex]];
    
    // Update prompt history with the manual correction
    const draggedItemData = itemsArray[targetIndex];
    if (draggedItemData.aisle) {
      promptHistory.push({
        item: draggedItemData.name,
        aisle: draggedItemData.aisle,
        timestamp: new Date().toISOString()
      });
      if (promptHistory.length > 50) promptHistory.shift();
    }
    
    updateDoc(ref, { items: itemsArray, promptHistory });
    renderList();
  }

  return false;
}

function handleDragEnd(e) {
  this.style.opacity = "1";
}

// --- Shopping List Management ---
const ul = document.getElementById("list");
const input = document.getElementById("item");
const optionsMenu = document.getElementById("optionsMenu");

function renderList() {
  ul.innerHTML = "";
  
  // Group by aisle if available
  let groupedItems = {};
  itemsArray.forEach((item, index) => {
    const aisle = item.aisle || "Autre";
    if (!groupedItems[aisle]) groupedItems[aisle] = [];
    groupedItems[aisle].push({ item, index });
  });

  // If editing, show as flat list for drag/drop
  if (editMode) {
    itemsArray.forEach((item, index) => {
      renderListItem(item, index);
    });
  } else {
    // Otherwise group by aisle
    const aislePriority = currentStore && storesData[currentStore] 
      ? storesData[currentStore].aisles.reduce((acc, aisle, idx) => {
          acc[aisle] = idx;
          return acc;
        }, {})
      : {};

    const aisles = Object.keys(groupedItems).sort((a, b) => {
      const priorityA = aislePriority[a] ?? 999;
      const priorityB = aislePriority[b] ?? 999;
      return priorityA - priorityB;
    });

    aisles.forEach(aisle => {
      // Add aisle header
      const header = document.createElement("li");
      header.className = "aisle-header";
      header.textContent = aisle;
      ul.appendChild(header);

      // Add items in this aisle
      groupedItems[aisle].forEach(({ item, index }) => {
        renderListItem(item, index);
      });
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

  li.innerHTML = `
    <div class="item-left">
      <input type="checkbox" class="small-checkbox" ${item.bought ? "checked" : ""}>
      <div class="item-content">${item.name}</div>
      ${item.aisle ? `<span class="aisle-badge">${item.aisle}</span>` : ""}
    </div>
    <div class="item-actions">
      <button class="action-icon-btn not-found-button">🚫</button>
      <button class="action-icon-btn delete-item">❌</button>
    </div>
  `;

  li.querySelector(".small-checkbox").onclick = () => window.toggleBought(index);
  li.querySelector(".item-content").onclick = () => window.toggleBought(index);
  li.querySelector(".not-found-button").onclick = () => window.toggleNotFound(index);
  li.querySelector(".delete-item").onclick = () => window.deleteItem(index);

  ul.appendChild(li);
}

window.addItem = async function() {
  try {
    const val = input.value.trim();
    
    if (!val) {
      alert("Veuillez entrer le nom d'un article.");
      return;
    }
    
    if (val.length > 100) {
      alert("Le nom de l'article est trop long (max 100 caractères).");
      return;
    }
    
    // Check for duplicates
    if (itemsArray.some(item => item.name.toLowerCase() === val.toLowerCase() && !item.bought)) {
      alert("Cet article est déjà dans la liste.");
      return;
    }
    
    itemsArray.push({ name: val, bought: false, notFound: false, aisle: null });
    await updateDoc(ref, { items: itemsArray });
    input.value = "";
    input.focus();
  } catch (error) {
    console.error("Error adding item:", error);
    alert("Erreur lors de l'ajout de l'article. Réessayez.");
  }
};

window.toggleBought = async function(i) {
  itemsArray[i].bought = !itemsArray[i].bought;
  await updateDoc(ref, { items: itemsArray });
};

window.toggleNotFound = async function(i) {
  itemsArray[i].notFound = !itemsArray[i].notFound;
  await updateDoc(ref, { items: itemsArray });
};

window.deleteItem = async function(i) {
  if (!confirm("Es-tu sûr de vouloir supprimer cet article ?")) return;
  itemsArray.splice(i, 1);
  await updateDoc(ref, { items: itemsArray });
};

window.clearList = async function() {
  const notFoundItems = itemsArray.filter(it => it.notFound);
  if (notFoundItems.length > 0) {
    if (confirm("Les non trouvés seront conservés, supprimer le reste ?")) {
      itemsArray = itemsArray.filter(it => it.notFound);
      await updateDoc(ref, { items: itemsArray });
    }
  } else if (confirm("Supprimer toute la liste ?")) {
    itemsArray = [];
    await updateDoc(ref, { items: itemsArray });
  }
};

window.downloadList = function() {
  let text = itemsArray.map(it => `${it.aisle ? `[${it.aisle}] ` : ""}${it.name}`).join("\n");
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
  
  let currentAisle = null;
  itemsArray.forEach(it => {
    if (it.aisle !== currentAisle) {
      if (currentAisle !== null) printWindow.document.write('</ul><ul>');
      printWindow.document.write(`<li class="aisle"><strong>${it.aisle || "Autre"}</strong></li>`);
      currentAisle = it.aisle;
    }
    printWindow.document.write(`<li>${it.name}</li>`);
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
  let reader = new FileReader();
  reader.onload = function(ev) {
    let lines = ev.target.result.split("\n")
      .map(n => {
        const match = n.match(/\[([^\]]+)\]\s*(.*)/);
        return {
          name: match ? match[2].trim() : n.trim(),
          aisle: match ? match[1] : null,
          bought: false,
          notFound: false
        };
      })
      .filter(n => n.name);
    itemsArray.push(...lines);
    updateDoc(ref, { items: itemsArray });
  };
  reader.readAsText(file);
};

window.toggleOptionsMenu = function() {
  optionsMenu.style.display = optionsMenu.style.display === 'block' ? 'none' : 'block';
};

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
