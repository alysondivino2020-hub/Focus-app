import { db } from './database.js';
import { uid } from './utils.js';

export class FocusTimer {
  constructor(onTick, onFinish) {
    this.onTick = onTick;
    this.onFinish = onFinish;
    this.totalSeconds = 25 * 60;
    this.remaining = this.totalSeconds;
    this.interval = null;
    this.state = 'idle';
    this.startedAt = null;
    this.activityId = null;
    this.title = 'Sessão livre';
  }

  configure(minutes, activity = null) {
    if (this.state === 'running') throw new Error('Pause ou encerre a sessão antes de alterar a duração.');
    this.totalSeconds = Math.max(60, Number(minutes) * 60);
    this.remaining = this.totalSeconds;
    this.activityId = activity?.sourceId || activity?.id || null;
    this.title = activity?.title || 'Sessão livre';
    this.state = 'idle';
    this.emit();
  }

  start() {
    if (this.state === 'running') return;
    if (!this.startedAt) this.startedAt = new Date().toISOString();
    this.state = 'running';
    this.interval = setInterval(() => {
      this.remaining = Math.max(0, this.remaining - 1);
      this.emit();
      if (this.remaining <= 0) this.finish('completed');
    }, 1000);
    this.emit();
  }

  pause() {
    clearInterval(this.interval);
    this.interval = null;
    this.state = 'paused';
    this.emit();
  }

  async finish(status = 'completed') {
    clearInterval(this.interval);
    this.interval = null;
    const realSeconds = this.totalSeconds - this.remaining;
    const record = {
      id: uid('focus'),
      userId: 'local',
      activityId: this.activityId,
      title: this.title,
      plannedDuration: Math.round(this.totalSeconds / 60),
      realDuration: Math.max(1, Math.round(realSeconds / 60)),
      startedAt: this.startedAt || new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status
    };
    if (realSeconds >= 30 || status === 'completed') await db.put('focusSessions', record);
    this.state = status;
    this.onFinish?.(record);
    this.remaining = this.totalSeconds;
    this.startedAt = null;
    this.emit();
    return record;
  }

  reset() {
    clearInterval(this.interval);
    this.interval = null;
    this.remaining = this.totalSeconds;
    this.startedAt = null;
    this.state = 'idle';
    this.emit();
  }

  emit() {
    this.onTick?.({
      totalSeconds: this.totalSeconds,
      remaining: this.remaining,
      progress: ((this.totalSeconds - this.remaining) / this.totalSeconds) * 100,
      state: this.state,
      title: this.title
    });
  }
}
