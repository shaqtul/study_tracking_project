(function () {
  'use strict';

  // ===================== Storage Layer =====================
  const Store = {
    get(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
      catch { return fallback; }
    },
    set(key, val) { localStorage.setItem(key, JSON.stringify(val)); },
  };

  // ===================== Data Defaults =====================
  const DEFAULT_SUBJECTS = [
    { id: 's1', name: 'Math', color: '#6C63FF' },
    { id: 's2', name: 'Science', color: '#34D399' },
    { id: 's3', name: 'English', color: '#FB923C' },
    { id: 's4', name: 'Programming', color: '#A78BFA' },
  ];

  const TECHNIQUES = {
    pomodoro:       { focus: 25, break: 5,  rounds: 4, longBreak: 15 },
    'long-pomodoro': { focus: 50, break: 10, rounds: 4, longBreak: 20 },
    '5217':         { focus: 52, break: 17, rounds: 4, longBreak: 17 },
    stopwatch:      { focus: 0,  break: 0,  rounds: 1, longBreak: 0 },
    custom:         { focus: 30, break: 5,  rounds: 4, longBreak: 10 },
  };

  // ===================== State =====================
  let subjects = Store.get('subjects', DEFAULT_SUBJECTS);
  let sessions = Store.get('sessions', []);
  let dailyGoalHours = Store.get('dailyGoalHours', 4);

  let timerState = {
    running: false,
    paused: false,
    technique: 'pomodoro',
    phase: 'focus',
    round: 1,
    totalSeconds: 0,
    remaining: 0,
    elapsed: 0,
    intervalId: null,
    focusAccumulated: 0,
    startTimestamp: null,
  };

  // ===================== Helpers =====================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function fmtMinutes(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function fmtSeconds(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function dateKey(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  function todayKey() { return dateKey(new Date()); }

  function startOfWeek(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    dt.setDate(diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function getDaysInRange(start, end) {
    const days = [];
    const cur = new Date(start);
    while (cur <= end) {
      days.push(dateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  function getSubjectById(id) {
    return subjects.find(s => s.id === id) || { name: 'Unknown', color: '#6b7280' };
  }

  function minutesForDate(dk) {
    return sessions
      .filter(s => dateKey(s.date) === dk)
      .reduce((sum, s) => sum + s.duration, 0);
  }

  function saveSessions() { Store.set('sessions', sessions); }
  function saveSubjects() { Store.set('subjects', subjects); }

  // ===================== Sound =====================
  function playNotification() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.4);
      });
    } catch {}
  }

  // ===================== Navigation =====================
  function navigateTo(page) {
    $$('.page').forEach(p => p.classList.remove('active'));
    $$('.nav-link').forEach(l => l.classList.remove('active'));
    $(`#page-${page}`).classList.add('active');
    $(`.nav-link[data-page="${page}"]`).classList.add('active');

    if (page === 'dashboard') refreshDashboard();
    if (page === 'timer') refreshTimerPage();
    if (page === 'history') refreshHistory();
    if (page === 'stats') refreshStats();
    if (page === 'goals') refreshGoals();
    if (page === 'subjects') refreshSubjects();
  }

  $$('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  // ===================== Subject Dropdowns =====================
  function populateSubjectDropdowns() {
    const selects = [
      $('#timer-subject'),
      $('#quick-subject'),
      $('#history-subject-filter'),
    ];
    selects.forEach(sel => {
      if (!sel) return;
      const current = sel.value;
      const isFilter = sel.id === 'history-subject-filter';
      sel.innerHTML = isFilter ? '<option value="">All Subjects</option>' : '';
      subjects.forEach(s => {
        sel.innerHTML += `<option value="${s.id}">${s.name}</option>`;
      });
      if (current && [...sel.options].some(o => o.value === current)) {
        sel.value = current;
      }
    });
  }

  // ===================== Dashboard =====================
  let dashWeekChart = null;
  let dashSubjectChart = null;

  function refreshDashboard() {
    const today = todayKey();
    const todayMin = minutesForDate(today);

    $('#dash-today-time').textContent = fmtMinutes(todayMin);
    const goalMin = dailyGoalHours * 60;
    const pct = goalMin > 0 ? Math.min(100, (todayMin / goalMin) * 100) : 0;
    $('#dash-goal-bar').style.width = pct + '%';

    const weekStart = startOfWeek(new Date());
    const weekEnd = new Date();
    const weekDays = getDaysInRange(weekStart, weekEnd);
    const weekMin = weekDays.reduce((sum, d) => sum + minutesForDate(d), 0);
    $('#dash-week-time').textContent = fmtMinutes(weekMin);

    $('#dash-streak').textContent = calcStreak() + ' days';
    $('#dash-total-sessions').textContent = sessions.length;

    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    $('#current-date').textContent = now.toLocaleDateString('en-US', options);

    buildDashWeekChart(weekStart);
    buildDashSubjectChart(weekStart, weekEnd);

    const recent = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    $('#dash-recent-sessions').innerHTML = recent.length === 0
      ? '<p class="empty-state">No sessions yet. Start studying!</p>'
      : recent.map(s => sessionHTML(s)).join('');
  }

  function buildDashWeekChart(weekStart) {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const allDays = getDaysInRange(weekStart, new Date(weekStart.getTime() + 6 * 86400000));
    const data = allDays.map(d => +(minutesForDate(d) / 60).toFixed(2));

    if (dashWeekChart) dashWeekChart.destroy();
    dashWeekChart = new Chart($('#dash-week-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: 'rgba(108, 99, 255, 0.6)',
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: chartDefaults('Hours'),
    });
  }

  function buildDashSubjectChart(start, end) {
    const days = getDaysInRange(start, end);
    const map = {};
    sessions.forEach(s => {
      if (days.includes(dateKey(s.date))) {
        map[s.subjectId] = (map[s.subjectId] || 0) + s.duration;
      }
    });

    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([id]) => getSubjectById(id).name);
    const data = entries.map(([, m]) => +(m / 60).toFixed(2));
    const colors = entries.map(([id]) => getSubjectById(id).color);

    if (dashSubjectChart) dashSubjectChart.destroy();
    dashSubjectChart = new Chart($('#dash-subject-chart'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3b4', padding: 12, font: { size: 12 } } },
        },
      },
    });
  }

  // ===================== Timer Engine =====================
  const CIRCUMFERENCE = 2 * Math.PI * 120; // matches SVG r=120

  function getTechnique() {
    const t = { ...TECHNIQUES[timerState.technique] };
    if (timerState.technique === 'custom') {
      t.focus = parseInt($('#custom-focus').value) || 30;
      t.break = parseInt($('#custom-break').value) || 5;
    }
    return t;
  }

  function resetTimerDisplay() {
    const t = getTechnique();
    timerState.phase = 'focus';
    timerState.round = 1;
    timerState.focusAccumulated = 0;
    timerState.elapsed = 0;
    timerState.startTimestamp = null;

    if (timerState.technique === 'stopwatch') {
      timerState.totalSeconds = 0;
      timerState.remaining = 0;
      $('#timer-time').textContent = '00:00';
      $('#timer-phase').textContent = 'Stopwatch';
      $('#timer-session-count').textContent = '';
      updateRing(0);
    } else {
      timerState.totalSeconds = t.focus * 60;
      timerState.remaining = timerState.totalSeconds;
      $('#timer-time').textContent = fmtSeconds(timerState.remaining);
      $('#timer-phase').textContent = 'Focus';
      $('#timer-session-count').textContent = `Session 1 / ${t.rounds}`;
      updateRing(0);
    }
    updatePhaseStyle();
    showTimerButtons('idle');
  }

  function updateRing(fraction) {
    const offset = CIRCUMFERENCE * (1 - fraction);
    $('#timer-progress').style.strokeDashoffset = offset;
  }

  function updatePhaseStyle() {
    const ring = $('#timer-progress');
    const label = $('#timer-phase');
    if (timerState.phase === 'break' || timerState.phase === 'longBreak') {
      ring.classList.add('break-phase');
      label.style.color = 'var(--accent-green)';
    } else {
      ring.classList.remove('break-phase');
      label.style.color = 'var(--accent-blue)';
    }
  }

  function showTimerButtons(state) {
    const start = $('#timer-start');
    const pause = $('#timer-pause');
    const stop = $('#timer-stop');
    start.classList.toggle('hidden', state !== 'idle');
    pause.classList.toggle('hidden', state !== 'running' && state !== 'paused');
    stop.classList.toggle('hidden', state === 'idle');
    pause.textContent = state === 'paused' ? 'Resume' : 'Pause';
  }

  function startTimer() {
    const t = getTechnique();
    if (!timerState.running) {
      timerState.running = true;
      timerState.paused = false;
      if (!timerState.startTimestamp) timerState.startTimestamp = Date.now();
    }
    showTimerButtons('running');

    timerState.intervalId = setInterval(() => {
      if (timerState.technique === 'stopwatch') {
        timerState.elapsed++;
        timerState.focusAccumulated++;
        $('#timer-time').textContent = fmtSeconds(timerState.elapsed);
        const maxDisplay = 3600;
        updateRing(Math.min(timerState.elapsed / maxDisplay, 1));
        updateDocTitle(fmtSeconds(timerState.elapsed));
      } else {
        timerState.remaining--;
        if (timerState.remaining < 0) {
          handlePhaseEnd(t);
          return;
        }
        const fraction = 1 - timerState.remaining / timerState.totalSeconds;
        updateRing(fraction);
        $('#timer-time').textContent = fmtSeconds(timerState.remaining);
        if (timerState.phase === 'focus') timerState.focusAccumulated++;
        updateDocTitle(fmtSeconds(timerState.remaining));
      }
    }, 1000);
  }

  function handlePhaseEnd(t) {
    playNotification();
    if (timerState.phase === 'focus') {
      if (timerState.round >= t.rounds) {
        timerState.phase = 'longBreak';
        timerState.totalSeconds = t.longBreak * 60;
        $('#timer-phase').textContent = 'Long Break';
      } else {
        timerState.phase = 'break';
        timerState.totalSeconds = t.break * 60;
        $('#timer-phase').textContent = 'Break';
      }
    } else {
      if (timerState.phase === 'longBreak') {
        stopAndSave();
        return;
      }
      timerState.round++;
      timerState.phase = 'focus';
      timerState.totalSeconds = t.focus * 60;
      $('#timer-phase').textContent = 'Focus';
      $('#timer-session-count').textContent = `Session ${timerState.round} / ${t.rounds}`;
    }
    timerState.remaining = timerState.totalSeconds;
    updatePhaseStyle();
    updateRing(0);
  }

  function pauseTimer() {
    if (timerState.paused) {
      timerState.paused = false;
      startTimer();
    } else {
      timerState.paused = true;
      clearInterval(timerState.intervalId);
      showTimerButtons('paused');
    }
  }

  function stopAndSave() {
    clearInterval(timerState.intervalId);
    timerState.running = false;
    timerState.paused = false;
    document.title = 'StudyFlow — Study Time Tracker';

    const focusMin = Math.round(timerState.focusAccumulated / 60);
    if (focusMin >= 1) {
      const session = {
        id: uid(),
        subjectId: $('#timer-subject').value || (subjects[0] && subjects[0].id),
        duration: focusMin,
        date: new Date().toISOString(),
        notes: $('#timer-notes').value.trim(),
        technique: timerState.technique,
      };
      sessions.push(session);
      saveSessions();
      $('#timer-notes').value = '';
    }

    resetTimerDisplay();
  }

  function updateDocTitle(time) {
    const phaseLabel = timerState.technique === 'stopwatch' ? '' : ` (${timerState.phase})`;
    document.title = `${time}${phaseLabel} — StudyFlow`;
  }

  function refreshTimerPage() {
    populateSubjectDropdowns();
    if (!timerState.running && !timerState.paused) {
      resetTimerDisplay();
    }
  }

  // Technique selector
  $$('.technique-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (timerState.running) return;
      $$('.technique-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      timerState.technique = btn.dataset.technique;
      $('#custom-settings').classList.toggle('hidden', timerState.technique !== 'custom');
      resetTimerDisplay();
    });
  });

  $('#timer-start').addEventListener('click', startTimer);
  $('#timer-pause').addEventListener('click', pauseTimer);
  $('#timer-stop').addEventListener('click', stopAndSave);

  // ===================== History =====================
  function sessionHTML(s, showDelete = false) {
    const subj = getSubjectById(s.subjectId);
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const deleteBtn = showDelete
      ? `<div class="session-actions"><button data-delete="${s.id}" title="Delete">&#10005;</button></div>`
      : '';
    return `
      <div class="session-item">
        <div class="session-color" style="background:${subj.color}"></div>
        <div class="session-info">
          <div class="session-subject">${subj.name}</div>
          <div class="session-meta">${dateStr} at ${timeStr}${s.notes ? ' — ' + escapeHtml(s.notes) : ''}</div>
        </div>
        <div class="session-duration">${fmtMinutes(s.duration)}</div>
        ${deleteBtn}
      </div>`;
  }

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function refreshHistory() {
    populateSubjectDropdowns();
    applyHistoryFilter();
  }

  function applyHistoryFilter() {
    let filtered = [...sessions];
    const from = $('#history-date-from').value;
    const to = $('#history-date-to').value;
    const subj = $('#history-subject-filter').value;

    if (from) filtered = filtered.filter(s => dateKey(s.date) >= from);
    if (to) filtered = filtered.filter(s => dateKey(s.date) <= to);
    if (subj) filtered = filtered.filter(s => s.subjectId === subj);

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const list = $('#history-list');
    const empty = $('#history-empty');
    if (filtered.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
    } else {
      empty.classList.add('hidden');
      list.innerHTML = filtered.map(s => sessionHTML(s, true)).join('');
    }
  }

  $('#history-filter-btn').addEventListener('click', applyHistoryFilter);

  document.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-delete]');
    if (delBtn) {
      const id = delBtn.dataset.delete;
      sessions = sessions.filter(s => s.id !== id);
      saveSessions();
      refreshHistory();
    }
  });

  // ===================== Statistics =====================
  let statsTimeChart = null;
  let statsSubjectChart = null;
  let statsHourChart = null;
  let statsRange = 'week';

  function refreshStats() {
    const now = new Date();
    let start, end = now;

    if (statsRange === 'week') {
      start = startOfWeek(now);
    } else if (statsRange === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      start = new Date(now.getFullYear(), 0, 1);
    }

    const days = getDaysInRange(start, end);
    const rangeSessions = sessions.filter(s => {
      const dk = dateKey(s.date);
      return dk >= days[0] && dk <= days[days.length - 1];
    });

    const totalMin = rangeSessions.reduce((sum, s) => sum + s.duration, 0);
    const daysWithData = new Set(rangeSessions.map(s => dateKey(s.date))).size;
    const avgMin = daysWithData > 0 ? totalMin / daysWithData : 0;
    const dayTotals = {};
    rangeSessions.forEach(s => {
      const dk = dateKey(s.date);
      dayTotals[dk] = (dayTotals[dk] || 0) + s.duration;
    });
    const bestDayMin = Math.max(0, ...Object.values(dayTotals));

    $('#stats-total-time').textContent = fmtMinutes(totalMin);
    $('#stats-avg-day').textContent = fmtMinutes(avgMin);
    $('#stats-best-day').textContent = fmtMinutes(bestDayMin);
    $('#stats-sessions-count').textContent = rangeSessions.length;

    buildStatsTimeChart(days, dayTotals);
    buildStatsSubjectChart(rangeSessions);
    buildStatsHourChart(rangeSessions);
  }

  function buildStatsTimeChart(days, dayTotals) {
    const labels = days.map(d => {
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const data = days.map(d => +((dayTotals[d] || 0) / 60).toFixed(2));
    const goalLine = Array(days.length).fill(dailyGoalHours);

    if (statsTimeChart) statsTimeChart.destroy();
    statsTimeChart = new Chart($('#stats-time-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Study Hours',
            data,
            backgroundColor: 'rgba(108, 99, 255, 0.6)',
            borderRadius: 6,
            borderSkipped: false,
          },
          {
            label: 'Daily Goal',
            data: goalLine,
            type: 'line',
            borderColor: 'rgba(251, 146, 60, 0.6)',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: chartDefaults('Hours'),
    });
  }

  function buildStatsSubjectChart(rangeSessions) {
    const map = {};
    rangeSessions.forEach(s => {
      map[s.subjectId] = (map[s.subjectId] || 0) + s.duration;
    });
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(([id]) => getSubjectById(id).name);
    const data = entries.map(([, m]) => +(m / 60).toFixed(2));
    const colors = entries.map(([id]) => getSubjectById(id).color);

    if (statsSubjectChart) statsSubjectChart.destroy();
    statsSubjectChart = new Chart($('#stats-subject-chart'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#9ca3b4', padding: 12, font: { size: 12 } } },
        },
      },
    });
  }

  function buildStatsHourChart(rangeSessions) {
    const hours = new Array(24).fill(0);
    rangeSessions.forEach(s => {
      const h = new Date(s.date).getHours();
      hours[h] += s.duration;
    });

    const labels = hours.map((_, i) => `${String(i).padStart(2, '0')}:00`);
    const data = hours.map(m => +(m / 60).toFixed(2));

    if (statsHourChart) statsHourChart.destroy();
    statsHourChart = new Chart($('#stats-hour-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: 'rgba(167, 139, 250, 0.6)',
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: chartDefaults('Hours'),
    });
  }

  $$('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.range-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      statsRange = btn.dataset.range;
      refreshStats();
    });
  });

  // ===================== Goals & Streaks =====================
  function calcStreak() {
    const today = new Date();
    let streak = 0;
    let d = new Date(today);
    while (true) {
      const dk = dateKey(d);
      const min = minutesForDate(dk);
      if (min > 0) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  function calcBestStreak() {
    if (sessions.length === 0) return 0;
    const allDates = [...new Set(sessions.map(s => dateKey(s.date)))].sort();
    let best = 1, current = 1;
    for (let i = 1; i < allDates.length; i++) {
      const prev = new Date(allDates[i - 1] + 'T12:00:00');
      const curr = new Date(allDates[i] + 'T12:00:00');
      const diff = (curr - prev) / 86400000;
      if (diff === 1) {
        current++;
        best = Math.max(best, current);
      } else {
        current = 1;
      }
    }
    return Math.max(best, current);
  }

  function refreshGoals() {
    $('#goal-daily-hours').value = dailyGoalHours;
    const todayMin = minutesForDate(todayKey());
    const goalMin = dailyGoalHours * 60;
    const pct = goalMin > 0 ? Math.min(100, Math.round((todayMin / goalMin) * 100)) : 0;

    $('#goal-percent').textContent = pct + '%';
    $('#goal-detail').textContent = `${fmtMinutes(todayMin)} / ${dailyGoalHours}h`;

    const circumference = 2 * Math.PI * 90;
    const offset = circumference * (1 - pct / 100);
    $('#goal-progress-ring').style.strokeDashoffset = offset;

    buildWeekGoalGrid();

    $('#streak-current').textContent = calcStreak();
    $('#streak-best').textContent = calcBestStreak();
  }

  function buildWeekGoalGrid() {
    const weekStart = startOfWeek(new Date());
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const goalMin = dailyGoalHours * 60;

    let html = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const dk = dateKey(d);
      const min = minutesForDate(dk);
      const pct = goalMin > 0 ? Math.min(100, (min / goalMin) * 100) : 0;
      const met = pct >= 100 ? 'goal-met' : '';
      html += `
        <div class="week-day-card">
          <span class="week-day-name">${dayNames[i]}</span>
          <div class="week-day-bar-wrapper">
            <div class="week-day-bar ${met}" style="height:${pct}%"></div>
          </div>
          <span class="week-day-time">${fmtMinutes(min)}</span>
        </div>`;
    }
    $('#week-goal-grid').innerHTML = html;
  }

  $('#goal-save-btn').addEventListener('click', () => {
    dailyGoalHours = parseFloat($('#goal-daily-hours').value) || 4;
    Store.set('dailyGoalHours', dailyGoalHours);
    refreshGoals();
  });

  // ===================== Subjects Management =====================
  function refreshSubjects() {
    const list = $('#subjects-list');
    list.innerHTML = subjects.map(s => {
      const totalMin = sessions.filter(ss => ss.subjectId === s.id).reduce((sum, ss) => sum + ss.duration, 0);
      return `
        <div class="subject-item">
          <div class="subject-dot" style="background:${s.color}"></div>
          <span class="subject-name">${escapeHtml(s.name)}</span>
          <span class="subject-hours">${fmtMinutes(totalMin)} total</span>
          <button class="subject-delete" data-subject-delete="${s.id}" title="Delete">&#10005;</button>
        </div>`;
    }).join('');
    populateSubjectDropdowns();
  }

  $('#subject-add-btn').addEventListener('click', () => {
    const name = $('#subject-name').value.trim();
    if (!name) return;
    subjects.push({ id: uid(), name, color: $('#subject-color').value });
    saveSubjects();
    $('#subject-name').value = '';
    refreshSubjects();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-subject-delete]');
    if (btn) {
      const id = btn.dataset.subjectDelete;
      subjects = subjects.filter(s => s.id !== id);
      saveSubjects();
      refreshSubjects();
    }
  });

  // ===================== Quick Log Modal =====================
  $('#quick-log-fab').addEventListener('click', () => {
    populateSubjectDropdowns();
    $('#quick-date').value = todayKey();
    $('#modal-overlay').classList.remove('hidden');
  });

  $('#modal-cancel').addEventListener('click', () => {
    $('#modal-overlay').classList.add('hidden');
  });

  $('#modal-overlay').addEventListener('click', (e) => {
    if (e.target === $('#modal-overlay')) {
      $('#modal-overlay').classList.add('hidden');
    }
  });

  $('#modal-confirm').addEventListener('click', () => {
    const dur = parseInt($('#quick-duration').value) || 0;
    if (dur < 1) return;
    const d = $('#quick-date').value ? new Date($('#quick-date').value + 'T12:00:00') : new Date();
    const session = {
      id: uid(),
      subjectId: $('#quick-subject').value || (subjects[0] && subjects[0].id),
      duration: dur,
      date: d.toISOString(),
      notes: $('#quick-notes').value.trim(),
      technique: 'manual',
    };
    sessions.push(session);
    saveSessions();
    $('#modal-overlay').classList.add('hidden');
    $('#quick-notes').value = '';
    refreshDashboard();
  });

  // ===================== Export / Import =====================
  $('#export-btn').addEventListener('click', () => {
    const data = { subjects, sessions, dailyGoalHours };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studyflow-export-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#import-btn').addEventListener('click', () => $('#import-file').click());

  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.subjects) { subjects = data.subjects; saveSubjects(); }
        if (data.sessions) { sessions = data.sessions; saveSessions(); }
        if (data.dailyGoalHours) { dailyGoalHours = data.dailyGoalHours; Store.set('dailyGoalHours', dailyGoalHours); }
        navigateTo('dashboard');
      } catch {
        alert('Invalid import file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ===================== Chart Defaults =====================
  function chartDefaults(yLabel) {
    return {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#21242f',
          titleColor: '#e8e9ed',
          bodyColor: '#9ca3b4',
          borderColor: '#2d3143',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(45,49,67,0.5)' },
          ticks: { color: '#6b7280', font: { size: 11 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(45,49,67,0.5)' },
          ticks: { color: '#6b7280', font: { size: 11 } },
          title: { display: true, text: yLabel, color: '#6b7280' },
        },
      },
    };
  }

  // ===================== Init =====================
  populateSubjectDropdowns();
  navigateTo('dashboard');
})();
