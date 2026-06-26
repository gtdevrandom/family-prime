// notifications.js
// Client-side push notifications management with Firebase Cloud Messaging

/**
 * Firebase configuration - shared across the app
 */
export const firebaseConfig = {
  apiKey: "AIzaSyBGyhISFdzVklC1K7Y3TNyQpQ-QJWUXPIo",
  authDomain: "shopngo-2008.firebaseapp.com",
  projectId: "shopngo-2008",
  storageBucket: "shopngo-2008.appspot.com",
  messagingSenderId: "931959995203",
  appId: "1:931959995203:web:f06465bad7af5899868df6",
};

/**
 * Your VAPID key from Firebase Console
 * ⚠️ This is your public key - it's safe to keep in client code
 * Go to: Firebase Console → Project Settings → Cloud Messaging → Web Push Certificates
 */
const VAPID_KEY = "BNJ_l0fUInWPfeDfZkFnxzj--CV5waIV8nGqcOfafJR_MwiAh37e9uiQ_q1PeV84827OEh-yAt57paaoJZEoGOI";

let messaging = null;
let db = null;
let auth = null;
let isNotificationSupported = false;

/**
 * Initialize Firebase Messaging
 * This must be called after Firebase is initialized in app.js
 */
export async function initializeMessaging(firebaseApp, firebaseDb, firebaseAuth = null) {
  try {
    // Check if notifications are supported
    if (!("serviceWorker" in navigator) || !("Notification" in window)) {
      console.warn("⚠️ Notifications not supported on this browser");
      isNotificationSupported = false;
      return;
    }

    const { getMessaging } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
    
    messaging = getMessaging(firebaseApp);
    db = firebaseDb;
    auth = firebaseAuth;
    isNotificationSupported = true;

    console.log("✅ Firebase Messaging initialized");

    // Register the service worker for messaging
    try {
      const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js", {
        scope: "./",
      });
      console.log("✅ Firebase Messaging Service Worker registered:", registration);
    } catch (err) {
      console.error("❌ Error registering Firebase Messaging SW:", err);
    }

    // Listen for messages when app is in foreground
    setupForegroundMessageHandler();

    // Listen for navigation messages from service worker
    setupServiceWorkerMessaging();

  } catch (err) {
    console.error("❌ Error initializing messaging:", err);
  }
}

/**
 * Request notification permission and get FCM token
 * This should be called when user wants to enable notifications
 */
export async function requestNotificationPermission(userId) {
  try {
    if (!isNotificationSupported) {
      console.warn("⚠️ Notifications not supported");
      return null;
    }

    // Ensure user is authenticated (sign in anonymously if needed)
    if (!auth) {
      console.error("❌ Auth not initialized");
      return null;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.log("🔑 No user logged in - signing in anonymously for notifications");
      const { signInAnonymously } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
      try {
        const result = await signInAnonymously(auth);
        console.log("✅ Signed in anonymously:", result.user.uid);
      } catch (authErr) {
        console.error("❌ Failed to sign in anonymously:", authErr);
        return null;
      }
    }

    // Request browser permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("❌ Notification permission denied by user");
      return null;
    }

    // Get FCM token
    const { getToken } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js");
    
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) {
      console.error("❌ Failed to get FCM token");
      return null;
    }

    console.log("✅ FCM Token obtained:", token.substring(0, 20) + "...");

    // Save token to Firestore for this authenticated user
    const currentUserId = auth.currentUser?.uid || userId;
    if (!currentUserId) {
      throw new Error("Utilisateur non authentifié pour enregistrer le token FCM.");
    }
    await saveFCMTokenToFirestore(currentUserId, token);

    return token;
  } catch (err) {
    console.error("❌ Error requesting notification permission:", err);
    return null;
  }
}

/**
 * Save FCM token to Firestore under users collection
 */
async function saveFCMTokenToFirestore(userId, token) {
  try {
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    
    await setDoc(
      doc(db, "users", userId),
      {
        fcmToken: token,
        tokenUpdatedAt: new Date(),
        notificationsEnabled: true,
      },
      { merge: true }
    );

    console.log("✅ FCM token saved to Firestore");
  } catch (err) {
    if (err && (err.code === 'permission-denied' || String(err.message).includes('Missing or insufficient permissions'))) {
      console.warn('⚠️ Firestore permissions blocked saving the FCM token. Saving token locally instead.');
      try {
        localStorage.setItem('fcmToken', token);
        localStorage.setItem('notificationsEnabled', 'true');
      } catch (lsErr) {
        console.warn('⚠️ Could not save FCM token to localStorage:', lsErr);
      }
      return;
    }
    console.error("❌ Error saving FCM token:", err);
    throw err;
  }
}

/**
 * Setup foreground message handler
 * Called when app is open and receives a notification
 */
function setupForegroundMessageHandler() {
  if (!messaging) return;

  // Import and setup onMessage handler
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js").then(({ onMessage }) => {
    onMessage(messaging, (payload) => {
      console.log("📱 Foreground notification received:", payload);

      const { title, body } = payload.notification;
      const data = payload.data || {};

      // Show browser notification even in foreground
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, {
          body: body,
          icon: "./image/icon-192.png",
          badge: "./image/icon-192.png",
          tag: data.eventId || "event-notification",
          data: {
            eventId: data.eventId,
            url: data.url,
          },
        });
      }

      // Also dispatch custom event for app to handle
      window.dispatchEvent(
        new CustomEvent("foregroundNotification", {
          detail: { title, body, data },
        })
      );
    });
  }).catch(err => console.error("Error setting up foreground message handler:", err));
}

/**
 * Setup service worker messaging
 * Listen for navigation messages from the service worker
 */
function setupServiceWorkerMessaging() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data.type === "NAVIGATE_TO_EVENT") {
      console.log("🔄 Navigating to event:", event.data.eventId);
      // Dispatch event that app.js can listen to
      window.dispatchEvent(
        new CustomEvent("navigateToEvent", {
          detail: { eventId: event.data.eventId },
        })
      );
    }
  });
}

/**
 * Disable notifications for current user
 */
export async function disableNotifications(userId) {
  try {
    const { doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    
    await setDoc(
      doc(db, "users", userId),
      {
        notificationsEnabled: false,
        fcmToken: null,
      },
      { merge: true }
    );

    console.log("✅ Notifications disabled");
  } catch (err) {
    console.error("❌ Error disabling notifications:", err);
  }
}

/**
 * Check if notifications are enabled for current user
 */
export async function areNotificationsEnabled(userId) {
  try {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    
    const userDoc = await getDoc(doc(db, "users", userId));
    if (!userDoc.exists()) return false;

    return userDoc.data().notificationsEnabled === true;
  } catch (err) {
    console.error("❌ Error checking notifications status:", err);
    return false;
  }
}

/**
 * Get notification status - user-friendly message
 */
export async function getNotificationStatus() {
  return {
    supported: isNotificationSupported,
    permission: isNotificationSupported ? Notification.permission : "denied",
    serviceWorkerActive: (await navigator.serviceWorker.getRegistrations()).length > 0,
  };
}

export default {
  initializeMessaging,
  requestNotificationPermission,
  disableNotifications,
  areNotificationsEnabled,
  getNotificationStatus,
};
