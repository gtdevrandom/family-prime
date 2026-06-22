/**
 * Tests pour vérifier le système offline
 * À exécuter dans la console du navigateur
 */

// ============================================
// UTILS DE TEST
// ============================================

const TestUtils = {
  log: (message, data = null) => {
    const prefix = '🧪 TEST:';
    console.log(`%c${prefix} ${message}`, 'color: #2196F3; font-weight: bold;', data || '');
  },
  
  success: (message) => {
    console.log(`%c✅ ${message}`, 'color: #4CAF50; font-weight: bold;');
  },
  
  error: (message) => {
    console.log(`%c❌ ${message}`, 'color: #F44336; font-weight: bold;');
  },
  
  warn: (message) => {
    console.log(`%c⚠️  ${message}`, 'color: #FF9800; font-weight: bold;');
  },
};

// ============================================
// TEST SUITE
// ============================================

const OfflineTests = {
  
  // Test 1: Vérifier l'initialisation
  async testInitialization() {
    TestUtils.log('Test 1: Initialisation du gestionnaire');
    
    if (typeof fm !== 'undefined') {
      TestUtils.success('FirestoreOfflineManager initialisé');
      TestUtils.log('  - DB disponible:', !!fm.db);
      TestUtils.log('  - Online:', fm.isOnline);
    } else {
      TestUtils.error('fm non défini - assurez-vous que firestore-offline.js est chargé');
    }
  },
  
  // Test 2: Vérifier IndexedDB
  async testIndexedDB() {
    TestUtils.log('Test 2: Vérifier IndexedDB');
    
    try {
      const dbs = await indexedDB.databases();
      TestUtils.success('IndexedDB disponible');
      TestUtils.log(`  - Bases de données: ${dbs.length}`);
      dbs.forEach(db => {
        console.log(`    • ${db.name}`);
      });
    } catch (e) {
      TestUtils.error('IndexedDB non disponible: ' + e.message);
    }
  },
  
  // Test 3: Vérifier localStorage
  testLocalStorage() {
    TestUtils.log('Test 3: Vérifier localStorage');
    
    try {
      const testKey = 'offline-test-' + Date.now();
      localStorage.setItem(testKey, 'test');
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      
      if (retrieved === 'test') {
        TestUtils.success('localStorage fonctionne');
      } else {
        TestUtils.error('localStorage ne fonctionne pas correctement');
      }
    } catch (e) {
      TestUtils.error('localStorage erreur: ' + e.message);
    }
  },
  
  // Test 4: Vérifier les données en cache
  testCachedData() {
    TestUtils.log('Test 4: Données en cache');
    
    try {
      const cached = localStorage.getItem('familyPrimeData');
      if (cached) {
        const data = JSON.parse(cached);
        TestUtils.success('Données familiales en cache');
        TestUtils.log('  - Items:', data.items?.length || 0);
        TestUtils.log('  - Events:', data.calendarEvents?.length || 0);
        TestUtils.log('  - Stores:', Object.keys(data.stores || {}).length);
      } else {
        TestUtils.warn('Pas de données en cache (c\'est normal la 1ère fois)');
      }
    } catch (e) {
      TestUtils.error('Erreur lecture cache: ' + e.message);
    }
  },
  
  // Test 5: Vérifier la connexion
  testConnectivity() {
    TestUtils.log('Test 5: Connexion');
    
    TestUtils.log('  - navigator.onLine:', navigator.onLine);
    TestUtils.log('  - fm.isOnline:', fm?.isOnline);
    TestUtils.log('  - Status indicator:', 
      document.getElementById('connectionStatus')?.textContent);
  },
  
  // Test 6: Statut de sync
  testSyncStatus() {
    TestUtils.log('Test 6: Statut de synchronisation');
    
    if (fm) {
      const status = fm.getSyncStatus();
      TestUtils.log('  - Online:', status.isOnline);
      TestUtils.log('  - Pending operations:', status.pendingOperations);
      TestUtils.log('  - Syncing:', status.isSyncing);
    }
  },
  
  // Test 7: Simuler offline et tester
  async testOfflineSimulation() {
    TestUtils.log('Test 7: Simulation offline');
    TestUtils.warn('Pour tester offline vraiment, utilisez:');
    console.log('  1. DevTools → Network → Offline');
    console.log('  2. Puis DevTools → Application → Cache Storage');
    console.log('  3. L\'app devrait continuer à fonctionner');
  },
  
  // Test 8: Tester lecture de données
  async testReadData() {
    TestUtils.log('Test 8: Lecture des données');
    
    try {
      const data = await fm.readData('lists', 'shopping');
      if (data) {
        TestUtils.success('Données lues de Firestore');
        TestUtils.log('  - Keys:', Object.keys(data).length);
      } else {
        TestUtils.warn('Pas de données trouvées');
      }
    } catch (e) {
      TestUtils.error('Erreur lecture: ' + e.message);
    }
  },
  
  // Test 9: Tester écriture de données (safe)
  async testWriteData() {
    TestUtils.log('Test 9: Test d\'écriture (mode safe)');
    TestUtils.warn('Ceci va ajouter un test item à votre liste');
    
    try {
      const testItem = {
        id: 'test-' + Date.now(),
        name: '🧪 TEST ITEM - À SUPPRIMER',
        category: 'tests',
        bought: false,
        notFound: false,
        timestamp: Date.now()
      };
      
      // Juste pour tester, ne pas vraiment sauver
      TestUtils.log('Test item:', testItem);
      TestUtils.success('Test d\'écriture préparé (pas envoyé)');
      
    } catch (e) {
      TestUtils.error('Erreur: ' + e.message);
    }
  },
  
  // Test 10: Vérifier taille du cache
  async testCacheSize() {
    TestUtils.log('Test 10: Taille du cache');
    
    try {
      let totalSize = 0;
      
      // LocalStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        totalSize += key.length + value.length;
      }
      
      TestUtils.log('  - localStorage:', (totalSize / 1024).toFixed(2) + ' KB');
      
      // IndexedDB (estimation)
      const dbs = await indexedDB.databases();
      TestUtils.log('  - IndexedDB:', dbs.length + ' bases');
      
    } catch (e) {
      TestUtils.warn('Impossible de calculer: ' + e.message);
    }
  },
  
  // Test 11: Vérifier les listeners
  testListeners() {
    TestUtils.log('Test 11: Real-time listeners');
    
    if (fm) {
      TestUtils.log('  - Listeners actifs:', fm.listeners?.length || 0);
      TestUtils.success('Listeners configurés');
    }
  },
};

// ============================================
// EXÉCUTION DES TESTS
// ============================================

async function runAllOfflineTests() {
  console.clear();
  console.log('%c🧪 === OFFLINE SYSTEM TESTS ===', 
    'font-size: 16px; font-weight: bold; color: #2196F3;');
  console.log('');
  
  // Run tests
  await OfflineTests.testInitialization();
  console.log('');
  
  await OfflineTests.testIndexedDB();
  console.log('');
  
  OfflineTests.testLocalStorage();
  console.log('');
  
  OfflineTests.testCachedData();
  console.log('');
  
  OfflineTests.testConnectivity();
  console.log('');
  
  OfflineTests.testSyncStatus();
  console.log('');
  
  await OfflineTests.testReadData();
  console.log('');
  
  await OfflineTests.testCacheSize();
  console.log('');
  
  OfflineTests.testListeners();
  console.log('');
  
  OfflineTests.testOfflineSimulation();
  console.log('');
  
  console.log('%c✅ Tests terminés!', 
    'font-size: 14px; font-weight: bold; color: #4CAF50;');
  console.log('Résultats dans la console ci-dessus ⬆️');
}

// ============================================
// HELPERS DE DEBUG
// ============================================

window.OfflineDebug = {
  // Afficher le statut
  status: () => {
    console.log('📊 Statut Offline System:');
    console.table(fm.getSyncStatus());
  },
  
  // Afficher les données en cache
  showCache: () => {
    console.log('💾 Données en cache (localStorage):');
    const data = JSON.parse(localStorage.getItem('familyPrimeData') || '{}');
    console.table({
      Items: data.items?.length || 0,
      Events: data.calendarEvents?.length || 0,
      Stores: Object.keys(data.stores || {}).length,
    });
  },
  
  // Forcer la synchro
  forceSync: async () => {
    console.log('🔄 Forçage de la synchronisation...');
    await fm.syncPendingChanges();
    console.log('✅ Sync terminée');
  },
  
  // Effacer le cache (danger!)
  clearCache: () => {
    if (confirm('⚠️ Ceci va effacer tout le cache. Continuer?')) {
      localStorage.removeItem('familyPrimeData');
      console.log('🗑️ Cache localStorage effacé');
    }
  },
  
  // Afficher les infos IndexedDB
  showIndexedDB: async () => {
    const dbs = await indexedDB.databases();
    console.log('📦 IndexedDB Databases:');
    dbs.forEach(db => {
      console.log(`  • ${db.name} (version: ${db.version})`);
    });
  },
  
  // Simuler offline (DevTools)
  goOffline: () => {
    if (confirm('Allez dans DevTools → Network et mettez sur Offline')) {
      console.log('✅ Mode offline ready - activez dans DevTools');
    }
  },
};

// ============================================
// AUTO-RUN AU CHARGEMENT (optionnel)
// ============================================

// Décommenter pour auto-run les tests au chargement:
// window.addEventListener('load', () => {
//   setTimeout(() => runAllOfflineTests(), 1000);
// });

console.log('%c🧪 Tests disponibles!', 'color: #2196F3; font-weight: bold;');
console.log('Appelez: runAllOfflineTests() pour lancer tous les tests');
console.log('Ou utilisez: OfflineDebug.* pour des infos spécifiques');
