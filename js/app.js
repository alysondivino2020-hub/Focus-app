import { createIcons, icons } from 'lucide';
window.lucide = { createIcons: () => createIcons({ icons }) };
import { db } from './database.js';
import { Router } from './router.js';
import {
  CATEGORY_DEFAULTS, PRIORITY_LABELS, TYPE_LABELS, uid, localDateString, parseLocalDate,
  addDays, dateTime, formatDate, formatLongDate, formatTime, formatDuration, escapeHTML,
  getInitials, downloadFile, fileToDataURL, startOfWeek, relativeTime, refreshIcons,
  debounce, minutesToTime, timeToMinutes
} from './utils.js';
import {
  saveActivity, completeActivity, postponeActivity, expandRecurrences, detectConflicts,
  getStatus, findCurrentAndNext, suggestFreeSlots, priorityScore, activityInterval
} from './activities.js';
import {
  monthMatrix, weekDates, groupByDate, calculateOccupancy, chronologicalGroups, findGaps
} from './calendar.js';
import { saveHabit, toggleHabit, habitWeek, habitStats } from './habits.js';
import { saveGoal, toggleGoalStep, splitGoalIntoSteps, calculateGoalProgress } from './goals.js';
import { FocusTimer } from './focus-mode.js';
import {
  requestNotificationPermission, scheduleActivityNotifications, clearBrowserSchedules,
  configureNativeActions, listenNativeNotificationActions, getExactAlarmStatus,
  openExactAlarmSettings, isNative
} from './notifications.js';
import { buildReport, weeklyComparison } from './reports.js';
import {
  signIn, createAccount, signInWithGoogle, recoverPassword, observeAuth, signOutUser
} from './auth.js';
import { initFirebase, syncLocalToCloud, pullCloudToLocal } from './firebase-sync.js';

const els = {
  splash: document.querySelector('#splash'),
  onboarding: document.querySelector('#onboarding'),
  onboardingForm: document.querySelector('#onboarding-form'),
  appShell: document.querySelector('#app-shell'),
  main: document.querySelector('#main-content'),
  pageTitle: document.querySelector('#page-title'),
  pageEyebrow: document.querySelector('#page-eyebrow'),
  activityDialog: document.querySelector('#activity-dialog'),
  activityForm: document.querySelector('#activity-form'),
  activityFormTitle: document.querySelector('#activity-form-title'),
  categorySelect: document.querySelector('#activity-category'),
  recurrenceType: document.querySelector('#recurrence-type'),
  recurrenceDays: document.querySelector('#recurrence-days'),
  conflictAlert: document.querySelector('#conflict-alert'),
  searchDialog: document.querySelector('#search-dialog'),
  searchInput: document.querySelector('#global-search-input'),
  searchResults: document.querySelector('#global-search-results'),
  authDialog: document.querySelector('#auth-dialog'),
  authForm: document.querySelector('#auth-form'),
  authMessage: document.querySelector('#auth-message'),
  toastRegion: document.querySelector('#toast-region'),
  avatarInitials: document.querySelector('#avatar-initials'),
  installButton: document.querySelector('#install-button'),
  syncStatus: document.querySelector('#sync-status')
};

const state = {
  profile: null,
  settings: {
    dayStart: '06:00',
    dayEnd: '23:00',
    weekStartsOn: 1,
    darkMode: false,
    notifications: true,
    sounds: true,
    vibration: true,
    timeFormat: '24h',
    defaultDuration: 45,
    dailyTaskLimit: 8
  },
  categories: CATEGORY_DEFAULTS,
  sources: [],
  occurrences: [],
  habits: [],
  goals: [],
  sessions: [],
  notes: [],
  trash: [],
  user: null,
  route: 'home',
  profileTab: 'settings',
  agendaView: 'list',
  agendaAnchor: new Date(),
  agendaFilters: { category: 'all', priority: 'all', status: 'all', query: '' },
  deferredInstall: null,
  selectedFocusActivity: null,
  focusMinutes: 25
};

const timer = new FocusTimer(renderTimerTick, async record => {
  if (record.status === 'completed') {
    beep(880, 0.22);
    vibrate([160, 80, 160]);
    toast('Sessão concluída e registrada.', 'success');
  }
  await reloadData(false);
  if (state.route === 'focus') renderFocus();
});

const router = new Router(route => {
  state.route = route;
  renderRoute();
});

boot().catch(error => {
  console.error(error);
  els.splash?.classList.add('hide');
  toast(`Falha ao iniciar: ${error.message}`, 'error', 8000);
});

async function boot() {
  await db.init();
  state.profile = await db.getSetting('profile', null);
  state.settings = { ...state.settings, ...(await db.getSetting('appSettings', {})) };
  state.categories = await db.getSetting('categories', CATEGORY_DEFAULTS);

  applyTheme();
  registerServiceWorker();
  bindGlobalEvents();
  configureNativeActions().catch(console.warn);
  if (isNative()) document.querySelector('#google-login')?.remove();
  listenNativeNotificationActions(async event => {
    if (event.action === 'complete' && event.activityId) await completeById(event.activityId);
    if (event.action === 'snooze' && event.activityId) await postponeActivity(event.activityId, 10);
    if (event.action === 'open') location.hash = '#agenda';
    await reloadData();
    renderRoute();
  }).catch(console.warn);

  setTimeout(() => els.splash.classList.add('hide'), 500);

  if (!state.profile) {
    els.onboarding.classList.remove('hidden');
    if (new URLSearchParams(location.search).has('auth')) {
      setTimeout(() => els.authDialog.showModal(), 650);
    }
    return;
  }

  await enterApp();
}

async function enterApp() {
  els.onboarding.classList.add('hidden');
  els.appShell.classList.remove('hidden');
  els.avatarInitials.textContent = getInitials(state.profile?.name);
  await reloadData();
  router.start();
  observeAuthentication();
  if (new URLSearchParams(location.search).has('auth')) {
    els.authDialog.showModal();
  }
  if (new URLSearchParams(location.search).get('action') === 'add') {
    setTimeout(openActivityDialog, 300);
  }
}

async function reloadData(reschedule = true) {
  const [sources, habits, goals, sessions, notes, trash] = await Promise.all([
    db.getAll('activities'),
    db.getAll('habits'),
    db.getAll('goals'),
    db.getAll('focusSessions'),
    db.getAll('notes'),
    db.getAll('trash')
  ]);
  state.sources = sources;
  state.habits = habits;
  state.goals = goals;
  state.sessions = sessions.sort((a,b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
  state.notes = notes;
  state.trash = trash.sort((a,b) => (b.deletedAt || '').localeCompare(a.deletedAt || ''));
  state.occurrences = expandRecurrences(sources, addDays(new Date(), -120), addDays(new Date(), 420));

  if (reschedule && state.settings.notifications) {
    clearBrowserSchedules();
    const upcoming = state.occurrences.filter(item => {
      const interval = activityInterval(item);
      return interval && interval.start > new Date() && interval.start < addDays(new Date(), 30);
    }).slice(0, 100);
    for (const item of upcoming) scheduleActivityNotifications(item).catch(console.warn);
  }
}

function bindGlobalEvents() {
  els.onboardingForm.addEventListener('submit', handleOnboarding);
  document.querySelector('#demo-onboarding').addEventListener('click', () => handleOnboarding(null, true));

  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('change', handleDocumentChange);
  els.activityForm.addEventListener('submit', handleActivitySubmit);
  els.activityForm.addEventListener('input', debounce(checkFormConflicts, 180));
  els.searchInput.addEventListener('input', debounce(renderSearchResults, 120));

  document.querySelector('#global-search-button').addEventListener('click', openSearch);
  document.querySelector('#profile-button').addEventListener('click', () => router.go('profile'));
  document.querySelector('#notifications-button').addEventListener('click', showNotificationSummary);

  els.authForm.addEventListener('submit', handleSignIn);
  document.querySelector('#create-account').addEventListener('click', handleCreateAccount);
  document.querySelector('#google-login').addEventListener('click', handleGoogleLogin);
  document.querySelector('#recover-password').addEventListener('click', handlePasswordRecovery);

  els.recurrenceType.addEventListener('change', () => {
    els.recurrenceDays.classList.toggle('hidden', els.recurrenceType.value !== 'custom');
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    state.deferredInstall = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener('click', installPWA);

  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);
  updateConnectionStatus();

  document.addEventListener('dragstart', event => {
    const item = event.target.closest('[data-drag-id]');
    if (item && event.dataTransfer) event.dataTransfer.setData('text/focus-activity', item.dataset.dragId);
  });
  document.addEventListener('dragover', event => {
    if (event.target.closest('[data-drop-date]')) event.preventDefault();
  });
  document.addEventListener('drop', async event => {
    const cell = event.target.closest('[data-drop-date]');
    const id = event.dataTransfer?.getData('text/focus-activity');
    if (!cell || !id) return;
    event.preventDefault();
    await moveActivityToDate(id, cell.dataset.dropDate);
  });

  window.addEventListener('keydown', event => {
    const inputFocused = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (!inputFocused && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openActivityDialog();
    }
    if (event.key === 'Escape') {
      for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    }
  });

  navigator.serviceWorker?.addEventListener('message', async event => {
    if (event.data?.type !== 'NOTIFICATION_ACTION') return;
    if (event.data.action === 'complete') await completeById(event.data.activityId);
    if (event.data.action === 'snooze') await postponeActivity(event.data.activityId, 10);
    await reloadData();
    renderRoute();
  });
}

async function handleOnboarding(event, demo = false) {
  event?.preventDefault();
  const form = new FormData(els.onboardingForm);
  const weekdays = [...document.querySelectorAll('#onboarding-weekdays input:checked')].map(input => Number(input.value));
  state.profile = {
    id: 'local-profile',
    name: demo ? (form.get('name') || 'Usuário FOCUS') : form.get('name'),
    mainGoal: form.get('mainGoal') || 'organizar',
    weekdays,
    createdAt: new Date().toISOString()
  };
  state.settings = {
    ...state.settings,
    dayStart: form.get('dayStart') || '06:00',
    dayEnd: form.get('dayEnd') || '23:00',
    notifications: form.get('notifications') === 'on'
  };
  await db.setSetting('profile', state.profile);
  await db.setSetting('appSettings', state.settings);
  await db.setSetting('categories', CATEGORY_DEFAULTS);

  if (demo) await db.seedDemo();

  if (state.settings.notifications) {
    const permission = await requestNotificationPermission().catch(() => ({ granted: false }));
    if (!permission.granted) state.settings.notifications = false;
    if (permission.granted) await ensureNativeExactAlarms();
    await db.setSetting('appSettings', state.settings);
  }
  await enterApp();
}

function renderRoute() {
  if (!state.profile) return;
  const meta = {
    home: ['Início', 'PLANEJAMENTO PESSOAL'],
    agenda: ['Agenda', 'CALENDÁRIO E ATIVIDADES'],
    focus: ['Modo Foco', 'EXECUÇÃO SEM DISTRAÇÕES'],
    profile: ['Perfil', 'DADOS, HÁBITOS E METAS']
  }[state.route];
  els.pageTitle.textContent = meta[0];
  els.pageEyebrow.textContent = meta[1];

  if (state.route === 'home') renderHome();
  if (state.route === 'agenda') renderAgenda();
  if (state.route === 'focus') renderFocus();
  if (state.route === 'profile') renderProfile();

  els.main.focus({ preventScroll: true });
  refreshIcons();
}

function renderHome() {
  const now = new Date();
  const today = localDateString(now);
  const todayItems = state.occurrences.filter(item => item.date === today);
  const activeItems = todayItems.filter(item => item.status !== 'cancelled');
  const completed = activeItems.filter(item => item.status === 'completed');
  const overdue = activeItems.filter(item => getStatus(item, now) === 'overdue');
  const scheduled = activeItems.filter(item => item.startTime);
  const { current, next } = findCurrentAndNext(state.occurrences, now);
  const currentOrNext = current || next;
  const progress = activeItems.length ? Math.round((completed.length / activeItems.length) * 100) : 0;
  const occupancy = calculateOccupancy(todayItems, now, state.settings.dayStart, state.settings.dayEnd);
  const focusToday = state.sessions
    .filter(session => localDateString(new Date(session.endedAt || session.createdAt)) === today)
    .reduce((sum, item) => sum + Number(item.realDuration || 0), 0);
  const nextSeven = weekDates(now, now.getDay());
  const greeting = getGreeting();
  const priorityList = state.occurrences
    .filter(item => item.status !== 'completed' && item.status !== 'cancelled' && dateTime(item.date, item.startTime || '23:59') >= addDays(now, -14))
    .sort((a,b) => priorityScore(b) - priorityScore(a))
    .slice(0, 6);

  els.main.innerHTML = `
    <section class="dashboard-grid">
      <article class="card hero-card">
        <div class="hero-greeting">
          <p>${escapeHTML(formatLongDate(now))}</p>
          <h2>${greeting}, ${escapeHTML(state.profile.name.split(' ')[0])}.</h2>
          <p>${focusPhrase(activeItems.length, overdue.length)}</p>
        </div>
        ${renderNowPanel(current, next)}
      </article>

      <article class="card day-score">
        <div class="card-header">
          <div><p class="eyebrow">RITMO DO DIA</p><h2>${occupancyLabel(occupancy)}</h2></div>
          <span class="category-pill">${occupancy}% ocupado</span>
        </div>
        <div class="progress-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="track" cx="60" cy="60" r="50"></circle>
            <circle class="value" cx="60" cy="60" r="50" stroke-dasharray="314.16" stroke-dashoffset="${314.16 * (1 - progress / 100)}"></circle>
          </svg>
          <strong>${progress}%</strong><span>concluído</span>
        </div>
        <div class="score-stats">
          <div class="score-stat"><strong>${activeItems.length}</strong><small>Atividades</small></div>
          <div class="score-stat"><strong>${completed.length}</strong><small>Concluídas</small></div>
          <div class="score-stat"><strong>${overdue.length}</strong><small>Atrasadas</small></div>
        </div>
      </article>
    </section>

    <section class="kpi-row" aria-label="Resumo do dia">
      ${kpiCard('calendar-clock', currentOrNext ? formatTime(currentOrNext.startTime) : 'Livre', 'Próximo horário')}
      ${kpiCard('list-checks', String(activeItems.length - completed.length), 'Pendências de hoje')}
      ${kpiCard('timer', formatDuration(focusToday), 'Tempo focado')}
      ${kpiCard('gauge', `${occupancy}%`, 'Nível de ocupação')}
    </section>

    <section class="card week-strip-card">
      <div class="card-header">
        <div><p class="eyebrow">PRÓXIMOS DIAS</p><h2>Visão de sete dias</h2></div>
        <button class="btn ghost" data-action="go-agenda">Abrir agenda</button>
      </div>
      <div class="week-strip">
        ${nextSeven.map(date => {
          const dayItems = state.occurrences.filter(item => item.date === localDateString(date));
          const occ = calculateOccupancy(dayItems, date, state.settings.dayStart, state.settings.dayEnd);
          return `<button class="week-day ${localDateString(date) === today ? 'active' : ''}" data-action="open-date" data-date="${localDateString(date)}">
            <small>${new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(date).replace('.','')}</small>
            <strong>${date.getDate()}</strong>
            <small>${dayItems.length} item${dayItems.length !== 1 ? 's' : ''}</small>
            <div class="occupancy" aria-label="${occ}% ocupado"><span style="width:${occ}%"></span></div>
          </button>`;
        }).join('')}
      </div>
    </section>

    <section class="home-lower">
      <article class="card schedule-card">
        <div class="card-header">
          <div><p class="eyebrow">PRIORIDADES</p><h2>O que merece atenção</h2></div>
          <button class="icon-button" data-action="open-add" aria-label="Adicionar"><i data-lucide="plus"></i></button>
        </div>
        ${priorityList.length ? `<div class="timeline">${priorityList.map(renderTimelineItem).join('')}</div>` : emptyState('calendar-plus','Nenhuma atividade pendente','Adicione uma atividade para começar a organizar o dia.')}
      </article>

      <article class="card assistant-card">
        <div class="assistant-icon"><i data-lucide="sparkles"></i></div>
        <p class="eyebrow">ASSISTENTE LOCAL</p>
        <h2>Organização sem API paga</h2>
        <p class="muted">As recomendações usam prazo, prioridade, duração, conflitos e disponibilidade.</p>
        <div class="assistant-actions">
          <button data-assistant="today">O que preciso fazer hoje?</button>
          <button data-assistant="late">Quais tarefas estão atrasadas?</button>
          <button data-assistant="free">Tenho horário livre amanhã?</button>
          <button data-assistant="priority">Qual atividade devo priorizar?</button>
          <button data-assistant="week">Organizar minha semana</button>
        </div>
        <div class="assistant-response" id="assistant-response">Selecione uma pergunta para receber uma recomendação objetiva.</div>
      </article>
    </section>

    <section class="card schedule-card" style="margin-top:20px">
      <div class="card-header">
        <div><p class="eyebrow">NOTAS RÁPIDAS</p><h2>Capturar sem interromper o fluxo</h2></div>
        <button class="btn ghost" data-action="add-note"><i data-lucide="plus"></i>Nova nota</button>
      </div>
      ${state.notes.length ? `<div class="agenda-list">${state.notes.slice(0,8).map(note => `<div class="activity-row"><div class="kpi-icon"><i data-lucide="sticky-note"></i></div><div class="activity-info"><h4>${escapeHTML(note.title || 'Nota')}</h4><p>${escapeHTML(note.content || '')}</p></div><div class="activity-actions"><button data-action="delete-note" data-id="${note.id}" aria-label="Excluir nota"><i data-lucide="trash-2"></i></button></div></div>`).join('')}</div>` : emptyState('sticky-note','Nenhuma nota rápida','Registre uma ideia curta sem criar uma atividade completa.')}
    </section>

    <button class="fab" data-action="open-add" aria-label="Adicionar atividade"><i data-lucide="plus"></i></button>
  `;
}

function renderNowPanel(current, next) {
  if (!current && !next) {
    return `<div class="now-panel">
      <span class="now-label"><i data-lucide="circle-check-big"></i> AGORA</span>
      <h3>Agenda livre neste momento</h3>
      <p>Use o espaço disponível para uma tarefa curta ou preserve a pausa.</p>
      <div class="now-actions">
        <button class="btn primary" data-action="open-add"><i data-lucide="plus"></i>Adicionar atividade</button>
        <button class="btn ghost" data-action="find-free-slot">Ver horários livres</button>
      </div>
    </div>`;
  }
  const item = current || next;
  const interval = activityInterval(item);
  const descriptor = current ? `Termina ${relativeTime(interval.end)}` : `Começa ${relativeTime(interval.start)}`;
  return `<div class="now-panel">
    <span class="now-label"><i data-lucide="${current ? 'radio' : 'arrow-right-circle'}"></i> ${current ? 'AGORA' : 'PRÓXIMA ATIVIDADE'}</span>
    <h3>${escapeHTML(item.title)}</h3>
    <div class="now-meta"><span>${formatTime(item.startTime)}–${formatTime(item.endTime)}</span><span>${escapeHTML(descriptor)}</span></div>
    <div class="now-actions">
      <button class="btn primary" data-action="start-focus" data-id="${item.id}"><i data-lucide="timer"></i>Iniciar foco</button>
      <button class="btn ghost" data-action="complete" data-id="${item.id}"><i data-lucide="check"></i>Concluir</button>
      <button class="btn ghost" data-action="postpone" data-id="${item.id}"><i data-lucide="clock-3"></i>Adiar</button>
    </div>
  </div>`;
}

function kpiCard(icon, value, label) {
  return `<article class="card kpi-card"><div class="kpi-icon"><i data-lucide="${icon}"></i></div><div><strong>${escapeHTML(value)}</strong><span>${escapeHTML(label)}</span></div></article>`;
}

function renderTimelineItem(item) {
  const status = getStatus(item);
  const category = getCategory(item.category);
  return `<div class="timeline-item ${status}">
    <div class="timeline-time">${item.startTime ? formatTime(item.startTime) : formatDate(item.date,{weekday:undefined,year:undefined})}</div>
    <div class="timeline-line"><span class="timeline-dot" style="background:${item.color || category.color}"></span></div>
    <div class="timeline-content"><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(category.name)} • ${PRIORITY_LABELS[item.priority] || 'Normal'}</p></div>
    <span class="timeline-status">${statusLabel(status)}</span>
  </div>`;
}

function renderAgenda() {
  const filters = state.agendaFilters;
  const range = agendaRange();
  const filtered = state.occurrences.filter(item => {
    const inRange = item.date >= localDateString(range.from) && item.date <= localDateString(range.to);
    const category = filters.category === 'all' || item.category === filters.category;
    const priority = filters.priority === 'all' || item.priority === filters.priority;
    const status = filters.status === 'all' || getStatus(item) === filters.status;
    const query = !filters.query || `${item.title} ${item.description || ''}`.toLowerCase().includes(filters.query.toLowerCase());
    return inRange && category && priority && status && query;
  });

  els.main.innerHTML = `
    <section class="card agenda-panel">
      <div class="agenda-toolbar">
        <div class="segmented" role="tablist" aria-label="Visualização da agenda">
          ${['day','week','month','list'].map(view => `<button class="${state.agendaView === view ? 'active' : ''}" data-action="agenda-view" data-view="${view}">${{day:'Dia',week:'Semana',month:'Mês',list:'Lista'}[view]}</button>`).join('')}
        </div>
        <div class="agenda-controls">
          <button class="icon-button" data-action="agenda-prev" aria-label="Período anterior"><i data-lucide="chevron-left"></i></button>
          <button class="btn ghost" data-action="agenda-today">Hoje</button>
          <button class="icon-button" data-action="agenda-next" aria-label="Próximo período"><i data-lucide="chevron-right"></i></button>
          <button class="btn primary" data-action="open-add"><i data-lucide="plus"></i>Adicionar</button>
        </div>
      </div>

      <div class="section-title-row">
        <div><p class="eyebrow">PERÍODO SELECIONADO</p><h2>${agendaTitle(range)}</h2></div>
        <div class="agenda-controls">
          <select id="agenda-category-filter" aria-label="Filtrar categoria">
            <option value="all">Todas as categorias</option>
            ${state.categories.map(cat => `<option value="${cat.id}" ${filters.category === cat.id ? 'selected' : ''}>${escapeHTML(cat.name)}</option>`).join('')}
          </select>
          <select id="agenda-priority-filter" aria-label="Filtrar prioridade">
            <option value="all">Todas as prioridades</option>
            ${Object.entries(PRIORITY_LABELS).map(([id,name]) => `<option value="${id}" ${filters.priority === id ? 'selected' : ''}>${name}</option>`).join('')}
          </select>
          <select id="agenda-status-filter" aria-label="Filtrar status">
            <option value="all">Todos os status</option>
            <option value="pending" ${filters.status === 'pending' ? 'selected' : ''}>Pendentes</option>
            <option value="completed" ${filters.status === 'completed' ? 'selected' : ''}>Concluídas</option>
            <option value="overdue" ${filters.status === 'overdue' ? 'selected' : ''}>Atrasadas</option>
          </select>
          <input id="agenda-query-filter" value="${escapeHTML(filters.query)}" placeholder="Buscar">
        </div>
      </div>

      <div id="agenda-content">${renderAgendaContent(filtered, range)}</div>
    </section>

    <section class="card agenda-panel" style="margin-top:20px">
      <div class="card-header">
        <div><p class="eyebrow">PLANEJAMENTO SEMANAL</p><h2>Distribuir tarefas sem horário</h2></div>
        <button class="btn secondary" data-action="organize-week"><i data-lucide="wand-sparkles"></i>Organizar minha semana</button>
      </div>
      ${renderWeeklyPlanning()}
    </section>

    <section class="card schedule-card" style="margin-top:20px">
      <div class="card-header">
        <div><p class="eyebrow">NOTAS RÁPIDAS</p><h2>Capturar sem interromper o fluxo</h2></div>
        <button class="btn ghost" data-action="add-note"><i data-lucide="plus"></i>Nova nota</button>
      </div>
      ${state.notes.length ? `<div class="agenda-list">${state.notes.slice(0,8).map(note => `<div class="activity-row"><div class="kpi-icon"><i data-lucide="sticky-note"></i></div><div class="activity-info"><h4>${escapeHTML(note.title || 'Nota')}</h4><p>${escapeHTML(note.content || '')}</p></div><div class="activity-actions"><button data-action="delete-note" data-id="${note.id}" aria-label="Excluir nota"><i data-lucide="trash-2"></i></button></div></div>`).join('')}</div>` : emptyState('sticky-note','Nenhuma nota rápida','Registre uma ideia curta sem criar uma atividade completa.')}
    </section>

    <button class="fab" data-action="open-add" aria-label="Adicionar atividade"><i data-lucide="plus"></i></button>
  `;
}

function agendaRange() {
  const anchor = new Date(state.agendaAnchor);
  if (state.agendaView === 'day') return { from: anchor, to: anchor };
  if (state.agendaView === 'week') {
    const from = startOfWeek(anchor, state.settings.weekStartsOn);
    return { from, to: addDays(from, 6) };
  }
  if (state.agendaView === 'month') {
    return { from: new Date(anchor.getFullYear(), anchor.getMonth(), 1), to: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) };
  }
  return { from: addDays(anchor, -14), to: addDays(anchor, 60) };
}

function agendaTitle(range) {
  if (state.agendaView === 'day') return formatDate(range.from, { weekday:'long', month:'long', year:'numeric' });
  if (state.agendaView === 'week') return `${formatDate(range.from,{weekday:undefined,year:undefined})} — ${formatDate(range.to,{weekday:undefined,year:'numeric'})}`;
  if (state.agendaView === 'month') return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'}).format(state.agendaAnchor);
  return 'Atividades em ordem cronológica';
}

function renderAgendaContent(items, range) {
  if (state.agendaView === 'month') {
    const byDate = groupByDate(items);
    const weekdays = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
    return `<div class="calendar-month">
      ${weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('')}
      ${monthMatrix(state.agendaAnchor).map(cell => {
        const dayItems = byDate[cell.dateString] || [];
        return `<div class="calendar-cell ${cell.currentMonth ? '' : 'outside'} ${cell.today ? 'today' : ''}" data-action="open-date" data-date="${cell.dateString}" data-drop-date="${cell.dateString}">
          <div class="calendar-date"><span>${cell.date.getDate()}</span><span>${dayItems.length || ''}</span></div>
          ${dayItems.slice(0,3).map(item => `<button class="calendar-event" draggable="true" data-drag-id="${item.id}" style="background:${item.color || getCategory(item.category).color}" data-action="edit" data-id="${item.id}" title="${escapeHTML(item.title)}">${formatTime(item.startTime)} ${escapeHTML(item.title)}</button>`).join('')}
          ${dayItems.length > 3 ? `<div class="calendar-more">+${dayItems.length - 3} itens</div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  if (!items.length) return emptyState('calendar-x','Nada neste período','Altere os filtros ou adicione uma atividade.');

  if (state.agendaView === 'day') {
    const gaps = findGaps(state.occurrences, range.from, state.settings, 30);
    return `${renderActivityList(items)}
      <div style="margin-top:20px"><h3>Horários livres</h3>
      <div class="free-slots">${gaps.slice(0,8).map(gap => `<span class="free-slot">${gap.start}–${gap.end} • ${formatDuration(gap.duration)}</span>`).join('') || '<span class="muted">Nenhum intervalo livre acima de 30 minutos.</span>'}</div></div>`;
  }

  if (state.agendaView === 'week') {
    return `<div class="week-strip" style="margin-bottom:20px">
      ${weekDates(range.from, state.settings.weekStartsOn).map(date => {
        const count = items.filter(item => item.date === localDateString(date)).length;
        const occupancy = calculateOccupancy(items, date, state.settings.dayStart, state.settings.dayEnd);
        return `<button class="week-day ${localDateString(date) === localDateString() ? 'active' : ''}" data-action="open-date" data-date="${localDateString(date)}">
          <small>${new Intl.DateTimeFormat('pt-BR',{weekday:'short'}).format(date).replace('.','')}</small><strong>${date.getDate()}</strong><small>${count} item${count !== 1 ? 's':''}</small>
          <div class="occupancy"><span style="width:${occupancy}%"></span></div>
        </button>`;
      }).join('')}
    </div>${renderActivityList(items)}`;
  }

  return chronologicalGroups(items).map(group => `
    <div style="margin-bottom:22px">
      <h3>${formatDate(group.date,{month:'long',year:'numeric'})}</h3>
      ${renderActivityList(group.items)}
    </div>`).join('');
}

function renderActivityList(items) {
  return `<div class="agenda-list">${items.map(item => {
    const status = getStatus(item);
    const category = getCategory(item.category);
    return `<article class="activity-row ${status === 'completed' ? 'completed' : ''}" data-id="${item.id}">
      <button class="activity-check ${status === 'completed' ? 'done' : ''}" data-action="complete" data-id="${item.id}" aria-label="${status === 'completed' ? 'Reabrir' : 'Concluir'} ${escapeHTML(item.title)}"><i data-lucide="check"></i></button>
      <div class="activity-info">
        <h4>${escapeHTML(item.title)} ${item.favorite ? '<span title="Favorita" aria-label="Favorita">★</span>' : ''}</h4>
        <p>${item.startTime ? `${formatTime(item.startTime)}–${formatTime(item.endTime)}` : 'Sem horário'} • ${escapeHTML(category.name)} • ${TYPE_LABELS[item.type] || 'Atividade'}${item.responsible ? ` • ${escapeHTML(item.responsible)}` : ''}</p>
        <div style="margin-top:7px"><span class="priority-pill priority-${item.priority}">${PRIORITY_LABELS[item.priority] || 'Normal'}</span> ${status !== 'pending' ? `<span class="category-pill">${statusLabel(status)}</span>` : ''}</div>
        ${(item.subtasks || []).length ? `<div class="agenda-list" style="margin-top:9px">${item.subtasks.slice(0,5).map(sub => `<button class="text-button" style="text-align:left;padding:3px 0;color:${sub.done ? 'var(--success)' : 'var(--muted)'}" data-action="toggle-subtask" data-id="${item.id}" data-step="${sub.id}">${sub.done ? '✓' : '○'} ${escapeHTML(sub.title || sub)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="activity-actions">
        <button data-action="favorite" data-id="${item.id}" aria-label="${item.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}"><i data-lucide="star"></i></button>
        <button data-action="share" data-id="${item.id}" aria-label="Compartilhar"><i data-lucide="share-2"></i></button>
        ${item.attachment ? `<button data-action="download-attachment" data-id="${item.id}" aria-label="Baixar anexo"><i data-lucide="paperclip"></i></button>` : ''}
        <button data-action="duplicate" data-id="${item.id}" aria-label="Duplicar"><i data-lucide="copy"></i></button>
        <button data-action="edit" data-id="${item.id}" aria-label="Editar"><i data-lucide="pencil"></i></button>
        <button data-action="delete" data-id="${item.id}" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
      </div>
    </article>`;
  }).join('')}</div>`;
}

function renderWeeklyPlanning() {
  const from = startOfWeek(new Date(), state.settings.weekStartsOn);
  const to = addDays(from, 6);
  const weekItems = state.occurrences.filter(item => item.date >= localDateString(from) && item.date <= localDateString(to));
  const unscheduled = weekItems.filter(item => !item.startTime && item.status !== 'completed');
  const late = state.occurrences.filter(item => getStatus(item) === 'overdue').slice(0,6);
  const priorityGoals = state.goals.filter(goal => goal.status !== 'completed').sort((a,b) => (b.priority === 'high') - (a.priority === 'high')).slice(0,3);
  return `<div class="report-grid">
    <div class="report-card"><small>Tarefas sem horário</small><div class="report-value">${unscheduled.length}</div><p class="muted">Podem receber sugestões de encaixe.</p></div>
    <div class="report-card"><small>Tarefas atrasadas</small><div class="report-value">${late.length}</div><p class="muted">Devem ser revistas antes de adicionar carga.</p></div>
    <div class="report-card"><small>Metas prioritárias</small><div class="report-value">${priorityGoals.length}</div><p class="muted">Ações relacionadas devem ter espaço na semana.</p></div>
    <div class="report-card"><small>Carga média</small><div class="report-value">${Math.round(weekItems.reduce((sum,item) => sum + Number(item.duration || 0),0) / 420)}h/dia</div><p class="muted">Cálculo sobre sete dias.</p></div>
  </div>`;
}

function renderFocus() {
  const candidates = state.occurrences
    .filter(item => item.status !== 'completed' && item.status !== 'cancelled' && item.date >= localDateString(addDays(new Date(), -2)))
    .sort((a,b) => priorityScore(b) - priorityScore(a))
    .slice(0,50);
  if (!state.selectedFocusActivity && candidates.length) state.selectedFocusActivity = candidates[0];
  if (timer.state === 'idle' && state.selectedFocusActivity) {
    timer.activityId = state.selectedFocusActivity.sourceId || state.selectedFocusActivity.id;
    timer.title = state.selectedFocusActivity.title;
  }

  els.main.innerHTML = `
    <section class="focus-layout">
      <article class="card focus-stage">
        <p class="eyebrow" style="color:#a5f3fc">SESSÃO ATUAL</p>
        <h2 id="focus-task-title">${escapeHTML(timer.title || state.selectedFocusActivity?.title || 'Sessão livre')}</h2>
        <div class="timer-display" id="timer-display">${secondsToClock(timer.remaining)}</div>
        <div class="timer-progress" aria-label="Progresso da sessão"><span id="timer-progress-bar" style="width:${((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100}%"></span></div>
        <p id="timer-state-text" style="margin-top:14px;color:rgba(255,255,255,.7)">${timerStateText(timer.state)}</p>
        <div class="timer-controls">
          <button class="btn primary" data-action="timer-toggle"><i data-lucide="${timer.state === 'running' ? 'pause' : 'play'}"></i>${timer.state === 'running' ? 'Pausar' : 'Iniciar'}</button>
          <button class="btn ghost" data-action="timer-complete"><i data-lucide="check"></i>Concluir</button>
          <button class="btn ghost" data-action="timer-abandon"><i data-lucide="log-out"></i>Abandonar</button>
        </div>
      </article>

      <aside class="focus-settings">
        <article class="card focus-card">
          <div class="card-header"><div><p class="eyebrow">CONFIGURAÇÃO</p><h2>Preparar foco</h2></div></div>
          <label class="field">
            <span>Atividade</span>
            <select id="focus-activity-select">
              <option value="">Sessão livre</option>
              ${candidates.map(item => `<option value="${item.id}" ${(state.selectedFocusActivity?.id === item.id) ? 'selected' : ''}>${escapeHTML(item.title)} — ${formatDate(item.date,{weekday:undefined,year:undefined})}</option>`).join('')}
            </select>
          </label>
          <div style="margin-top:16px"><span class="muted" style="font-size:.82rem;font-weight:700">Duração</span>
            <div class="duration-grid" style="margin-top:8px">
              ${[25,45,50,60].map(minutes => `<button class="duration-button ${state.focusMinutes === minutes ? 'active' : ''}" data-action="set-duration" data-minutes="${minutes}">${minutes} min</button>`).join('')}
            </div>
          </div>
          <label class="field" style="margin-top:12px"><span>Duração personalizada</span><input id="custom-focus-duration" type="number" min="1" max="240" placeholder="Minutos"></label>
          <div class="switch-row" style="margin-top:12px"><span><strong>Som ao concluir</strong><small>Alerta discreto.</small></span><input id="focus-sound-toggle" type="checkbox" ${state.settings.sounds ? 'checked' : ''} role="switch"></div>
          <div class="switch-row" style="margin-top:8px"><span><strong>Vibração</strong><small>Somente em dispositivos compatíveis.</small></span><input id="focus-vibration-toggle" type="checkbox" ${state.settings.vibration ? 'checked' : ''} role="switch"></div>
        </article>

        <article class="card focus-card">
          <div class="card-header"><div><p class="eyebrow">HISTÓRICO</p><h2>Sessões recentes</h2></div></div>
          <div class="session-list">
            ${state.sessions.slice(0,8).map(session => `<div class="session-item"><div><strong>${escapeHTML(session.title || 'Sessão livre')}</strong><br><small>${new Date(session.endedAt).toLocaleDateString('pt-BR')}</small></div><strong>${formatDuration(session.realDuration)}</strong></div>`).join('') || '<p class="muted">Nenhuma sessão registrada.</p>'}
          </div>
        </article>
      </aside>
    </section>
  `;
  renderTimerTick({
    totalSeconds: timer.totalSeconds,
    remaining: timer.remaining,
    progress: ((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100,
    state: timer.state,
    title: timer.title
  });
}

function renderTimerTick(data) {
  document.querySelector('#timer-display')?.replaceChildren(document.createTextNode(secondsToClock(data.remaining)));
  const bar = document.querySelector('#timer-progress-bar');
  if (bar) bar.style.width = `${Math.max(0,100 - (data.remaining / data.totalSeconds) * 100)}%`;
  const title = document.querySelector('#focus-task-title');
  if (title) title.textContent = data.title || 'Sessão livre';
  const text = document.querySelector('#timer-state-text');
  if (text) text.textContent = timerStateText(data.state);
  const toggle = document.querySelector('[data-action="timer-toggle"]');
  if (toggle) toggle.innerHTML = `<i data-lucide="${data.state === 'running' ? 'pause' : 'play'}"></i>${data.state === 'running' ? 'Pausar' : 'Iniciar'}`;
  refreshIcons();
}

function renderProfile() {
  els.main.innerHTML = `
    <section class="profile-grid">
      <aside class="card profile-card">
        <div class="profile-avatar">${getInitials(state.profile.name)}</div>
        <div><h2>${escapeHTML(state.profile.name)}</h2><p class="muted">${state.user?.email ? escapeHTML(state.user.email) : 'Modo visitante • dados locais'}</p></div>
        <nav class="profile-nav" aria-label="Seções do perfil">
          ${[
            ['settings','settings','Configurações'],
            ['habits','repeat-2','Hábitos'],
            ['goals','target','Metas'],
            ['reports','chart-no-axes-combined','Desempenho'],
            ['trash','trash-2','Lixeira']
          ].map(([tab,icon,label]) => `<button class="${state.profileTab === tab ? 'active' : ''}" data-action="profile-tab" data-tab="${tab}"><i data-lucide="${icon}"></i>${label}</button>`).join('')}
        </nav>
        <button class="btn ${state.user ? 'secondary' : 'primary'} wide" data-action="${state.user ? 'sign-out' : 'open-auth'}" style="margin-top:18px">${state.user ? 'Sair da conta' : 'Entrar para sincronizar'}</button>
      </aside>

      <section class="card profile-section">
        ${renderProfileTab()}
      </section>
    </section>
  `;
}

function renderProfileTab() {
  if (state.profileTab === 'settings') return renderSettings();
  if (state.profileTab === 'habits') return renderHabits();
  if (state.profileTab === 'goals') return renderGoals();
  if (state.profileTab === 'reports') return renderReports();
  if (state.profileTab === 'trash') return renderTrash();
  return '';
}

function renderSettings() {
  return `
    <div class="card-header"><div><p class="eyebrow">PREFERÊNCIAS</p><h2>Configurações do aplicativo</h2></div></div>
    <form id="settings-form" class="settings-grid">
      <div class="form-grid">
        <label class="field"><span>Nome</span><input name="name" value="${escapeHTML(state.profile.name)}" required></label>
        <label class="field"><span>Duração padrão</span><select name="defaultDuration">${[15,30,45,60,90,120].map(v => `<option value="${v}" ${state.settings.defaultDuration == v ? 'selected':''}>${formatDuration(v)}</option>`).join('')}</select></label>
        <label class="field"><span>Início do dia</span><input type="time" name="dayStart" value="${state.settings.dayStart}"></label>
        <label class="field"><span>Término do dia</span><input type="time" name="dayEnd" value="${state.settings.dayEnd}"></label>
        <label class="field"><span>Início da semana</span><select name="weekStartsOn"><option value="1" ${state.settings.weekStartsOn == 1 ? 'selected':''}>Segunda-feira</option><option value="0" ${state.settings.weekStartsOn == 0 ? 'selected':''}>Domingo</option></select></label>
        <label class="field"><span>Limite diário de atividades</span><input type="number" name="dailyTaskLimit" min="1" max="30" value="${state.settings.dailyTaskLimit}"></label>
      </div>
      <label class="switch-row"><span><strong>Modo escuro</strong><small>Reduz o brilho da interface.</small></span><input type="checkbox" name="darkMode" ${state.settings.darkMode ? 'checked':''} role="switch"></label>
      <label class="switch-row"><span><strong>Notificações</strong><small>No navegador, dependem de permissão e disponibilidade; no Android, use Capacitor.</small></span><input type="checkbox" name="notifications" ${state.settings.notifications ? 'checked':''} role="switch"></label>
      <label class="switch-row"><span><strong>Sons</strong><small>Alertas discretos no modo foco.</small></span><input type="checkbox" name="sounds" ${state.settings.sounds ? 'checked':''} role="switch"></label>
      <label class="switch-row"><span><strong>Vibração</strong><small>Quando suportada pelo dispositivo.</small></span><input type="checkbox" name="vibration" ${state.settings.vibration ? 'checked':''} role="switch"></label>
      <button class="btn primary" type="submit">Salvar configurações</button>
    </form>

    <hr style="border:0;border-top:1px solid var(--line);margin:28px 0">
    <div class="card-header"><div><p class="eyebrow">DADOS</p><h2>Backup e sincronização</h2></div></div>
    <div class="data-actions">
      <button class="btn secondary" data-action="export-data"><i data-lucide="download"></i>Exportar JSON</button>
      <button class="btn secondary" data-action="import-data"><i data-lucide="upload"></i>Importar backup</button>
      <input type="file" id="import-file" accept=".json,application/json" hidden>
      <button class="btn secondary" data-action="export-calendar"><i data-lucide="calendar-plus"></i>Exportar agenda</button>
      <button class="btn secondary" data-action="sync-now" ${state.user ? '' : 'disabled'}><i data-lucide="cloud-upload"></i>Sincronizar agora</button>
      <button class="btn ghost" data-action="remove-demo"><i data-lucide="eraser"></i>Remover demonstração</button>
      <button class="btn danger" data-action="clear-data"><i data-lucide="triangle-alert"></i>Apagar todos os dados</button>
    </div>

    <hr style="border:0;border-top:1px solid var(--line);margin:28px 0">
    <div class="card-header"><div><p class="eyebrow">CATEGORIAS</p><h2>Organização visual</h2></div><button class="btn ghost" data-action="add-category"><i data-lucide="plus"></i>Nova categoria</button></div>
    <div class="agenda-list">
      ${state.categories.map(cat => `<div class="activity-row"><span class="timeline-dot" style="background:${cat.color}"></span><div class="activity-info"><h4>${escapeHTML(cat.name)}</h4><p>${cat.id}</p></div><div class="activity-actions"><button data-action="edit-category" data-id="${cat.id}"><i data-lucide="pencil"></i></button><button data-action="delete-category" data-id="${cat.id}"><i data-lucide="trash-2"></i></button></div></div>`).join('')}
    </div>
  `;
}

function renderHabits() {
  return `
    <div class="card-header"><div><p class="eyebrow">CONSISTÊNCIA</p><h2>Hábitos e rotina</h2></div><button class="btn primary" data-action="add-habit"><i data-lucide="plus"></i>Novo hábito</button></div>
    ${state.habits.length ? `<div class="habit-grid">${state.habits.map(habit => {
      const stats = habitStats(habit);
      const week = habitWeek(habit, new Date(), state.settings.weekStartsOn);
      return `<article class="habit-card">
        <div class="habit-card-header"><div><h3>${escapeHTML(habit.title)}</h3><small>${stats.consistency}% de consistência • sequência ${stats.streak} dia${stats.streak !== 1 ? 's':''}</small></div><button class="icon-button" data-action="delete-habit" data-id="${habit.id}" aria-label="Excluir hábito"><i data-lucide="trash-2"></i></button></div>
        <div class="habit-week">${week.map(day => `<button class="habit-day ${day.done ? 'done':''}" data-action="toggle-habit" data-id="${habit.id}" data-date="${day.dateString}" title="${day.dateString}">${new Intl.DateTimeFormat('pt-BR',{weekday:'narrow'}).format(day.date)}</button>`).join('')}</div>
        <p class="muted" style="margin:12px 0 0">Meta: ${habit.weeklyGoal} vez${habit.weeklyGoal !== 1 ? 'es':''} por semana${habit.preferredTime ? ` • ${habit.preferredTime}`:''}</p>
      </article>`;
    }).join('')}</div>` : emptyState('repeat-2','Nenhum hábito cadastrado','Crie hábitos simples e acompanhe sem punição por interrupções.')}
  `;
}

function renderGoals() {
  return `
    <div class="card-header"><div><p class="eyebrow">OBJETIVOS</p><h2>Metas em ações executáveis</h2></div><button class="btn primary" data-action="add-goal"><i data-lucide="plus"></i>Nova meta</button></div>
    ${state.goals.length ? `<div class="goal-grid">${state.goals.map(goal => {
      const progress = calculateGoalProgress(goal);
      return `<article class="goal-card">
        <div class="goal-card-header"><div><h3>${escapeHTML(goal.title)}</h3><small>${goal.deadline ? `Prazo ${formatDate(goal.deadline,{weekday:undefined,year:'numeric'})}` : 'Sem prazo'}</small></div><button class="icon-button" data-action="delete-goal" data-id="${goal.id}" aria-label="Excluir meta"><i data-lucide="trash-2"></i></button></div>
        <p class="muted">${escapeHTML(goal.description || 'Sem descrição.')}</p>
        <div class="goal-progress"><span style="width:${progress}%"></span></div><small>${progress}% concluído</small>
        <div class="agenda-list" style="margin-top:14px">${(goal.steps || []).map(step => `<div class="activity-row" style="padding:9px"><button class="activity-check ${step.done?'done':''}" data-action="toggle-goal-step" data-id="${goal.id}" data-step="${step.id}"><i data-lucide="check"></i></button><div class="activity-info"><h4>${escapeHTML(step.title)}</h4></div></div>`).join('')}</div>
        <button class="btn ghost wide" style="margin-top:12px" data-action="split-goal" data-id="${goal.id}"><i data-lucide="list-tree"></i>Dividir ou reorganizar etapas</button>
      </article>`;
    }).join('')}</div>` : emptyState('target','Nenhuma meta cadastrada','Transforme um objetivo amplo em etapas pequenas e verificáveis.')}
  `;
}

function renderReports() {
  const report = buildReport(state.occurrences, state.sessions, state.habits, 30);
  const comparison = weeklyComparison(state.occurrences);
  const maxDay = Math.max(1,...report.byDay.map(day => day.completed));
  const categories = Object.entries(report.byCategory).sort((a,b) => b[1]-a[1]).slice(0,5);
  return `
    <div class="card-header"><div><p class="eyebrow">ÚLTIMOS 30 DIAS</p><h2>Desempenho sem sobrecarga</h2></div></div>
    <div class="report-grid">
      ${reportCard('Taxa de conclusão',`${report.completionRate}%`,`${report.completed} de ${report.total} atividades`)}
      ${reportCard('Tempo focado',formatDuration(report.focusMinutes),`${state.sessions.length} sessões registradas`)}
      ${reportCard('Hábitos cumpridos',String(report.habitChecks),'Registros no período')}
      ${reportCard('Comparação semanal',`${comparison.delta >= 0 ? '+' : ''}${comparison.delta}%`,`${comparison.current} concluídas nesta semana`)}
    </div>
    <div class="report-grid" style="margin-top:18px">
      <article class="report-card">
        <h3>Conclusões por dia</h3>
        <div class="bar-chart">${report.byDay.map(day => `<div class="bar-chart-bar" style="height:${Math.max(5,(day.completed/maxDay)*100)}%"><span>${day.label}</span></div>`).join('')}</div>
      </article>
      <article class="report-card">
        <h3>Categorias que consomem tempo</h3>
        <div class="agenda-list" style="margin-top:12px">${categories.map(([category,minutes]) => `<div class="session-item"><span>${escapeHTML(getCategory(category).name)}</span><strong>${formatDuration(minutes)}</strong></div>`).join('') || '<p class="muted">Sem dados suficientes.</p>'}</div>
      </article>
    </div>
    <div class="assistant-response" style="margin-top:18px"><strong>Leitura responsável:</strong> seu melhor dia foi ${report.bestDay} e o horário com mais conclusões foi ${report.bestHour}. Use estes dados para reduzir atrito, não para eliminar pausas ou ampliar jornadas sem necessidade.</div>
  `;
}

function reportCard(label,value,detail) {
  return `<article class="report-card"><small>${escapeHTML(label)}</small><div class="report-value">${escapeHTML(value)}</div><p class="muted">${escapeHTML(detail)}</p></article>`;
}

function renderTrash() {
  return `
    <div class="card-header"><div><p class="eyebrow">EXCLUSÕES TEMPORÁRIAS</p><h2>Lixeira</h2></div><button class="btn danger" data-action="empty-trash" ${state.trash.length ? '' : 'disabled'}>Esvaziar</button></div>
    ${state.trash.length ? `<div class="agenda-list">${state.trash.map(item => `<div class="activity-row"><div class="kpi-icon"><i data-lucide="trash-2"></i></div><div class="activity-info"><h4>${escapeHTML(item.data?.title || item.originalId)}</h4><p>${escapeHTML(item.originalStore)} • excluído em ${new Date(item.deletedAt).toLocaleString('pt-BR')}</p></div><div class="activity-actions"><button data-action="restore-trash" data-id="${item.id}" aria-label="Restaurar"><i data-lucide="undo-2"></i></button><button data-action="delete-trash-permanent" data-id="${item.id}" aria-label="Excluir permanentemente"><i data-lucide="x"></i></button></div></div>`).join('')}</div>` : emptyState('trash-2','Lixeira vazia','Itens excluídos ficam aqui até a remoção permanente.')}
  `;
}

async function handleDocumentClick(event) {
  const target = event.target.closest('[data-action], [data-assistant]');
  if (!target) return;
  const action = target.dataset.action;

  if (target.dataset.assistant) return handleAssistant(target.dataset.assistant);
  if (action === 'open-add') return openActivityDialog();
  if (action === 'close-modal') return els.activityDialog.close();
  if (action === 'close-search') return els.searchDialog.close();
  if (action === 'close-auth') return els.authDialog.close();
  if (action === 'go-agenda') return router.go('agenda');
  if (action === 'open-auth') return els.authDialog.showModal();
  if (action === 'open-date') {
    state.agendaAnchor = parseLocalDate(target.dataset.date);
    state.agendaView = 'day';
    router.go('agenda');
    if (state.route === 'agenda') renderAgenda();
    return;
  }
  if (action === 'agenda-view') { state.agendaView = target.dataset.view; return renderAgenda(); }
  if (action === 'agenda-prev') return shiftAgenda(-1);
  if (action === 'agenda-next') return shiftAgenda(1);
  if (action === 'agenda-today') { state.agendaAnchor = new Date(); return renderAgenda(); }
  if (action === 'complete') return completeById(target.dataset.id);
  if (action === 'postpone') return postponeById(target.dataset.id);
  if (action === 'edit') return editActivity(target.dataset.id);
  if (action === 'delete') return deleteActivity(target.dataset.id);
  if (action === 'duplicate') return duplicateActivity(target.dataset.id);
  if (action === 'favorite') return toggleFavorite(target.dataset.id);
  if (action === 'share') return shareActivity(target.dataset.id);
  if (action === 'download-attachment') return downloadAttachment(target.dataset.id);
  if (action === 'toggle-subtask') return toggleSubtask(target.dataset.id,target.dataset.step);
  if (action === 'add-note') return addQuickNote();
  if (action === 'delete-note') return deleteQuickNote(target.dataset.id);
  if (action === 'start-focus') return startFocusFor(target.dataset.id);
  if (action === 'find-free-slot') { state.agendaView = 'day'; state.agendaAnchor = new Date(); return router.go('agenda'); }
  if (action === 'organize-week') return organizeWeek();
  if (action === 'profile-tab') { state.profileTab = target.dataset.tab; return renderProfile(); }
  if (action === 'timer-toggle') {
    timer.state === 'running' ? timer.pause() : timer.start();
    return;
  }
  if (action === 'timer-complete') return timer.finish('completed');
  if (action === 'timer-abandon') {
    if (confirm('Abandonar a sessão atual? O tempo parcial poderá ser registrado.')) return timer.finish('abandoned');
    return;
  }
  if (action === 'set-duration') {
    state.focusMinutes = Number(target.dataset.minutes);
    timer.configure(state.focusMinutes, state.selectedFocusActivity);
    return renderFocus();
  }
  if (action === 'add-habit') return addHabitPrompt();
  if (action === 'toggle-habit') {
    await toggleHabit(target.dataset.id, target.dataset.date);
    await reloadData(false); return renderProfile();
  }
  if (action === 'delete-habit') return deleteDomainItem('habits', target.dataset.id, 'hábito');
  if (action === 'add-goal') return addGoalPrompt();
  if (action === 'toggle-goal-step') {
    await toggleGoalStep(target.dataset.id, target.dataset.step);
    await reloadData(false); return renderProfile();
  }
  if (action === 'split-goal') return splitGoal(target.dataset.id);
  if (action === 'delete-goal') return deleteDomainItem('goals', target.dataset.id, 'meta');
  if (action === 'export-data') return exportData();
  if (action === 'import-data') return document.querySelector('#import-file').click();
  if (action === 'export-calendar') return exportCalendar();
  if (action === 'sync-now') return syncNow();
  if (action === 'remove-demo') return removeDemo();
  if (action === 'clear-data') return clearAllData();
  if (action === 'add-category') return addCategory();
  if (action === 'edit-category') return editCategory(target.dataset.id);
  if (action === 'delete-category') return deleteCategory(target.dataset.id);
  if (action === 'sign-out') return signOutFlow();
  if (action === 'restore-trash') {
    await db.restoreTrash(target.dataset.id); await reloadData(false); renderProfile(); toast('Item restaurado.','success'); return;
  }
  if (action === 'delete-trash-permanent') {
    if (!confirm('Excluir este item permanentemente?')) return;
    await db.remove('trash', target.dataset.id, { soft:false }); await reloadData(false); return renderProfile();
  }
  if (action === 'empty-trash') {
    if (!confirm('Esvaziar a lixeira permanentemente?')) return;
    await db.clearStore('trash'); await reloadData(false); return renderProfile();
  }
}

async function handleDocumentChange(event) {
  if (event.target.id === 'agenda-category-filter') { state.agendaFilters.category = event.target.value; return renderAgenda(); }
  if (event.target.id === 'agenda-priority-filter') { state.agendaFilters.priority = event.target.value; return renderAgenda(); }
  if (event.target.id === 'agenda-status-filter') { state.agendaFilters.status = event.target.value; return renderAgenda(); }
  if (event.target.id === 'agenda-query-filter') { state.agendaFilters.query = event.target.value; return renderAgenda(); }

  if (event.target.id === 'focus-activity-select') {
    state.selectedFocusActivity = state.occurrences.find(item => item.id === event.target.value) || null;
    timer.configure(state.focusMinutes, state.selectedFocusActivity);
    return renderFocus();
  }
  if (event.target.id === 'custom-focus-duration' && event.target.value) {
    state.focusMinutes = Math.max(1,Math.min(240,Number(event.target.value)));
    timer.configure(state.focusMinutes, state.selectedFocusActivity);
    return renderFocus();
  }
  if (event.target.id === 'focus-sound-toggle') {
    state.settings.sounds = event.target.checked;
    await db.setSetting('appSettings', state.settings);
  }
  if (event.target.id === 'focus-vibration-toggle') {
    state.settings.vibration = event.target.checked;
    await db.setSetting('appSettings', state.settings);
  }
  if (event.target.id === 'import-file') return importData(event.target.files[0]);
}

function shiftAgenda(direction) {
  const anchor = new Date(state.agendaAnchor);
  if (state.agendaView === 'day') anchor.setDate(anchor.getDate() + direction);
  else if (state.agendaView === 'week') anchor.setDate(anchor.getDate() + direction * 7);
  else if (state.agendaView === 'month') anchor.setMonth(anchor.getMonth() + direction);
  else anchor.setDate(anchor.getDate() + direction * 30);
  state.agendaAnchor = anchor;
  renderAgenda();
}

function openActivityDialog(existing = null) {
  els.activityForm.reset();
  els.activityFormTitle.textContent = existing ? 'Editar atividade' : 'Adicionar atividade';
  const form = els.activityForm.elements;
  form.id.value = existing?.id || '';
  form.title.value = existing?.title || '';
  form.description.value = existing?.description || '';
  form.type.value = existing?.type || 'commitment';
  form.category.value = existing?.category || 'personal';
  form.priority.value = existing?.priority || 'normal';
  form.date.value = existing?.date || localDateString();
  form.duration.value = [15,30,45,60,90,120].includes(Number(existing?.duration)) ? String(existing.duration) : String(state.settings.defaultDuration);
  form.startTime.value = existing?.startTime || '';
  form.endTime.value = existing?.endTime || '';
  form.location.value = existing?.location || '';
  form.responsible.value = existing?.responsible || '';
  form.color.value = existing?.color || getCategory(existing?.category || 'personal').color;
  form.subtasks.value = (existing?.subtasks || []).map(item => typeof item === 'string' ? item : item.title).join('\n');
  form.recurrenceType.value = existing?.recurrence?.type || 'none';
  form.recurrenceUntil.value = existing?.recurrence?.until || '';
  form.reminder.value = existing?.reminders?.[0] ?? '';
  form.eisenhower.value = existing?.eisenhower || 'auto';
  for (const checkbox of els.activityForm.querySelectorAll('[name="recurrenceDays"]')) {
    checkbox.checked = existing?.recurrence?.days?.includes(Number(checkbox.value)) || false;
  }
  els.recurrenceDays.classList.toggle('hidden', form.recurrenceType.value !== 'custom');
  els.conflictAlert.classList.add('hidden');
  els.activityDialog.showModal();
  setTimeout(() => form.title.focus(), 80);
  refreshIcons();
}

async function handleActivitySubmit(event) {
  event.preventDefault();
  const submit = els.activityForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const fd = new FormData(els.activityForm);
    const type = fd.get('type');
    const title = fd.get('title');
    const attachment = await fileToDataURL(fd.get('attachment')?.size ? fd.get('attachment') : null);

    if (type === 'habit') {
      await saveHabit({ title, weeklyGoal: 5, preferredTime: fd.get('startTime'), reminder: fd.get('reminder'), color: fd.get('color') });
      toast('Hábito criado. Ajuste a frequência na área de hábitos.','success');
    } else if (type === 'goal') {
      await saveGoal({
        title, description: fd.get('description'), deadline: fd.get('date'),
        category: fd.get('category'), priority: fd.get('priority'),
        steps: splitGoalIntoSteps(title, fd.get('description'))
      });
      toast('Meta criada e dividida em etapas.','success');
    } else {
      const recurrenceDays = [...els.activityForm.querySelectorAll('[name="recurrenceDays"]:checked')].map(input => Number(input.value));
      const duration = fd.get('duration') === 'custom'
        ? Math.max(1, timeToMinutes(fd.get('endTime')) - timeToMinutes(fd.get('startTime')))
        : Number(fd.get('duration'));
      const existing = fd.get('id') ? await db.get('activities', fd.get('id')) : null;
      const activity = await saveActivity({
        ...existing,
        id: fd.get('id') || undefined,
        title,
        description: fd.get('description'),
        type,
        category: fd.get('category'),
        priority: fd.get('priority'),
        date: fd.get('date'),
        startTime: fd.get('startTime'),
        endTime: fd.get('endTime'),
        duration,
        location: fd.get('location'),
        responsible: fd.get('responsible'),
        favorite: existing?.favorite || false,
        color: fd.get('color'),
        subtasks: String(fd.get('subtasks') || '').split('\n').map(value => value.trim()).filter(Boolean).map(value => ({ id:uid('sub'), title:value, done:false })),
        recurrence: { type: fd.get('recurrenceType'), days: recurrenceDays, until: fd.get('recurrenceUntil') },
        reminders: fd.get('reminder') === '' ? [] : [Number(fd.get('reminder'))],
        eisenhower: fd.get('eisenhower'),
        attachment: attachment || existing?.attachment || null
      });
      await scheduleActivityNotifications(activity).catch(console.warn);
      toast(existing ? 'Atividade atualizada.' : 'Atividade salva.','success');
    }

    els.activityDialog.close();
    await reloadData();
    renderRoute();
  } catch (error) {
    toast(error.message,'error');
  } finally {
    submit.disabled = false;
  }
}

async function checkFormConflicts() {
  const fd = new FormData(els.activityForm);
  if (!fd.get('date') || !fd.get('startTime')) return els.conflictAlert.classList.add('hidden');
  const duration = Number(fd.get('duration')) || 30;
  const candidate = {
    date: fd.get('date'),
    startTime: fd.get('startTime'),
    endTime: fd.get('endTime') || minutesToTime(timeToMinutes(fd.get('startTime')) + duration),
    duration
  };
  const conflicts = detectConflicts(candidate, state.occurrences, fd.get('id') || null);
  if (!conflicts.length) return els.conflictAlert.classList.add('hidden');
  els.conflictAlert.innerHTML = `<strong>Conflito de horário detectado.</strong><br>${conflicts.slice(0,3).map(conflict => `${escapeHTML(conflict.activity.title)} (${formatTime(conflict.activity.startTime)}–${formatTime(conflict.activity.endTime)}), sobreposição de ${conflict.minutes} min`).join('<br>')}<br><small>O cadastro continua permitido, mas revise o horário.</small>`;
  els.conflictAlert.classList.remove('hidden');
}

async function completeById(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  const source = state.sources.find(record => record.id === (item.sourceId || item.id));
  const currentStatus = item.status === 'completed';
  if (item.isOccurrence && !currentStatus) {
    await db.put('activities', { ...source, exceptions: [...new Set([...(source.exceptions || []), item.date])] });
    await db.put('activities', {
      ...item,
      id: uid('act'),
      sourceId: undefined,
      isOccurrence: false,
      recurrence: { type:'none' },
      status: 'completed',
      completedAt: new Date().toISOString()
    });
  } else {
    await completeActivity(source?.id || item.id, currentStatus ? 'pending' : 'completed');
  }
  beep(740, .08);
  vibrate(40);
  await reloadData(false);
  renderRoute();
  toast(currentStatus ? 'Atividade reaberta.' : 'Atividade concluída.','success');
}

async function postponeById(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  const amount = Number(prompt('Adiar por quantos minutos?', '30'));
  if (!Number.isFinite(amount) || amount <= 0) return;
  if (item.isOccurrence) {
    const source = state.sources.find(record => record.id === item.sourceId);
    await db.put('activities', { ...source, exceptions:[...new Set([...(source.exceptions || []),item.date])] });
    const shiftedStart = minutesToTime(timeToMinutes(item.startTime || '09:00') + amount);
    const shiftedEnd = minutesToTime(timeToMinutes(shiftedStart) + Number(item.duration || 30));
    await db.put('activities', { ...item, id:uid('act'), sourceId:undefined, isOccurrence:false, recurrence:{type:'none'}, startTime:shiftedStart, endTime:shiftedEnd });
  } else {
    await postponeActivity(item.id, amount);
  }
  await reloadData();
  renderRoute();
  toast(`Atividade adiada em ${amount} minutos.`,'success');
}

async function editActivity(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  if (item.isOccurrence) {
    const wholeSeries = confirm('Editar toda a série?\n\nOK: editar a série inteira.\nCancelar: criar uma edição apenas para esta ocorrência.');
    const source = state.sources.find(record => record.id === item.sourceId);
    if (wholeSeries) return openActivityDialog(source);
    await db.put('activities', { ...source, exceptions:[...new Set([...(source.exceptions || []), item.date])] });
    const standalone = { ...item, id:uid('act'), sourceId:undefined, isOccurrence:false, recurrence:{type:'none'} };
    return openActivityDialog(standalone);
  }
  openActivityDialog(item);
}

async function deleteActivity(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  if (item.isOccurrence) {
    const wholeSeries = confirm('Excluir toda a série?\n\nOK: excluir a série inteira.\nCancelar: excluir somente esta ocorrência.');
    if (wholeSeries) {
      if (!confirm(`Confirmar exclusão da série “${item.title}”?`)) return;
      await db.remove('activities', item.sourceId);
    } else {
      const source = state.sources.find(record => record.id === item.sourceId);
      await db.put('activities', { ...source, exceptions:[...new Set([...(source.exceptions || []),item.date])] });
    }
  } else {
    if (!confirm(`Mover “${item.title}” para a lixeira?`)) return;
    await db.remove('activities', item.id);
  }
  await reloadData(false);
  renderRoute();
  toast('Atividade removida.','success');
}

async function duplicateActivity(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  const duplicate = {
    ...item,
    id: uid('act'),
    title: `${item.title} — cópia`,
    recurrence: { type:'none' },
    sourceId: undefined,
    isOccurrence: false,
    status: 'pending',
    completedAt: null,
    date: item.date
  };
  await db.put('activities', duplicate);
  await reloadData(false);
  renderRoute();
  toast('Atividade duplicada.','success');
}


async function toggleFavorite(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  const sourceId = item.sourceId || item.id;
  const source = state.sources.find(record => record.id === sourceId);
  await db.put('activities',{...source,favorite:!source.favorite});
  await reloadData(false);
  renderRoute();
  toast(source.favorite ? 'Removida dos favoritos.' : 'Adicionada aos favoritos.','success');
}

async function toggleSubtask(id, stepId) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  const source = state.sources.find(record => record.id === (item.sourceId || item.id));
  const subtasks = (source.subtasks || []).map(sub => sub.id === stepId ? {...sub,done:!sub.done} : sub);
  await db.put('activities',{...source,subtasks});
  await reloadData(false);
  renderRoute();
}

async function shareActivity(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item) return;
  const text = `${item.title}\n${formatDate(item.date,{weekday:'long',month:'long',year:'numeric'})}${item.startTime ? `, ${item.startTime}–${item.endTime}` : ''}${item.location ? `\nLocal: ${item.location}` : ''}`;
  try {
    if (navigator.share) await navigator.share({title:item.title,text});
    else {
      await navigator.clipboard.writeText(text);
      toast('Atividade copiada para a área de transferência.','success');
    }
  } catch (error) {
    if (error.name !== 'AbortError') toast('Não foi possível compartilhar.','error');
  }
}

function downloadAttachment(id) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  const attachment = item?.attachment;
  if (!attachment?.data) return toast('Anexo indisponível.','error');
  const anchor = document.createElement('a');
  anchor.href = attachment.data;
  anchor.download = attachment.name || 'anexo';
  anchor.click();
}

async function addQuickNote() {
  const title = prompt('Título da nota:','Nota rápida');
  if (!title) return;
  const content = prompt('Conteúdo:','');
  if (content === null) return;
  await db.put('notes',{id:uid('note'),title,content});
  await reloadData(false);
  renderHome();
  toast('Nota salva.','success');
}

async function deleteQuickNote(id) {
  if (!confirm('Excluir esta nota?')) return;
  await db.remove('notes',id);
  await reloadData(false);
  renderHome();
}

async function moveActivityToDate(id,newDate) {
  const item = state.occurrences.find(record => record.id === id) || state.sources.find(record => record.id === id);
  if (!item || item.date === newDate) return;
  if (item.isOccurrence) {
    const source = state.sources.find(record => record.id === item.sourceId);
    await db.put('activities',{...source,exceptions:[...new Set([...(source.exceptions || []),item.date])]});
    await db.put('activities',{...item,id:uid('act'),date:newDate,sourceId:undefined,isOccurrence:false,recurrence:{type:'none'}});
  } else {
    await db.put('activities',{...item,date:newDate});
  }
  await reloadData();
  renderAgenda();
  toast(`Atividade movida para ${formatDate(newDate,{weekday:'long',month:'long',year:'numeric'})}.`,'success');
}

function startFocusFor(id) {
  const item = state.occurrences.find(record => record.id === id);
  if (!item) return;
  state.selectedFocusActivity = item;
  state.focusMinutes = item.duration && item.duration <= 120 ? item.duration : 25;
  timer.configure(state.focusMinutes, item);
  router.go('focus');
}

function handleAssistant(command) {
  const response = document.querySelector('#assistant-response');
  if (!response) return;
  const now = new Date();
  const today = localDateString(now);
  const itemsToday = state.occurrences.filter(item => item.date === today && item.status !== 'completed');
  const overdue = state.occurrences.filter(item => getStatus(item) === 'overdue');
  const pending = state.occurrences.filter(item => item.status !== 'completed' && item.status !== 'cancelled');
  if (command === 'today') {
    response.innerHTML = itemsToday.length
      ? `Hoje existem <strong>${itemsToday.length} atividades pendentes</strong>. Comece por “${escapeHTML([...itemsToday].sort((a,b)=>priorityScore(b)-priorityScore(a))[0].title)}”.`
      : 'Não há pendências hoje. Preserve o tempo livre ou antecipe somente uma tarefa curta.';
  }
  if (command === 'late') {
    response.innerHTML = overdue.length
      ? `Há <strong>${overdue.length} atividades atrasadas</strong>. Revise primeiro: ${overdue.slice(0,3).map(item => `“${escapeHTML(item.title)}”`).join(', ')}. Exclua ou reprograme o que não é mais relevante.`
      : 'Nenhuma atividade atrasada foi encontrada.';
  }
  if (command === 'free') {
    const tomorrow = addDays(now,1);
    const slots = suggestFreeSlots(state.occurrences, tomorrow, 45, state.settings);
    response.innerHTML = slots.length
      ? `Amanhã há espaço para uma tarefa de 45 minutos, por exemplo <strong>${slots[0].start}–${slots[0].end}</strong>.`
      : 'Amanhã não há um intervalo adequado dentro dos horários configurados ou o limite diário foi atingido.';
  }
  if (command === 'priority') {
    const top = [...pending].sort((a,b)=>priorityScore(b)-priorityScore(a))[0];
    response.innerHTML = top
      ? `A prioridade sugerida é <strong>“${escapeHTML(top.title)}”</strong>, considerando prazo, atraso, importância e duração. A prioridade não foi alterada automaticamente.`
      : 'Não há atividade pendente para priorizar.';
  }
  if (command === 'week') {
    const unscheduled = pending.filter(item => !item.startTime && item.date <= localDateString(addDays(now,7)));
    response.innerHTML = unscheduled.length
      ? `Existem <strong>${unscheduled.length} tarefas sem horário</strong>. Use “Organizar minha semana” na Agenda para ver encaixes e confirmar cada alteração.`
      : 'As tarefas da próxima semana já possuem horários ou não há tarefas pendentes no período.';
  }
}

async function organizeWeek() {
  const from = startOfWeek(new Date(), state.settings.weekStartsOn);
  const to = addDays(from,6);
  const candidates = state.sources
    .filter(item => !item.startTime && item.status !== 'completed' && item.date >= localDateString(from) && item.date <= localDateString(to))
    .sort((a,b) => priorityScore(b)-priorityScore(a));
  if (!candidates.length) return toast('Não há tarefas sem horário nesta semana.');
  let changed = 0;
  for (const task of candidates) {
    const slots = suggestFreeSlots(state.occurrences, parseLocalDate(task.date), task.duration || state.settings.defaultDuration, state.settings);
    if (!slots.length) continue;
    const slot = slots[0];
    const accepted = confirm(`Sugerir ${slot.start}–${slot.end} para “${task.title}” em ${formatDate(task.date,{weekday:'long',year:undefined})}?`);
    if (accepted) {
      await db.put('activities', { ...task, startTime:slot.start, endTime:slot.end });
      changed++;
      await reloadData(false);
    }
  }
  renderAgenda();
  toast(changed ? `${changed} tarefa(s) organizada(s) com confirmação.` : 'Nenhuma alteração foi confirmada.', changed ? 'success' : '');
}

async function addHabitPrompt() {
  const title = prompt('Nome do hábito:');
  if (!title) return;
  const weeklyGoal = Number(prompt('Meta semanal (1 a 7):','5'));
  const preferredTime = prompt('Horário preferencial (HH:MM, opcional):','');
  await saveHabit({ title, weeklyGoal:Math.max(1,Math.min(7,weeklyGoal || 5)), preferredTime });
  await reloadData(false); renderProfile(); toast('Hábito criado.','success');
}

async function addGoalPrompt() {
  const title = prompt('Título da meta:');
  if (!title) return;
  const description = prompt('Descrição curta:','') || '';
  const deadline = prompt('Prazo no formato AAAA-MM-DD (opcional):','') || '';
  await saveGoal({ title, description, deadline, steps:splitGoalIntoSteps(title,description), priority:'normal' });
  await reloadData(false); renderProfile(); toast('Meta criada com etapas sugeridas.','success');
}

async function splitGoal(goalId) {
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal) return;
  const replace = confirm('Substituir as etapas atuais por uma nova divisão sugerida?');
  if (!replace) return;
  await db.put('goals', { ...goal, steps:splitGoalIntoSteps(goal.title,goal.description), progress:0 });
  await reloadData(false); renderProfile();
}

async function deleteDomainItem(store, id, label) {
  if (!confirm(`Mover este ${label} para a lixeira?`)) return;
  await db.remove(store,id);
  await reloadData(false); renderProfile();
}

async function exportData() {
  const data = await db.exportData();
  downloadFile(`focus-backup-${localDateString()}.json`, JSON.stringify(data,null,2));
  toast('Backup exportado.','success');
}

async function importData(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const replace = confirm('Substituir os dados atuais?\n\nOK: substituir.\nCancelar: mesclar.');
    await db.importData(payload,{replace});
    state.profile = await db.getSetting('profile', state.profile);
    state.settings = { ...state.settings, ...(await db.getSetting('appSettings',{})) };
    state.categories = await db.getSetting('categories',CATEGORY_DEFAULTS);
    applyTheme();
    await reloadData();
    renderRoute();
    toast('Backup importado.','success');
  } catch (error) {
    toast(`Falha ao importar: ${error.message}`,'error');
  }
}

function exportCalendar() {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//FOCUS//PT-BR'];
  for (const item of state.occurrences.filter(item => item.startTime).slice(0,1000)) {
    const start = `${item.date.replaceAll('-','')}T${item.startTime.replace(':','')}00`;
    const end = `${item.date.replaceAll('-','')}T${(item.endTime || minutesToTime(timeToMinutes(item.startTime)+(item.duration||30))).replace(':','')}00`;
    lines.push('BEGIN:VEVENT',`UID:${item.id}@focus`,`DTSTART:${start}`,`DTEND:${end}`,`SUMMARY:${icsEscape(item.title)}`,`DESCRIPTION:${icsEscape(item.description || '')}`,'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  downloadFile(`focus-agenda-${localDateString()}.ics`,lines.join('\r\n'),'text/calendar');
  toast('Agenda exportada em formato ICS.','success');
}

async function syncNow() {
  if (!state.user) return;
  try {
    setSyncStatus('Sincronizando…','warning');
    const upload = await syncLocalToCloud(state.user.uid);
    const download = await pullCloudToLocal(state.user.uid);
    await reloadData();
    renderRoute();
    setSyncStatus(`Sincronizado • ${upload.count + download.count} registros`,'success');
    toast('Sincronização concluída.','success');
  } catch (error) {
    setSyncStatus('Falha na sincronização','error');
    toast(error.message,'error');
  }
}

async function removeDemo() {
  if (!confirm('Remover todos os dados de demonstração? Seus dados próprios serão mantidos.')) return;
  await db.removeDemoData();
  await reloadData(false); renderRoute(); toast('Demonstração removida.','success');
}

async function clearAllData() {
  const confirmation = prompt('Esta ação é permanente. Digite APAGAR para confirmar:');
  if (confirmation !== 'APAGAR') return;
  await db.clearAll();
  location.reload();
}

async function addCategory() {
  const name = prompt('Nome da categoria:');
  if (!name) return;
  const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  if (state.categories.some(cat => cat.id === id)) return toast('Já existe uma categoria com este identificador.','error');
  state.categories.push({id,name,color:'#4F46E5',icon:'tag'});
  await db.setSetting('categories',state.categories); renderProfile();
}

async function editCategory(id) {
  const category = getCategory(id);
  const name = prompt('Novo nome:',category.name);
  if (!name) return;
  const color = prompt('Cor hexadecimal:',category.color) || category.color;
  state.categories = state.categories.map(cat => cat.id === id ? {...cat,name,color} : cat);
  await db.setSetting('categories',state.categories); renderProfile();
}

async function deleteCategory(id) {
  const used = state.sources.some(item => item.category === id);
  if (used) return toast('A categoria está em uso. Reclassifique as atividades antes de excluir.','error');
  if (!confirm('Excluir esta categoria?')) return;
  state.categories = state.categories.filter(cat => cat.id !== id);
  await db.setSetting('categories',state.categories); renderProfile();
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'settings-form') return;
  event.preventDefault();
  const fd = new FormData(event.target);
  const notificationsRequested = fd.get('notifications') === 'on';
  if (notificationsRequested && !state.settings.notifications) {
    const permission = await requestNotificationPermission();
    if (!permission.granted) toast('Permissão de notificação não concedida.','error');
    if (permission.granted) await ensureNativeExactAlarms();
    state.settings.notifications = permission.granted;
  } else {
    state.settings.notifications = notificationsRequested;
  }
  state.profile.name = fd.get('name');
  state.settings = {
    ...state.settings,
    dayStart:fd.get('dayStart'),
    dayEnd:fd.get('dayEnd'),
    weekStartsOn:Number(fd.get('weekStartsOn')),
    dailyTaskLimit:Number(fd.get('dailyTaskLimit')),
    defaultDuration:Number(fd.get('defaultDuration')),
    darkMode:fd.get('darkMode') === 'on',
    sounds:fd.get('sounds') === 'on',
    vibration:fd.get('vibration') === 'on'
  };
  await db.setSetting('profile',state.profile);
  await db.setSetting('appSettings',state.settings);
  els.avatarInitials.textContent = getInitials(state.profile.name);
  applyTheme();
  toast('Configurações salvas.','success');
  renderProfile();
});

function openSearch() {
  els.searchInput.value = '';
  els.searchResults.innerHTML = '<p class="muted">Digite para pesquisar atividades, hábitos e metas.</p>';
  els.searchDialog.showModal();
  setTimeout(() => els.searchInput.focus(),50);
}

function renderSearchResults() {
  const query = els.searchInput.value.trim().toLowerCase();
  if (!query) {
    els.searchResults.innerHTML = '<p class="muted">Digite para pesquisar atividades, hábitos e metas.</p>';
    return;
  }
  const results = [
    ...state.sources.filter(item => `${item.title} ${item.description || ''}`.toLowerCase().includes(query)).map(item => ({...item,domain:'Atividade'})),
    ...state.habits.filter(item => item.title.toLowerCase().includes(query)).map(item => ({...item,domain:'Hábito'})),
    ...state.goals.filter(item => `${item.title} ${item.description || ''}`.toLowerCase().includes(query)).map(item => ({...item,domain:'Meta'}))
  ].slice(0,30);
  els.searchResults.innerHTML = results.length ? results.map(item => `<button class="search-result" data-search-domain="${item.domain}" data-search-id="${item.id}"><strong>${escapeHTML(item.title)}</strong><small>${item.domain}${item.date ? ` • ${formatDate(item.date,{weekday:undefined,year:undefined})}`:''}</small></button>`).join('') : '<p class="muted">Nenhum resultado encontrado.</p>';
}

els.searchResults.addEventListener('click', event => {
  const result = event.target.closest('[data-search-domain]');
  if (!result) return;
  els.searchDialog.close();
  if (result.dataset.searchDomain === 'Atividade') {
    const item = state.sources.find(record => record.id === result.dataset.searchId);
    if (item) openActivityDialog(item);
  } else {
    state.profileTab = result.dataset.searchDomain === 'Hábito' ? 'habits' : 'goals';
    router.go('profile');
    if (state.route === 'profile') renderProfile();
  }
});

async function handleSignIn(event) {
  event.preventDefault();
  const fd = new FormData(els.authForm);
  setAuthMessage('Entrando…','');
  try {
    const result = await signIn(fd.get('email'),fd.get('password'));
    state.user = result.user;
    els.authDialog.close();
    await syncNow();
    toast('Conta conectada.','success');
  } catch (error) {
    setAuthMessage(authErrorMessage(error),'error');
  }
}

async function handleCreateAccount() {
  const fd = new FormData(els.authForm);
  try {
    const result = await createAccount(fd.get('email'),fd.get('password'));
    state.user = result.user;
    els.authDialog.close();
    await syncNow();
    toast('Conta criada e dados locais sincronizados.','success');
  } catch (error) {
    setAuthMessage(authErrorMessage(error),'error');
  }
}

async function handleGoogleLogin() {
  try {
    const result = await signInWithGoogle();
    state.user = result.user;
    els.authDialog.close();
    await syncNow();
  } catch (error) {
    setAuthMessage(authErrorMessage(error),'error');
  }
}

async function handlePasswordRecovery() {
  const email = new FormData(els.authForm).get('email');
  try {
    await recoverPassword(email);
    setAuthMessage('E-mail de recuperação enviado.','success');
  } catch (error) {
    setAuthMessage(authErrorMessage(error),'error');
  }
}

async function signOutFlow() {
  await signOutUser().catch(console.warn);
  state.user = null;
  renderProfile();
  toast('Conta desconectada. Os dados locais permanecem disponíveis.');
}

async function observeAuthentication() {
  try {
    await initFirebase();
    await observeAuth(user => {
      state.user = user;
      if (state.route === 'profile') renderProfile();
      setSyncStatus(user ? 'Conta conectada' : 'Dados locais protegidos',user ? 'success' : '');
    });
  } catch (error) {
    console.warn('Firebase opcional não iniciado:',error);
  }
}

function setAuthMessage(message,type) {
  els.authMessage.textContent = message;
  els.authMessage.style.color = type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--muted)';
}

function authErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'E-mail ou senha inválidos.';
  if (code.includes('email-already-in-use')) return 'Este e-mail já possui conta.';
  if (code.includes('weak-password')) return 'A senha precisa ter pelo menos seis caracteres.';
  if (code.includes('popup-closed')) return 'A janela de acesso foi fechada.';
  return error.message || 'Não foi possível concluir o acesso.';
}

async function ensureNativeExactAlarms() {
  if (!isNative()) return;
  try {
    const status = await getExactAlarmStatus();
    if (status?.exact_alarm === 'granted' || status?.exact_alarm === 'unsupported') return;
    const shouldOpen = confirm('Para que os lembretes ocorram no horário exato, permita alarmes e lembretes nas configurações do Android. Abrir agora?');
    if (shouldOpen) await openExactAlarmSettings();
  } catch (error) {
    console.warn('Não foi possível verificar alarmes exatos:', error);
  }
}

function showNotificationSummary() {
  const upcoming = state.occurrences.filter(item => {
    const interval = activityInterval(item);
    return interval && interval.start > new Date() && interval.start < addDays(new Date(),2) && item.reminders?.length;
  });
  toast(upcoming.length ? `${upcoming.length} atividade(s) com lembrete nas próximas 48 horas.` : 'Nenhum lembrete nas próximas 48 horas.');
}

async function installPWA() {
  if (!state.deferredInstall) return;
  state.deferredInstall.prompt();
  await state.deferredInstall.userChoice;
  state.deferredInstall = null;
  els.installButton.hidden = true;
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  setSyncStatus(online ? (state.user ? 'Online • conta conectada' : 'Online • dados locais') : 'Offline • alterações salvas localmente',online ? 'success' : 'warning');
}

function setSyncStatus(text,status='') {
  if (!els.syncStatus) return;
  els.syncStatus.querySelector('span:last-child').textContent = text;
  const dot = els.syncStatus.querySelector('.status-dot');
  dot.style.background = status === 'error' ? 'var(--danger)' : status === 'warning' ? 'var(--warning)' : 'var(--success)';
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.darkMode ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',state.settings.darkMode ? '#0F1220' : '#3730A3');
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(console.warn));
  }
}

function getCategory(id) {
  return state.categories.find(category => category.id === id) || {id:id || 'other',name:'Outros',color:'#64748B',icon:'tag'};
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function focusPhrase(total,overdue) {
  if (!total) return 'Seu dia está livre. Planeje somente o que realmente precisa acontecer.';
  if (overdue) return `Existem ${overdue} pendência${overdue !== 1 ? 's' : ''} atrasada${overdue !== 1 ? 's' : ''}. Replaneje antes de adicionar mais carga.`;
  return 'Uma atividade por vez. Priorize o que tem prazo e preserve os intervalos.';
}

function occupancyLabel(value) {
  if (value < 30) return 'Dia leve';
  if (value < 60) return 'Dia equilibrado';
  if (value < 85) return 'Dia intenso';
  return 'Agenda sobrecarregada';
}

function statusLabel(status) {
  return {
    completed:'Concluída', overdue:'Atrasada', current:'Em andamento',
    soon:'Próxima', pending:'Pendente', cancelled:'Cancelada'
  }[status] || status;
}

function emptyState(icon,title,description) {
  return `<div class="empty-state"><div class="empty-icon"><i data-lucide="${icon}"></i></div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(description)}</p></div>`;
}

function secondsToClock(seconds) {
  const value = Math.max(0,Math.round(seconds));
  return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;
}

function timerStateText(value) {
  return {idle:'Pronto para começar',running:'Mantenha a atenção na atividade atual',paused:'Sessão pausada',completed:'Sessão concluída',abandoned:'Sessão encerrada'}[value] || '';
}

function toast(message,type='',duration=4300) {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : type === 'success' ? 'circle-check' : 'info'}"></i><span>${escapeHTML(message)}</span><button aria-label="Fechar">×</button>`;
  element.querySelector('button').addEventListener('click',() => element.remove());
  els.toastRegion.appendChild(element);
  refreshIcons();
  setTimeout(() => element.remove(),duration);
}

function beep(frequency=660,duration=.12) {
  if (!state.settings.sounds) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(.05,context.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime+duration);
  } catch {}
}

function vibrate(pattern) {
  if (state.settings.vibration && navigator.vibrate) navigator.vibrate(pattern);
}

function icsEscape(value='') {
  return String(value).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}
