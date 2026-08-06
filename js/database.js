import { CATEGORY_DEFAULTS, uid, localDateString, addDays } from './utils.js';

const DB_NAME = 'focusDB';
const DB_VERSION = 3;
const STORES = ['activities', 'habits', 'goals', 'focusSessions', 'settings', 'notes', 'trash', 'syncQueue'];

class FocusDatabase {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = event => {
        const db = event.target.result;
        for (const storeName of STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            if (storeName === 'activities') {
              store.createIndex('date', 'date', { unique: false });
              store.createIndex('status', 'status', { unique: false });
              store.createIndex('updatedAt', 'updatedAt', { unique: false });
            }
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return this.db;
  }

  async transaction(storeName, mode, callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = callback(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transação cancelada.'));
    });
  }

  async getAll(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async get(storeName, id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const request = this.db.transaction(storeName, 'readonly').objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, data) {
    const record = { ...data };
    if (!record.id) record.id = uid(storeName.slice(0, 3));
    record.updatedAt = new Date().toISOString();
    if (!record.createdAt) record.createdAt = record.updatedAt;
    await this.transaction(storeName, 'readwrite', store => store.put(record));
    return record;
  }

  async bulkPut(storeName, records) {
    await this.transaction(storeName, 'readwrite', store => {
      for (const record of records) store.put(record);
    });
  }

  async remove(storeName, id, { soft = true } = {}) {
    const existing = await this.get(storeName, id);
    if (!existing) return null;
    if (soft && storeName !== 'trash') {
      await this.put('trash', {
        id: `trash_${storeName}_${id}`,
        originalStore: storeName,
        originalId: id,
        deletedAt: new Date().toISOString(),
        data: existing
      });
    }
    await this.transaction(storeName, 'readwrite', store => store.delete(id));
    return existing;
  }

  async restoreTrash(trashId) {
    const item = await this.get('trash', trashId);
    if (!item) return null;
    await this.put(item.originalStore, item.data);
    await this.remove('trash', trashId, { soft: false });
    return item.data;
  }

  async clearStore(storeName) {
    await this.transaction(storeName, 'readwrite', store => store.clear());
  }

  async clearAll() {
    for (const store of STORES) await this.clearStore(store);
  }

  async getSetting(id, fallback = null) {
    const record = await this.get('settings', id);
    return record?.value ?? fallback;
  }

  async setSetting(id, value) {
    return this.put('settings', { id, value });
  }

  async exportData() {
    const payload = { version: DB_VERSION, exportedAt: new Date().toISOString(), stores: {} };
    for (const store of STORES.filter(s => s !== 'syncQueue')) {
      payload.stores[store] = await this.getAll(store);
    }
    return payload;
  }

  async importData(payload, { replace = false } = {}) {
    if (!payload?.stores) throw new Error('Backup inválido.');
    if (replace) {
      for (const store of STORES.filter(s => s !== 'syncQueue')) await this.clearStore(store);
    }
    for (const [store, records] of Object.entries(payload.stores)) {
      if (!STORES.includes(store) || !Array.isArray(records)) continue;
      await this.bulkPut(store, records);
    }
  }

  async seedDemo() {
    const today = new Date();
    const date = offset => localDateString(addDays(today, offset));
    const now = new Date().toISOString();

    const activities = [
      {
        id: 'demo_work', title: 'Trabalho', description: 'Rotina profissional', type: 'commitment',
        category: 'work', priority: 'normal', date: date(0), startTime: '07:00', endTime: '13:30',
        duration: 390, status: 'pending', color: '#4F46E5',
        recurrence: { type: 'weekdays', days: [1,2,3,4,5], until: date(120) },
        reminders: [15], subtasks: [], createdAt: now, updatedAt: now, demo: true
      },
      {
        id: 'demo_gym', title: 'Academia', description: 'Treino programado', type: 'commitment',
        category: 'gym', priority: 'normal', date: date(0), startTime: '15:00', endTime: '16:20',
        duration: 80, status: 'pending', color: '#EA580C',
        recurrence: { type: 'weekdays', days: [1,2,3,4,5], until: date(120) },
        reminders: [15], subtasks: [], createdAt: now, updatedAt: now, demo: true
      },
      {
        id: 'demo_college', title: 'Faculdade', description: 'Aulas do curso', type: 'commitment',
        category: 'studies', priority: 'high', date: date(0), startTime: '19:00', endTime: '22:10',
        duration: 190, status: 'pending', color: '#7C3AED',
        recurrence: { type: 'custom', days: [1,2,3,4,5], until: date(120) },
        reminders: [30], subtasks: [], createdAt: now, updatedAt: now, demo: true
      },
      {
        id: 'demo_study', title: 'Estudar por 45 minutos', type: 'study', category: 'studies',
        priority: 'high', date: date(1), startTime: '', endTime: '', duration: 45, status: 'pending',
        color: '#7C3AED', recurrence: { type: 'none' }, reminders: [], subtasks: ['Separar material', 'Revisar pontos principais'],
        createdAt: now, updatedAt: now, demo: true
      },
      {
        id: 'demo_bill', title: 'Pagar uma conta', type: 'task', category: 'finance',
        priority: 'urgent', date: date(2), startTime: '12:00', endTime: '12:15', duration: 15,
        status: 'pending', color: '#059669', recurrence: { type: 'none' }, reminders: [60, 1440], subtasks: [],
        createdAt: now, updatedAt: now, demo: true
      },
      {
        id: 'demo_doctor', title: 'Consulta médica', type: 'event', category: 'health',
        priority: 'high', date: date(4), startTime: '10:30', endTime: '11:20', duration: 50,
        status: 'pending', color: '#06B6D4', recurrence: { type: 'none' }, reminders: [30, 1440], subtasks: [],
        createdAt: now, updatedAt: now, demo: true
      },
      {
        id: 'demo_week', title: 'Revisar tarefas da semana', type: 'task', category: 'personal',
        priority: 'normal', date: date(6), startTime: '18:00', endTime: '18:30', duration: 30,
        status: 'pending', color: '#2563EB', recurrence: { type: 'weekly', days: [0], until: date(90) },
        reminders: [15], subtasks: [], createdAt: now, updatedAt: now, demo: true
      }
    ];

    const habits = [
      { id:'demo_habit_read', title:'Ler', frequency:'daily', weeklyGoal:5, preferredTime:'22:20', reminder:15, history:[], color:'#7C3AED', demo:true, createdAt:now, updatedAt:now },
      { id:'demo_habit_water', title:'Beber água', frequency:'daily', weeklyGoal:7, preferredTime:'09:00', reminder:0, history:[], color:'#06B6D4', demo:true, createdAt:now, updatedAt:now }
    ];

    const goals = [
      {
        id:'demo_goal_course', title:'Concluir um curso', description:'Finalizar as aulas e o projeto final',
        deadline:date(45), category:'studies', priority:'high', progress:25, status:'active',
        steps:[
          {id:uid('step'), title:'Concluir módulo 1', done:true},
          {id:uid('step'), title:'Concluir módulo 2', done:false},
          {id:uid('step'), title:'Entregar projeto', done:false}
        ], demo:true, createdAt:now, updatedAt:now
      }
    ];

    await this.bulkPut('activities', activities);
    await this.bulkPut('habits', habits);
    await this.bulkPut('goals', goals);
    await this.setSetting('categories', CATEGORY_DEFAULTS);
    await this.setSetting('demoSeeded', true);
  }

  async removeDemoData() {
    for (const store of ['activities','habits','goals']) {
      const records = await this.getAll(store);
      for (const record of records.filter(item => item.demo)) {
        await this.remove(store, record.id, { soft: false });
      }
    }
    await this.setSetting('demoSeeded', false);
  }
}

export const db = new FocusDatabase();
