// firebase-messaging-sw.js
// ⚠️ IMPORTANT: This file MUST be at the root of the public folder
// and accessible at /firebase-messaging-sw.js

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyBGyhISFdzVklC1K7Y3TNyQpQ-QJWUXPIo",
  authDomain: "shopngo-2008.firebaseapp.com",
  projectId: "shopngo-2008",
  storageBucket: "shopngo-2008.appspot.com",
  messagingSenderId: "931959995203",
  appId: "1:931959995203:web:f06465bad7af5899868df6",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

console.log("[Service Worker] Firebase Messaging initialized");

/**
 * 🔔 Receive notifications when app is closed / in background
 * This handler is called automatically when a message is received via FCM
 */
messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Background notification received:", payload);

  const { title, body } = payload.notification;
  const data = payload.data || {};

  self.registration.showNotification(title, {
    body: body,
    icon: "./image/icon-192.png",
    badge: "./image/icon-192.png",
    tag: data.eventId || "event-notification",
    requireInteraction: true, // Keep notification visible
    data: {
      eventId: data.eventId,
      url: data.url,
      timestamp: new Date().toISOString(),
    },
    actions: [
      { action: "open", title: "Voir l'événement" },
      { action: "close", title: "Ignorer" },
    ],
  });
});

/**
 * Handle notification click
 * Open the app or navigate to the event
 */
self.addEventListener("notificationclick", (event) => {
  console.log("[SW] Notification clicked:", event.action);
  event.notification.close();

  if (event.action === "open" || !event.action) {
    const eventId = event.notification.data?.eventId;
    const url = event.notification.data?.url || "/";

    event.waitUntil(
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        // If app is already open, focus on it
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            // Send message to client to navigate to event
            if (eventId) {
              client.postMessage({
                type: "NAVIGATE_TO_EVENT",
                eventId: eventId,
              });
            }
            return;
          }
        }
        // Otherwise open a new window
        if (clients.openWindow) return clients.openWindow(url);
      })
    );
  }
});

/**
 * Handle notification close/dismiss
 */
self.addEventListener("notificationclose", (event) => {
  console.log("[SW] Notification dismissed:", event.notification.data?.eventId);
});
