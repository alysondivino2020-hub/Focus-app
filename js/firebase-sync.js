import { db } from './database.js';

let firebase = null;
let auth = null;
let firestore = null;
let modules = null;
let configured = false;

async function loadConfig() {
  try {
    const configPath = './firebase-config.js';
    const module = await import(configPath);
    return module.firebaseConfig;
  } catch {
    return null;
  }
}

export async function initFirebase() {
  if (firebase) return { configured, auth, firestore };
  const config = await loadConfig();
  if (!config?.apiKey || config.apiKey === 'COLE_AQUI') {
    firebase = {};
    configured = false;
    return { configured, auth, firestore };
  }

  const version = '12.16.0';
  const [appModule, authModule, fireModule] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
  ]);

  modules = { ...appModule, ...authModule, ...fireModule };
  firebase = modules.initializeApp(config);
  auth = modules.getAuth(firebase);
  firestore = modules.initializeFirestore(firebase, {
    localCache: modules.persistentLocalCache({ tabManager: modules.persistentMultipleTabManager() })
  });
  configured = true;
  return { configured, auth, firestore };
}

export async function getFirebaseState() {
  return initFirebase();
}

export async function syncLocalToCloud(userId) {
  await initFirebase();
  if (!configured || !userId) return { synced: false, reason: 'Firebase não configurado.' };
  const stores = ['activities','habits','goals','focusSessions','notes'];
  let count = 0;
  for (const storeName of stores) {
    const records = await db.getAll(storeName);
    const batchSize = 400;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = modules.writeBatch(firestore);
      for (const record of records.slice(i, i + batchSize)) {
        const ref = modules.doc(firestore, 'users', userId, storeName, record.id);
        batch.set(ref, { ...record, userId }, { merge: true });
        count++;
      }
      await batch.commit();
    }
  }
  return { synced: true, count };
}

export async function pullCloudToLocal(userId) {
  await initFirebase();
  if (!configured || !userId) return { synced: false, reason: 'Firebase não configurado.' };
  const stores = ['activities','habits','goals','focusSessions','notes'];
  let count = 0;
  for (const storeName of stores) {
    const snapshot = await modules.getDocs(modules.collection(firestore, 'users', userId, storeName));
    const records = snapshot.docs.map(doc => doc.data());
    await db.bulkPut(storeName, records);
    count += records.length;
  }
  return { synced: true, count };
}

export { modules as firebaseModules };
