import { localDateString, parseLocalDate, addDays, startOfWeek, timeToMinutes, minutesToTime } from './utils.js';

export function monthMatrix(anchor = new Date()) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first, 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(start, index);
    return {
      date,
      dateString: localDateString(date),
      currentMonth: date.getMonth() === anchor.getMonth(),
      today: localDateString(date) === localDateString()
    };
  });
}

export function weekDates(anchor = new Date(), startsOn = 1) {
  const start = startOfWeek(anchor, startsOn);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function groupByDate(activities) {
  return activities.reduce((result, item) => {
    (result[item.date] ||= []).push(item);
    return result;
  }, {});
}

export function calculateOccupancy(activities, date, dayStart = '06:00', dayEnd = '23:00') {
  const total = timeToMinutes(dayEnd) - timeToMinutes(dayStart);
  const occupied = activities
    .filter(item => item.date === localDateString(date) && item.startTime)
    .reduce((sum, item) => {
      const start = timeToMinutes(item.startTime);
      const end = item.endTime ? timeToMinutes(item.endTime) : start + Number(item.duration || 30);
      return sum + Math.max(0, end - start);
    }, 0);
  return Math.min(100, Math.round((occupied / Math.max(1,total)) * 100));
}

export function chronologicalGroups(activities) {
  const groups = groupByDate(activities);
  return Object.keys(groups).sort().map(date => ({ date, items: groups[date] }));
}

export function findGaps(activities, date, settings = {}, minDuration = 30) {
  const dayStart = timeToMinutes(settings.dayStart || '06:00');
  const dayEnd = timeToMinutes(settings.dayEnd || '23:00');
  const items = activities
    .filter(item => item.date === localDateString(date) && item.startTime)
    .map(item => ({
      start: timeToMinutes(item.startTime),
      end: item.endTime ? timeToMinutes(item.endTime) : timeToMinutes(item.startTime) + Number(item.duration || 30)
    }))
    .sort((a,b) => a.start - b.start);
  const gaps = [];
  let cursor = dayStart;
  for (const item of items) {
    if (item.start - cursor >= minDuration) gaps.push({ start: minutesToTime(cursor), end: minutesToTime(item.start), duration: item.start - cursor });
    cursor = Math.max(cursor, item.end);
  }
  if (dayEnd - cursor >= minDuration) gaps.push({ start: minutesToTime(cursor), end: minutesToTime(dayEnd), duration: dayEnd - cursor });
  return gaps;
}
