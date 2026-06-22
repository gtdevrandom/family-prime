import { getDoc, doc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { FirestoreOfflineManager } from './firestore-offline.js';

const firebaseConfig = {
  apiKey: "AIzaSyBGyhISFdzVklC1K7Y3TNyQpQ-QJWUXPIo",
  authDomain: "shopngo-2008.firebaseapp.com",
  projectId: "shopngo-2008",
  storageBucket: "shopngo-2008.firebasestorage.app",
  messagingSenderId: "931959995203",
  appId: "1:931959995203:web:f06465bad7af5899868df6",
  measurementId: "G-CJ2KZ8DCS6"
};

// Initialize Firestore with offline persistence
const fm = new FirestoreOfflineManager(firebaseConfig);

// Get database reference (initialized in FirestoreOfflineManager)
const db = fm.db;
const ref = doc(db, "lists", "shopping");

// Global state
let itemsArray = [];
let calendarEventsArray = [];
let storesData = {};
let currentStore = null;
let editMode = false;
let isSorted = false; // Track if list is sorted
let promptHistory = [];
let lastAISortTime = 0; // Throttle AI sorting to max every 30s
let isOnline = navigator.onLine;
let pendingChanges = []; // Queue for offline changes

// Global application authentication guard applied to the entire app setup
function checkAuth() {
  if (localStorage.getItem("auth") === "true") {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("appContainer").classList.add("show");
    return true;
  }
  return false;
}

window.addEventListener('DOMContentLoaded', async () => {
  checkAuth();
  // Wait for Firestore to initialize
  await new Promise(resolve => setTimeout(resolve, 500));
  // Load initial data from localStorage when DOM is ready
  loadFromLocalStorage();
  // Initial render
  if (document.getElementById("list")) {
    renderList();
  }
  if (document.getElementById("calendarEventsList")) {
    renderCalendar();
  }
  updateStoreSelector();
  // Setup real-time listeners
  setupRealtimeListeners();
});

// --- Offline-first state from localStorage ---
function loadFromLocalStorage() {
  try {
    const local = localStorage.getItem('familyPrimeData');
    if (local) {
      const parsed = JSON.parse(local);
      itemsArray = parsed.items || [];
      calendarEventsArray = parsed.calendarEvents || [];
      storesData = parsed.stores || {};
      currentStore = parsed.currentStore || null;
      promptHistory = parsed.promptHistory || [];
    }
  } catch (e) {
    console.warn('Error loading from localStorage:', e);
  }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem('familyPrimeData', JSON.stringify({
      items: itemsArray,
      calendarEvents: calendarEventsArray,
      stores: storesData,
      currentStore: currentStore,
      promptHistory: promptHistory
    }));
  } catch (e) {
    console.warn('Error saving to localStorage:', e);
  }
}

// Load initial data from localStorage (will be called after DOM is ready)
// Note: renderList, renderCalendar, updateStoreSelector will be called after onSnapshot initializes

// --- Setup Real-time Listeners with Firestore Offline Persistence ---
function setupRealtimeListeners() {
  // Listen to shopping list updates
  fm.onDataChange('lists', 'shopping', (data) => {
    if (data) {
      itemsArray = data.items || [];
      calendarEventsArray = data.calendarEvents || [];
      storesData = data.stores || {};
      currentStore = data.currentStore || null;
      promptHistory = data.promptHistory || [];
      
      // Save to localStorage when Firebase updates
      saveToLocalStorage();
      
      // Si pas de magasin sélectionné mais qu'il y en a, en sélectionner un
      if (!currentStore && Object.keys(storesData).length > 0) {
        const firstStore = Object.keys(storesData)[0];
        currentStore = firstStore;
        fm.updateData('lists', 'shopping', { currentStore: firstStore }).catch(err => console.error("Error setting currentStore:", err));
      }
      
      // Update UI
      if (document.getElementById("list")) {
        renderList();
      }
      if (document.getElementById("calendarEventsList")) {
        renderCalendar();
      }
      updateStoreSelector();
    }
  });
}

// --- Network status monitoring ---
window.addEventListener('online', () => {
  isOnline = true;
  console.log('✅ Online: syncing pending changes...');
  // Firestore will automatically sync
});

window.addEventListener('offline', () => {
  isOnline = false;
  console.log('❌ Offline: changes will be queued');
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
  // Remove active from all screens and nav items
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  // Add active to the selected screen
  const screenEl = document.getElementById(`tab-${tabName}`);
  if (screenEl) {
    screenEl.classList.add('active');
  }
  
  // Add active to the correct nav item based on the tabName
  const navItems = document.querySelectorAll('.nav-item');
  if (tabName === 'calendrier' && navItems[1]) {
    navItems[1].classList.add('active');
  } else if (tabName === 'courses' && navItems[0]) {
    navItems[0].classList.add('active');
  }
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
  saveToLocalStorage();
  
  await fm.updateData('lists', 'shopping', { calendarEvents: calendarEventsArray }).catch(err => console.error("Error saving event:", err));
  
  document.getElementById("calendarEventInput").value = "";
};

window.deleteCalendarEvent = async function(index) {
  if (!confirm("Supprimer cet événement ?")) return;
  calendarEventsArray.splice(index, 1);
  saveToLocalStorage();
  
  await fm.updateData('lists', 'shopping', { calendarEvents: calendarEventsArray }).catch(err => console.error("Error deleting event:", err));
};

// --- Auto-delete expired calendar events ---
function cleanExpiredEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const initialCount = calendarEventsArray.length;
  
  calendarEventsArray = calendarEventsArray.filter(evt => {
    const eventDate = new Date(evt.date);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate >= today;
  });
  
  if (calendarEventsArray.length < initialCount) {
    saveToLocalStorage();
    fm.updateData('lists', 'shopping', { calendarEvents: calendarEventsArray }).catch(err => console.error("Error cleaning expired events:", err));
  }
}

// Run cleanup every hour
setInterval(cleanExpiredEvents, 3600000);
// Also run on app start
cleanExpiredEvents();

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
  
  saveToLocalStorage();
  if (isOnline) {
    await fm.updateData('lists', 'shopping', { stores: storesData, currentStore }).catch(err => console.error("Error saving store:", err));
  }
  
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
  
  saveToLocalStorage();
  if (isOnline) {
    await fm.updateData('lists', 'shopping', { stores: storesData, currentStore }).catch(err => console.error("Error deleting store:", err));
  }
  
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
    saveToLocalStorage();
    if (isOnline) {
      await fm.updateData('lists', 'shopping', { currentStore: newStore }).catch(err => console.error("Error changing store:", err));
    }
  }
};

// --- Google Gemini AI Sorting ---
async function callGeminiAPI(prompt) {
  try {
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

    saveToLocalStorage();
    if (isOnline) {
      await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error saving sorted items:", err));
    }
    isSorted = true; // Set sorted flag to true after successful sort
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
  // Check if list is sorted before allowing edit mode
  if (!isSorted) {
    alert("Veuillez d'abord trier la liste avant de l'éditer.");
    return;
  }
  
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
  renderList(); // Re-render to show aisle headers
  enableDragDrop();
};

window.confirmEditMode = async function() {
  editMode = false;
  isSorted = false; // Reset sorted flag when exiting edit mode
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
  
  saveToLocalStorage();
  // Sauvegarder l'ordre des articles dans Firestore
  try {
    if (isOnline) {
      await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error saving items:", err));
    }
  } catch (error) {
    console.error("Error saving items:", error);
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
    // Get the actual index from the data attribute, not DOM position
    const draggedIndex = parseInt(draggedItem.dataset.index);
    const dropTarget = e.target.closest(".item");
    
    if (dropTarget && dropTarget !== draggedItem) {
      const targetIndex = parseInt(dropTarget.dataset.index);
      const targetAisle = itemsArray[targetIndex].aisle;
      
      if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
        itemsArray[draggedIndex].aisle = targetAisle;
        
        // Update prompt history with the manual correction
        promptHistory.push({
          item: itemsArray[draggedIndex].name,
          aisle: targetAisle,
          timestamp: new Date().toISOString()
        });
        if (promptHistory.length > 50) promptHistory.shift();
        
        saveToLocalStorage();
        if (isOnline) {
          fm.updateData('lists', 'shopping', { items: itemsArray, promptHistory }).catch(err => console.error("Error on drop item:", err));
        }
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
    // Get the actual index from the data attribute, not DOM position
    const draggedIndex = parseInt(draggedItem.dataset.index);
    const targetAisle = this.dataset.aisle;
    
    if (draggedIndex !== -1 && targetAisle && itemsArray[draggedIndex]) {
      const oldAisle = itemsArray[draggedIndex].aisle;
      itemsArray[draggedIndex].aisle = targetAisle;
      
      // Update prompt history with the manual correction
      promptHistory.push({
        item: itemsArray[draggedIndex].name,
        aisle: targetAisle,
        timestamp: new Date().toISOString()
      });
      if (promptHistory.length > 50) promptHistory.shift();
      
      saveToLocalStorage();
      if (isOnline) {
        fm.updateData('lists', 'shopping', { items: itemsArray, promptHistory }).catch(err => console.error("Error on drop aisle:", err));
      }
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
    
    let aisle = (item.aisle && item.aisle.trim()) || "Autre";
    
    // In edit mode, normalize aisle names to match store aisles exactly (case-insensitive)
    if (editMode && currentStore && storesData[currentStore]) {
      const storeAisle = storesData[currentStore].aisles.find(a => a.toLowerCase() === aisle.toLowerCase());
      if (storeAisle) {
        aisle = storeAisle; // Use the store's exact casing
      }
    }
    
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

    // Show ALL aisles from the store in edit mode, in the correct order
    let allAisles = [];
    if (currentStore && storesData[currentStore]) {
      // Use store aisles in their order
      allAisles = [...storesData[currentStore].aisles];
    }
    
    // Always add "Autre" at the end
    if (!allAisles.includes("Autre")) {
      allAisles.push("Autre");
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
    // Normal view: group by aisle - show non-empty aisles first, then "Autre" at the end
    const aislePriority = currentStore && storesData[currentStore] 
      ? storesData[currentStore].aisles.reduce((acc, aisle, idx) => {
          acc[aisle] = idx;
          return acc;
        }, {})
      : {};

    // Sort aisles: prioritize by store order, then "Autre" at the end
    const aisles = Object.keys(groupedItems).sort((a, b) => {
      // "Autre" always goes last
      if (a === "Autre") return 1;
      if (b === "Autre") return -1;
      
      const priorityA = aislePriority[a] ?? 999;
      const priorityB = aislePriority[b] ?? 999;
      return priorityA - priorityB;
    });

    aisles.forEach(aisle => {
      // In normal view, DON'T show aisle headers - just show items with their badges
      // Add items in this aisle (without header)
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
    
    // Check if this item has been placed before in promptHistory
    let suggestedAisle = null;
    const historyEntry = promptHistory.find(entry => entry && entry.item && entry.item.toLowerCase() === val.toLowerCase());
    if (historyEntry) {
      suggestedAisle = historyEntry.aisle;
    }
    
    itemsArray.push({ name: val, bought: false, notFound: false, aisle: suggestedAisle });
    isSorted = false; // Reset sorted flag when adding an item
    saveToLocalStorage();
    
    if (isOnline) {
      await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error adding item:", err));
    }
    
    input.value = "";
    if (input) input.focus();
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
    await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error toggling bought:", err));
  }
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
    await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error toggling not found:", err));
  }
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
    await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error deleting item:", err));
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
        renderList();
        if (isOnline) {
          await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error clearing list:", err));
        }
      }
    } else if (hasOtherItems) {
      if (confirm("Supprimer toute la liste ?")) {
        itemsArray = [];
        saveToLocalStorage();
        renderList();
        if (isOnline) {
          await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error clearing list:", err));
        }
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
  reader.onload = async function(ev) {
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
    saveToLocalStorage();
    if (isOnline) {
      await fm.updateData('lists', 'shopping', { items: itemsArray }).catch(err => console.error("Error loading file:", err));
    }
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

