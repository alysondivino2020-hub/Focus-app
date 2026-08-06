export const CATEGORY_DEFAULTS = [
  { id: 'work', name: 'Trabalho', color: '#4F46E5', icon: 'briefcase-business' },
  { id: 'studies', name: 'Estudos', color: '#7C3AED', icon: 'book-open' },
  { id: 'health', name: 'Saúde', color: '#06B6D4', icon: 'heart-pulse' },
  { id: 'gym', name: 'Academia', color: '#EA580C', icon: 'dumbbell' },
  { id: 'personal', name: 'Pessoal', color: '#2563EB', icon: 'user-round' },
  { id: 'family', name: 'Família', color: '#DB2777', icon: 'users-round' },
  { id: 'finance', name: 'Financeiro', color: '#059669', icon: 'wallet-cards' },
  { id: 'commitments', name: 'Compromissos', color: '#D97706', icon: 'calendar-check' },
  { id: 'leisure', name: 'Lazer', color: '#0891B2', icon: 'gamepad-2' },
  { id: 'projects', name: 'Projetos', color: '#9333EA', icon: 'folder-kanban' }
];

export const PRIORITY_LABELS = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente'
};

export const TYPE_LABELS = {
  commitment: 'Compromisso',
  task: 'Tarefa',
  event: 'Evento',
  habit: 'Hábito',
  goal: 'Meta',
  reminder: 'Lembrete',
  study: 'Estudo',
  recurring: 'Recorrente'
};

export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}_${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

export const pad = value => String(value).padStart(2, '0');

export function localDateString(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseLocalDate(value) {
  if (value instanceof Date) return new Date(value);
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function dateTime(date, time = '00:00') {
  const [hours, minutes] = (time || '00:00').split(':').map(Number);
  const d = parseLocalDate(date);
  d.setHours(hours || 0, minutes || 0, 0, 0);
  return d;
}

export function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMinutes(date, minutes) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() + Number(minutes || 0));
  return d;
}

export function minutesBetween(start, end) {
  return Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
}

export function timeToMinutes(time = '00:00') {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(minutes) {
  const normalized = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function formatDate(value, options = {}) {
  const date = typeof value === 'string' ? parseLocalDate(value) : new Date(value);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: options.weekday ?? 'short',
    day: '2-digit',
    month: options.month ?? 'short',
    year: options.year,
    ...options
  }).format(date);
}

export function formatLongDate(value = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  }).format(new Date(value));
}

export function formatTime(value) {
  if (!value) return 'Sem horário';
  return value.slice(0, 5);
}

export function formatDuration(minutes = 0) {
  const value = Number(minutes || 0);
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h${pad(rest)}` : `${hours}h`;
}

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
}

export function sanitizeObject(object) {
  const result = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'string') result[key] = value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').trim();
    else result[key] = value;
  }
  return result;
}

export function debounce(fn, wait = 220) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getInitials(name = 'FOCUS') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}

export function downloadFile(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function fileToDataURL(file, maxBytes = 2 * 1024 * 1024) {
  if (!file) return null;
  if (file.size > maxBytes) throw new Error('O arquivo ultrapassa o limite de 2 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: reader.result });
    reader.onerror = () => reject(new Error('Não foi possível ler o anexo.'));
    reader.readAsDataURL(file);
  });
}

export function startOfWeek(date = new Date(), startsOn = 1) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day - startsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0,0,0,0);
  return d;
}

export function endOfWeek(date = new Date(), startsOn = 1) {
  const d = startOfWeek(date, startsOn);
  d.setDate(d.getDate() + 6);
  d.setHours(23,59,59,999);
  return d;
}

export function isSameDay(a, b) {
  return localDateString(a) === localDateString(b);
}

export function relativeTime(target, base = new Date()) {
  const diff = new Date(target) - new Date(base);
  const absMinutes = Math.round(Math.abs(diff) / 60000);
  if (absMinutes < 1) return 'agora';
  if (absMinutes < 60) return diff > 0 ? `em ${absMinutes} min` : `há ${absMinutes} min`;
  const hours = Math.round(absMinutes / 60);
  if (hours < 24) return diff > 0 ? `em ${hours}h` : `há ${hours}h`;
  const days = Math.round(hours / 24);
  return diff > 0 ? `em ${days} dia${days !== 1 ? 's' : ''}` : `há ${days} dia${days !== 1 ? 's' : ''}`;
}

export function refreshIcons() {
  requestAnimationFrame(() => {
    if (window.lucide?.createIcons) window.lucide.createIcons();
  });
}
