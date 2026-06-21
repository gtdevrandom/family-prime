import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, updateDoc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyBGyhISFdzVklC1K7Y3TNyQpQ-QJWUXPIo",
  authDomain: "shopngo-2008.firebaseapp.com",
  projectId: "shopngo-2008",
  storageBucket: "shopngo-2008.firebasestorage.app",
  messagingSenderId: "931959995203",
  appId: "1:931959995203:web:f06465bad7af5899868df6",
  measurementId: "G-CJ2KZ8DCS6"
};

// Global application authentication guard applied to the entire app setup
function checkAuth() {
  if (localStorage.getItem("auth") === "true") {
    document.getElementById("loginScreen").style.display = "none";
    document.getElementById("appContainer").classList.add("show");
    return true;
  }
  return false;
}

window.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// Standard document storage reference for absolute cross-device and configuration safety
const ref = doc(db, "lists", "shopping");

let itemsArray = [];
let calendarEventsArray = [];

// --- Dynamic Firestore Live Sync for all features ---
onSnapshot(ref, snap => {
  const data = snap.data() || {};
  itemsArray = data.items || [];
  calendarEventsArray = data.calendarEvents || [];
  
  renderList();
  renderCalendar();
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
  
  // Highlight the correct navigation element
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
  
  // Sort upcoming events chronologically
  const sortedEvents = [...calendarEventsArray].sort((a,b) => new Date(a.date) - new Date(b.date));

  sortedEvents.forEach((evt) => {
    // Find original index in global array to delete accurately
    const originalIndex = calendarEventsArray.findIndex(item => item === evt);
    
    // Render in main calendar tab list
    let li = document.createElement("li");
    li.className = "item";
    
    // Format date beautifully
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

// --- Original Shop-n-Go List Architecture Core Features ---
const ul = document.getElementById("list");
const input = document.getElementById("item");
const optionsMenu = document.getElementById("optionsMenu");

function renderList() {
  ul.innerHTML = "";
  itemsArray.forEach((item, index) => {
    let li = document.createElement("li");
    li.className = "item";
    if (item.bought) li.classList.add("bought");
    if (item.notFound) li.classList.add("not-found");
    li.dataset.index = index;

    li.innerHTML = `
      <div class="item-left">
        <input type="checkbox" class="small-checkbox" ${item.bought ? "checked" : ""}>
        <div class="item-content">${item.name}</div>
      </div>
      <div class="item-actions">
        <button class="action-icon-btn not-found-button">🚫</button>
        <button class="action-icon-btn delete-item">❌</button>
      </div>
    `;

    // Exact event hooks mapping preserved from source project file
    li.querySelector(".small-checkbox").onclick = () => window.toggleBought(index);
    li.querySelector(".item-content").onclick = () => window.toggleBought(index);
    li.querySelector(".not-found-button").onclick = () => window.toggleNotFound(index);
    li.querySelector(".delete-item").onclick = () => window.deleteItem(index);

    ul.appendChild(li);
  });
}

window.addItem = async function() {
  const val = input.value.trim();
  if (!val) return;
  itemsArray.push({ name: val, bought: false, notFound: false });
  await updateDoc(ref, { items: itemsArray });
  input.value = "";
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
  let text = itemsArray.map(it => it.name).join("\n");
  let blob = new Blob([text], { type: 'text/plain' });
  let a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "shopping-list.txt";
  a.click();
  URL.revokeObjectURL(a.href);
};

window.printList = function() {
  let printWindow = window.open('', '', 'width=800,height=600');
  printWindow.document.write('<html><head><title>Liste</title><style>body{font-family:Arial,sans-serif;font-size:18px;padding:20px;}ul{padding-left:20px;}li{margin-bottom:10px;}h1{text-align:center;}</style></head><body>');
  printWindow.document.write('<h1>Liste de Courses</h1><ul>');
  itemsArray.forEach(it => printWindow.document.write(`<li>${it.name}</li>`));
  printWindow.document.write('</ul></body></html>');
  printWindow.document.close();
  printWindow.print();
};

window.shareList = function() {
  let text = itemsArray.map(it => it.name).join("\n");
  const siteLink = window.location.href;
  if (navigator.share) {
    navigator.share({ title: 'Liste de Courses', text: `Voici ma liste de courses :\n${text}` }).catch(console.error);
  } else alert("Partage non supporté sur ce navigateur.");
};

window.loadFile = async function(e) {
  let file = e.target.files[0];
  let reader = new FileReader();
  reader.onload = function(ev) {
    let lines = ev.target.result.split("\n").map(n => ({ name: n.trim(), bought: false, notFound: false })).filter(n => n.name);
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
  if (container && !container.contains(e.target)) {
    optionsMenu.style.display = 'none';
  }
});
