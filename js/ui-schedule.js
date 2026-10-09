/* Timetable dialog box: when a line's own all-stops trains (line.schedules) or a service's trains (service.schedules) run
   — see js/schedule.js for the shape — and the map's calendar of public holidays (store.calendar). */
(function (TM) {
  const ui = (TM.ui = TM.ui || {});
  const store = TM.store, actions = TM.actions, sched = TM.sched;
  const $ = (root, sel) => root.querySelector(sel);
  const esc = (s) => TM.esc(s);

  /* one line of text for a list: "2 plans · Asia/Kuala_Lumpur", or none */
  ui.scheduleSummary = (s) => (s ? `${s.plans.length} plan${s.plans.length === 1 ? '' : 's'} · ${s.tz}` : 'no timetable (a usual wait is assumed)');

  const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return ['UTC', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York']; } })();
  const blankPlan = () => ({ name: '', dir: 'both', days: ['mon', 'tue', 'wed', 'thu', 'fri'], dates: [], except: [], first: '06:00', last: '23:30', starts: [], every: [{ from: '06:00', to: '23:30', min: 10 }] });

  /* target: { line: id } (its own all-stops trains — a branch's line) or { service: id } */
  ui.openScheduleDialog = (target) => {
    const line = target.line ? store.rootLine(store.line(target.line)) || store.line(target.line) : null;
    const service = target.service ? store.services.find((x) => x.id === target.service) : null;
    if (!line && !service) return;
    /* the stops it passes, in travel order each way, and the minutes between them */
    const run = TM.route.runTimes(line || service);
    if (!run) { TM.toast(line ? 'Add at least two stops to this line first' : 'This service has no route yet', 'err'); return; }
    const wayOf = (dir) => (dir === 'back' ? run.back : run.fwd);
    const stops = run.fwd.rows.map((r) => r.id);
    const name = (id) => { const st = store.stations.get(id); return st ? TM.nameOf(st, TM.state.langs[0]) : id; };
    const dirs = { both: 'Both ways', fwd: `Towards ${name(stops[stops.length - 1])}`, back: `Towards ${name(stops[0])}` };
    const loopish = line ? line.loop : service.loop;
    if (loopish) { dirs.fwd = 'In its own order'; dirs.back = 'The other way round'; }
    const current = line ? line.schedules : service.schedules;
    const work = { tz: (current && current.tz) || store.calendar.tz || sched.userTz(), plans: JSON.parse(JSON.stringify((current && current.plans) || [])) };
    if (!work.plans.length) work.plans.push(blankPlan());
    work.plans.forEach((p) => { if (p.trains) p.shift = 10; });   // minutes a copied train is later by
    const calendar = JSON.parse(JSON.stringify(store.calendar)), ownsMap = actions.ownsMap();
    const title = line ? `Timetable · ${esc(line.code)} all-stops trains` : `Timetable · ${esc(service.name)}`;

    const stationSel = (value, attr) => `<select class="input" ${attr} style="height:30px;flex:1;min-width:0">${stops.map((id) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(name(id))} (${esc(id)})</option>`).join('')}</select>`;
    const timeIn = (value, attr, label) => `<input class="input" type="time" ${attr} value="${esc(value || '')}" style="height:30px;width:112px" aria-label="${label}">`;

    /* ---------- fixed timetable: stations down, one column per train ---------- */
    /* where a train is at a stop when nothing is typed there: the nearest earlier typed time plus the line's own minutes */
    const estimate = (dir, train, id) => {
      const at = {};
      Object.entries(train.at).forEach(([k, v]) => { const t = sched.parseClock(v); if (t) at[k] = t; });
      const m = sched.trainAt({ from: train.from, at }, wayOf(dir).off, id);
      return m == null ? '' : sched.fmtMin(m);
    };
    const newTrain = (dir) => { const first = wayOf(dir).rows.find((r) => r.calls); return { from: first ? first.id : stops[0], at: {} }; };
    const shiftedCopy = (train, min) => {
      const at = {};
      Object.entries(train.at).forEach(([id, v]) => { const m = sched.toMin(sched.parseClock(v) || ''); if (m != null && m + min < 48 * 60) at[id] = sched.fmtMin(m + min); });
      return { from: train.from, at };
    };
    const gridHtml = (p, i) => {
      const { rows } = wayOf(p.dir);
      const head = p.trains.map((t, j) => {
        const options = rows.filter((r) => r.calls || r.id === t.from);
        if (!options.some((r) => r.id === t.from)) options.unshift({ id: t.from });   // a stop no longer on the route
        return `<th><div class="tt-colh">` +
          `<select class="input" data-from="${j}" data-prev="${esc(t.from)}" title="Where this train starts" aria-label="Train ${j + 1} starts at">${options.map((r) => `<option value="${esc(r.id)}" ${r.id === t.from ? 'selected' : ''}>${esc(r.id)} · ${esc(name(r.id))}</option>`).join('')}</select><span class="hint">Train ${j + 1}</span>` +
          `<button type="button" class="btn sm ghost icon-btn" data-dup="${i}:${j}" title="Add a copy of this train, later by the minutes below">${TM.icon('copy')}</button>` +
          `<button type="button" class="btn sm ghost icon-btn" data-rmtrain="${i}:${j}" title="Remove this train">${TM.icon('x')}</button></div></th>`;
      }).join('');
      const startAt = p.trains.map((t) => rows.findIndex((r) => r.id === t.from));
      const body = rows.map((r, ri) => `<tr${r.calls ? '' : ' class="pass"'}><th scope="row"><b>${esc(name(r.id))}</b> <span class="hint">${esc(r.id)}${r.calls ? '' : ' · passes'}</span></th>` +
        p.trains.map((t, j) => {
          if (ri < startAt[j]) return '<td class="off"></td>';
          const value = t.at[r.id] || '';
          return `<td><input class="input tt-cell${ri === startAt[j] ? ' start' : ''}" data-t="${j}" data-s="${esc(r.id)}" value="${esc(value)}" placeholder="${value ? '' : estimate(p.dir, t, r.id)}" inputmode="numeric" autocomplete="off" ${r.calls ? '' : 'disabled'} aria-label="Train ${j + 1} at ${esc(name(r.id))}"></td>`;
        }).join('') + '</tr>').join('');
      return `<p class="hint" style="margin:0 0 6px">Type when each train is at a station (0530 or 05:30; 24:30 is half past midnight). Choose the station a train starts at. A station left empty follows the line's own times from the one before — the faded time.</p>` +
        `<div class="tt-grid-wrap"><table class="tt-grid"><thead><tr><th>Station</th>${head}</tr></thead><tbody>${body}</tbody></table></div>` +
        `<div class="row wrap" style="gap:6px 8px;margin-top:6px"><button type="button" class="btn sm" data-addtrain="${i}">${TM.icon('plus')} Train</button>` +
        `<span class="hint">a copy of the last one, later by</span><input class="input" type="number" min="1" max="240" data-shift="${i}" value="${p.shift}" style="height:30px;width:70px" aria-label="Minutes later"><span class="hint">min</span></div>`;
    };

    const planHtml = (p, i) => {
      const timetable = !!p.trains, dirList = Object.entries(dirs).filter(([k]) => !timetable || k !== 'both');
      return `<div class="sec tt-plan" data-plan="${i}" style="border:1px solid var(--line);border-radius:12px;padding:10px;margin:0 0 10px">` +
        `<div class="row" style="gap:8px;margin-bottom:8px"><input class="input" data-f="name" value="${esc(p.name)}" placeholder="Plan name, e.g. Weekdays" style="flex:1;height:30px">` +
        `<select class="input" data-f="dir" style="height:30px;width:auto">${dirList.map(([k, t]) => `<option value="${k}" ${p.dir === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` +
        `<button type="button" class="btn sm ghost icon-btn" data-rmplan="${i}" title="Remove this plan" style="width:28px;padding:0">${TM.icon('trash')}</button></div>` +
        `<div class="row wrap" style="gap:4px 12px;margin-bottom:8px">${Object.entries(sched.DAYS).map(([k, t]) => `<label class="check"><input type="checkbox" data-day="${k}" ${p.days.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div>` +
        `<div class="grid2" style="margin-bottom:8px"><div class="field" style="margin:0"><label>Only on these dates <span class="hint">(YYYY-MM-DD, comma-separated — wins over the days above)</span></label><input class="input" data-f="dates" value="${esc(p.dates.join(', '))}" placeholder="2026-12-24" style="height:30px"></div>` +
        `<div class="field" style="margin:0"><label>Not on these dates</label><input class="input" data-f="except" value="${esc(p.except.join(', '))}" placeholder="2026-12-25" style="height:30px"></div></div>` +
        `<div class="seg" style="margin-bottom:8px"><button type="button" data-kind="${i}:freq" class="${timetable ? '' : 'on'}">First / last train &amp; frequency</button><button type="button" data-kind="${i}:times" class="${timetable ? 'on' : ''}">Fixed timetable</button></div>` +
        (timetable
          ? gridHtml(p, i)
          : `<div class="row wrap" style="gap:12px;margin-bottom:8px"><label class="row" style="gap:6px"><span class="hint">First train</span>${timeIn(p.first, 'data-f="first"', 'First train')}</label><label class="row" style="gap:6px"><span class="hint">Last train</span>${timeIn(p.last, 'data-f="last"', 'Last train')}</label><span class="hint">from the first stop of that way</span></div>` +
            `<div class="lbl" style="margin:4px 0 6px">Trains also start at <span style="font-weight:500">(so a stop part-way gets its first train earlier)</span></div>` +
            p.starts.map((st, j) => `<div class="row tt-start" style="gap:6px;margin-bottom:4px">${stationSel(st.at, 'data-sf="at"')}${timeIn(st.time, 'data-sf="time"', 'First train from there')}<button type="button" class="btn sm ghost icon-btn" data-rmstart="${i}:${j}" style="width:26px;padding:0">${TM.icon('x')}</button></div>`).join('') +
            `<button type="button" class="btn sm ghost" data-addstart="${i}">${TM.icon('plus')} Start point</button>` +
            `<div class="lbl" style="margin:10px 0 6px">How often <span style="font-weight:500">(by the time trains leave the first stop)</span></div>` +
            p.every.map((b, j) => `<div class="row tt-band" style="gap:6px;margin-bottom:4px">${timeIn(b.from, 'data-bf="from"', 'From')}<span class="hint">to</span>${timeIn(b.to, 'data-bf="to"', 'To')}<span class="hint">every</span><input class="input" type="number" min="1" max="240" step="0.5" data-bf="min" value="${b.min}" style="height:30px;width:70px" aria-label="Minutes between trains"><span class="hint">min</span><button type="button" class="btn sm ghost icon-btn" data-rmband="${i}:${j}" style="width:26px;padding:0">${TM.icon('x')}</button></div>`).join('') +
            `<button type="button" class="btn sm ghost" data-addband="${i}">${TM.icon('plus')} Time band</button>`) +
        '</div>';
    };
    const calendarHtml = () => `<div class="sec" style="margin-top:6px"><div class="sec-h"><h3>Map calendar</h3></div>` +
      `<p class="hint" style="margin-top:0">Shared by every timetable of this map${ownsMap ? '' : ' — only the map\'s own author can change it'}.</p>` +
      `<div class="field"><label>Default time zone for new timetables</label><input class="input" id="ttCalTz" list="ttZones" value="${esc(calendar.tz)}" placeholder="${esc(sched.userTz())}" ${ownsMap ? '' : 'disabled'}></div>` +
      `<div class="field" style="margin:0"><label>Public holidays <span class="hint">— one per line: "YYYY-MM-DD Name"</span></label><textarea class="input" id="ttHols" rows="5" style="height:auto;font-family:ui-monospace,monospace" ${ownsMap ? '' : 'disabled'}>${esc(calendar.holidays.map((h) => (h.date + ' ' + h.name).trim()).join('\n'))}</textarea></div></div>`;

    const dialog = ui.modal({
      title, wide: true,
      body: `<datalist id="ttZones">${ZONES.map((z) => `<option value="${esc(z)}">`).join('')}</datalist>` +
        `<div class="field"><label>Time zone of these times</label><input class="input" id="ttTz" list="ttZones" value="${esc(work.tz)}"></div>` +
        `<p class="hint" style="margin-top:0">Each plan says when trains run, on which days. A plan for a specific date wins, then one for public holidays (on a holiday), then one for the weekday. The journey planner shows the wait for the next train from these.</p>` +
        `<div id="ttPlans"></div><button type="button" class="btn sm" id="ttAddPlan">${TM.icon('plus')} Add plan</button>` + calendarHtml() +
        `<p class="hint" id="ttErr" style="color:var(--danger)"></p>`,
      buttons: [
        ...(current ? [{ label: 'Remove timetable', cls: 'danger', onClick: () => { if (!confirm('Remove this timetable?')) return false; save(null); } }] : []),
        { label: 'Cancel', cls: 'ghost' },
        { label: 'Save', cls: 'primary', onClick: () => {
          collect();
          const errBox = $(dialog.body, '#ttErr');
          errBox.textContent = '';
          if (!sched.validTz(work.tz)) { errBox.textContent = `"${work.tz}" is not a time zone (e.g. Asia/Kuala_Lumpur).`; return false; }
          const problem = checkTrains();
          if (problem) { errBox.textContent = problem; return false; }
          const s = sched.norm({ tz: work.tz, plans: work.plans });
          const dropped = work.plans.length - (s ? s.plans.length : 0);
          if (dropped && !confirm(`${dropped} plan${dropped === 1 ? ' is' : 's are'} incomplete (a frequency plan needs a first and last train and at least one time band; a fixed timetable at least one train) and will be left out. Save anyway?`)) return false;
          save(s);
        } },
      ],
    });
    dialog.el.querySelector('.modal').classList.add('xwide');
    const plansBox = $(dialog.body, '#ttPlans');
    const draw = () => { plansBox.innerHTML = work.plans.map(planHtml).join(''); };
    /* a train as typed in the grid (box: the plan's element) */
    const readTrain = (box, j) => {
      const at = {};
      box.querySelectorAll(`.tt-cell[data-t="${j}"]`).forEach((c) => { if (c.value.trim()) at[c.dataset.s] = c.value.trim(); });
      return { from: box.querySelector(`[data-from="${j}"]`).value, at };
    };
    /* read every field back into work (before redrawing, and on save) */
    function collect() {
      work.tz = $(dialog.body, '#ttTz').value.trim();
      plansBox.querySelectorAll('.tt-plan').forEach((box) => {
        const p = work.plans[+box.dataset.plan];
        const f = (k) => { const el = box.querySelector(`[data-f="${k}"]`); return el ? el.value : undefined; };
        p.name = f('name') || ''; p.dir = f('dir') || 'both';
        p.days = [...box.querySelectorAll('[data-day]')].filter((c) => c.checked).map((c) => c.dataset.day);
        p.dates = (f('dates') || '').split(/[\s,;]+/).filter(Boolean); p.except = (f('except') || '').split(/[\s,;]+/).filter(Boolean);
        if (p.trains) {
          p.trains = [...box.querySelectorAll('[data-from]')].map((sel) => readTrain(box, sel.dataset.from));
          p.shift = +(box.querySelector('[data-shift]').value) || 10;
        } else {
          p.first = f('first') || ''; p.last = f('last') || '';
          p.starts = [...box.querySelectorAll('.tt-start')].map((r) => ({ at: r.querySelector('[data-sf="at"]').value, time: r.querySelector('[data-sf="time"]').value }));
          p.every = [...box.querySelectorAll('.tt-band')].map((r) => ({ from: r.querySelector('[data-bf="from"]').value, to: r.querySelector('[data-bf="to"]').value, min: +r.querySelector('[data-bf="min"]').value }));
        }
      });
    }
    /* the first thing wrong in a grid, as a sentence (and its cell marked), or '' */
    function checkTrains() {
      plansBox.querySelectorAll('.bad').forEach((c) => c.classList.remove('bad'));
      for (let i = 0; i < work.plans.length; i++) {
        const p = work.plans[i];
        if (!p.trains) continue;
        const { rows } = wayOf(p.dir), label = `${p.name || 'Plan ' + (i + 1)}, train`;
        for (let j = 0; j < p.trains.length; j++) {
          const t = p.trains[j], cell = (id) => plansBox.querySelector(`.tt-plan[data-plan="${i}"] .tt-cell[data-t="${j}"][data-s="${CSS.escape(id)}"]`);
          let last = -1;
          for (const r of rows.slice(Math.max(0, rows.findIndex((x) => x.id === t.from)))) {
            if (!(r.id in t.at)) continue;
            const clock = sched.parseClock(t.at[r.id]);
            if (clock === null) { const c = cell(r.id); if (c) c.classList.add('bad'); return `${label} ${j + 1}: “${t.at[r.id]}” at ${name(r.id)} is not a time (use HH:MM).`; }
            if (!clock) continue;
            const m = sched.toMin(clock);
            if (m < last) { const c = cell(r.id); if (c) c.classList.add('bad'); return `${label} ${j + 1}: ${name(r.id)} is earlier than the station before it.`; }
            last = m;
          }
          if (!sched.parseClock(t.at[t.from])) { const c = cell(t.from); if (c) c.classList.add('bad'); return `${label} ${j + 1}: type the time it starts at ${name(t.from)}.`; }
        }
      }
      return '';
    }
    function save(s) {
      if (ownsMap) {
        const holidays = $(dialog.body, '#ttHols').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [date, ...rest] = l.split(/\s+/); return { date, name: rest.join(' ') }; });
        const next = sched.normCalendar({ tz: $(dialog.body, '#ttCalTz').value.trim(), holidays });
        if (JSON.stringify(next) !== JSON.stringify(store.calendar)) store.setCalendar(next);
      }
      if (line) { if (s) line.schedules = s; else line.schedules = null; store.save(); }
      else actions.saveService(Object.assign({}, service, { schedules: s || undefined }), service.id);
      TM.toast(s ? 'Timetable saved' : 'Timetable removed');
    }
    draw();
    dialog.body.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const [i, j] = (b.dataset.rmstart || b.dataset.rmband || b.dataset.kind || b.dataset.dup || b.dataset.rmtrain || '').split(':');
      if (b.id === 'ttAddPlan') { collect(); work.plans.push(blankPlan()); draw(); }
      else if (b.dataset.rmplan != null) { collect(); work.plans.splice(+b.dataset.rmplan, 1); draw(); }
      else if (b.dataset.kind) {
        collect();
        const p = work.plans[+i];
        if (j === 'times' && !p.trains) { if (p.dir === 'both') p.dir = 'fwd'; p.trains = [newTrain(p.dir)]; p.shift = 10; }
        if (j === 'freq' && p.trains) { delete p.trains; delete p.shift; Object.assign(p, { first: p.first || '06:00', last: p.last || '23:30', starts: p.starts || [], every: p.every && p.every.length ? p.every : [{ from: '06:00', to: '23:30', min: 10 }] }); }
        draw();
      } else if (b.dataset.addtrain != null) {
        collect();
        const p = work.plans[+b.dataset.addtrain], last = p.trains[p.trains.length - 1];
        p.trains.push(last ? shiftedCopy(last, p.shift) : newTrain(p.dir)); draw();
        plansBox.querySelector(`.tt-plan[data-plan="${b.dataset.addtrain}"] .tt-grid-wrap`).scrollLeft = 1e6;
      } else if (b.dataset.dup) { collect(); const p = work.plans[+i]; p.trains.splice(+j + 1, 0, shiftedCopy(p.trains[+j], p.shift)); draw(); }
      else if (b.dataset.rmtrain) { collect(); work.plans[+i].trains.splice(+j, 1); draw(); }
      else if (b.dataset.addstart != null) { collect(); work.plans[+b.dataset.addstart].starts.push({ at: stops[Math.floor(stops.length / 2)] || stops[0], time: work.plans[+b.dataset.addstart].first || '06:00' }); draw(); }
      else if (b.dataset.rmstart) { collect(); work.plans[+i].starts.splice(+j, 1); draw(); }
      else if (b.dataset.addband != null) { collect(); const ev = work.plans[+b.dataset.addband].every, prev = ev[ev.length - 1]; ev.push({ from: prev ? prev.to : '06:00', to: '23:30', min: 10 }); draw(); }
      else if (b.dataset.rmband) { collect(); work.plans[+i].every.splice(+j, 1); draw(); }
    });
    dialog.body.addEventListener('change', (e) => {
      const el = e.target, box = el.closest('.tt-plan');
      if (!box) return;
      const p = work.plans[+box.dataset.plan];
      if (el.classList.contains('tt-cell')) {
        const clock = sched.parseClock(el.value);
        el.classList.toggle('bad', clock === null);
        if (clock !== null) el.value = clock;
        /* the faded times of the stations after it follow from what is typed now */
        const j = el.dataset.t, train = readTrain(box, j);
        box.querySelectorAll(`.tt-cell[data-t="${j}"]`).forEach((c) => { c.placeholder = c.value ? '' : estimate(p.dir, train, c.dataset.s); });
      } else if (el.dataset.from != null) {   // starting somewhere else: keep the time it had there, if it had one
        collect();
        const train = p.trains[+el.dataset.from];
        if (!train.at[train.from]) { const kept = estimate(p.dir, { from: el.dataset.prev, at: train.at }, train.from); if (kept) train.at[train.from] = kept; }
        draw();
      } else if (el.dataset.f === 'dir' && p.trains) { collect(); draw(); }
    });
    dialog.body.addEventListener('keydown', (e) => {
      const cell = e.target.closest && e.target.closest('.tt-cell');
      if (!cell || !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      const column = [...cell.closest('.tt-grid').querySelectorAll(`.tt-cell[data-t="${cell.dataset.t}"]:not(:disabled)`)], next = column[column.indexOf(cell) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (next) { e.preventDefault(); next.focus(); next.select(); }
    });
  };
})(window.TM);
