import {
  doc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { calendarMonthDates, eventOccursOnDate, formatDateKey } from "./lib/calendarDates.js";

const weekdays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric"
});

let db;
let currentUser;
let userProfile;
let events = [];
let members = [];
let iceboxItems = [];
let migrationAttempted = false;
let callApi;
let selectedDate = formatDateKey(new Date());
let displayedMonth = new Date();
let editingEventId = null;
let unsubscribers = [];
let handlersBound = false;

function setStatus(elementId, message, isError = false) {
  const element = document.getElementById(elementId);
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle("error", isError);
}

function addTextElement(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function bindHandlers() {
  if (handlersBound) return;
  handlersBound = true;

  document.getElementById("previousMonthButton").addEventListener("click", () => {
    displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("nextMonthButton").addEventListener("click", () => {
    displayedMonth = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById("calendarEventForm").addEventListener("submit", saveEvent);
  document.getElementById("cancelEventEditButton").addEventListener("click", resetEventForm);
  document.getElementById("eventRecurrenceInput").addEventListener("change", event => {
    document.getElementById("recurrenceUntilGroup").hidden = event.target.value === "none";
  });
  document.getElementById("iceboxForm").addEventListener("submit", addIceboxItem);
}

export function startFamilyFeatures(database, user, profile, authenticatedApi) {
  stopFamilyFeatures();
  db = database;
  currentUser = user;
  userProfile = profile;
  callApi = authenticatedApi;
  selectedDate = formatDateKey(new Date());
  displayedMonth = new Date();
  bindHandlers();

  resetEventForm();
  renderCalendar();
  renderIceboxItems();
  loadMembers().catch(error => {
    console.error("Unable to load family members for calendar events:", error);
    setStatus("calendarFormStatus", "Impossible de charger la liste des membres. Réessayez plus tard.", true);
  });

  const shoppingDocument = doc(db, "lists", "shopping");
  unsubscribers.push(onSnapshot(shoppingDocument, snapshot => {
    if (!snapshot.exists()) {
      setStatus("calendarFormStatus", "La liste familiale n’est pas encore initialisée.", true);
      return;
    }
    const data = snapshot.data();
    events = Array.isArray(data.familyEvents) ? data.familyEvents : [];
    iceboxItems = Array.isArray(data.iceboxItems) ? data.iceboxItems : [];
    const familyFeaturesReady = data.familyFeaturesMigrated === true;
    renderCalendar();
    renderEventsForSelectedDate();
    renderIceboxItems();
    if (!familyFeaturesReady && !migrationAttempted) {
      migrationAttempted = true;
      migrateLegacyFamilyFeatures().catch(error => {
        console.error("Unable to migrate family events and Icebox data:", error);
        setStatus("calendarFormStatus", `Migration des anciennes données impossible : ${error.message}`, true);
      });
    }
  }, error => {
    console.error("Unable to load family data:", error);
    setStatus("calendarFormStatus", "Impossible de charger les événements et les glaces.", true);
  }));
}

export function stopFamilyFeatures() {
  unsubscribers.forEach(unsubscribe => unsubscribe());
  unsubscribers = [];
  events = [];
  members = [];
  iceboxItems = [];
  migrationAttempted = false;
  db = null;
  currentUser = null;
  userProfile = null;
  callApi = null;
}

async function migrateLegacyFamilyFeatures() {
  setStatus("calendarFormStatus", "Import des anciennes données familiales…");
  await callApi("/api/family-data", { operation: "migrate" });
  setStatus("calendarFormStatus", "");
}

async function loadMembers() {
  if (!currentUser) return;
  const token = await currentUser.getIdToken();
  const apiBaseUrl = (window.FAMILY_PRIME_API_URL || "").replace(/\/+$/, "");
  const response = await fetch(`${apiBaseUrl}/api/members`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Erreur serveur (${response.status}).`);
  if (!Array.isArray(result.members)) throw new Error("La liste des membres reçue est invalide.");
  members = result.members;
  renderMemberCheckboxes();
}

function renderMemberCheckboxes(selectedIds = null) {
  const container = document.getElementById("eventMembersList");
  container.replaceChildren();
  members.forEach(member => {
    const label = document.createElement("label");
    label.className = "member-checkbox";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "eventMember";
    checkbox.value = member.uid;
    checkbox.checked = selectedIds
      ? selectedIds.includes(member.uid)
      : member.uid === currentUser?.uid;
    label.append(checkbox, document.createTextNode(member.displayName));
    container.appendChild(label);
  });
}

function renderCalendar() {
  const title = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(displayedMonth);
  document.getElementById("calendarMonthTitle").textContent = title;
  const grid = document.getElementById("calendarGrid");
  grid.replaceChildren();

  weekdays.forEach(day => addTextElement(grid, "span", "calendar-day-header", day));
  calendarMonthDates(displayedMonth.getFullYear(), displayedMonth.getMonth()).forEach(day => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    if (!day.inMonth) button.classList.add("outside-month");
    if (day.dateKey === selectedDate) button.classList.add("active-day");
    if (events.some(event => eventOccursOnDate(event, day.dateKey))) button.classList.add("has-event");
    button.textContent = String(day.day);
    button.setAttribute("aria-label", day.dateKey);
    button.addEventListener("click", () => selectDate(day.dateKey));
    grid.appendChild(button);
  });
  renderEventsForSelectedDate();
}

function selectDate(dateKey) {
  selectedDate = dateKey;
  displayedMonth = new Date(`${dateKey}T12:00:00`);
  document.getElementById("eventDateInput").value = dateKey;
  renderCalendar();
  renderEventsForSelectedDate();
}

function renderEventsForSelectedDate() {
  const selected = new Date(`${selectedDate}T12:00:00`);
  document.getElementById("selectedDateTitle").textContent =
    `Événements du ${dateFormatter.format(selected)}`;
  const container = document.getElementById("calendarEventsList");
  container.replaceChildren();

  const todaysEvents = events
    .filter(event => eventOccursOnDate(event, selectedDate))
    .sort((first, second) => (first.time || "").localeCompare(second.time || ""));

  if (todaysEvents.length === 0) {
    addTextElement(container, "p", "empty-state", "Aucun événement prévu ce jour-là.");
    return;
  }

  todaysEvents.forEach(event => {
    const card = document.createElement("article");
    card.className = "family-event";
    const time = document.createElement("time");
    time.className = "family-event-time";
    time.textContent = event.time || "Heure non définie";
    card.appendChild(time);
    addTextElement(card, "h4", "family-event-title", event.title || "Événement");
    const creator = members.find(member => member.uid === event.creatorUid)?.displayName
      || (event.creatorUid === currentUser?.uid ? userProfile?.displayName : "Membre");
    addTextElement(card, "p", "family-event-meta", `Ajouté par ${creator}`);

    const attendeeNames = (Array.isArray(event.memberIds) ? event.memberIds : [])
      .map(uid => members.find(member => member.uid === uid)?.displayName)
      .filter(Boolean);
    if (attendeeNames.length > 0) {
      addTextElement(card, "p", "family-event-meta", `Membres concernés : ${attendeeNames.join(", ")}`);
    }
    if (event.recurrence && event.recurrence !== "none") {
      const recurrenceLabel = {
        daily: "Tous les jours",
        weekly: "Toutes les semaines",
        monthly: "Tous les mois",
        yearly: "Tous les ans"
      }[event.recurrence] || "Récurrent";
      addTextElement(card, "p", "family-event-meta", recurrenceLabel);
    }
    if (event.creatorUid === currentUser?.uid) {
      const actions = document.createElement("div");
      actions.className = "family-event-actions";
      const editButton = addTextElement(actions, "button", "btn-cancel", "Modifier");
      editButton.type = "button";
      editButton.addEventListener("click", () => editEvent(event));
      const deleteButton = addTextElement(actions, "button", "btn-delete", "Supprimer");
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () => removeEvent(event));
      card.appendChild(actions);
    }
    container.appendChild(card);
  });
}

function editEvent(event) {
  editingEventId = event.id;
  document.getElementById("calendarFormTitle").textContent = "Modifier l’événement";
  document.getElementById("saveEventButton").textContent = "Enregistrer";
  document.getElementById("cancelEventEditButton").hidden = false;
  document.getElementById("eventTitleInput").value = event.title || "";
  document.getElementById("eventDateInput").value = event.startDate || selectedDate;
  document.getElementById("eventTimeInput").value = event.time || "";
  document.getElementById("eventRecurrenceInput").value = event.recurrence || "none";
  document.getElementById("eventRecurrenceUntilInput").value = event.recurrenceUntil || "";
  document.getElementById("recurrenceUntilGroup").hidden = !event.recurrence || event.recurrence === "none";
  renderMemberCheckboxes(Array.isArray(event.memberIds) ? event.memberIds : []);
  setStatus("calendarFormStatus", "");
  document.getElementById("eventTitleInput").focus();
}

function resetEventForm() {
  editingEventId = null;
  document.getElementById("calendarEventForm").reset();
  document.getElementById("eventDateInput").value = selectedDate;
  document.getElementById("calendarFormTitle").textContent = "Ajouter un événement";
  document.getElementById("saveEventButton").textContent = "Ajouter l’événement";
  document.getElementById("cancelEventEditButton").hidden = true;
  document.getElementById("recurrenceUntilGroup").hidden = true;
  renderMemberCheckboxes();
  setStatus("calendarFormStatus", "");
}

async function saveEvent(event) {
  event.preventDefault();
  const startDate = document.getElementById("eventDateInput").value;
  const recurrence = document.getElementById("eventRecurrenceInput").value;
  const recurrenceUntil = document.getElementById("eventRecurrenceUntilInput").value;
  const title = document.getElementById("eventTitleInput").value.trim();
  if (!title) {
    setStatus("calendarFormStatus", "Saisissez un nom pour cet événement.", true);
    return;
  }
  if (recurrenceUntil && recurrenceUntil < startDate) {
    setStatus("calendarFormStatus", "La date de fin doit être postérieure à la première date.", true);
    return;
  }
  const button = document.getElementById("saveEventButton");
  button.disabled = true;
  setStatus("calendarFormStatus", "");
  const originalEvent = editingEventId
    ? events.find(item => item.id === editingEventId)
    : null;
  if (editingEventId && !originalEvent) {
    setStatus("calendarFormStatus", "Cet événement n’est plus disponible. Actualisez la page.", true);
    button.disabled = false;
    return;
  }
  const eventId = editingEventId || crypto.randomUUID();
  const eventData = {
    id: eventId,
    title,
    startDate,
    time: document.getElementById("eventTimeInput").value,
    recurrence,
    recurrenceUntil: recurrence === "none" ? "" : recurrenceUntil,
    memberIds: [...document.querySelectorAll('input[name="eventMember"]:checked')].map(input => input.value)
  };

  try {
    await callApi("/api/family-data", { operation: "save-event", event: eventData });
    selectedDate = startDate;
    displayedMonth = new Date(`${startDate}T12:00:00`);
    resetEventForm();
    renderCalendar();
  } catch (error) {
    console.error("Unable to save a family calendar event in lists/shopping:", error);
    setStatus("calendarFormStatus", `Enregistrement impossible : ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function removeEvent(event) {
  if (!confirm(`Supprimer « ${event.title} »${event.recurrence !== "none" ? " et toute sa série" : ""} ?`)) return;
  try {
    await callApi("/api/family-data", { operation: "delete-event", id: event.id });
  } catch (error) {
    console.error("Unable to delete a family calendar event from lists/shopping:", error);
    setStatus("calendarFormStatus", `Suppression impossible : ${error.message}`, true);
  }
}

async function addIceboxItem(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const name = document.getElementById("iceboxNameInput").value.trim();
  if (!name) {
    setStatus("iceboxFormStatus", "Saisissez le nom de la glace.", true);
    return;
  }
  const quantity = Number(document.getElementById("iceboxQuantityInput").value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
    setStatus("iceboxFormStatus", "La quantité doit être comprise entre 1 et 9 999.", true);
    return;
  }

  button.disabled = true;
  setStatus("iceboxFormStatus", "");
  try {
    await callApi("/api/family-data", {
      operation: "add-icebox-item",
      name,
      flavor: document.getElementById("iceboxFlavorInput").value.trim(),
      quantity
    });
    form.reset();
    document.getElementById("iceboxQuantityInput").value = "1";
  } catch (error) {
    console.error("Unable to add an Icebox item:", error);
    setStatus("iceboxFormStatus", `Ajout impossible : ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function renderIceboxItems() {
  const container = document.getElementById("iceboxItemsList");
  container.replaceChildren();
  if (iceboxItems.length === 0) {
    addTextElement(container, "p", "empty-state", "❄️ Le congélateur est vide. Ajoutez vos premières glaces !");
    return;
  }

  iceboxItems.sort((first, second) => (first.name || "").localeCompare(second.name || "", "fr"));
  iceboxItems.forEach(item => {
    const row = document.createElement("article");
    row.className = "icebox-item";
    const information = document.createElement("div");
    information.className = "icebox-item-info";
    addTextElement(information, "h3", "", item.name || "Glace");
    if (item.flavor) addTextElement(information, "p", "", `🍨 ${item.flavor}`);
    const controls = document.createElement("div");
    controls.className = "icebox-item-controls";
    const decrement = addTextElement(controls, "button", "btn-cancel", "−");
    decrement.type = "button";
    decrement.setAttribute("aria-label", `Retirer une unité de ${item.name}`);
    decrement.addEventListener("click", () => changeIceboxQuantity(item, -1));
    addTextElement(controls, "span", "icebox-quantity", String(item.quantity || 0));
    const increment = addTextElement(controls, "button", "btn-cancel", "+");
    increment.type = "button";
    increment.setAttribute("aria-label", `Ajouter une unité de ${item.name}`);
    increment.addEventListener("click", () => changeIceboxQuantity(item, 1));
    const removeButton = addTextElement(row, "button", "btn-delete", "Supprimer");
    removeButton.type = "button";
    removeButton.addEventListener("click", () => removeIceboxItem(item));
    row.append(information, controls, removeButton);
    container.appendChild(row);
  });
}

async function changeIceboxQuantity(item, delta) {
  const quantity = Math.max(0, Math.min(9999, (Number(item.quantity) || 0) + delta));
  try {
    await callApi("/api/family-data", {
      operation: "change-icebox-quantity",
      id: item.id,
      delta
    });
  } catch (error) {
    console.error("Unable to update an Icebox quantity in lists/shopping:", error);
    setStatus("iceboxFormStatus", `Mise à jour impossible : ${error.message}`, true);
  }
}

async function removeIceboxItem(item) {
  if (!confirm(`Supprimer « ${item.name} » du congélateur ?`)) return;
  try {
    await callApi("/api/family-data", { operation: "delete-icebox-item", id: item.id });
  } catch (error) {
    console.error("Unable to delete an Icebox item from lists/shopping:", error);
    setStatus("iceboxFormStatus", `Suppression impossible : ${error.message}`, true);
  }
}
