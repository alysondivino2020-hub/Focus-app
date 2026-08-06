import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  expandRecurrences, detectConflicts, normalizeActivity
} from '../js/activities.js';
import { suggestFreeSlots } from '../js/activities.js';

const required = [
  'index.html', 'manifest.json', 'service-worker.js', 'firestore.rules',
  'css/global.css', 'css/components.css', 'css/responsive.css',
  'js/app.js', 'js/database.js', 'js/activities.js', 'js/notifications.js'
];

for (const file of required) {
  assert.equal(existsSync(resolve(file)), true, `Arquivo obrigatório ausente: ${file}`);
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
assert.equal(manifest.short_name, 'FOCUS');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));

const weekly = normalizeActivity({
  id: 'series',
  title: 'Faculdade',
  date: '2026-08-03',
  startTime: '19:00',
  endTime: '22:10',
  recurrence: { type: 'custom', days: [1,2,3], until: '2026-08-12' }
});
const occurrences = expandRecurrences([weekly], new Date(2026,7,3), new Date(2026,7,12));
assert.equal(occurrences.length, 6, 'Recorrência personalizada incorreta');

const conflict = detectConflicts(
  { date:'2026-08-05', startTime:'10:30', endTime:'11:30', duration:60 },
  [{ id:'a', sourceId:'a', date:'2026-08-05', startTime:'10:00', endTime:'11:00', duration:60, status:'pending' }]
);
assert.equal(conflict.length, 1);
assert.equal(conflict[0].minutes, 30);

const slots = suggestFreeSlots(
  [{ date:'2026-08-05', startTime:'08:00', endTime:'10:00', duration:120, status:'pending' }],
  new Date(2026,7,5),
  45,
  { dayStart:'07:00', dayEnd:'12:00', dailyTaskLimit:8 }
);
assert.deepEqual(slots[0], { start:'07:00', end:'07:45' });

const source = readFileSync('js/app.js','utf8');
assert.equal(source.includes('em breve'), false, 'Não usar funcionalidades marcadas como em breve');

console.log('Smoke tests concluídos com sucesso.');
