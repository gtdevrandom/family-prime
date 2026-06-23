// app-improvements.js
// Enhanced app.js additions for notifications and calendar improvements
// Import this BEFORE app.js to add these functions

import { initializeMessaging, requestNotificationPermission } from './notifications.js';
import { CalendarManager } from './calendar-enhanced.js';

// Global calendar manager
export let calendarManager = null;

/**
 * Initialize notifications and calendar manager
 * Call this after Firebase is initialized in app.js
 */
export async function initializeEnhancements(firebaseApp, db, fm, auth) {
  try {
    // Initialize calendar manager
    calendarManager = new CalendarManager(fm, db);
    await calendarManager.initialize();
    console.log("✅ Calendar Manager initialized");

    // Initialize Firebase Messaging for notifications
    await initializeMessaging(firebaseApp, db, auth);
    console.log("✅ Notifications initialized");

    // Listen for navigation events from service worker
    setupNavigationHandlers();

    // Listen for foreground notifications
    setupForegroundNotificationHandlers();

    // Setup periodic cleanup of expired events
    setupPeriodicCleanup();
  } catch (err) {
    console.error("❌ Error initializing enhancements:", err);
  }
}

/**
 * Setup handlers for when service worker sends navigation events
 */
function setupNavigationHandlers() {
  window.addEventListener("navigateToEvent", (event) => {
    const { eventId } = event.detail;
    console.log("🔄 Navigating to event:", eventId);

    // Switch to calendar tab
    switchTab("calendrier");

    // Scroll to event in calendar if visible
    const eventElement = document.querySelector(`[data-event-id="${eventId}"]`);
    if (eventElement) {
      eventElement.scrollIntoView({ behavior: "smooth", block: "center" });
      // Highlight the event
      eventElement.classList.add("highlight");
      setTimeout(() => eventElement.classList.remove("highlight"), 2000);
    }
  });
}

/**
 * Setup handlers for foreground notifications
 */
function setupForegroundNotificationHandlers() {
  window.addEventListener("foregroundNotification", (event) => {
    const { title, body, data } = event.detail;
    console.log("📱 Foreground notification:", title);

    // Show notification toast if desired
    showNotificationToast(title, body, data);
  });

  // Also handle notification clicks
  navigator.serviceWorker?.controller?.postMessage({
    type: "NOTIFICATION_FOREGROUND_READY",
  });
}

/**
 * Show a toast notification in the UI
 */
function showNotificationToast(title, body, data) {
  const toast = document.createElement("div");
  toast.className = "notification-toast";
  toast.innerHTML = `
    <div class="toast-content">
      <h4>${title}</h4>
      <p>${body}</p>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #2e7d32;
    color: white;
    padding: 16px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    z-index: 10000;
    max-width: 350px;
    animation: slideIn 0.3s ease-out;
  `;

  document.body.appendChild(toast);

  // Auto remove after 5 seconds
  setTimeout(() => toast.remove(), 5000);
}

/**
 * Setup periodic cleanup of expired events
 */
function setupPeriodicCleanup() {
  // Run cleanup every hour
  setInterval(async () => {
    if (calendarManager) {
      try {
        const before = calendarManager.events.length;
        calendarManager.cleanExpiredEvents();
        const after = calendarManager.events.length;

        if (before > after) {
          console.log(`🗑️ Cleaned ${before - after} expired events`);
          await calendarManager.saveToFirestore();
          renderCalendarUI();
        }
      } catch (err) {
        console.error("Error in periodic cleanup:", err);
      }
    }
  }, 3600000);

  // Also run on app start (delayed to allow initialization)
  setTimeout(async () => {
    if (calendarManager) {
      calendarManager.cleanExpiredEvents();
      await calendarManager.saveToFirestore();
    }
  }, 5000);
}

/**
 * Add calendar event with improved error handling
 */
export async function addCalendarEventImproved(dateString, eventName, description = "", eventTime = null) {
  try {
    if (!calendarManager) {
      throw new Error("Calendar manager not initialized");
    }

    const event = await calendarManager.addEvent(dateString, eventName, description, eventTime);

    // Clear input fields
    const dateInput = document.getElementById("calendarDateInput");
    const eventInput = document.getElementById("calendarEventInput");
    const descriptionInput = document.getElementById("calendarDescriptionInput");
    const timeInput = document.getElementById("calendarTimeInput");

    if (dateInput) dateInput.value = "";
    if (eventInput) eventInput.value = "";
    if (descriptionInput) descriptionInput.value = "";
    if (timeInput) timeInput.value = "";

    // Refresh calendar UI
    renderCalendarUI();

    return event;
  } catch (err) {
    console.error("Error adding calendar event:", err);
    alert("Erreur: " + err.message);
    throw err;
  }
}

/**
 * Delete calendar event with confirmation
 */
export async function deleteCalendarEventImproved(eventId) {
  try {
    if (!calendarManager) {
      throw new Error("Calendar manager not initialized");
    }

    const event = calendarManager.getEventById(eventId);
    if (!event) {
      throw new Error("Événement non trouvé");
    }

    if (!confirm(`Supprimer l'événement "${event.name}" ?`)) {
      return;
    }

    await calendarManager.deleteEvent(eventId);
    renderCalendarUI();
  } catch (err) {
    console.error("Error deleting calendar event:", err);
    alert("Erreur: " + err.message);
  }
}

/**
 * Toggle event completion status
 */
export async function toggleEventCompletion(eventId) {
  try {
    if (!calendarManager) {
      throw new Error("Calendar manager not initialized");
    }

    await calendarManager.toggleCompleted(eventId);
    renderCalendarUI();
  } catch (err) {
    console.error("Error toggling event completion:", err);
    alert("Erreur: " + err.message);
  }
}

/**
 * Render calendar UI with improved display
 */
function renderCalendarUI() {
  const listEl = document.getElementById("calendarEventsList");
  if (!listEl || !calendarManager) return;

  listEl.innerHTML = "";

  const sortedEvents = calendarManager.getEventsSorted();

  if (sortedEvents.length === 0) {
    listEl.innerHTML = '<li style="text-align: center; color: #999; padding: 20px;">Aucun événement planifié</li>';
    return;
  }

  sortedEvents.forEach((evt) => {
    const li = document.createElement("li");
    li.className = `item ${evt.completed ? "completed" : ""}`;
    li.setAttribute("data-event-id", evt.id);

    const formattedDate = CalendarManager.formatDateWithDay(evt.date);
    const daysUntil = CalendarManager.daysUntilEvent(evt.date);

    let statusText = "";
    if (daysUntil < 0) statusText = "Passé";
    else if (daysUntil === 0) statusText = "Aujourd'hui! 🎉";
    else if (daysUntil === 1) statusText = "Demain";
    else if (daysUntil <= 7) statusText = `Dans ${daysUntil} jours`;
    else statusText = `Dans ${Math.floor(daysUntil / 7)} semaines`;

    const timeDisplay = evt.time ? `<div style="font-size: 13px; color: #ff6600; margin-top: 2px;">🔔 ${evt.time}</div>` : "";

    li.innerHTML = `
      <div class="item-left">
        <div style="font-size: 18px; margin-right: 4px; cursor: pointer;" onclick="toggleEventCompletion('${evt.id}')">
          ${evt.completed ? "✅" : "📌"}
        </div>
        <div class="item-content">
          <strong>${formattedDate}</strong>
          <div style="font-size: 14px; color: #666;">${evt.name}</div>
          ${evt.description ? `<div style="font-size: 12px; color: #999; margin-top: 4px;">${evt.description}</div>` : ""}
          ${timeDisplay}
          <div style="font-size: 12px; color: #0066cc; margin-top: 4px;">${statusText}</div>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="action-icon-btn" onclick="editCalendarEvent('${evt.id}')" title="Éditer">✏️</button>
        <button class="action-icon-btn delete-item" onclick="deleteCalendarEventImproved('${evt.id}')" title="Supprimer">❌</button>
      </div>
    `;
    listEl.appendChild(li);
  });
}

/**
 * Edit calendar event
 */
export async function editCalendarEvent(eventId) {
  try {
    if (!calendarManager) {
      throw new Error("Calendar manager not initialized");
    }

    const event = calendarManager.getEventById(eventId);
    if (!event) {
      throw new Error("Événement non trouvé");
    }

    // Populate edit form
    document.getElementById("calendarDateInput").value = event.date;
    document.getElementById("calendarEventInput").value = event.name;
    if (document.getElementById("calendarTimeInput")) {
      document.getElementById("calendarTimeInput").value = event.time || "";
    }
    if (document.getElementById("calendarDescriptionInput")) {
      document.getElementById("calendarDescriptionInput").value = event.description || "";
    }
    document.getElementById("calendarDateInput").dataset.editingEventId = eventId;

    // Scroll to form
    document.getElementById("calendarDateInput").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error("Error editing calendar event:", err);
    alert("Erreur: " + err.message);
  }
}

/**
 * Request notification permission from user
 */
export async function enableNotifications() {
  try {
    const auth = localStorage.getItem("auth");
    if (!auth) {
      alert("Veuillez vous connecter d'abord");
      return;
    }

    // Use a default user ID or fetch from Firebase Auth
    // For now, using a device ID
    const deviceId = localStorage.getItem("deviceId") || `device_${Date.now()}`;
    localStorage.setItem("deviceId", deviceId);

    const token = await requestNotificationPermission(deviceId);
    if (token) {
      alert("✅ Notifications activées! Vous recevrez des rappels pour vos événements.");
      updateNotificationStatus();
    } else {
      alert("❌ Impossible d'activer les notifications");
    }
  } catch (err) {
    console.error("Error enabling notifications:", err);
    alert("Erreur: " + err.message);
  }
}

/**
 * Update notification status UI
 */
export function updateNotificationStatus() {
  const statusEl = document.getElementById("notificationStatus");
  if (!statusEl) return;

  if ("Notification" in window) {
    const permission = Notification.permission;
    statusEl.innerHTML = `
      <div style="padding: 12px; background: ${permission === "granted" ? "#e8f5e9" : "#fff3e0"}; border-radius: 4px; margin: 12px 0;">
        <div style="font-size: 14px; font-weight: bold;">
          ${permission === "granted" ? "✅ Notifications activées" : "⚠️ Notifications désactivées"}
        </div>
        <div style="font-size: 12px; color: #666; margin-top: 4px;">
          ${permission === "granted"
            ? "Vous recevrez des rappels pour vos événements"
            : "Cliquez sur le bouton ci-dessous pour activer les notifications"}
        </div>
      </div>
    `;
  }
}

export default {
  initializeEnhancements,
  addCalendarEventImproved,
  deleteCalendarEventImproved,
  toggleEventCompletion,
  editCalendarEvent,
  enableNotifications,
  updateNotificationStatus,
};
