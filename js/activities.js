import { db } from './database.js';
import {
  uid, sanitizeObject, localDateString, parseLocalDate, addDays, dateTime,
  timeToMinutes, minutesToTime, clamp
} from './utils.js';

export function normalizeActivity(input) {
  const cleaned = sanitizeObject(input);
  const duration = Number(cleaned.duration || 0);
  let endTime = cleaned.endTime || '';
  if (cleaned.startTime && !endTime && duration) {
    endTime = minutesToTime(timeToMinutes(cleaned.startTime) + duration);
  }
  const recurrence = cleaned.recurrence || { type: 'none' };
  return {
    id: cleaned.id || uid('act'),
    userId: cleaned.userId || 'local',
    title: cleaned.title?.slice(0,120) || '',
    description: cleaned.description?.slice(0,1000) || '',
    type: cleaned.type || 'task',
    category: cleaned.category || 'personal',
    priority: cleaned.priority || 'normal',
    date: cleaned.date || localDateString(),
    startTime: cleaned.startTime || '',
    endTime,
    duration: duration || calculateDuration(cleaned.startTime, endTime) || 30,
    location: cleaned.location?.slice(0,120) || '',
    responsible: cleaned.responsible?.slice(0,120) || '',
    favorite: Boolean(cleaned.favorite),
    color: cleaned.color || '#4F46E5',
    recurrence: {
      type: recurrence.type || 'none',
      days: Array.isArray(recurrence.days) ? recurrence.days.map(Number) : [],
      until: recurrence.until || '',
      count: recurrence.count ? Number(recurrence.count) : null
    },
    reminders: Array.isArray(cleaned.reminders) ? cleaned.reminders.map(Number) : [],
    status: cleaned.status || 'pending',
    subtasks: Array.isArray(cleaned.subtasks) ? cleaned.subtasks : [],
    attachment: cleaned.attachment || null,
    eisenhower: cleaned.eisenhower || suggestEisenhower(cleaned),
    exceptions: cleaned.exceptions || [],
    completedAt: cleaned.completedAt || null,
    createdAt: cleaned.createdAt,
    updatedAt: cleaned.updatedAt
  };
}

export function calculateDuration(start, end) {
  if (!start || !end) return 0;
  let value = timeToMinutes(end) - timeToMinutes(start);
  if (value < 0) value += 1440;
  return value;
}

export function suggestEisenhower(activity) {
  const priority = activity.priority || 'normal';
  const date = activity.date ? parseLocalDate(activity.date) : new Date();
  const days = Math.ceil((date - new Date()) / 86400000);
  const important = ['high','urgent'].includes(priority);
  const urgent = priority === 'urgent' || days <= 1;
  if (important && urgent) return 'important-urgent';
  if (important) return 'important-not-urgent';
  if (urgent) return 'not-important-urgent';
  return 'not-important-not-urgent';
}

export async function saveActivity(input) {
  const activity = normalizeActivity(input);
  if (!activity.title) throw new Error('Informe o título da atividade.');
  if (!activity.date) throw new Error('Informe a data.');
  if (activity.startTime && activity.endTime && calculateDuration(activity.startTime, activity.endTime) <= 0) {
    throw new Error('O horário final precisa ser posterior ao horário inicial.');
  }
  return db.put('activities', activity);
}

export async function completeActivity(id, status = 'completed') {
  const record = await db.get('activities', id);
  if (!record) return null;
  return db.put('activities', {
    ...record,
    status,
    completedAt: status === 'completed' ? new Date().toISOString() : null
  });
}

export async function postponeActivity(id, minutes = 30) {
  const record = await db.get('activities', id);
  if (!record) return null;
  const start = record.startTime ? timeToMinutes(record.startTime) : 9 * 60;
  const duration = record.duration || calculateDuration(record.startTime, record.endTime) || 30;
  const shifted = clamp(start + minutes, 0, 1439);
  const end = clamp(shifted + duration, 0, 1439);
  return db.put('activities', {
    ...record,
    startTime: minutesToTime(shifted),
    endTime: minutesToTime(end)
  });
}

export function expandRecurrences(records, fromDate, toDate) {
  const from = parseLocalDate(localDateString(fromDate));
  const to = parseLocalDate(localDateString(toDate));
  const occurrences = [];

  for (const source of records) {
    const recurrence = source.recurrence || { type:'none' };
    const start = parseLocalDate(source.date);
    const until = recurrence.until ? parseLocalDate(recurrence.until) : to;
    const maxDate = until < to ? until : to;

    if (recurrence.type === 'none' || !recurrence.type) {
      if (start >= from && start <= to) occurrences.push({ ...source, occurrenceDate: source.date, sourceId: source.id });
      continue;
    }

    let cursor = new Date(start);
    let generated = 0;
    const maxIterations = 1100;
    let iterations = 0;

    while (cursor <= maxDate && iterations++ < maxIterations) {
      const dateString = localDateString(cursor);
      const excluded = source.exceptions?.includes(dateString);
      if (!excluded && cursor >= from && matchesRecurrence(source, cursor)) {
        occurrences.push({
          ...source,
          id: `${source.id}__${dateString}`,
          sourceId: source.id,
          occurrenceDate: dateString,
          date: dateString,
          isOccurrence: true
        });
        generated++;
        if (recurrence.count && generated >= recurrence.count) break;
      }
      cursor = addDays(cursor, 1);
    }
  }
  return occurrences.sort(compareActivities);
}

function matchesRecurrence(activity, date) {
  const recurrence = activity.recurrence || {};
  const original = parseLocalDate(activity.date);
  if (date < original) return false;
  const daysDiff = Math.floor((parseLocalDate(localDateString(date)) - original) / 86400000);
  switch (recurrence.type) {
    case 'daily': return true;
    case 'weekdays': return date.getDay() >= 1 && date.getDay() <= 5;
    case 'weekly': return date.getDay() === original.getDay() && daysDiff % 7 === 0;
    case 'custom': return (recurrence.days || []).includes(date.getDay());
    case 'monthly': return date.getDate() === original.getDate();
    case 'yearly': return date.getDate() === original.getDate() && date.getMonth() === original.getMonth();
    default: return localDateString(date) === activity.date;
  }
}

export function compareActivities(a,b) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  const timeA = a.startTime || '23:59';
  const timeB = b.startTime || '23:59';
  return timeA.localeCompare(timeB);
}

export function activityInterval(activity) {
  if (!activity.startTime) return null;
  const start = dateTime(activity.date, activity.startTime);
  const end = activity.endTime
    ? dateTime(activity.date, activity.endTime)
    : new Date(start.getTime() + Number(activity.duration || 30) * 60000);
  return { start, end };
}

export function detectConflicts(candidate, occurrences, ignoreSourceId = null) {
  const interval = activityInterval(candidate);
  if (!interval) return [];
  return occurrences.filter(item => {
    if (item.sourceId === ignoreSourceId || item.id === ignoreSourceId) return false;
    if (item.status === 'cancelled') return false;
    const other = activityInterval(item);
    if (!other) return false;
    return interval.start < other.end && interval.end > other.start;
  }).map(item => {
    const other = activityInterval(item);
    const overlapStart = new Date(Math.max(interval.start, other.start));
    const overlapEnd = new Date(Math.min(interval.end, other.end));
    return { activity: item, minutes: Math.round((overlapEnd - overlapStart) / 60000) };
  });
}

export function getStatus(activity, now = new Date()) {
  if (activity.status === 'completed') return 'completed';
  if (activity.status === 'cancelled') return 'cancelled';
  const interval = activityInterval(activity);
  if (!interval) {
    const endOfDate = dateTime(activity.date, '23:59');
    return endOfDate < now ? 'overdue' : 'pending';
  }
  if (interval.end < now) return 'overdue';
  if (interval.start <= now && interval.end >= now) return 'current';
  const diff = interval.start - now;
  return diff <= 3600000 ? 'soon' : 'pending';
}

export function findCurrentAndNext(occurrences, now = new Date()) {
  const active = occurrences
    .filter(item => item.status !== 'completed' && item.status !== 'cancelled')
    .map(item => ({ item, interval: activityInterval(item) }))
    .filter(entry => entry.interval)
    .sort((a,b) => a.interval.start - b.interval.start);
  const current = active.find(entry => entry.interval.start <= now && entry.interval.end >= now)?.item || null;
  const next = active.find(entry => entry.interval.start > now)?.item || null;
  return { current, next };
}

export function suggestFreeSlots(activities, date, duration = 45, settings = {}) {
  const dayStart = timeToMinutes(settings.dayStart || '06:00');
  const dayEnd = timeToMinutes(settings.dayEnd || '23:00');
  const limit = Number(settings.dailyTaskLimit || 8);
  const dateString = localDateString(date);
  const scheduled = activities
    .filter(a => a.date === dateString && a.startTime && a.status !== 'cancelled')
    .map(a => ({
      start: timeToMinutes(a.startTime),
      end: timeToMinutes(a.endTime || minutesToTime(timeToMinutes(a.startTime) + Number(a.duration || 30)))
    }))
    .sort((a,b) => a.start - b.start);

  if (scheduled.length >= limit) return [];
  const slots = [];
  let cursor = dayStart;
  for (const item of scheduled) {
    if (item.start - cursor >= duration) slots.push({ start: minutesToTime(cursor), end: minutesToTime(cursor + duration) });
    cursor = Math.max(cursor, item.end);
  }
  if (dayEnd - cursor >= duration) slots.push({ start: minutesToTime(cursor), end: minutesToTime(cursor + duration) });
  return slots.slice(0, 5);
}

export function priorityScore(activity, now = new Date()) {
  const priority = { low: 1, normal: 2, high: 4, urgent: 7 }[activity.priority] || 2;
  const due = dateTime(activity.date, activity.startTime || '23:59');
  const days = Math.max(-10, Math.ceil((due - now) / 86400000));
  const overdue = due < now ? 8 : 0;
  const deadlinePressure = days <= 1 ? 5 : days <= 3 ? 3 : days <= 7 ? 1 : 0;
  const durationPenalty = Number(activity.duration || 30) > 120 ? -1 : 0;
  return priority + overdue + deadlinePressure + durationPenalty;
}
