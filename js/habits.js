import { db } from './database.js';
import { uid, sanitizeObject, localDateString, startOfWeek, addDays } from './utils.js';

export async function saveHabit(input) {
  const habit = sanitizeObject({
    id: input.id || uid('hab'),
    userId: input.userId || 'local',
    title: input.title || '',
    frequency: input.frequency || 'daily',
    weeklyGoal: Number(input.weeklyGoal || 5),
    preferredTime: input.preferredTime || '',
    reminder: input.reminder === '' ? null : Number(input.reminder || 0),
    history: Array.isArray(input.history) ? input.history : [],
    color: input.color || '#7C3AED',
    createdAt: input.createdAt,
    updatedAt: input.updatedAt
  });
  if (!habit.title) throw new Error('Informe o nome do hábito.');
  return db.put('habits', habit);
}

export async function toggleHabit(habitId, date = localDateString()) {
  const habit = await db.get('habits', habitId);
  if (!habit) return null;
  const history = new Set(habit.history || []);
  history.has(date) ? history.delete(date) : history.add(date);
  return db.put('habits', { ...habit, history: [...history].sort() });
}

export function habitWeek(habit, anchor = new Date(), startsOn = 1) {
  const start = startOfWeek(anchor, startsOn);
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(start, index);
    const dateString = localDateString(date);
    return { date, dateString, done: (habit.history || []).includes(dateString) };
  });
}

export function habitStats(habit, weeks = 4) {
  const start = addDays(new Date(), -(weeks * 7 - 1));
  const history = (habit.history || []).filter(date => new Date(`${date}T00:00:00`) >= start);
  const target = Math.max(1, Number(habit.weeklyGoal || 1) * weeks);
  const consistency = Math.min(100, Math.round((history.length / target) * 100));
  const set = new Set(habit.history || []);
  let streak = 0;
  let cursor = new Date();
  while (set.has(localDateString(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return { consistency, streak, completed: history.length, target };
}
