/**
 * Configuration Firestore Offline Persistence
 * Paramètres avancés et options de tuning
 */

export const OfflineConfig = {
  // ========== PERSISTENCE ==========
  
  // Activer/désactiver la persistence offline
  enablePersistence: true,
  
  // Taille maximale du cache IndexedDB (en MB)
  // -1 = illimité, 0 = désactiver persistence
  // Défaut: 40 MB par navigateur
  cacheSizeBytes: 50 * 1024 * 1024, // 50 MB
  
  // ========== SYNCHRONIZATION ==========
  
  // Intervalle de vérification de connexion (ms)
  connectivityCheckInterval: 30000, // 30 secondes
  
  // Timeout pour la vérification de connectivité
  connectivityCheckTimeout: 5000, // 5 secondes
  
  // URL pour vérifier la connexion
  connectivityCheckUrl: 'https://www.gstatic.com/images/branding/product/1x/firebase_512dp.png',
  
  // Activer le polling automatique
  enablePolling: true,
  
  // ========== QUEUE & RETRY ==========
  
  // Max d'opérations en queue avant warning
  maxQueueSize: 1000,
  
  // Nombre de tentatives de sync
  maxRetries: 3,
  
  // Délai initial avant retry (ms, exponential backoff)
  initialRetryDelay: 1000,
  
  // Délai maximum entre retries
  maxRetryDelay: 30000,
  
  // ========== CACHE STRATEGY ==========
  
  // Strategy de cache: 'aggressive' | 'balanced' | 'conservative'
  // aggressive: cache tout, moins de data sync
  // balanced: cache raisonnable, bon équilibre
  // conservative: cache minimal, plus de sync
  cacheStrategy: 'balanced',
  
  // Garder les données en cache même après suppression Firestore
  keepDeletedDataInCache: false,
  
  // TTL du cache (en ms) - 0 = pas d'expiration
  cacheTTL: 0,
  
  // ========== NOTIFICATIONS ==========
  
  // Afficher les notifications de statut
  showStatusNotifications: true,
  
  // Durée des notifications (ms)
  notificationDuration: 3000,
  
  // Logger les opérations de sync
  enableLogging: true,
  
  // Niveau de log: 'debug' | 'info' | 'warn' | 'error'
  logLevel: 'info',
  
  // ========== BEHAVIORS ==========
  
  // Auto-sync au chargement
  syncOnInit: true,
  
  // Auto-sync quand la fenêtre regagne le focus
  syncOnFocus: true,
  
  // Auto-sync quand on rentre en ligne
  syncOnOnline: true,
  
  // Nettoyer les données expirées (calendrier)
  autoCleanExpiredData: true,
  
  // Intervalle de nettoyage (ms)
  cleanupInterval: 86400000, // 24 heures
  
  // ========== PERFORMANCE ==========
  
  // Batch size pour sync (max opérations par batch)
  batchSize: 25,
  
  // Throttle des écritures (ms) - éviter trop de syncs rapides
  writeThrottleMs: 500,
  
  // Debounce des reads (ms)
  readDebounceMs: 100,
  
  // ========== DÉVELOPPEMENT ==========
  
  // Simuler le mode offline pour tester
  forceOfflineMode: false,
  
  // Délai artificiel pour les opérations (ms)
  artificalLatency: 0,
  
  // Simuler des erreurs de sync (0-1)
  simulatedErrorRate: 0,
};

/**
 * Preset de configurations
 */
export const OfflinePresets = {
  // Pour une app de liste de courses simple (votre cas)
  shopping: {
    ...OfflineConfig,
    cacheStrategy: 'aggressive',
    cacheSizeBytes: 20 * 1024 * 1024,
    connectivityCheckInterval: 30000,
  },
  
  // Pour une app collaborative temps-réel
  collaborative: {
    ...OfflineConfig,
    cacheStrategy: 'balanced',
    cacheSizeBytes: 100 * 1024 * 1024,
    connectivityCheckInterval: 5000,
    syncOnFocus: true,
  },
  
  // Pour une app avec peu d'opérations
  minimal: {
    ...OfflineConfig,
    cacheStrategy: 'conservative',
    cacheSizeBytes: 10 * 1024 * 1024,
    enablePolling: false,
    connectivityCheckInterval: 60000,
  },
  
  // Pour développement/test
  development: {
    ...OfflineConfig,
    enableLogging: true,
    logLevel: 'debug',
    forceOfflineMode: false,
    showStatusNotifications: true,
  },
};

/**
 * Utilisation:
 * 
 * // Importer
 * import { OfflineConfig, OfflinePresets } from './offline-config.js';
 * 
 * // Utiliser la config par défaut
 * const config = OfflineConfig;
 * 
 * // Ou utiliser un preset
 * const config = OfflinePresets.shopping;
 * 
 * // Ou personnaliser
 * const config = {
 *   ...OfflinePresets.shopping,
 *   cacheSizeBytes: 30 * 1024 * 1024
 * };
 */
