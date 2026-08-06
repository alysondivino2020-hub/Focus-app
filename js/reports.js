import { dateTime, localDateString, addDays, startOfWeek } from './utils.js';

export function buildReport(activities, sessions, habits, rangeDays = 30) {
  const end = new Date();
  const start = addDays(end, -(rangeDays - 1));
  const inRange = activities.filter(item => dateTime(item.date, '23:59') >= start && dateTime(item.date, '00:00') <= end);
  const completed = inRange.filter(item => item.status === 'completed');
  const overdue = inRange.filter(item => item.status !== 'completed' && dateTime(item.date, item.endTime || '23:59') < end);
  const focusMinutes = sessions
    .filter(session => new Date(session.endedAt || session.createdAt) >= start)
    .reduce((sum, session) => sum + Number(session.realDuration || 0), 0);
  const habitChecks = habits.reduce((sum, habit) =>
    sum + (habit.history || []).filter(date => dateTime(date) >= start && dateTime(date) <= end).length, 0);

  const byDay = Array.from({ length: 7 }, (_, day) => ({
    day,
    label: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][day],
    completed: completed.filter(item => dateTime(item.date).getDay() === day).length
  }));

  const byCategory = {};
  for (const item of inRange) byCategory[item.category] = (byCategory[item.category] || 0) + Number(item.duration || 0);

  const byHour = {};
  for (const item of completed.filter(a => a.completedAt)) {
    const hour = new Date(item.completedAt).getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  }

  const completionRate = inRange.length ? Math.round((completed.length / inRange.length) * 100) : 0;
  const bestDay = [...byDay].sort((a,b) => b.completed - a.completed)[0];
  const bestHour = Object.entries(byHour).sort((a,b) => b[1] - a[1])[0]?.[0];

  return {
    rangeDays,
    total: inRange.length,
    completed: completed.length,
    overdue: overdue.length,
    completionRate,
    focusMinutes,
    habitChecks,
    byDay,
    byCategory,
    bestDay: bestDay?.completed ? bestDay.label : 'Sem dados',
    bestHour: bestHour !== undefined ? `${String(bestHour).padStart(2,'0')}:00` : 'Sem dados'
  };
}

export function weeklyComparison(activities) {
  const thisStart = startOfWeek(new Date());
  const lastStart = addDays(thisStart, -7);
  const lastEnd = addDays(thisStart, -1);
  const count = (start,end) => activities.filter(item => {
    const date = dateTime(item.date);
    return item.status === 'completed' && date >= start && date <= end;
  }).length;
  const current = count(thisStart, new Date());
  const previous = count(lastStart, lastEnd);
  const delta = previous ? Math.round(((current - previous) / previous) * 100) : current ? 100 : 0;
  return { current, previous, delta };
}
