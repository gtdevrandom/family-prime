import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { 
  getFirestore, 
  enableIndexedDbPersistence,
  doc, 
  getDoc, 
  updateDoc, 
  setDoc,
  onSnapshot,
  collection,
  query,
  getDocs,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

class FirestoreOfflineManager {
  constructor(firebaseConfig) {
    this.firebaseConfig = firebaseConfig;
    this.app = null;
    this.db = null;
    this.isOnline = navigator.onLine;
    this.listeners = [];
    this.syncQueue = [];
    this.isSyncing = false;
    
    this.init();
  }

  async init() {
    try {
      // Initialize Firebase
      this.app = initializeApp(this.firebaseConfig);
      this.db = getFirestore(this.app);

      // Enable offline persistence
      await enableIndexedDbPersistence(this.db);
      console.log('✅ Firestore offline persistence enabled');

      // Setup online/offline listeners
      this.setupConnectionListeners();

      // Initial sync check
      this.checkConnectionAndSync();

    } catch (err) {
      if (err.code === 'failed-precondition') {
        console.warn('⚠️ Multiple tabs open - offline persistence disabled');
      } else if (err.code === 'unimplemented') {
        console.warn('⚠️ Offline persistence not supported in this browser');
      } else {
        console.error('Error initializing Firestore:', err);
      }
    }
  }

  setupConnectionListeners() {
    // Listen to online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🟢 Online - Starting sync');
      this.showConnectionStatus('En ligne', 'online');
      this.syncPendingChanges();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('🔴 Offline - Using local cache');
      this.showConnectionStatus('Hors ligne', 'offline');
    });

    // Periodic connectivity check
    setInterval(() => {
      this.checkConnectionAndSync();
    }, 30000); // Check every 30 seconds
  }

  async checkConnectionAndSync() {
    try {
      // Use Google DNS for connectivity check (CORS-friendly)
      const response = await fetch('https://www.google.com/generate_204', {
        method: 'HEAD',
        cache: 'no-cache',
        mode: 'no-cors'
      });
      
      if (!this.isOnline) {
        this.isOnline = true;
        console.log('🟢 Reconnected - Starting sync');
        this.showConnectionStatus('En ligne', 'online');
        this.syncPendingChanges();
      }
    } catch (err) {
      if (this.isOnline) {
        this.isOnline = false;
        console.log('🔴 Connection lost - Using local cache');
        this.showConnectionStatus('Hors ligne', 'offline');
      }
    }
  }

  showConnectionStatus(text, status) {
    const indicator = document.getElementById('connectionStatus');
    if (indicator) {
      indicator.textContent = text;
      indicator.className = `connection-status ${status}`;
    }
  }

  // Write operations with sync queue
  async writeData(collectionName, documentId, data) {
    try {
      const ref = doc(this.db, collectionName, documentId);
      await setDoc(ref, data, { merge: true });
      console.log(`✅ Written to ${collectionName}/${documentId}`);
      return true;
    } catch (err) {
      console.error('Error writing data:', err);
      if (!this.isOnline) {
        // Queue for sync when online
        this.syncQueue.push({
          operation: 'write',
          collectionName,
          documentId,
          data,
          timestamp: Date.now()
        });
        console.log('📋 Operation queued for sync');
      }
      throw err;
    }
  }

  // Update operations with sync queue
  async updateData(collectionName, documentId, data) {
    try {
      const ref = doc(this.db, collectionName, documentId);
      await updateDoc(ref, data);
      console.log(`✅ Updated ${collectionName}/${documentId}`);
      return true;
    } catch (err) {
      console.error('Error updating data:', err);
      if (!this.isOnline) {
        // Queue for sync when online
        this.syncQueue.push({
          operation: 'update',
          collectionName,
          documentId,
          data,
          timestamp: Date.now()
        });
        console.log('📋 Operation queued for sync');
      }
      throw err;
    }
  }

  // Read operations (will use cache if offline)
  async readData(collectionName, documentId) {
    try {
      const ref = doc(this.db, collectionName, documentId);
      const snapshot = await getDoc(ref);
      return snapshot.exists() ? snapshot.data() : null;
    } catch (err) {
      console.error('Error reading data:', err);
      throw err;
    }
  }

  // Query operations (will use cache if offline)
  async queryCollection(collectionName, conditions = []) {
    try {
      const collectionRef = collection(this.db, collectionName);
      const q = conditions.length > 0 ? query(collectionRef, ...conditions) : collectionRef;
      const snapshot = await getDocs(q);
      
      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (err) {
      console.error('Error querying collection:', err);
      throw err;
    }
  }

  // Real-time listener (works with cache)
  onDataChange(collectionName, documentId, callback) {
    const ref = doc(this.db, collectionName, documentId);
    
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (snapshot.exists()) {
          console.log(`📡 Data received: ${collectionName}/${documentId}`);
          callback(snapshot.data(), true);
        }
      },
      (error) => {
        console.error('Snapshot error:', error);
        callback(null, false);
      }
    );

    this.listeners.push(unsubscribe);
    return unsubscribe;
  }

  // Sync pending operations when back online
  async syncPendingChanges() {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;
    console.log(`🔄 Syncing ${this.syncQueue.length} pending operations...`);

    const failedOperations = [];

    for (const operation of this.syncQueue) {
      try {
        if (operation.operation === 'write') {
          await this.writeData(operation.collectionName, operation.documentId, operation.data);
        } else if (operation.operation === 'update') {
          await this.updateData(operation.collectionName, operation.documentId, operation.data);
        }
      } catch (err) {
        console.error('Sync failed for operation:', operation);
        failedOperations.push(operation);
      }
    }

    // Remove synced operations
    this.syncQueue = failedOperations;
    this.isSyncing = false;

    if (failedOperations.length === 0) {
      console.log('✅ All pending operations synced');
    } else {
      console.warn(`⚠️ ${failedOperations.length} operations still pending`);
    }
  }

  // Get sync queue info
  getSyncStatus() {
    return {
      isOnline: this.isOnline,
      pendingOperations: this.syncQueue.length,
      isSyncing: this.isSyncing
    };
  }

  // Cleanup
  cleanup() {
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];
  }
}

// Export for use
export { FirestoreOfflineManager };
