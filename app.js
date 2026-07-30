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
let bewerkSnapshot = null;
let geselecteerdVoorDag = new Set();
let dragSrcId = null;
let dragSrcSectie = null;
let huidigeTijdstipTaakId = null;
let standaarden = [];
let records = { besteDagen: [], besteMaanden: [] };
let masterKwadrantFilter = null;

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
  records = Storage.get('actielijst_records', { besteDagen: [], besteMaanden: [] });
  const dagKeys = dagPlanning[vandaagStr()] ? Object.keys(dagPlanning[vandaagStr()]).filter(k => !k.startsWith('__')) : [];
  console.log('[LOAD] taken:', taken.length, '| vandaag in dagPlanning:', dagKeys.length, dagKeys);
}

function slaData(syncNaarServer = true) {
  const dagKeys = dagPlanning[vandaagStr()] ? Object.keys(dagPlanning[vandaagStr()]).filter(k => !k.startsWith('__')) : [];
  console.log('[SAVE] taken:', taken.length, '| vandaag in dagPlanning:', dagKeys.length, dagKeys);
  Storage.set('actielijst_taken', taken);
  Storage.set('actielijst_dagPlanning', dagPlanning);
  Storage.set('actielijst_standaarden', standaarden);
  Storage.set('actielijst_laatstGewijzigd', Date.now());
  const rawDag = localStorage.getItem('actielijst_dagPlanning');
  console.log('[SAVE-RAW] na schrijven:', rawDag ? rawDag.substring(0, 120) : 'NULL — schrijven mislukt!');
  if (syncNaarServer) {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(syncServer, 800);
  }
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
      body: 'd=' + encodeURIComponent(JSON.stringify({ taken, dagPlanning, standaarden, laatstGewijzigd: Storage.get('actielijst_laatstGewijzigd', 0) }))
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
      if (data.laatstGewijzigd) Storage.set('actielijst_laatstGewijzigd', data.laatstGewijzigd);
      console.log('[SERVER] server-data geladen');
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

  if (!dagPlanning[vandaag]) dagPlanning[vandaag] = {};

  // Doorloop ALLE verleden dagen (ook als er meerdere werkdagen zijn overgeslagen)
  const verledenDagen = Object.keys(dagPlanning).filter(d => d < vandaag).sort();

  let overgenomen = 0;
  for (const dag of verledenDagen) {
    const planning = dagPlanning[dag];
    if (!planning) continue;
    for (const [taakId, info] of Object.entries(planning)) {
      if (taakId.startsWith('__')) continue;
      if (info.gedaan) continue; // afgevinkt → laat in verleden (archief)
      const taak = taken.find(t => t.id === taakId);
      if (taak?.isStandaard) continue;
      if (!dagPlanning[vandaag][taakId]) {
        dagPlanning[vandaag][taakId] = { gedaan: false, overgenomen: true };
        overgenomen++;
      }
      delete planning[taakId];
    }
  }

  if (overgenomen > 0) slaData(false);
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
          ${t.snelToegevoegd ? '' : `<span class="badge badge-thema-${t.thema}">${t.thema}</span>`}
          <span class="badge badge-${t.type}">${t.type === 'zakelijk' ? 'Zakelijk' : 'Privé'}</span>
          ${!t.snelToegevoegd && t.periode ? `<span class="badge badge-${t.periode}">${t.periode}</span>` : ''}
          ${!t.snelToegevoegd && t.grootte ? `<span class="badge badge-grootte">${t.grootte}</span>` : ''}
          ${!t.snelToegevoegd && t.prio ? `<span class="badge badge-prio">P${t.prio}</span>` : ''}
          ${!t.snelToegevoegd && isUrgent(t) ? '<span class="badge badge-urgent">Urgent</span>' : ''}
          ${overgenomen ? '<span class="badge" style="background:#fef3c7;color:#92400e">Overgenomen</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        ${!gedaan && huidigeDag !== vandaagStr() ? `<button class="task-action-btn" onclick="verplaatsNaarVandaag('${t.id}', '${huidigeDag}', event)" data-tooltip="Naar vandaag">&#10142;</button>` : ''}
        ${!gedaan ? `<button class="task-action-btn" onclick="openVerplaatsDatumModal('${t.id}', '${huidigeDag}', event)" data-tooltip="Verplaats naar datum">&#128197;</button>` : ''}
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
  const wordtGedaan = !info.gedaan;
  dagPlanning[huidigeDag][taakId] = { ...info, gedaan: wordtGedaan };

  // Niet-terugkerende taak afgevinkt → uit Master halen (blijft in Archief via dagPlanning)
  const taak = taken.find(t => t.id === taakId);
  if (taak && !taak.altijdBewaren) {
    if (wordtGedaan) {
      taak.uitMaster = true;
      taak.afgerond = true;
      taak.afgerondDatum = taak.afgerondDatum || huidigeDag;
    } else {
      taak.uitMaster = false;
      taak.afgerond = false;
      taak.afgerondDatum = null;
    }
  }

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

// ===== TAAK VERPLAATSEN TUSSEN DAGEN =====
let verplaatsTaakId = null;
let verplaatsFromDate = null;

function verplaatsTaakDag(taakId, fromDate, toDate) {
  if (!fromDate || !toDate || fromDate === toDate) return;
  if (!dagPlanning[fromDate] || !dagPlanning[fromDate][taakId]) return;
  if (!dagPlanning[toDate]) dagPlanning[toDate] = {};
  dagPlanning[toDate][taakId] = dagPlanning[fromDate][taakId];
  delete dagPlanning[fromDate][taakId];
  slaData();
  renderDag();
  if (document.getElementById('tab-archief').classList.contains('active')) renderArchief();
}

function verplaatsNaarVandaag(taakId, fromDate, event) {
  event.stopPropagation();
  verplaatsTaakDag(taakId, fromDate, vandaagStr());
}

function openVerplaatsDatumModal(taakId, fromDate, event) {
  event.stopPropagation();
  verplaatsTaakId = taakId;
  verplaatsFromDate = fromDate;
  document.getElementById('verplaats-datum-input').value = vandaagStr();
  document.getElementById('verplaats-modal-overlay').classList.remove('hidden');
}

function slaVerplaatsOp() {
  const datum = document.getElementById('verplaats-datum-input').value;
  if (datum && verplaatsTaakId && verplaatsFromDate) {
    verplaatsTaakDag(verplaatsTaakId, verplaatsFromDate, datum);
  }
  sluitVerplaatsModal();
}

function sluitVerplaatsModal() {
  verplaatsTaakId = null;
  verplaatsFromDate = null;
  document.getElementById('verplaats-modal-overlay').classList.add('hidden');
}

// ===== ARCHIEF: AFVINKEN / VERWIJDEREN =====
function vinkArchiefAf(taakId, dag, event) {
  event.stopPropagation();
  if (!dagPlanning[dag] || !dagPlanning[dag][taakId]) return;
  dagPlanning[dag][taakId] = { ...dagPlanning[dag][taakId], gedaan: true };
  const taak = taken.find(t => t.id === taakId);
  if (taak && !taak.altijdBewaren) {
    taak.uitMaster = true;
    taak.afgerond = true;
    taak.afgerondDatum = taak.afgerondDatum || dag;
  }
  slaData();
  renderArchief();
}

function verwijderArchiefTaak(taakId, dag, event) {
  event.stopPropagation();
  if (dagPlanning[dag]) {
    delete dagPlanning[dag][taakId];
    slaData();
    renderArchief();
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
  input.addEventListener('change', () => syncPickerButtons(container, input));

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
    if (t.uitMaster) return false;
    if (thema && t.thema !== thema) return false;
    if (periode && t.periode !== periode) return false;
    if (grootte && t.grootte !== grootte) return false;
    if (type && t.type !== type) return false;
    if (prio && String(t.prio) !== prio) return false;
    if (status === 'actief_wachten' && t.afgerond && !t.altijdBewaren) return false;
    if (status === 'actief' && (t.afgerond || t.wachten) && !t.altijdBewaren) return false;
    if (status === 'wachten' && !t.wachten) return false;
    if (status === 'afgerond' && !t.afgerond) return false;
    if (status === 'terugkerend' && !t.altijdBewaren) return false;
    return true;
  });

  // Kwadrant filter vanuit Stats-tab
  if (masterKwadrantFilter) {
    gefilterd = gefilterd.filter(t => isUrgent(t) === masterKwadrantFilter.u && isBelangrijk(t) === masterKwadrantFilter.b);
  }

  // Groepeer per thema
  const themas = ['IURC', 'AI', 'Innovatie', 'DHM', 'TD', 'EU', 'Spreker', 'Overig'];
  const container = document.getElementById('master-lijst');

  const kwadrantBanner = masterKwadrantFilter ? `<div class="kwadrant-banner">
    <span>Kwadrant: <b>${kwadrantNaam(masterKwadrantFilter.u, masterKwadrantFilter.b)}</b></span>
    <button class="reset-btn" onclick="clearMasterKwadrantFilter()">✕ Wis filter</button>
  </div>` : '';

  if (!gefilterd.length) {
    container.innerHTML = kwadrantBanner + '<div class="empty-state">Geen taken gevonden. Maak een nieuwe taak aan.</div>';
    return;
  }

  const sortering = document.getElementById('master-sortering')?.value || 'thema';

  if (sortering === 'thema') {
    const zakelijkTaken = gefilterd.filter(t => t.type !== 'prive');
    const priveTaken = gefilterd.filter(t => t.type === 'prive');

    const perThema = {};
    for (const t of themas) perThema[t] = [];
    for (const t of zakelijkTaken) {
      if (!perThema[t.thema]) perThema[t.thema] = [];
      perThema[t.thema].push(t);
    }

    const themaHTML = themas.map(t => {
      const lijst = perThema[t];
      if (!lijst.length) return '';
      const gesorteerd = lijst.sort((a,b) => (a.periode||'Z').localeCompare(b.periode||'Z') || a.prio - b.prio);
      return `<div class="thema-groep">
        <div class="thema-header thema-header-${t}">${t} <span class="thema-count">${lijst.length} taken</span></div>
        ${gesorteerd.map(taak => renderMasterKaart(taak)).join('')}
      </div>`;
    }).join('');

    const priveHTML = priveTaken.length ? `<div class="thema-groep">
      <div class="thema-header thema-header-prive">Privé <span class="thema-count">${priveTaken.length} taken</span></div>
      ${priveTaken.sort((a,b) => (a.periode||'Z').localeCompare(b.periode||'Z') || (a.prio||5) - (b.prio||5)).map(taak => renderMasterKaart(taak)).join('')}
    </div>` : '';

    container.innerHTML = kwadrantBanner + themaHTML + priveHTML;
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
  const wachten = !!t.wachten;
  return `<div class="task-card ${afgerond ? 'master-afgerond' : ''} ${wachten ? 'master-wachten' : ''}" data-id="${t.id}" onclick="bewerkTaak('${t.id}')">
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
        ${wachten ? '<span class="badge badge-wachten">⏸ Wachten</span>' : ''}
        ${t.notities ? `<span class="badge badge-notitie" title="${escHtml(t.notities)}">Notitie</span>` : ''}
        ${t.altijdBewaren ? '<span class="badge badge-terugkerend" title="Terugkerende taak">↻</span>' : ''}
      </div>
    </div>
    <div class="task-actions">
      ${!afgerond ? `<button class="task-action-btn btn-dag" onclick="voegToeAanVandaag('${t.id}', event)" data-tooltip="Aan vandaag toevoegen">+</button>` : ''}
      <button class="task-action-btn btn-gedaan" onclick="toggleMasterAfgerond('${t.id}', event)" data-tooltip="${afgerond ? 'Heropen taak' : (t.altijdBewaren ? 'Terugkerende taak' : 'Markeer als gedaan')}">
        ${afgerond ? '&#x21A9;' : '&#x2713;'}
      </button>
      ${!afgerond ? `<button class="task-action-btn btn-wachten" onclick="toggleMasterWachten('${t.id}', event)" data-tooltip="${wachten ? 'Zet actief' : 'Op wachten'}">⏸</button>` : ''}
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
      ? bijhorend.sort((a,b) => a.prio - b.prio).map(t => {
          const inVandaag = !!(dagPlanning[vandaagStr()]?.[t.id]);
          return `<div class="task-card" onclick="bewerkTaak('${t.id}')">
            <div class="task-body">
              <div class="task-omschrijving" style="font-size:12px">${escHtml(t.omschrijving)}</div>
              <div class="task-meta">
                <span class="badge badge-thema-${t.thema}" style="font-size:10px">${t.thema}</span>
                <span class="badge badge-${t.periode}" style="font-size:10px">${t.periode}</span>
                <span class="badge badge-prio" style="font-size:10px">P${t.prio}</span>
              </div>
            </div>
            <div class="task-actions">
              ${!inVandaag ? `<button class="task-action-btn btn-dag" onclick="voegToeAanVandaag('${t.id}', event)" data-tooltip="Aan vandaag">+</button>` : ''}
              <button class="task-action-btn btn-gedaan" onclick="toggleMasterAfgerond('${t.id}', event)" data-tooltip="Afronden">&#x2713;</button>
              <button class="task-action-btn btn-delete" onclick="verwijderTaak('${t.id}', event)" data-tooltip="Verwijderen">&#x1F5D1;</button>
            </div>
          </div>`;
        }).join('')
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
        const isOpen = !isGedaan && !isVerwijderd;
        return `
        <div class="task-card ${isGedaan ? 'gedaan' : ''} ${isVerwijderd ? 'archief-verwijderd' : ''}" style="cursor:default">
          ${isGedaan || isVerwijderd ? `<div class="task-check">${isGedaan ? '✓' : '🗑'}</div>` : ''}
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
          ${isOpen ? `<div class="task-actions" style="opacity:1">
            ${dag !== vandaagStr() ? `<button class="task-action-btn" onclick="verplaatsNaarVandaag('${t.id}', '${dag}', event)" data-tooltip="Naar vandaag">&#10142;</button>` : ''}
            <button class="task-action-btn" onclick="openVerplaatsDatumModal('${t.id}', '${dag}', event)" data-tooltip="Verplaats naar datum">&#128197;</button>
            <button class="task-action-btn btn-gedaan" onclick="vinkArchiefAf('${t.id}', '${dag}', event)" data-tooltip="Markeer als gedaan">&#x2713;</button>
            <button class="task-action-btn btn-delete" onclick="verwijderArchiefTaak('${t.id}', '${dag}', event)" data-tooltip="Verwijder uit dag">&#x2715;</button>
          </div>` : ''}
          ${isVerwijderd ? `<div class="task-actions" style="opacity:1">
            <button class="task-action-btn btn-delete" onclick="definitiefVerwijder('${t.id}', event)" data-tooltip="Definitief verwijderen">&#x1F5D1;</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
  berekenEnSlaRecords();
}

function definitiefVerwijder(taakId, event) {
  event.stopPropagation();
  if (!confirm('Deze taak definitief verwijderen uit alle data? Dit kan niet ongedaan worden gemaakt.')) return;
  taken = taken.filter(t => t.id !== taakId);
  slaData();
  renderArchief();
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
  bewerkSnapshot = getModalSnapshot();
}

function getModalSnapshot() {
  return JSON.stringify({
    o: document.getElementById('taak-omschrijving').value.trim(),
    th: document.getElementById('taak-thema').value,
    ty: document.getElementById('taak-type').value,
    p: document.getElementById('taak-periode').value,
    g: document.getElementById('taak-grootte').value,
    pr: document.getElementById('taak-prio').value,
    t: document.getElementById('taak-tijd').value || '',
    n: document.getElementById('taak-notities').value.trim(),
    ab: !!document.getElementById('taak-altijd-bewaren').checked
  });
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
    wachten: oud?.wachten || false,
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
  bewerkSnapshot = null;
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

function slaSnelModalOp(houdOpen = false) {
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
    snelToegevoegd: true,
    aangemaakt: new Date().toISOString()
  };
  taken.push(taak);
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
  dagPlanning[huidigeDag][taak.id] = { gedaan: false, overgenomen: false, tijdstip };
  slaData();
  renderDag();

  if (houdOpen) {
    document.getElementById('snel-onderwerp').value = '';
    setTijdstipPickerWaarde('snel-tijd-picker', '');
    document.getElementById('snel-onderwerp').focus();
  } else {
    document.getElementById('snel-modal-overlay').classList.add('hidden');
  }
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
  Storage.set('actielijst_laatstGewijzigd', Date.now());
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
      <div class="standaard-rij standaard-${s.type === 'prive' ? 'prive' : 'zakelijk'}" data-id="${s.id}">
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
        rij.classList.toggle('standaard-prive', this.value === 'prive');
        rij.classList.toggle('standaard-zakelijk', this.value !== 'prive');
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
      <div class="standaard-dag-rij standaard-${s.type === 'prive' ? 'prive' : 'zakelijk'}" data-id="${s.id}">
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

// ===== WACHTEN STATUS =====
function toggleMasterWachten(taakId, event) {
  event.stopPropagation();
  taken = taken.map(t => {
    if (t.id !== taakId) return t;
    return { ...t, wachten: !t.wachten, afgerond: false, afgerondDatum: null };
  });
  slaData();
  renderMaster();
}

// ===== KWADRANT FILTER (van Stats naar Master) =====
function kwadrantNaam(u, b) {
  if (u && b) return 'Doe nu (Urgent + Belangrijk)';
  if (!u && b) return 'Plan in (Niet urgent + Belangrijk)';
  if (u && !b) return 'Delegeer (Urgent + Niet belangrijk)';
  return 'Elimineer (Niet urgent + Niet belangrijk)';
}

function naarMasterKwadrant(u, b) {
  masterKwadrantFilter = { u, b };
  ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('filter-status').value = 'actief_wachten';
  document.getElementById('master-sortering').value = 'thema';
  wisselTab('master');
}

function clearMasterKwadrantFilter() {
  masterKwadrantFilter = null;
  renderMaster();
}

// ===== RECORDS (aller tijden) =====
function berekenEnSlaRecords() {
  const dagStats = {};
  for (const [dag, planning] of Object.entries(dagPlanning)) {
    const items = Object.entries(planning).filter(([k]) => !k.startsWith('__'));
    const totaal = items.length;
    const gedaan = items.filter(([, v]) => v.gedaan).length;
    if (totaal > 0) dagStats[dag] = { gedaan, totaal };
  }

  const sortedDagen = Object.entries(dagStats)
    .sort((a, b) => b[1].gedaan - a[1].gedaan)
    .slice(0, 3)
    .map(([datum, s]) => ({ datum, aantalGedaan: s.gedaan, totaal: s.totaal }));

  const maandStats = {};
  for (const [dag, s] of Object.entries(dagStats)) {
    if (!s.gedaan) continue;
    const maand = dag.slice(0, 7);
    if (!maandStats[maand]) maandStats[maand] = { totaalGedaan: 0, aantalDagen: 0 };
    maandStats[maand].totaalGedaan += s.gedaan;
    maandStats[maand].aantalDagen++;
  }

  const sortedMaanden = Object.entries(maandStats)
    .sort((a, b) => b[1].totaalGedaan - a[1].totaalGedaan)
    .slice(0, 3)
    .map(([maand, s]) => ({ maand, totaalGedaan: s.totaalGedaan, gemDagelijks: Math.round(s.totaalGedaan / s.aantalDagen * 10) / 10 }));

  records = { besteDagen: sortedDagen, besteMaanden: sortedMaanden };
  Storage.set('actielijst_records', records);
}

// ===== INFO POPUP =====
function toggleInfoPopup(id) {
  const popup = document.getElementById(id);
  if (!popup) return;
  const isOpen = !popup.classList.contains('hidden');
  document.querySelectorAll('.info-popup').forEach(p => p.classList.add('hidden'));
  if (!isOpen) popup.classList.remove('hidden');
}

// ===== STATISTIEKEN =====
function getMondayStr(d) {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(mon.getDate() + diff);
  return localDateStr(mon);
}

function getLast12Mondays() {
  const result = [];
  let d = new Date(getMondayStr(new Date()) + 'T00:00:00');
  for (let i = 0; i < 12; i++) {
    result.unshift(localDateStr(d));
    d.setDate(d.getDate() - 7);
  }
  return result;
}

function getLast6Months() {
  const result = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return result;
}

function getLast12Months() {
  const result = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  return result;
}

function getLast60Days() {
  const result = [];
  const today = new Date();
  for (let i = 59; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    result.push(localDateStr(d));
  }
  return result;
}

function eindeMaand(maandStr) {
  const [y, m] = maandStr.split('-').map(Number);
  return localDateStr(new Date(y, m, 0));
}

function getTaakAanmaakDatum(t) {
  if (t.aangemaakt) return t.aangemaakt.slice(0, 10);
  try {
    const ts = parseInt(t.id.slice(0, 8), 36);
    if (ts > 1500000000000 && ts < 2100000000000) {
      return new Date(ts).toISOString().slice(0, 10);
    }
  } catch(e) {}
  return null;
}

function taakOpenOpDag(t, dagStr, aangemaakt) {
  if (!aangemaakt || aangemaakt > dagStr) return false;
  if (t.verwijderd && t.verwijderdDatum && t.verwijderdDatum <= dagStr) return false;
  if (t.afgerond && !t.altijdBewaren && t.afgerondDatum && t.afgerondDatum <= dagStr) return false;
  return true;
}

function formatMaand(str) {
  const [y, m] = str.split('-');
  const mnd = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  return mnd[parseInt(m)-1] + ' \'' + y.slice(2);
}

function formatWeekLabel(mondayStr) {
  const d = new Date(mondayStr + 'T00:00:00');
  return `${d.getDate()}/${d.getMonth()+1}`;
}

function statBar(label, val, max, kleur, unit) {
  const w = max ? Math.max(val > 0 ? 3 : 0, Math.round((val / max) * 100)) : 0;
  const display = unit === 'uur'
    ? (val === 0 ? '0u' : val % 1 === 0 ? val + 'u' : val.toFixed(1) + 'u')
    : val;
  return `<div class="stat-bar-rij">
    <div class="stat-bar-label">${escHtml(String(label))}</div>
    <div class="stat-bar-outer"><div class="stat-bar-inner" style="width:${w}%;${kleur ? 'background:' + kleur : ''}"></div></div>
    <div class="stat-bar-waarde">${display}</div>
  </div>`;
}

function lineChart(chartId, labels, values, kleur, unit) {
  const n = values.length;
  if (n === 0) return '';
  const W = 600, H = 130;
  const pl = 36, pr = 8, pt = 10, pb = 24;
  const iW = W - pl - pr, iH = H - pt - pb;
  const maxVal = Math.max(...values, 0.001);
  const col = kleur || '#2563eb';
  const gradId = 'grad-' + chartId;
  const fmtV = v => unit === 'uur'
    ? (v === 0 ? '0u' : v % 1 === 0 ? v + 'u' : v.toFixed(1) + 'u')
    : String(Math.round(v));
  const px = i => pl + (n > 1 ? i / (n - 1) : 0.5) * iW;
  const py = v => pt + iH - (v / maxVal) * iH;
  const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `${pl},${pt + iH} ${pts} ${px(n - 1).toFixed(1)},${pt + iH}`;
  // grid lines at 25%, 50%, 75%
  const grid = [0.25, 0.5, 0.75, 1].map(f => {
    const v = maxVal * f, yp = py(v).toFixed(1);
    return `<line x1="${pl}" y1="${yp}" x2="${pl + iW}" y2="${yp}" stroke="#e2e8f0" stroke-width="0.5" stroke-dasharray="3,3"/>
      <text x="${pl - 3}" y="${(parseFloat(yp) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#94a3b8">${fmtV(Math.round(maxVal * f))}</text>`;
  }).join('');
  // x-axis labels: show 1st-of-month markers (contain '/'), and for <=14 pts show all
  const xLabels = labels.map((lbl, i) => {
    const show = n <= 14 || i === 0 || i === n - 1 || String(lbl).includes('/') || (n <= 30 && i % 5 === 0) || (n > 30 && i % 10 === 0);
    if (!show) return '';
    return `<text x="${px(i).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="9" fill="#94a3b8">${escHtml(String(lbl))}</text>`;
  }).join('');
  // dots only when few points
  const dots = n <= 20 ? values.map((v, i) =>
    `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="3" fill="${col}" stroke="white" stroke-width="1.5"/>`)
    .join('') : '';
  return `<div class="line-chart-wrap"><svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grid}
    <line x1="${pl}" y1="${pt}" x2="${pl}" y2="${pt + iH}" stroke="#cbd5e1" stroke-width="1"/>
    <line x1="${pl}" y1="${pt + iH}" x2="${pl + iW}" y2="${pt + iH}" stroke="#cbd5e1" stroke-width="1"/>
    <polygon points="${area}" fill="url(#${gradId})"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
  </svg></div>`;
}

const UREN_GROOTTE = { K: 0.5, M: 2, L: 5, XL: 10 };
function urenVoorTaak(t) { return UREN_GROOTTE[t.grootte] || 1; }

function renderStatistieken() {
  const container = document.getElementById('stats-content');
  if (!container) return;

  berekenEnSlaRecords();

  const vandaag = vandaagStr();
  const actief = taken.filter(t => !t.afgerond && !t.verwijderd && !t.isStandaard);
  const afgerond = taken.filter(t => t.afgerond && !t.verwijderd && !t.isStandaard);
  const weekMon = getMondayStr(new Date());
  const maandPrefix = vandaag.slice(0, 7);
  const afgerondDezeWeek = afgerond.filter(t => t.afgerondDatum >= weekMon).length;
  const afgerondDezeMaand = afgerond.filter(t => t.afgerondDatum?.startsWith(maandPrefix)).length;
  const inDagVandaag = Object.keys(dagPlanning[vandaag] || {}).filter(k => !k.startsWith('__')).length;

  function fmtUur(u) { return u === 0 ? '0u' : u % 1 === 0 ? u + 'u' : u.toFixed(1) + 'u'; }

  // --- Overzicht ---
  const overzichtHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Overzicht</div>
    <div class="stat-cards">
      <div class="stat-card"><div class="stat-card-val">${actief.length}</div><div class="stat-card-label">Actief</div></div>
      <div class="stat-card"><div class="stat-card-val">${afgerond.length}</div><div class="stat-card-label">Afgerond</div></div>
      <div class="stat-card stat-card-groen"><div class="stat-card-val">${afgerondDezeWeek}</div><div class="stat-card-label">Deze week</div></div>
      <div class="stat-card stat-card-blauw"><div class="stat-card-val">${afgerondDezeMaand}</div><div class="stat-card-label">Deze maand</div></div>
      <div class="stat-card stat-card-oranje"><div class="stat-card-val">${inDagVandaag}</div><div class="stat-card-label">Vandaag ingepland</div></div>
    </div>
  </div>`;

  // --- Per thema (aantal + uren actief) ---
  const themas = ['IURC','AI','Innovatie','DHM','TD','EU','Spreker','Overig'];
  const themaKleuren = { IURC:'#1d4ed8', AI:'#6d28d9', Innovatie:'#15803d', DHM:'#c2410c', TD:'#0d9488', EU:'#3730a3', Spreker:'#be185d', Overig:'#475569' };
  const perThemaCount = {}, perThemaUren = {};
  themas.forEach(t => { perThemaCount[t] = 0; perThemaUren[t] = 0; });
  actief.forEach(t => {
    if (perThemaCount[t.thema] !== undefined) { perThemaCount[t.thema]++; perThemaUren[t.thema] += urenVoorTaak(t); }
  });
  const maxThemaCount = Math.max(...Object.values(perThemaCount), 0.1);
  const maxThemaUren = Math.max(...Object.values(perThemaUren), 0.1);
  const themaHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Per thema — actief</div>
    <div class="stat-bars">
      <div class="stat-bars-subheader">Aantal taken</div>
      ${themas.map(t => statBar(t, perThemaCount[t], maxThemaCount, themaKleuren[t])).join('')}
      <div class="stat-bars-subheader">Geschatte uren</div>
      ${themas.map(t => statBar(t, perThemaUren[t], maxThemaUren, themaKleuren[t], 'uur')).join('')}
    </div>
  </div>`;

  // --- Per kwadrant (klikbaar naar master) ---
  const kwadranten = [
    { label:'Doe nu', sub:'Urgent + Belangrijk', u:true, b:true, kleur:'#dc2626' },
    { label:'Plan in', sub:'Niet urgent + Belangrijk', u:false, b:true, kleur:'#2563eb' },
    { label:'Delegeer', sub:'Urgent + Niet belangrijk', u:true, b:false, kleur:'#d97706' },
    { label:'Elimineer', sub:'Niet urgent + Niet belangrijk', u:false, b:false, kleur:'#94a3b8' },
  ];
  const kwadrantHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Per kwadrant (actief) — klik om naar master te gaan</div>
    <div class="stat-kwadranten">
      ${kwadranten.map(k => {
        const count = actief.filter(t => isUrgent(t) === k.u && isBelangrijk(t) === k.b).length;
        return `<div class="stat-kwadrant stat-kwadrant-klik" style="border-top:3px solid ${k.kleur}" onclick="naarMasterKwadrant(${k.u},${k.b})">
          <div class="stat-kwadrant-val">${count}</div>
          <div class="stat-kwadrant-label">${k.label}</div>
          <div class="stat-kwadrant-sub">${k.sub}</div>
          <div class="stat-kwadrant-link">→ Bekijk in master</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;

  // --- Per prioriteit (aantal + uren actief) ---
  const perPrioCount = {}, perPrioUren = {};
  for (let i = 1; i <= 10; i++) { perPrioCount[i] = 0; perPrioUren[i] = 0; }
  actief.forEach(t => {
    if (t.prio >= 1 && t.prio <= 10) { perPrioCount[t.prio]++; perPrioUren[t.prio] += urenVoorTaak(t); }
  });
  const maxPrioCount = Math.max(...Object.values(perPrioCount), 0.1);
  const maxPrioUren = Math.max(...Object.values(perPrioUren), 0.1);
  const prioKleur = p => parseInt(p) <= 3 ? '#dc2626' : parseInt(p) <= 6 ? '#d97706' : '#94a3b8';
  const prioHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Per prioriteit — actief</div>
    <div class="stat-bars">
      <div class="stat-bars-subheader">Aantal taken</div>
      ${Object.entries(perPrioCount).map(([p, n]) => statBar('P'+p, n, maxPrioCount, prioKleur(p))).join('')}
      <div class="stat-bars-subheader">Geschatte uren</div>
      ${Object.entries(perPrioUren).map(([p, u]) => statBar('P'+p, u, maxPrioUren, prioKleur(p), 'uur')).join('')}
    </div>
  </div>`;

  // --- Per weekdag (aantal + uren afgerond) ---
  const dagNamen = ['Ma','Di','Wo','Do','Vr','Za','Zo'];
  const perWeekdagCount = [0,0,0,0,0,0,0];
  const perWeekdagUren = [0,0,0,0,0,0,0];
  afgerond.forEach(t => {
    if (!t.afgerondDatum) return;
    const idx = new Date(t.afgerondDatum + 'T00:00:00').getDay();
    const i = idx === 0 ? 6 : idx - 1;
    perWeekdagCount[i]++;
    perWeekdagUren[i] += urenVoorTaak(t);
  });
  const maxWeekdagCount = Math.max(...perWeekdagCount, 0.1);
  const maxWeekdagUren = Math.max(...perWeekdagUren, 0.1);
  const weekdagHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Per weekdag — afgerond</div>
    <div class="stat-bars">
      <div class="stat-bars-subheader">Aantal taken</div>
      ${dagNamen.map((n, i) => statBar(n, perWeekdagCount[i], maxWeekdagCount, null)).join('')}
      <div class="stat-bars-subheader">Geschatte uren</div>
      ${dagNamen.map((n, i) => statBar(n, perWeekdagUren[i], maxWeekdagUren, null, 'uur')).join('')}
    </div>
  </div>`;

  // --- Per week (aantal + uren afgerond, last 12) ---
  const mondays = getLast12Mondays();
  const perWeekCount = {}, perWeekUren = {};
  mondays.forEach(m => { perWeekCount[m] = 0; perWeekUren[m] = 0; });
  afgerond.forEach(t => {
    if (!t.afgerondDatum) return;
    const mon = getMondayStr(new Date(t.afgerondDatum + 'T00:00:00'));
    if (perWeekCount[mon] !== undefined) { perWeekCount[mon]++; perWeekUren[mon] += urenVoorTaak(t); }
  });
  const maxWeekCount = Math.max(...Object.values(perWeekCount), 0.1);
  const maxWeekUren = Math.max(...Object.values(perWeekUren), 0.1);
  const weekHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Per week — afgerond (laatste 12 weken)</div>
    <div class="stat-bars">
      <div class="stat-bars-subheader">Aantal taken</div>
      ${mondays.map(m => statBar(formatWeekLabel(m), perWeekCount[m], maxWeekCount, null)).join('')}
      <div class="stat-bars-subheader">Geschatte uren</div>
      ${mondays.map(m => statBar(formatWeekLabel(m), perWeekUren[m], maxWeekUren, null, 'uur')).join('')}
    </div>
  </div>`;

  // --- Per maand (aantal + uren afgerond, last 6) ---
  const maanden = getLast6Months();
  const perMaandCount = {}, perMaandUren = {};
  maanden.forEach(m => { perMaandCount[m] = 0; perMaandUren[m] = 0; });
  afgerond.forEach(t => {
    if (!t.afgerondDatum) return;
    const prefix = t.afgerondDatum.slice(0, 7);
    if (perMaandCount[prefix] !== undefined) { perMaandCount[prefix]++; perMaandUren[prefix] += urenVoorTaak(t); }
  });
  const maxMaandCount = Math.max(...Object.values(perMaandCount), 0.1);
  const maxMaandUren = Math.max(...Object.values(perMaandUren), 0.1);
  const maandHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Per maand — afgerond (laatste 6 maanden)</div>
    <div class="stat-bars">
      <div class="stat-bars-subheader">Aantal taken</div>
      ${maanden.map(m => statBar(formatMaand(m), perMaandCount[m], maxMaandCount, null)).join('')}
      <div class="stat-bars-subheader">Geschatte uren</div>
      ${maanden.map(m => statBar(formatMaand(m), perMaandUren[m], maxMaandUren, null, 'uur')).join('')}
    </div>
  </div>`;

  // --- Openstaande werkdruk per dag (last 60 days) ---
  const last60Days = getLast60Days();
  const wdCount60 = {}, wdUren60 = {};
  last60Days.forEach(d => { wdCount60[d] = 0; wdUren60[d] = 0; });
  taken.filter(t => !t.isStandaard).forEach(t => {
    const aangemaakt = getTaakAanmaakDatum(t);
    last60Days.forEach(d => {
      if (taakOpenOpDag(t, d, aangemaakt)) { wdCount60[d]++; wdUren60[d] += urenVoorTaak(t); }
    });
  });
  const maxWd60Count = Math.max(...Object.values(wdCount60), 0.1);
  const maxWd60Uren = Math.max(...Object.values(wdUren60), 0.1);
  const dagLabel60 = d => {
    const dd = new Date(d + 'T00:00:00');
    return dd.getDate() === 1 ? `${dd.getDate()}/${dd.getMonth()+1}` : String(dd.getDate());
  };
  const wd60Labels = last60Days.map(dagLabel60);
  const werkdruk60HTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Openstaande werkdruk — laatste 60 dagen</div>
    <div class="stat-bars-subheader" style="margin-top:0">Aantal taken</div>
    ${lineChart('wd60-cnt', wd60Labels, last60Days.map(d => wdCount60[d]), '#2563eb', null)}
    <div class="stat-bars-subheader">Geschatte uren</div>
    ${lineChart('wd60-uur', wd60Labels, last60Days.map(d => wdUren60[d]), '#0d9488', 'uur')}
  </div>`;

  // --- Openstaande werkdruk per maand (last 12 months) ---
  const last12Maanden = getLast12Months();
  const wdCount12M = {}, wdUren12M = {};
  last12Maanden.forEach(m => { wdCount12M[m] = 0; wdUren12M[m] = 0; });
  taken.filter(t => !t.isStandaard).forEach(t => {
    const aangemaakt = getTaakAanmaakDatum(t);
    last12Maanden.forEach(m => {
      const refDag = eindeMaand(m);
      if (taakOpenOpDag(t, refDag, aangemaakt)) { wdCount12M[m]++; wdUren12M[m] += urenVoorTaak(t); }
    });
  });
  const maxWd12MCount = Math.max(...Object.values(wdCount12M), 0.1);
  const maxWd12MUren = Math.max(...Object.values(wdUren12M), 0.1);
  const wd12MLabels = last12Maanden.map(formatMaand);
  const werkdruk12MHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Openstaande werkdruk — laatste 12 maanden</div>
    <div class="stat-bars-subheader" style="margin-top:0">Aantal taken</div>
    ${lineChart('wd12m-cnt', wd12MLabels, last12Maanden.map(m => wdCount12M[m]), '#2563eb', null)}
    <div class="stat-bars-subheader">Geschatte uren</div>
    ${lineChart('wd12m-uur', wd12MLabels, last12Maanden.map(m => wdUren12M[m]), '#0d9488', 'uur')}
  </div>`;

  // --- Statistieken onderaan ---
  const gedaanDagen = new Set();
  for (const [dag, planning] of Object.entries(dagPlanning)) {
    if (Object.entries(planning).some(([k, v]) => !k.startsWith('__') && v.gedaan)) gedaanDagen.add(dag);
  }
  const streakDagen = [...gedaanDagen].sort();
  let maxStreak = streakDagen.length > 0 ? 1 : 0, curStreak = maxStreak;
  for (let i = 1; i < streakDagen.length; i++) {
    const prev = new Date(streakDagen[i-1] + 'T00:00:00');
    const cur = new Date(streakDagen[i] + 'T00:00:00');
    const diff = (cur - prev) / 86400000;
    if (diff === 1 || (prev.getDay() === 5 && diff === 3)) { curStreak++; } else { maxStreak = Math.max(maxStreak, curStreak); curStreak = 1; }
  }
  maxStreak = Math.max(maxStreak, curStreak);

  const actieveUren = actief.reduce((s, t) => s + urenVoorTaak(t), 0);
  const weekGem = mondays.length ? Math.round(Object.values(perWeekUren).reduce((s,v)=>s+v,0) / mondays.length * 10) / 10 : 0;
  const hoogPrioActief = actief.filter(t => t.prio <= 3).length;
  const wachtenActief = taken.filter(t => !t.verwijderd && !t.isStandaard && t.wachten).length;
  const besteDag = records.besteDagen?.[0];
  const tweedeBesteDag = records.besteDagen?.[1];
  const besteMaand = records.besteMaanden?.[0];
  const tweedeBesteMaand = records.besteMaanden?.[1];

  let bestPct = 0, bestPctDag = '';
  for (const [dag, planning] of Object.entries(dagPlanning)) {
    const items = Object.entries(planning).filter(([k]) => !k.startsWith('__'));
    if (items.length >= 3) {
      const p = items.filter(([,v]) => v.gedaan).length / items.length * 100;
      if (p > bestPct) { bestPct = p; bestPctDag = dag; }
    }
  }

  const grootteBreakdown = ['K','M','L','XL'].map(g => {
    const n = actief.filter(t => t.grootte === g).length;
    return n > 0 ? `<span class="stat-highlight-grootte">${g}: ${n}</span>` : '';
  }).filter(Boolean).join('');

  const statHTML = `<div class="stats-sectie">
    <div class="stats-sectie-titel">Statistieken</div>
    <div class="stat-highlight-card">
      <div class="stat-highlight-main">
        <div class="stat-highlight-val">${fmtUur(actieveUren)}</div>
        <div class="stat-highlight-label">Actieve werkdruk</div>
        <div class="stat-highlight-sub">${actief.length} actieve taken</div>
      </div>
      ${grootteBreakdown ? `<div class="stat-highlight-breakdown">${grootteBreakdown}</div>` : ''}
    </div>
    <div class="stat-record-2col">
      <div class="stat-record-col">
        <div class="stat-record-col-titel">Beste dag</div>
        <div class="stat-record-card stat-record-card-top">
          <div class="stat-record-val">${besteDag ? besteDag.aantalGedaan + ' taken' : '—'}</div>
          <div class="stat-record-label">#1 dag ooit</div>
          <div class="stat-record-detail">${besteDag ? formatDatum(besteDag.datum) : 'Nog geen data'}</div>
        </div>
        <div class="stat-record-card">
          <div class="stat-record-val">${tweedeBesteDag ? tweedeBesteDag.aantalGedaan + ' taken' : '—'}</div>
          <div class="stat-record-label">#2 dag ooit</div>
          <div class="stat-record-detail">${tweedeBesteDag ? formatDatum(tweedeBesteDag.datum) : ''}</div>
        </div>
      </div>
      <div class="stat-record-col">
        <div class="stat-record-col-titel">Beste maand</div>
        <div class="stat-record-card stat-record-card-top">
          <div class="stat-record-val">${besteMaand ? besteMaand.totaalGedaan + ' taken' : '—'}</div>
          <div class="stat-record-label">#1 maand ooit</div>
          <div class="stat-record-detail">${besteMaand ? formatMaand(besteMaand.maand) + ' · gem ' + besteMaand.gemDagelijks + '/dag' : 'Nog geen data'}</div>
        </div>
        <div class="stat-record-card">
          <div class="stat-record-val">${tweedeBesteMaand ? tweedeBesteMaand.totaalGedaan + ' taken' : '—'}</div>
          <div class="stat-record-label">#2 maand ooit</div>
          <div class="stat-record-detail">${tweedeBesteMaand ? formatMaand(tweedeBesteMaand.maand) + ' · gem ' + tweedeBesteMaand.gemDagelijks + '/dag' : ''}</div>
        </div>
      </div>
    </div>
    <div class="stat-record-grid">
      <div class="stat-record-card"><div class="stat-record-val">${maxStreak + (maxStreak === 1 ? ' dag' : ' dagen')}</div><div class="stat-record-label">Langste streak</div><div class="stat-record-detail">Opeenvolgende werkdagen</div></div>
      <div class="stat-record-card"><div class="stat-record-val">${afgerond.length} taken</div><div class="stat-record-label">Totaal afgerond</div><div class="stat-record-detail">Alle tijden</div></div>
      <div class="stat-record-card"><div class="stat-record-val">${fmtUur(weekGem)}</div><div class="stat-record-label">Gem. uren/week</div><div class="stat-record-detail">Afgerond, laatste 12 weken</div></div>
      <div class="stat-record-card"><div class="stat-record-val">${bestPct ? Math.round(bestPct) + '%' : '—'}</div><div class="stat-record-label">Beste dag %</div><div class="stat-record-detail">${bestPctDag ? formatDatum(bestPctDag) : 'Minimaal 3 taken/dag'}</div></div>
      <div class="stat-record-card"><div class="stat-record-val">${hoogPrioActief} actief</div><div class="stat-record-label">Hoge prio (P1-3)</div><div class="stat-record-detail">Dringendste taken</div></div>
      <div class="stat-record-card"><div class="stat-record-val">${wachtenActief} taken</div><div class="stat-record-label">Op wachten</div><div class="stat-record-detail">Geblokkeerd / wachtend</div></div>
    </div>
  </div>`;

  container.innerHTML = overzichtHTML + themaHTML + kwadrantHTML + prioHTML + weekdagHTML + weekHTML + maandHTML + werkdruk60HTML + werkdruk12MHTML + statHTML;
}

// ===== URL PARAMETERS =====
function verwerkUrlParameters() {
  const params = new URLSearchParams(window.location.search);
  const omschrijving = params.get('taak');
  if (!omschrijving) return;

  const taak = {
    id: genId(),
    omschrijving: omschrijving.trim(),
    thema: params.get('thema') || 'Overig',
    type: params.get('type') || 'zakelijk',
    periode: params.get('periode') || 'B',
    grootte: params.get('grootte') || 'M',
    prio: parseInt(params.get('prio')) || 5,
    tijdstip: params.get('tijdstip') || null,
    notities: params.get('notities') || '',
    altijdBewaren: false,
    wachten: false,
    afgerond: false,
    afgerondDatum: null,
    aangemaakt: new Date().toISOString()
  };

  taken.push(taak);

  if (params.get('dag') === 'vandaag') {
    if (!dagPlanning[vandaagStr()]) dagPlanning[vandaagStr()] = {};
    dagPlanning[vandaagStr()][taak.id] = { gedaan: false, overgenomen: false };
  }

  slaData();
  window.history.replaceState({}, '', window.location.pathname);
  console.log('[URL] taak toegevoegd:', taak.omschrijving);
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
  renderStatistieken();
}

// ===== NAVIGATIE =====
function wisselTab(naam) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === naam));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + naam));
  if (naam === 'dag') renderDag();
  if (naam === 'master') renderMaster();
  if (naam === 'matrix') renderMatrix();
  if (naam === 'archief') renderArchief();
  if (naam === 'stats') renderStatistieken();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  laadData();
  await laadVanServer();
  carryForward();
  verwerkUrlParameters();
  renderAlles();
  console.log('[INIT] na server-load: taken:', taken.length, '| dagPlanning datums:', Object.keys(dagPlanning).length);

  // Info popup: sluiten bij klik buiten popup
  document.addEventListener('click', () => {
    document.querySelectorAll('.info-popup').forEach(p => p.classList.add('hidden'));
  });

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

  // Verplaats-naar-datum modal
  document.getElementById('verplaats-modal-opslaan').addEventListener('click', slaVerplaatsOp);
  document.getElementById('verplaats-modal-sluiten').addEventListener('click', sluitVerplaatsModal);
  document.getElementById('verplaats-modal-annuleren').addEventListener('click', sluitVerplaatsModal);
  document.getElementById('verplaats-modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) sluitVerplaatsModal();
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
  document.getElementById('standaarden-toevoegen-inline').addEventListener('click', voegStandaardenToeAanDag);
  document.getElementById('nieuw-standaard-btn').addEventListener('click', voegNieuweStandaardToe);
  document.getElementById('nieuw-standaard-naam').addEventListener('keydown', e => {
    if (e.key === 'Enter') voegNieuweStandaardToe();
  });

  // Master nieuw
  document.getElementById('nieuwe-taak-btn').addEventListener('click', openNieuweTaakModal);
  document.getElementById('standaarden-master-btn').addEventListener('click', openStandaardenModal);
  document.getElementById('export-btn').addEventListener('click', exporteerData);
  document.getElementById('import-btn').addEventListener('click', importeerData);
  document.getElementById('import-file-input').addEventListener('change', function() {
    verwerkImportBestand(this.files[0]);
  });

  // Master filters — wis kwadrantfilter bij elke handmatige filterwijziging
  ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio','filter-status'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { masterKwadrantFilter = null; renderMaster(); });
  });
  document.getElementById('master-sortering').addEventListener('change', () => { masterKwadrantFilter = null; renderMaster(); });
  document.getElementById('filter-reset').addEventListener('click', () => {
    masterKwadrantFilter = null;
    ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('filter-status').value = 'actief_wachten';
    document.getElementById('master-sortering').value = 'thema';
    renderMaster();
  });

  // Modal opslaan ook via knop bovenin
  document.getElementById('modal-opslaan-top').addEventListener('click', slaModalOp);

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
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target !== e.currentTarget) return;
    if (bewerkTaakId && bewerkSnapshot && getModalSnapshot() !== bewerkSnapshot) {
      const omschrijving = document.getElementById('taak-omschrijving').value.trim();
      if (omschrijving) { slaModalOp(); return; }
    }
    sluitModal();
  });

  // Enter in modal
  document.getElementById('taak-omschrijving').addEventListener('keydown', e => { if (e.key === 'Enter') slaModalOp(); });

  // Snel toevoegen modal
  document.getElementById('snel-modal-opslaan').addEventListener('click', () => slaSnelModalOp(false));
  document.getElementById('snel-modal-nogeen').addEventListener('click', () => slaSnelModalOp(true));
  document.getElementById('snel-modal-sluiten').addEventListener('click', sluitSnelModal);
  document.getElementById('snel-modal-annuleren').addEventListener('click', sluitSnelModal);
  document.getElementById('snel-modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) sluitSnelModal(); });
  document.getElementById('snel-onderwerp').addEventListener('keydown', e => { if (e.key === 'Enter') slaSnelModalOp(false); });

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
