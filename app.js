// ===== STORAGE =====
const Storage = {
  get(key, def = null) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) { console.error('Storage error', e); }
  }
};

// ===== STATE =====
let taken = [];        // alle master taken
let dagPlanning = {};  // { 'YYYY-MM-DD': { taakId: { gedaan, overgenomen, tijdstip } } }
let huidigeDag = vandaagStr();
let bewerkTaakId = null;
let geselecteerdVoorDag = new Set();
let dragSrcId = null;
let dragSrcSectie = null;
let huidigeTijdstipTaakId = null;
let standaarden = [];

function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function vandaagStr() {
  return localDateStr(new Date());
}

function normDagPlanning(obj) {
  if (!obj || Array.isArray(obj) || typeof obj !== 'object') return {};
  const result = {};
  for (const [date, planning] of Object.entries(obj)) {
    result[date] = (!planning || Array.isArray(planning) || typeof planning !== 'object') ? {} : planning;
  }
  return result;
}

function laadData() {
  const rawDag = localStorage.getItem('actielijst_dagPlanning');
  console.log('[LOAD-RAW] actielijst_dagPlanning in localStorage:', rawDag ? rawDag.substring(0, 120) : 'NULL/LEEG');
  taken = Storage.get('actielijst_taken', []);
  dagPlanning = normDagPlanning(Storage.get('actielijst_dagPlanning', {}));
  standaarden = Storage.get('actielijst_standaarden', []);
  const dagKeys = dagPlanning[vandaagStr()] ? Object.keys(dagPlanning[vandaagStr()]).filter(k => !k.startsWith('__')) : [];
  console.log('[LOAD] taken:', taken.length, '| vandaag in dagPlanning:', dagKeys.length, dagKeys);
}

function slaData() {
  const dagKeys = dagPlanning[vandaagStr()] ? Object.keys(dagPlanning[vandaagStr()]).filter(k => !k.startsWith('__')) : [];
  console.log('[SAVE] taken:', taken.length, '| vandaag in dagPlanning:', dagKeys.length, dagKeys);
  Storage.set('actielijst_taken', taken);
  Storage.set('actielijst_dagPlanning', dagPlanning);
  const rawDag = localStorage.getItem('actielijst_dagPlanning');
  console.log('[SAVE-RAW] na schrijven:', rawDag ? rawDag.substring(0, 120) : 'NULL — schrijven mislukt!');
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(syncServer, 800);
}

// ===== SERVER SYNC =====
let syncTimeout = null;

async function syncServer() {
  const syncBtn = document.getElementById('sync-btn');
  syncBtn.textContent = '⟳';
  syncBtn.className = 'icon-btn';
  try {
    const res = await fetch('save.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'd=' + encodeURIComponent(JSON.stringify({ taken, dagPlanning, standaarden }))
    });
    const data = await res.json();
    if (data.status === 'ok') {
      syncBtn.textContent = '✓';
      syncBtn.className = 'icon-btn synced';
      console.log('[SYNC] ✓ opgeslagen op server');
    } else {
      throw new Error(data.message);
    }
  } catch(e) {
    syncBtn.textContent = '!';
    syncBtn.className = 'icon-btn error';
    syncBtn.title = e.message || 'Opslaan mislukt';
    console.error('[SYNC] mislukt:', e.message);
  }
}

async function laadVanServer() {
  try {
    const res = await fetch('save.php');
    const data = await res.json();
    console.log('[SERVER] GET → heeftData:', data.heeftData, '| taken:', data.taken?.length, '| dagPlanning keys:', Object.keys(data.dagPlanning || {}).length);
    if (data.heeftData) {
      if (Array.isArray(data.taken)) {
        taken = data.taken;
        Storage.set('actielijst_taken', taken);
      }
      if (data.dagPlanning && typeof data.dagPlanning === 'object') {
        dagPlanning = normDagPlanning(data.dagPlanning);
        Storage.set('actielijst_dagPlanning', dagPlanning);
      }
      if (Array.isArray(data.standaarden)) {
        standaarden = data.standaarden;
        Storage.set('actielijst_standaarden', standaarden);
      }
      renderAlles();
    }
  } catch(e) {
    console.error('[SERVER] laden mislukt:', e.message);
  }
}

// ===== DATUM HELPERS =====
function datumOffset(dagen, vanafStr) {
  const d = new Date(vanafStr + 'T00:00:00');
  d.setDate(d.getDate() + dagen);
  return localDateStr(d);
}

function isWeekend(str) {
  const dag = new Date(str + 'T00:00:00').getDay(); // 0=zon, 6=zat
  return dag === 0 || dag === 6;
}

function werkdagStap(stap, vanafStr) {
  let d = new Date(vanafStr + 'T00:00:00');
  do {
    d.setDate(d.getDate() + stap);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return localDateStr(d);
}

function vorigeWerkdag(vanafStr) {
  return werkdagStap(-1, vanafStr);
}

// ===== CARRY FORWARD =====
function carryForward() {
  const vandaag = vandaagStr();
  if (isWeekend(vandaag)) return; // geen carry op weekenddagen

  const vorigeDag = vorigeWerkdag(vandaag);
  const vorigePlanning = dagPlanning[vorigeDag];
  if (!vorigePlanning) return;

  if (!dagPlanning[vandaag]) dagPlanning[vandaag] = {};

  let overgenomen = 0;
  for (const [taakId, info] of Object.entries(vorigePlanning)) {
    if (taakId.startsWith('__')) continue; // interne sleutels (volgorde, etc.) overslaan
    if (!info.gedaan && !dagPlanning[vandaag][taakId]) {
      const taak = taken.find(t => t.id === taakId);
      if (taak?.isStandaard) continue;
      dagPlanning[vandaag][taakId] = { gedaan: false, overgenomen: true };
      overgenomen++;
    }
  }

  if (overgenomen > 0) slaData();
}

function formatDatum(str) {
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ===== RENDER DAG =====
function renderDag() {
  const vandaag = vandaagStr();
  const dagKeys = dagPlanning[huidigeDag] ? Object.keys(dagPlanning[huidigeDag]).filter(k => !k.startsWith('__')) : [];
  console.log('[RENDER DAG]', huidigeDag, '| ids in planning:', dagKeys.length, '| taken totaal:', taken.length);
  document.getElementById('dag-datum').textContent = formatDatum(huidigeDag);
  document.getElementById('dag-label').textContent = huidigeDag === vandaag ? 'Vandaag' :
    huidigeDag > vandaag ? 'Toekomst' : 'Verleden';

  document.getElementById('naar-vandaag').style.display = huidigeDag === vandaag ? 'none' : 'inline-block';

  const planning = dagPlanning[huidigeDag] || {};
  const dagTaken = Object.keys(planning).map(id => {
    if (id.startsWith('__')) return null;
    const taak = taken.find(t => t.id === id);
    if (!taak || taak.verwijderd) return null;
    return { ...taak, dagInfo: planning[id] };
  }).filter(Boolean);

  // Sorteren: tijd eerst, dan prio
  const effectiefTijdstip = t => t.dagInfo.tijdstip || t.tijdstip;
  const metTijd = dagTaken.filter(t => effectiefTijdstip(t)).sort((a,b) => (effectiefTijdstip(a)||'').localeCompare(effectiefTijdstip(b)||''));
  const zakelijk = dagTaken.filter(t => !effectiefTijdstip(t) && t.type === 'zakelijk')
    .sort((a,b) => (a.thema||'').localeCompare(b.thema||'') || (a.prio||5) - (b.prio||5));
  const prive = dagTaken.filter(t => !effectiefTijdstip(t) && t.type === 'prive')
    .sort((a,b) => (a.thema||'').localeCompare(b.thema||'') || (a.prio||5) - (b.prio||5));

  renderDagLijst('lijst-tijd', metTijd, 'tijd');
  renderDagLijst('lijst-zakelijk', zakelijk, 'zakelijk');
  renderDagLijst('lijst-prive', prive, 'prive');

  document.getElementById('sectie-tijd').style.display = metTijd.length ? 'block' : 'none';

  // Stats
  const gedaan = dagTaken.filter(t => t.dagInfo.gedaan).length;
  document.getElementById('stat-gedaan').textContent = `${gedaan} gedaan`;
  document.getElementById('stat-open').textContent = `${dagTaken.length - gedaan} open`;

  // Counts
  document.querySelector('#sectie-tijd .count').textContent = metTijd.length ? `(${metTijd.length})` : '';
  document.querySelector('#sectie-zakelijk .count').textContent = zakelijk.length ? `(${zakelijk.length})` : '';
  document.querySelector('#sectie-prive .count').textContent = prive.length ? `(${prive.length})` : '';
}

function renderDagLijst(containerId, taken, sectieNaam) {
  const el = document.getElementById(containerId);
  if (!taken.length) { el.innerHTML = '<div class="empty-state" style="padding:10px;font-size:12px">Geen taken</div>'; return; }

  const customOrder = dagPlanning[huidigeDag]?.__order?.[sectieNaam] || [];

  const actief = taken.filter(t => !t.dagInfo.gedaan);
  const afgevinkt = taken.filter(t => t.dagInfo.gedaan);

  function sortActief(lijst) {
    if (sectieNaam === 'tijd') {
      // Tijdtaken altijd op tijd gesorteerd, nooit door drag-order overschreven
      return [...lijst].sort((a,b) =>
        (a.dagInfo.tijdstip || a.tijdstip || '').localeCompare(b.dagInfo.tijdstip || b.tijdstip || '')
      );
    }
    if (customOrder.length) {
      return [...lijst].sort((a, b) => {
        const ai = customOrder.indexOf(a.id);
        const bi = customOrder.indexOf(b.id);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
    }
    return [...lijst].sort((a,b) => (a.thema||'').localeCompare(b.thema||'') || (a.prio||5) - (b.prio||5));
  }

  function sortAfgevinkt(lijst) {
    return [...lijst].sort((a,b) => (a.thema||'').localeCompare(b.thema||'') || (a.prio||5) - (b.prio||5));
  }

  const gesorteerd = [...sortActief(actief), ...sortAfgevinkt(afgevinkt)];

  el.innerHTML = gesorteerd.map(t => {
    const gedaan = t.dagInfo.gedaan;
    const overgenomen = t.dagInfo.overgenomen;
    const tijdstip = t.dagInfo.tijdstip || t.tijdstip;

    return `<div class="task-card ${gedaan ? 'gedaan' : ''} ${overgenomen ? 'overgenomen' : ''}"
      data-id="${t.id}" draggable="${!gedaan}"
      ondragstart="onDagDragStart(event,'${t.id}','${sectieNaam}')"
      ondragover="onDagDragOver(event)"
      ondrop="onDagDrop(event,'${t.id}','${sectieNaam}')"
      ondragend="onDagDragEnd(event)">
      <div class="drag-handle" title="Verslepen">&#8597;</div>
      <div class="task-check" onclick="toggleGedaan('${t.id}', event)">${gedaan ? '&#x2713;' : ''}</div>
      ${tijdstip ? `<div class="task-tijdstip">${tijdstip}</div>` : ''}
      <div class="task-body">
        <div class="task-omschrijving">${escHtml(t.omschrijving)}</div>
        <div class="task-meta">
          <span class="badge badge-thema-${t.thema}">${t.thema}</span>
          <span class="badge badge-${t.type}">${t.type === 'zakelijk' ? 'Zakelijk' : 'Privé'}</span>
          ${t.periode ? `<span class="badge badge-${t.periode}">${t.periode}</span>` : ''}
          ${t.grootte ? `<span class="badge badge-grootte">${t.grootte}</span>` : ''}
          ${t.prio ? `<span class="badge badge-prio">P${t.prio}</span>` : ''}
          ${isUrgent(t) ? '<span class="badge badge-urgent">Urgent</span>' : ''}
          ${overgenomen ? '<span class="badge" style="background:#fef3c7;color:#92400e">Overgenomen</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" onclick="openTijdstipModal('${t.id}', event)" data-tooltip="Tijdstip instellen">&#128336;</button>
        <button class="task-action-btn" onclick="verwijderUitDag('${t.id}', event)" data-tooltip="Verwijder uit dag">&#x2715;</button>
      </div>
    </div>`;
  }).join('');
}

function onDagDragStart(event, taakId, sectie) {
  dragSrcId = taakId;
  dragSrcSectie = sectie;
  event.dataTransfer.effectAllowed = 'move';
  event.currentTarget.classList.add('dragging');
}

function onDagDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  event.currentTarget.classList.add('drag-over');
}

function onDagDrop(event, targetId, sectie) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (!dragSrcId || dragSrcId === targetId || dragSrcSectie !== sectie) return;

  const planning = dagPlanning[huidigeDag];
  if (!planning) return;

  // Build current order from DOM
  const el = event.currentTarget.closest('.task-list');
  const ids = [...el.querySelectorAll('.task-card:not(.gedaan)')].map(c => c.dataset.id);

  const fromIdx = ids.indexOf(dragSrcId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, dragSrcId);

  if (!planning.__order) planning.__order = {};
  planning.__order[sectie] = ids;

  dragSrcId = null;
  dragSrcSectie = null;
  slaData();
  renderDag();
}

function onDagDragEnd(event) {
  event.currentTarget.classList.remove('dragging', 'drag-over');
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  dragSrcId = null;
}

function toggleGedaan(taakId, event) {
  event.stopPropagation();
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
  const info = dagPlanning[huidigeDag][taakId] || {};
  dagPlanning[huidigeDag][taakId] = { ...info, gedaan: !info.gedaan };
  slaData();
  renderDag();
}

function verwijderUitDag(taakId, event) {
  event.stopPropagation();
  if (dagPlanning[huidigeDag]) {
    delete dagPlanning[huidigeDag][taakId];
    slaData();
    renderDag();
  }
}

// ===== TIJDSTIP PICKER =====
function initTijdstipPicker(containerId) {
  const container = document.getElementById(containerId);
  if (!container || container.dataset.pickerInit) return;
  container.dataset.pickerInit = '1';

  const input = container.querySelector('input[type="time"]');

  const uurRij = document.createElement('div');
  uurRij.className = 'picker-uur-rij';
  for (let h = 7; h <= 18; h++) {
    const uur = String(h).padStart(2, '0');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.uur = uur;
    btn.textContent = uur;
    btn.addEventListener('click', () => {
      const curMin = input.value ? input.value.split(':')[1] : '00';
      input.value = uur + ':' + curMin;
      syncPickerButtons(container, input);
    });
    uurRij.appendChild(btn);
  }

  const minRij = document.createElement('div');
  minRij.className = 'picker-min-rij';
  for (const m of ['00', '10', '15', '20', '30', '40', '45', '50']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.min = m;
    btn.textContent = ':' + m;
    btn.addEventListener('click', () => {
      const curUur = input.value ? input.value.split(':')[0] : '09';
      input.value = curUur + ':' + m;
      syncPickerButtons(container, input);
    });
    minRij.appendChild(btn);
  }

  const footer = document.createElement('div');
  footer.className = 'picker-footer-rij';
  const geenTijdBtn = document.createElement('button');
  geenTijdBtn.type = 'button';
  geenTijdBtn.className = 'geen-tijd-btn';
  geenTijdBtn.textContent = 'Geen tijd';
  geenTijdBtn.addEventListener('click', () => {
    input.value = '';
    syncPickerButtons(container, input);
  });
  footer.appendChild(geenTijdBtn);
  footer.appendChild(input);

  input.addEventListener('input', () => syncPickerButtons(container, input));

  container.innerHTML = '';
  container.appendChild(uurRij);
  container.appendChild(minRij);
  container.appendChild(footer);
}

function syncPickerButtons(container, input) {
  const val = input.value;
  const uur = val ? val.split(':')[0] : null;
  const min = val ? val.split(':')[1] : null;
  container.querySelectorAll('.picker-uur-rij button').forEach(btn => {
    btn.classList.toggle('actief', btn.dataset.uur === uur);
  });
  container.querySelectorAll('.picker-min-rij button').forEach(btn => {
    btn.classList.toggle('actief', btn.dataset.min === min);
  });
}

function setTijdstipPickerWaarde(containerId, waarde) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const input = container.querySelector('input[type="time"]');
  if (!input) return;
  input.value = waarde || '';
  syncPickerButtons(container, input);
}

function openTijdstipModal(taakId, event) {
  event.stopPropagation();
  huidigeTijdstipTaakId = taakId;
  const huidigTijdstip = dagPlanning[huidigeDag]?.[taakId]?.tijdstip || '';
  setTijdstipPickerWaarde('dag-tijdstip-picker', huidigTijdstip);
  document.getElementById('dag-tijdstip-modal-overlay').classList.remove('hidden');
}

function slaaDagTijdstipOp() {
  if (!huidigeTijdstipTaakId) return;
  const container = document.getElementById('dag-tijdstip-picker');
  const input = container ? container.querySelector('input[type="time"]') : null;
  const nieuw = input ? input.value.trim() : '';
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
  dagPlanning[huidigeDag][huidigeTijdstipTaakId] = {
    ...dagPlanning[huidigeDag][huidigeTijdstipTaakId],
    tijdstip: nieuw || null
  };
  huidigeTijdstipTaakId = null;
  document.getElementById('dag-tijdstip-modal-overlay').classList.add('hidden');
  slaData();
  renderDag();
}

// ===== RENDER MASTER =====
function renderMaster() {
  const thema = document.getElementById('filter-thema').value;
  const periode = document.getElementById('filter-periode').value;
  const grootte = document.getElementById('filter-grootte').value;
  const type = document.getElementById('filter-type').value;
  const prio = document.getElementById('filter-prio').value;
  const status = document.getElementById('filter-status').value;

  let gefilterd = taken.filter(t => {
    if (t.verwijderd) return false;
    if (t.isStandaard) return false;
    if (thema && t.thema !== thema) return false;
    if (periode && t.periode !== periode) return false;
    if (grootte && t.grootte !== grootte) return false;
    if (type && t.type !== type) return false;
    if (prio && String(t.prio) !== prio) return false;
    if (status === 'actief' && t.afgerond && !t.altijdBewaren) return false;
    if (status === 'afgerond' && !t.afgerond) return false;
    if (status === 'terugkerend' && !t.altijdBewaren) return false;
    return true;
  });

  // Groepeer per thema
  const themas = ['IURC', 'AI', 'Innovatie', 'DHM', 'TD', 'EU', 'Spreker', 'Overig'];
  const container = document.getElementById('master-lijst');

  if (!gefilterd.length) {
    container.innerHTML = '<div class="empty-state">Geen taken gevonden. Maak een nieuwe taak aan.</div>';
    return;
  }

  const sortering = document.getElementById('master-sortering')?.value || 'thema';

  if (sortering === 'thema') {
    const perThema = {};
    for (const t of themas) perThema[t] = [];
    for (const t of gefilterd) {
      if (!perThema[t.thema]) perThema[t.thema] = [];
      perThema[t.thema].push(t);
    }

    container.innerHTML = themas.map(t => {
      const lijst = perThema[t];
      if (!lijst.length) return '';
      const gesorteerd = lijst.sort((a,b) => a.prio - b.prio);
      return `<div class="thema-groep">
        <div class="thema-header thema-header-${t}">${t} <span class="thema-count">${lijst.length} taken</span></div>
        ${gesorteerd.map(taak => renderMasterKaart(taak)).join('')}
      </div>`;
    }).join('');
  } else {
    // flat sort
    let gesorteerd;
    if (sortering === 'prio') gesorteerd = gefilterd.sort((a,b) => (a.prio||5) - (b.prio||5));
    else if (sortering === 'periode') gesorteerd = gefilterd.sort((a,b) => (a.periode||'').localeCompare(b.periode||''));
    else if (sortering === 'type') gesorteerd = gefilterd.sort((a,b) => (a.type||'').localeCompare(b.type||''));
    else if (sortering === 'aangemaakt') gesorteerd = gefilterd.sort((a,b) => (b.aangemaakt||'').localeCompare(a.aangemaakt||''));
    container.innerHTML = `<div class="thema-groep">
      <div class="thema-header">Gesorteerd op: ${sortering}</div>
      ${gesorteerd.map(taak => renderMasterKaart(taak)).join('')}
    </div>`;
    return;
  }
}

function renderMasterKaart(t) {
  const urgent = isUrgent(t);
  const belangrijk = isBelangrijk(t);
  const afgerond = !!t.afgerond;
  return `<div class="task-card ${afgerond ? 'master-afgerond' : ''}" data-id="${t.id}" onclick="bewerkTaak('${t.id}')">
    <div class="task-body">
      <div class="task-omschrijving">${escHtml(t.omschrijving)}</div>
      <div class="task-meta">
        <span class="badge badge-${t.type}">${t.type === 'zakelijk' ? 'Zakelijk' : 'Privé'}</span>
        ${t.periode ? `<span class="badge badge-${t.periode}">${t.periode}</span>` : ''}
        ${t.grootte ? `<span class="badge badge-grootte">${t.grootte}</span>` : ''}
        ${t.prio ? `<span class="badge badge-prio">P${t.prio}</span>` : ''}
        ${urgent ? '<span class="badge badge-urgent">Urgent</span>' : ''}
        ${!belangrijk ? '<span class="badge badge-grootte">Niet belangrijk</span>' : ''}
        ${afgerond ? `<span class="badge badge-afgerond">Afgerond${t.afgerondDatum ? ' ' + t.afgerondDatum.slice(5,10).replace('-','/') : ''}</span>` : ''}
        ${t.notities ? `<span class="badge badge-grootte" title="${escHtml(t.notities)}">📝</span>` : ''}
        ${t.altijdBewaren ? '<span class="badge badge-terugkerend" title="Terugkerende taak">↻</span>' : ''}
      </div>
    </div>
    <div class="task-actions">
      ${!afgerond ? `<button class="task-action-btn btn-dag" onclick="voegToeAanVandaag('${t.id}', event)" data-tooltip="Aan vandaag toevoegen">+</button>` : ''}
      <button class="task-action-btn btn-gedaan" onclick="toggleMasterAfgerond('${t.id}', event)" data-tooltip="${afgerond ? 'Heropen taak' : (t.altijdBewaren ? 'Terugkerende taak' : 'Markeer als gedaan')}">
        ${afgerond ? '&#x21A9;' : '&#x2713;'}
      </button>
      <button class="task-action-btn btn-delete" onclick="verwijderTaak('${t.id}', event)" data-tooltip="Verwijderen">&#x1F5D1;</button>
    </div>
  </div>`;
}

function voegToeAanVandaag(taakId, event) {
  event.stopPropagation();
  const dag = vandaagStr();
  if (!dagPlanning[dag]) dagPlanning[dag] = {};
  if (!dagPlanning[dag][taakId]) {
    dagPlanning[dag][taakId] = { gedaan: false, overgenomen: false };
    slaData();
    // Toon bevestiging
    const btn = event.target;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = '+', 1000);
  }
}

function toggleMasterAfgerond(taakId, event) {
  event.stopPropagation();
  taken = taken.map(t => {
    if (t.id !== taakId) return t;
    if (t.altijdBewaren) {
      return { ...t, afgerond: false, afgerondDatum: null };
    }
    const wordtAfgerond = !t.afgerond;
    return { ...t, afgerond: wordtAfgerond, afgerondDatum: wordtAfgerond ? vandaagStr() : null };
  });
  slaData();
  renderMaster();
  renderMatrix();
}

function verwijderTaak(taakId, event) {
  event.stopPropagation();
  taken = taken.map(t => t.id !== taakId ? t :
    { ...t, verwijderd: true, verwijderdDatum: vandaagStr() }
  );
  slaData();
  renderAlles();
}

// ===== RENDER MATRIX =====
function renderMatrix() {
  const cells = document.querySelectorAll('.cell-tasks');
  cells.forEach(cell => {
    const urgent = cell.dataset.urgent === '1';
    const belangrijk = cell.dataset.belangrijk === '1';
    const bijhorend = taken.filter(t => !t.afgerond && !t.verwijderd && !t.isStandaard && isUrgent(t) === urgent && isBelangrijk(t) === belangrijk);
    cell.innerHTML = bijhorend.length
      ? bijhorend.sort((a,b) => a.prio - b.prio).map(t =>
          `<div class="task-card" onclick="bewerkTaak('${t.id}')">
            <div class="task-body">
              <div class="task-omschrijving" style="font-size:12px">${escHtml(t.omschrijving)}</div>
              <div class="task-meta">
                <span class="badge badge-thema-${t.thema}" style="font-size:10px">${t.thema}</span>
                <span class="badge badge-${t.periode}" style="font-size:10px">${t.periode}</span>
                <span class="badge badge-prio" style="font-size:10px">P${t.prio}</span>
              </div>
            </div>
          </div>`).join('')
      : '<div style="color:#94a3b8;font-size:12px;padding:8px">Leeg</div>';
  });
}

// ===== RENDER ARCHIEF =====
function renderArchief() {
  const maandInput = document.getElementById('archief-maand').value;
  const themaFilter = document.getElementById('archief-thema').value;
  const container = document.getElementById('archief-lijst');

  // Alle dagen met planning, gesorteerd aflopend
  const dagen = Object.keys(dagPlanning).sort((a,b) => b.localeCompare(a));

  const gefilterdeDagen = dagen.filter(dag => {
    if (maandInput && !dag.startsWith(maandInput)) return false;
    return true;
  });

  if (!gefilterdeDagen.length) {
    container.innerHTML = '<div class="empty-state">Geen archief gevonden.</div>';
    return;
  }

  container.innerHTML = gefilterdeDagen.map(dag => {
    const planning = dagPlanning[dag];
    let dagTaken = Object.keys(planning).map(id => {
      if (id.startsWith('__')) return null;
      const taak = taken.find(t => t.id === id);
      if (!taak) return null;
      if (themaFilter && taak.thema !== themaFilter) return null;
      return { ...taak, dagInfo: planning[id] };
    }).filter(Boolean);

    if (!dagTaken.length) return '';

    const aantalGedaan = dagTaken.filter(t => t.dagInfo.gedaan && !t.verwijderd).length;
    const aantalVerwijderd = dagTaken.filter(t => t.verwijderd).length;
    const aantalTotaal = dagTaken.filter(t => !t.verwijderd).length;

    return `<div class="dag-archief-item">
      <div class="dag-archief-header">
        <span>${formatDatum(dag)}</span>
        <span style="font-size:12px;color:#64748b">
          ${aantalGedaan}/${aantalTotaal} gedaan
          ${aantalVerwijderd ? `· <span style="color:#dc2626">${aantalVerwijderd} verwijderd</span>` : ''}
        </span>
      </div>
      ${dagTaken.map(t => {
        const isVerwijderd = !!t.verwijderd;
        const isGedaan = t.dagInfo.gedaan && !isVerwijderd;
        return `
        <div class="task-card ${isGedaan ? 'gedaan' : ''} ${isVerwijderd ? 'archief-verwijderd' : ''}" style="cursor:default">
          <div class="task-check">${isGedaan ? '✓' : isVerwijderd ? '🗑' : ''}</div>
          <div class="task-body">
            <div class="task-omschrijving">${escHtml(t.omschrijving)}</div>
            <div class="task-meta">
              <span class="badge badge-thema-${t.thema}">${t.thema}</span>
              <span class="badge badge-${t.type}">${t.type === 'zakelijk' ? 'Zakelijk' : 'Privé'}</span>
              <span class="badge badge-${t.periode}">${t.periode}</span>
              ${isVerwijderd ? '<span class="badge badge-verwijderd">Verwijderd</span>' : ''}
              ${t.dagInfo.overgenomen && !isVerwijderd ? '<span class="badge" style="background:#fef3c7;color:#92400e">Overgenomen</span>' : ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

// ===== MODAL TAAK =====
function updateAutoIndicatie() {
  const periode = document.getElementById('taak-periode').value;
  const prio = parseInt(document.getElementById('taak-prio').value) || 5;
  const urgent = periode === 'A';
  const belangrijk = prio <= 5;
  const ub = document.getElementById('auto-urgent-badge');
  const bb = document.getElementById('auto-belangrijk-badge');
  ub.textContent = urgent ? 'Urgent' : 'Niet urgent';
  ub.className = 'badge ' + (urgent ? 'badge-urgent' : 'badge-grootte');
  bb.textContent = belangrijk ? 'Belangrijk' : 'Niet belangrijk';
  bb.className = 'badge ' + (belangrijk ? 'badge-A' : 'badge-grootte');
}

function togglePriveVelden() {
  const isPrive = document.getElementById('taak-type').value === 'prive';
  document.getElementById('modal-thema-container').style.display = isPrive ? 'none' : '';
  document.getElementById('modal-periode-grootte-row').style.display = isPrive ? 'none' : '';
  document.getElementById('modal-prio-container').style.display = isPrive ? 'none' : '';
  document.getElementById('modal-urgentie-row').style.display = isPrive ? 'none' : '';
}

const THEMA_STANDAARD_PRIO = { IURC: 1, Overig: 2, AI: 3, Spreker: 3, Innovatie: 4, DHM: 5, TD: 6, EU: 8 };
function standaardPrioVoorThema(thema) { return THEMA_STANDAARD_PRIO[thema] ?? 5; }

function setModalWaarde(veld, waarde) {
  document.getElementById('taak-' + veld).value = String(waarde);
  const container = document.getElementById('taak-' + veld + '-btns');
  if (container) {
    container.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('actief', btn.dataset.value === String(waarde));
    });
  }
  if (veld === 'periode' || veld === 'prio') updateAutoIndicatie();
}

function openNieuweTaakModal() {
  bewerkTaakId = null;
  document.getElementById('modal-titel').textContent = 'Nieuwe taak';
  document.getElementById('taak-omschrijving').value = '';
  document.getElementById('taak-thema').value = 'IURC';
  document.getElementById('taak-type').value = 'zakelijk';
  setModalWaarde('periode', 'B');
  setModalWaarde('grootte', 'M');
  setModalWaarde('prio', standaardPrioVoorThema('IURC'));
  setTijdstipPickerWaarde('taak-tijd-picker', '');
  document.getElementById('taak-notities').value = '';
  document.getElementById('taak-altijd-bewaren').checked = false;
  togglePriveVelden();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('taak-omschrijving').focus();
}

function bewerkTaak(taakId) {
  const t = taken.find(t => t.id === taakId);
  if (!t) return;
  bewerkTaakId = taakId;
  document.getElementById('modal-titel').textContent = 'Taak bewerken';
  document.getElementById('taak-omschrijving').value = t.omschrijving;
  document.getElementById('taak-thema').value = t.thema || 'Overig';
  document.getElementById('taak-type').value = t.type;
  setModalWaarde('periode', t.periode || 'B');
  setModalWaarde('grootte', t.grootte || 'M');
  setModalWaarde('prio', t.prio || 5);
  setTijdstipPickerWaarde('taak-tijd-picker', t.tijdstip || '');
  document.getElementById('taak-notities').value = t.notities || '';
  document.getElementById('taak-altijd-bewaren').checked = !!t.altijdBewaren;
  togglePriveVelden();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('taak-omschrijving').focus();
}

function slaModalOp() {
  const omschrijving = document.getElementById('taak-omschrijving').value.trim();
  if (!omschrijving) { document.getElementById('taak-omschrijving').focus(); return; }

  const oud = bewerkTaakId ? taken.find(t => t.id === bewerkTaakId) : null;
  const isPrive = document.getElementById('taak-type').value === 'prive';
  const periode = isPrive ? (oud?.periode || 'B') : document.getElementById('taak-periode').value;
  const prio = isPrive ? (oud?.prio || 5) : (parseInt(document.getElementById('taak-prio').value) || 5);

  const taak = {
    id: bewerkTaakId || genId(),
    omschrijving,
    thema: isPrive ? (oud?.thema || 'Overig') : document.getElementById('taak-thema').value,
    type: document.getElementById('taak-type').value,
    periode,
    grootte: isPrive ? (oud?.grootte || 'M') : document.getElementById('taak-grootte').value,
    prio,
    tijdstip: document.getElementById('taak-tijd').value || null,
    notities: document.getElementById('taak-notities').value.trim(),
    altijdBewaren: !!document.getElementById('taak-altijd-bewaren').checked,
    afgerond: oud?.afgerond || false,
    afgerondDatum: oud?.afgerondDatum || null,
    aangemaakt: oud?.aangemaakt || new Date().toISOString()
  };

  if (bewerkTaakId) {
    taken = taken.map(t => t.id === bewerkTaakId ? taak : t);
  } else {
    taken.push(taak);
    // Als geopend vanuit de dag-tab: meteen toevoegen aan die dag
    if (voegToeAanDagNaSave) {
      if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
      dagPlanning[huidigeDag][taak.id] = { gedaan: false, overgenomen: false };
    }
  }

  voegToeAanDagNaSave = false;
  sluitModal();
  slaData();
  renderAlles();
}

function sluitModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  bewerkTaakId = null;
  voegToeAanDagNaSave = false;
}

// ===== SELECTEER TAKEN VOOR DAG =====
function openSelecteerModal() {
  geselecteerdVoorDag.clear();
  renderSelecteerLijst();
  document.getElementById('select-modal-overlay').classList.remove('hidden');
}

function renderSelecteerLijst() {
  const thema = document.getElementById('sel-filter-thema').value;
  const periode = document.getElementById('sel-filter-periode').value;
  const planning = dagPlanning[huidigeDag] || {};

  const beschikbaar = taken.filter(t => {
    if (t.verwijderd || t.afgerond || t.isStandaard) return false;
    if (planning[t.id] !== undefined) return false; // al in dag
    if (thema && t.thema !== thema) return false;
    if (periode && t.periode !== periode) return false;
    return true;
  }).sort((a,b) => a.prio - b.prio);

  const container = document.getElementById('select-taak-lijst');
  if (!beschikbaar.length) {
    container.innerHTML = '<div class="empty-state">Geen taken beschikbaar</div>';
    return;
  }

  container.innerHTML = beschikbaar.map(t => {
    const sel = geselecteerdVoorDag.has(t.id);
    return `<div class="select-task-item ${sel ? 'selected' : ''}" onclick="toggleSelecteer('${t.id}')">
      <input type="checkbox" ${sel ? 'checked' : ''}>
      <div style="flex:1">
        <div style="font-weight:500;font-size:13px">${escHtml(t.omschrijving)}</div>
        <div class="task-meta" style="margin-top:3px">
          <span class="badge badge-thema-${t.thema}">${t.thema}</span>
          <span class="badge badge-${t.periode}">${t.periode}</span>
          <span class="badge badge-grootte">${t.grootte}</span>
          <span class="badge badge-prio">P${t.prio}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleSelecteer(taakId) {
  if (geselecteerdVoorDag.has(taakId)) geselecteerdVoorDag.delete(taakId);
  else geselecteerdVoorDag.add(taakId);
  renderSelecteerLijst();
}

function voegGeselecteerdeToe() {
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
  for (const id of geselecteerdVoorDag) {
    dagPlanning[huidigeDag][id] = { gedaan: false, overgenomen: false };
  }
  slaData();
  renderDag();
  document.getElementById('select-modal-overlay').classList.add('hidden');
}

// ===== TAAK TOEVOEGEN AAN DAG =====
let voegToeAanDagNaSave = false;
let snelModalType = 'zakelijk';

function openSnelModal(type) {
  snelModalType = type || 'zakelijk';
  document.getElementById('snel-modal-titel').textContent = snelModalType === 'prive' ? 'Snel privé' : 'Snel werk';
  document.getElementById('snel-onderwerp').value = '';
  setTijdstipPickerWaarde('snel-tijd-picker', '');
  document.getElementById('snel-modal-overlay').classList.remove('hidden');
  document.getElementById('snel-onderwerp').focus();
}

function slaSnelModalOp() {
  const omschrijving = document.getElementById('snel-onderwerp').value.trim();
  if (!omschrijving) { document.getElementById('snel-onderwerp').focus(); return; }
  const tijdstip = document.getElementById('snel-tijd').value || null;

  const taak = {
    id: genId(),
    omschrijving,
    thema: 'Overig',
    type: snelModalType,
    periode: 'A',
    grootte: 'K',
    prio: 5,
    tijdstip,
    notities: '',
    afgerond: false,
    afgerondDatum: null,
    aangemaakt: new Date().toISOString()
  };
  taken.push(taak);
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
  dagPlanning[huidigeDag][taak.id] = { gedaan: false, overgenomen: false, tijdstip };
  document.getElementById('snel-modal-overlay').classList.add('hidden');
  slaData();
  renderDag();
}

function sluitSnelModal() {
  document.getElementById('snel-modal-overlay').classList.add('hidden');
}

// ===== URGENT / BELANGRIJK (automatisch) =====
// Urgent  = periode A (nu moet het)
// Belangrijk = prioriteit 1 t/m 5
function isUrgent(t)     { return t.periode === 'A'; }
function isBelangrijk(t) { return t.prio <= 5; }

// ===== STANDAARD DAGACTIES =====
function slaStandaarden() {
  Storage.set('actielijst_standaarden', standaarden);
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(syncServer, 800);
}

function openStandaardenModal() {
  renderStandaardenModal();
  document.getElementById('standaarden-modal-overlay').classList.remove('hidden');
}

function renderStandaardenModal() {
  document.getElementById('standaarden-dag-label').textContent = formatDatum(huidigeDag);

  const beheerLijst = document.getElementById('standaarden-beheer-lijst');
  if (!standaarden.length) {
    beheerLijst.innerHTML = '<div class="standaarden-leeg">Nog geen standaarden. Voeg er hieronder een toe.</div>';
  } else {
    beheerLijst.innerHTML = standaarden.map(s => `
      <div class="standaard-rij" data-id="${s.id}">
        <input type="text" class="standaard-naam-input filter-select" value="${escHtml(s.naam)}" placeholder="Naam">
        <input type="time" class="standaard-tijd-input filter-select" value="${s.tijdstip || ''}">
        <select class="standaard-type-select filter-select">
          <option value="zakelijk"${s.type !== 'prive' ? ' selected' : ''}>Zakelijk</option>
          <option value="prive"${s.type === 'prive' ? ' selected' : ''}>Privé</option>
        </select>
        <button class="task-action-btn btn-delete standaard-delete-btn" data-tooltip="Verwijderen">&#x1F5D1;</button>
      </div>
    `).join('');

    beheerLijst.querySelectorAll('.standaard-rij').forEach(rij => {
      const id = rij.dataset.id;
      rij.querySelector('.standaard-naam-input').addEventListener('blur', function() {
        const val = this.value.trim();
        if (val) updateStandaard(id, 'naam', val);
      });
      rij.querySelector('.standaard-tijd-input').addEventListener('change', function() {
        updateStandaard(id, 'tijdstip', this.value || null);
      });
      rij.querySelector('.standaard-type-select').addEventListener('change', function() {
        updateStandaard(id, 'type', this.value);
      });
      rij.querySelector('.standaard-delete-btn').addEventListener('click', () => verwijderStandaard(id));
    });
  }

  const dagLijst = document.getElementById('standaarden-dag-lijst');
  const dagSectie = document.getElementById('standaarden-dag-sectie');
  if (!standaarden.length) {
    dagSectie.style.display = 'none';
  } else {
    dagSectie.style.display = '';
    dagLijst.innerHTML = standaarden.map(s => `
      <div class="standaard-dag-rij" data-id="${s.id}">
        <label class="standaard-dag-label">
          <input type="checkbox" class="standaard-dag-check">
          <span>${escHtml(s.naam)}</span>
          ${s.tijdstip ? `<span class="badge badge-grootte">${s.tijdstip}</span>` : ''}
          <span class="badge badge-${s.type}">${s.type === 'zakelijk' ? 'Zakelijk' : 'Privé'}</span>
        </label>
        <input type="time" class="standaard-dag-override filter-select" value="${s.tijdstip || ''}" title="Tijdstip voor deze dag">
      </div>
    `).join('');
  }
}

function updateStandaard(id, veld, waarde) {
  standaarden = standaarden.map(s => s.id === id ? { ...s, [veld]: waarde } : s);
  slaStandaarden();
}

function verwijderStandaard(id) {
  standaarden = standaarden.filter(s => s.id !== id);
  slaStandaarden();
  renderStandaardenModal();
}

function voegNieuweStandaardToe() {
  const naam = document.getElementById('nieuw-standaard-naam').value.trim();
  if (!naam) { document.getElementById('nieuw-standaard-naam').focus(); return; }
  const tijdstip = document.getElementById('nieuw-standaard-tijd').value || null;
  const type = document.getElementById('nieuw-standaard-type').value;
  standaarden.push({ id: genId(), naam, tijdstip, type });
  slaStandaarden();
  document.getElementById('nieuw-standaard-naam').value = '';
  document.getElementById('nieuw-standaard-tijd').value = '';
  renderStandaardenModal();
  document.getElementById('nieuw-standaard-naam').focus();
}

function voegStandaardenToeAanDag() {
  const rijen = document.querySelectorAll('.standaard-dag-rij');
  let toegevoegd = 0;
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};

  rijen.forEach(rij => {
    if (!rij.querySelector('.standaard-dag-check').checked) return;
    const standaard = standaarden.find(s => s.id === rij.dataset.id);
    if (!standaard) return;
    const tijdstip = (rij.querySelector('.standaard-dag-override').value || standaard.tijdstip) || null;
    const taak = {
      id: genId(),
      omschrijving: standaard.naam,
      thema: 'Overig',
      type: standaard.type,
      periode: 'A',
      grootte: 'K',
      prio: 5,
      tijdstip,
      notities: '',
      isStandaard: true,
      afgerond: false,
      afgerondDatum: null,
      aangemaakt: new Date().toISOString()
    };
    taken.push(taak);
    dagPlanning[huidigeDag][taak.id] = { gedaan: false, overgenomen: false, tijdstip };
    toegevoegd++;
  });

  if (!toegevoegd) return;
  document.getElementById('standaarden-modal-overlay').classList.add('hidden');
  slaData();
  renderDag();
}

// ===== EXPORT / IMPORT =====
function exporteerData() {
  const exportData = {
    exportDatum: new Date().toISOString(),
    versie: '1.1',
    taken,
    dagPlanning,
    standaarden
  };
  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `actielijst-export-${vandaagStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importeerData() {
  document.getElementById('import-file-input').click();
}

function verwerkImportBestand(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      alert('Ongeldig bestand: kan de JSON niet lezen.');
      return;
    }

    if (!data.versie || !Array.isArray(data.taken)) {
      alert('Ongeldig formaat: versie-veld of taken-array ontbreekt.');
      return;
    }

    const bevestigd = confirm(
      'Wil je importeren?\n\nDit VOEGT toe aan je huidige data.\nDuplicaten worden overgeslagen op basis van taak-id (taken) en naam (standaarden).'
    );
    if (!bevestigd) {
      document.getElementById('import-file-input').value = '';
      return;
    }

    // Merge taken
    const bestaandeIds = new Set(taken.map(t => t.id));
    const nieuweTaken = data.taken.filter(t => t.id && !bestaandeIds.has(t.id));
    taken.push(...nieuweTaken);

    // Merge dagPlanning
    let nieuweDagEntries = 0;
    const importPlanning = normDagPlanning(data.dagPlanning || {});
    for (const [dag, planning] of Object.entries(importPlanning)) {
      if (!dagPlanning[dag]) {
        dagPlanning[dag] = { ...planning };
        nieuweDagEntries += Object.keys(planning).filter(k => !k.startsWith('__')).length;
      } else {
        for (const [id, info] of Object.entries(planning)) {
          if (id.startsWith('__')) continue;
          if (!dagPlanning[dag][id]) {
            dagPlanning[dag][id] = info;
            nieuweDagEntries++;
          }
        }
      }
    }

    // Merge standaarden
    const bestaandeNamen = new Set(standaarden.map(s => s.naam.toLowerCase()));
    const nieuweStandaarden = (data.standaarden || []).filter(
      s => s.naam && !bestaandeNamen.has(s.naam.toLowerCase())
    );
    standaarden.push(...nieuweStandaarden);
    Storage.set('actielijst_standaarden', standaarden);

    slaData();
    renderAlles();

    document.getElementById('import-file-input').value = '';
    alert(`Geïmporteerd: ${nieuweTaken.length} taken, ${nieuweDagEntries} dag-entries en ${nieuweStandaarden.length} standaarden.`);
  };
  reader.readAsText(file);
}

// ===== HELPERS =====
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderAlles() {
  renderDag();
  renderMaster();
  renderMatrix();
  renderArchief();
}

// ===== NAVIGATIE =====
function wisselTab(naam) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === naam));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + naam));
  if (naam === 'dag') renderDag();
  if (naam === 'master') renderMaster();
  if (naam === 'matrix') renderMatrix();
  if (naam === 'archief') renderArchief();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  laadData();
  carryForward();
  renderAlles();
  console.log('[INIT] localStorage: taken:', taken.length, '| dagPlanning datums:', Object.keys(dagPlanning).length);
  if (taken.length === 0 && Object.keys(dagPlanning).length === 0) {
    console.log('[INIT] localStorage leeg → laden van server');
    laadVanServer();
  } else {
    console.log('[INIT] localStorage heeft data → push naar server');
    syncServer();
  }

  // Init tijdstip pickers
  initTijdstipPicker('taak-tijd-picker');
  initTijdstipPicker('snel-tijd-picker');
  initTijdstipPicker('dag-tijdstip-picker');

  // Dag tijdstip modal
  document.getElementById('dag-tijdstip-opslaan').addEventListener('click', slaaDagTijdstipOp);
  document.getElementById('dag-tijdstip-sluiten').addEventListener('click', () => {
    document.getElementById('dag-tijdstip-modal-overlay').classList.add('hidden');
  });
  document.getElementById('dag-tijdstip-annuleren').addEventListener('click', () => {
    document.getElementById('dag-tijdstip-modal-overlay').classList.add('hidden');
  });
  document.getElementById('dag-tijdstip-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('dag-tijdstip-modal-overlay').classList.add('hidden');
  });

  // Tab navigatie
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => wisselTab(btn.dataset.tab));
  });

  // Dag navigatie (alle dagen)
  document.getElementById('prev-dag').addEventListener('click', () => {
    huidigeDag = datumOffset(-1, huidigeDag);
    renderDag();
  });
  document.getElementById('next-dag').addEventListener('click', () => {
    huidigeDag = datumOffset(1, huidigeDag);
    renderDag();
  });
  document.getElementById('naar-vandaag').addEventListener('click', () => {
    huidigeDag = vandaagStr();
    renderDag();
  });

  // Dag acties
  document.getElementById('snel-werk-btn').addEventListener('click', () => openSnelModal('zakelijk'));
  document.getElementById('snel-prive-btn').addEventListener('click', () => openSnelModal('prive'));
  document.getElementById('taken-selecteren').addEventListener('click', openSelecteerModal);
  document.getElementById('standaarden-btn').addEventListener('click', openStandaardenModal);

  // Standaarden modal
  document.getElementById('standaarden-sluiten').addEventListener('click', () => {
    document.getElementById('standaarden-modal-overlay').classList.add('hidden');
  });
  document.getElementById('standaarden-annuleren').addEventListener('click', () => {
    document.getElementById('standaarden-modal-overlay').classList.add('hidden');
  });
  document.getElementById('standaarden-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('standaarden-modal-overlay').classList.add('hidden');
  });
  document.getElementById('standaarden-toevoegen-btn').addEventListener('click', voegStandaardenToeAanDag);
  document.getElementById('nieuw-standaard-btn').addEventListener('click', voegNieuweStandaardToe);
  document.getElementById('nieuw-standaard-naam').addEventListener('keydown', e => {
    if (e.key === 'Enter') voegNieuweStandaardToe();
  });

  // Master nieuw
  document.getElementById('nieuwe-taak-btn').addEventListener('click', openNieuweTaakModal);
  document.getElementById('export-btn').addEventListener('click', exporteerData);
  document.getElementById('import-btn').addEventListener('click', importeerData);
  document.getElementById('import-file-input').addEventListener('change', function() {
    verwerkImportBestand(this.files[0]);
  });

  // Master filters
  ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio','filter-status'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderMaster);
  });
  document.getElementById('master-sortering').addEventListener('change', renderMaster);
  document.getElementById('filter-reset').addEventListener('click', () => {
    ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('filter-status').value = 'actief';
    document.getElementById('master-sortering').value = 'thema';
    renderMaster();
  });

  // Auto-indicatie in modal bijwerken bij wijzigen periode/prio
  document.getElementById('taak-periode').addEventListener('change', updateAutoIndicatie);
  document.getElementById('taak-prio').addEventListener('input', updateAutoIndicatie);

  // Standaard prioriteit invullen bij thema-keuze (alleen bij nieuwe taak, niet bewerken)
  document.getElementById('taak-thema').addEventListener('change', () => {
    if (bewerkTaakId) return;
    setModalWaarde('prio', standaardPrioVoorThema(document.getElementById('taak-thema').value));
  });

  // Privé: verberg overige velden
  document.getElementById('taak-type').addEventListener('change', togglePriveVelden);

  // Modal opslaan/sluiten
  document.getElementById('modal-opslaan').addEventListener('click', slaModalOp);
  document.getElementById('modal-sluiten').addEventListener('click', sluitModal);
  document.getElementById('modal-annuleren').addEventListener('click', sluitModal);
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) sluitModal(); });

  // Enter in modal
  document.getElementById('taak-omschrijving').addEventListener('keydown', e => { if (e.key === 'Enter') slaModalOp(); });

  // Snel toevoegen modal
  document.getElementById('snel-modal-opslaan').addEventListener('click', slaSnelModalOp);
  document.getElementById('snel-modal-sluiten').addEventListener('click', sluitSnelModal);
  document.getElementById('snel-modal-annuleren').addEventListener('click', sluitSnelModal);
  document.getElementById('snel-modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) sluitSnelModal(); });
  document.getElementById('snel-onderwerp').addEventListener('keydown', e => { if (e.key === 'Enter') slaSnelModalOp(); });

  // Selecteer modal
  document.getElementById('select-modal-sluiten').addEventListener('click', () => {
    document.getElementById('select-modal-overlay').classList.add('hidden');
  });
  document.getElementById('select-modal-annuleren').addEventListener('click', () => {
    document.getElementById('select-modal-overlay').classList.add('hidden');
  });
  document.getElementById('select-modal-toevoegen').addEventListener('click', voegGeselecteerdeToe);
  document.getElementById('sel-filter-thema').addEventListener('change', renderSelecteerLijst);
  document.getElementById('sel-filter-periode').addEventListener('change', renderSelecteerLijst);

  // Archief filters
  document.getElementById('archief-maand').addEventListener('change', renderArchief);
  document.getElementById('archief-thema').addEventListener('change', renderArchief);
  document.getElementById('archief-maand').value = new Date().toISOString().slice(0,7);

  // Sync knop
  document.getElementById('sync-btn').addEventListener('click', () => {
    clearTimeout(syncTimeout);
    syncServer();
  });
});
