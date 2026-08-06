import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { dateTime, addMinutes } from './utils.js';

let browserTimers = [];

export function isNative() {
  return Capacitor.isNativePlatform();
}

export async function requestNotificationPermission() {
  if (isNative()) {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return { granted: true };
    const result = await LocalNotifications.requestPermissions();
    return { granted: result.display === 'granted' };
  }
  if (!('Notification' in window)) return { granted: false, reason: 'Navegador sem suporte.' };
  const permission = await Notification.requestPermission();
  return { granted: permission === 'granted' };
}

export async function scheduleActivityNotifications(activity) {
  if (!activity.startTime || !activity.reminders?.length) return [];
  const scheduled = [];
  for (const reminder of activity.reminders) {
    const at = addMinutes(dateTime(activity.date, activity.startTime), -Number(reminder));
    if (at <= new Date()) continue;
    if (isNative()) {
      const id = numericId(`${activity.sourceId || activity.id}_${activity.date}_${reminder}`);
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: activity.title,
          body: `${activity.startTime} • ${activity.location || 'Atividade programada'}`,
          schedule: { at, allowWhileIdle: true },
          sound: 'focus_reminder.wav',
          extra: { activityId: activity.sourceId || activity.id, url: '/#agenda' },
          actionTypeId: 'FOCUS_ACTIVITY'
        }]
      });
      scheduled.push(id);
    } else {
      scheduleBrowserTimer(activity, at);
      scheduled.push(at.getTime());
    }
  }
  return scheduled;
}

function scheduleBrowserTimer(activity, at) {
  const delay = at.getTime() - Date.now();
  if (delay <= 0 || delay > 2147483647) return;
  const timer = setTimeout(() => {
    if (Notification.permission === 'granted') {
      const notification = new Notification(activity.title, {
        body: `${activity.startTime || ''} ${activity.location ? `• ${activity.location}` : ''}`,
        icon: 'assets/icons/icon-192.png',
        tag: activity.sourceId || activity.id,
        data: { activityId: activity.sourceId || activity.id, url: '/#agenda' }
      });
      notification.onclick = () => {
        window.focus();
        location.hash = '#agenda';
        notification.close();
      };
    }
  }, delay);
  browserTimers.push(timer);
}

export function clearBrowserSchedules() {
  browserTimers.forEach(clearTimeout);
  browserTimers = [];
}

export async function configureNativeActions() {
  if (!isNative()) return;
  await LocalNotifications.registerActionTypes({
    types: [{
      id: 'FOCUS_ACTIVITY',
      actions: [
        { id: 'complete', title: 'Concluir' },
        { id: 'snooze', title: 'Adiar 10 min' },
        { id: 'open', title: 'Abrir' }
      ]
    }]
  });
}

export async function listenNativeNotificationActions(callback) {
  if (!isNative()) return null;
  return LocalNotifications.addListener('localNotificationActionPerformed', event => {
    callback?.({
      action: event.actionId || 'open',
      activityId: event.notification?.extra?.activityId || null
    });
  });
}

export async function getExactAlarmStatus() {
  if (!isNative()) return { exact_alarm: 'unsupported' };
  return LocalNotifications.checkExactNotificationSetting();
}

export async function openExactAlarmSettings() {
  if (!isNative()) return null;
  return LocalNotifications.changeExactNotificationSetting();
}

function numericId(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash) + text.charCodeAt(i);
  return Math.abs(hash) % 2147483647;
}
