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

function vandaagStr() {
  return new Date().toISOString().slice(0,10);
}

function laadData() {
  taken = Storage.get('taken', []);
  dagPlanning = Storage.get('dagPlanning', {});
}

function slaData() {
  Storage.set('taken', taken);
  Storage.set('dagPlanning', dagPlanning);
  syncFirebase();
}

// ===== FIREBASE SYNC =====
let db = null;
let syncTimeout = null;

function initFirebase() {
  try {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
      db = firebase.firestore();
      laadVanFirebase();
    }
  } catch(e) { console.log('Firebase niet geconfigureerd, lokale opslag gebruikt'); }
}

function syncFirebase() {
  if (!db) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      const syncBtn = document.getElementById('sync-btn');
      syncBtn.textContent = '⟳';
      syncBtn.className = 'icon-btn';
      await db.collection('data').doc('taken').set({ taken });
      await db.collection('data').doc('dagPlanning').set({ dagPlanning });
      syncBtn.textContent = '✓';
      syncBtn.className = 'icon-btn synced';
    } catch(e) {
      const syncBtn = document.getElementById('sync-btn');
      syncBtn.textContent = '!';
      syncBtn.className = 'icon-btn error';
    }
  }, 1000);
}

async function laadVanFirebase() {
  if (!db) return;
  try {
    const [takenDoc, dagDoc] = await Promise.all([
      db.collection('data').doc('taken').get(),
      db.collection('data').doc('dagPlanning').get()
    ]);
    if (takenDoc.exists && takenDoc.data().taken) {
      taken = takenDoc.data().taken;
      Storage.set('taken', taken);
    }
    if (dagDoc.exists && dagDoc.data().dagPlanning) {
      dagPlanning = dagDoc.data().dagPlanning;
      Storage.set('dagPlanning', dagPlanning);
    }
    renderAlles();
  } catch(e) { console.error('Firebase laden mislukt', e); }
}

// ===== DATUM HELPERS =====
function datumOffset(dagen, vanafStr) {
  // Gewone kalender offset (geen weekend-skip), gebruikt voor archief/vergelijken
  const d = new Date(vanafStr + 'T00:00:00');
  d.setDate(d.getDate() + dagen);
  return d.toISOString().slice(0,10);
}

function isWeekend(str) {
  const dag = new Date(str + 'T00:00:00').getDay(); // 0=zon, 6=zat
  return dag === 0 || dag === 6;
}

function werkdagStap(stap, vanafStr) {
  // Navigeer één werkdag voor- of achteruit, skip zaterdag/zondag
  let d = new Date(vanafStr + 'T00:00:00');
  do {
    d.setDate(d.getDate() + stap);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().slice(0,10);
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
    if (!info.gedaan && !dagPlanning[vandaag][taakId]) {
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
  document.getElementById('dag-datum').textContent = formatDatum(huidigeDag);
  document.getElementById('dag-label').textContent = huidigeDag === vandaag ? 'Vandaag' :
    huidigeDag > vandaag ? 'Toekomst' : 'Verleden';

  document.getElementById('naar-vandaag').style.display = huidigeDag === vandaag ? 'none' : 'inline-block';

  const planning = dagPlanning[huidigeDag] || {};
  const dagTaken = Object.keys(planning).map(id => {
    const taak = taken.find(t => t.id === id);
    if (!taak || taak.verwijderd) return null; // verwijderde taken niet tonen in dag
    return { ...taak, dagInfo: planning[id] };
  }).filter(Boolean);

  // Sorteren: tijd eerst, dan prio
  const metTijd = dagTaken.filter(t => t.dagInfo.tijdstip).sort((a,b) => a.dagInfo.tijdstip.localeCompare(b.dagInfo.tijdstip));
  const zakelijk = dagTaken.filter(t => !t.dagInfo.tijdstip && t.type === 'zakelijk').sort((a,b) => a.prio - b.prio);
  const prive = dagTaken.filter(t => !t.dagInfo.tijdstip && t.type === 'prive').sort((a,b) => a.prio - b.prio);

  renderDagLijst('lijst-tijd', metTijd, true);
  renderDagLijst('lijst-zakelijk', zakelijk, false);
  renderDagLijst('lijst-prive', prive, false);

  document.getElementById('sectie-tijd').style.display = metTijd.length ? 'block' : 'none';

  // Stats
  const gedaan = dagTaken.filter(t => t.dagInfo.gedaan).length;
  const overgenomen = dagTaken.filter(t => t.dagInfo.overgenomen).length;
  document.getElementById('stat-gedaan').textContent = `${gedaan} gedaan`;
  document.getElementById('stat-open').textContent = `${dagTaken.length - gedaan} open`;
  document.getElementById('stat-tijd').textContent = `${overgenomen} overgenomen`;

  // Counts
  document.querySelector('#sectie-tijd .count').textContent = metTijd.length ? `(${metTijd.length})` : '';
  document.querySelector('#sectie-zakelijk .count').textContent = zakelijk.length ? `(${zakelijk.length})` : '';
  document.querySelector('#sectie-prive .count').textContent = prive.length ? `(${prive.length})` : '';
  renderClaudeSuggesties();
}

function renderDagLijst(containerId, taken, toonTijd) {
  const el = document.getElementById(containerId);
  if (!taken.length) { el.innerHTML = '<div class="empty-state" style="padding:10px;font-size:12px">Geen taken</div>'; return; }

  el.innerHTML = taken.map(t => {
    const gedaan = t.dagInfo.gedaan;
    const overgenomen = t.dagInfo.overgenomen;
    const tijdstip = t.dagInfo.tijdstip || t.tijdstip;

    return `<div class="task-card ${gedaan ? 'gedaan' : ''} ${overgenomen ? 'overgenomen' : ''}" data-id="${t.id}">
      <div class="task-check" onclick="toggleGedaan('${t.id}', event)">${gedaan ? '✓' : ''}</div>
      ${tijdstip ? `<div class="task-tijdstip">${tijdstip}</div>` : ''}
      <div class="task-body">
        <div class="task-omschrijving">${escHtml(t.omschrijving)}</div>
        <div class="task-meta">
          <span class="badge badge-thema">${t.thema}</span>
          <span class="badge badge-${t.type}">${t.type === 'zakelijk' ? 'Zakelijk' : 'Privé'}</span>
          <span class="badge badge-${t.periode}">${t.periode}</span>
          <span class="badge badge-grootte">${t.grootte}</span>
          <span class="badge badge-prio">P${t.prio}</span>
          ${isUrgent(t) ? '<span class="badge badge-urgent">Urgent</span>' : ''}
          ${overgenomen ? '<span class="badge" style="background:#fef3c7;color:#92400e">Overgenomen</span>' : ''}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" onclick="openTijdstipModal('${t.id}', event)" title="Tijdstip">⏰</button>
        <button class="task-action-btn" onclick="verwijderUitDag('${t.id}', event)" title="Verwijder uit dag">✕</button>
      </div>
    </div>`;
  }).join('');
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

function openTijdstipModal(taakId, event) {
  event.stopPropagation();
  const huidigTijdstip = dagPlanning[huidigeDag]?.[taakId]?.tijdstip || '';
  const nieuw = prompt('Tijdstip (bijv. 10:30), leeg om te verwijderen:', huidigTijdstip);
  if (nieuw === null) return;
  if (!dagPlanning[huidigeDag]) dagPlanning[huidigeDag] = {};
  dagPlanning[huidigeDag][taakId] = { ...dagPlanning[huidigeDag][taakId], tijdstip: nieuw.trim() || null };
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
    if (t.verwijderd) return false; // verwijderde taken nooit in master
    if (thema && t.thema !== thema) return false;
    if (periode && t.periode !== periode) return false;
    if (grootte && t.grootte !== grootte) return false;
    if (type && t.type !== type) return false;
    if (prio && String(t.prio) !== prio) return false;
    if (status === 'actief' && t.afgerond) return false;
    if (status === 'afgerond' && !t.afgerond) return false;
    return true;
  });

  // Groepeer per thema
  const themas = ['IURC', 'AI', 'Innovatie', 'DHM', 'TD', 'EU', 'Presentatie', 'Overig'];
  const container = document.getElementById('master-lijst');

  if (!gefilterd.length) {
    container.innerHTML = '<div class="empty-state">Geen taken gevonden. Maak een nieuwe taak aan.</div>';
    return;
  }

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
      <div class="thema-header">${t} <span class="thema-count">${lijst.length} taken</span></div>
      ${gesorteerd.map(taak => renderMasterKaart(taak)).join('')}
    </div>`;
  }).join('');
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
        <span class="badge badge-${t.periode}">${t.periode}</span>
        <span class="badge badge-grootte">${t.grootte}</span>
        <span class="badge badge-prio">P${t.prio}</span>
        ${urgent ? '<span class="badge badge-urgent">Urgent</span>' : ''}
        ${!belangrijk ? '<span class="badge badge-grootte">Niet belangrijk</span>' : ''}
        ${afgerond ? `<span class="badge badge-afgerond">Afgerond${t.afgerondDatum ? ' ' + t.afgerondDatum.slice(5,10).replace('-','/') : ''}</span>` : ''}
        ${t.notities ? `<span class="badge badge-grootte" title="${escHtml(t.notities)}">📝</span>` : ''}
      </div>
    </div>
    <div class="task-actions">
      ${!afgerond ? `<button class="task-action-btn btn-dag" onclick="voegToeAanVandaag('${t.id}', event)" title="Aan vandaag toevoegen">+</button>` : ''}
      <button class="task-action-btn btn-gedaan" onclick="toggleMasterAfgerond('${t.id}', event)" title="${afgerond ? 'Heropen' : 'Markeer als gedaan'}">
        ${afgerond ? '↩' : '✓'}
      </button>
      <button class="task-action-btn btn-delete" onclick="verwijderTaak('${t.id}', event)" title="Verwijderen">🗑</button>
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
    const bijhorend = taken.filter(t => !t.afgerond && !t.verwijderd && isUrgent(t) === urgent && isBelangrijk(t) === belangrijk);
    cell.innerHTML = bijhorend.length
      ? bijhorend.sort((a,b) => a.prio - b.prio).map(t =>
          `<div class="task-card" onclick="bewerkTaak('${t.id}')">
            <div class="task-body">
              <div class="task-omschrijving" style="font-size:12px">${escHtml(t.omschrijving)}</div>
              <div class="task-meta">
                <span class="badge badge-thema" style="font-size:10px">${t.thema}</span>
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
              <span class="badge badge-thema">${t.thema}</span>
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

function openNieuweTaakModal() {
  bewerkTaakId = null;
  document.getElementById('modal-titel').textContent = 'Nieuwe taak';
  document.getElementById('taak-omschrijving').value = '';
  document.getElementById('taak-thema').value = 'IURC';
  document.getElementById('taak-type').value = 'zakelijk';
  document.getElementById('taak-periode').value = 'B';
  document.getElementById('taak-grootte').value = 'M';
  document.getElementById('taak-prio').value = 5;
  document.getElementById('taak-tijd').value = '';
  document.getElementById('taak-notities').value = '';
  updateAutoIndicatie();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('taak-omschrijving').focus();
}

function bewerkTaak(taakId) {
  const t = taken.find(t => t.id === taakId);
  if (!t) return;
  bewerkTaakId = taakId;
  document.getElementById('modal-titel').textContent = 'Taak bewerken';
  document.getElementById('taak-omschrijving').value = t.omschrijving;
  document.getElementById('taak-thema').value = t.thema;
  document.getElementById('taak-type').value = t.type;
  document.getElementById('taak-periode').value = t.periode;
  document.getElementById('taak-grootte').value = t.grootte;
  document.getElementById('taak-prio').value = t.prio;
  document.getElementById('taak-tijd').value = t.tijdstip || '';
  document.getElementById('taak-notities').value = t.notities || '';
  updateAutoIndicatie();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('taak-omschrijving').focus();
}

function slaModalOp() {
  const omschrijving = document.getElementById('taak-omschrijving').value.trim();
  if (!omschrijving) { document.getElementById('taak-omschrijving').focus(); return; }

  const oud = bewerkTaakId ? taken.find(t => t.id === bewerkTaakId) : null;
  const periode = document.getElementById('taak-periode').value;
  const prio = parseInt(document.getElementById('taak-prio').value) || 5;

  const taak = {
    id: bewerkTaakId || genId(),
    omschrijving,
    thema: document.getElementById('taak-thema').value,
    type: document.getElementById('taak-type').value,
    periode,
    grootte: document.getElementById('taak-grootte').value,
    prio,
    tijdstip: document.getElementById('taak-tijd').value || null,
    notities: document.getElementById('taak-notities').value.trim(),
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
    if (t.verwijderd || t.afgerond) return false; // niet tonen
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
          <span class="badge badge-thema">${t.thema}</span>
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

// ===== TAAK TOEVOEGEN AAN DAG (via volledig modal) =====
let voegToeAanDagNaSave = false;

function snelTaakToevoegen() {
  voegToeAanDagNaSave = true;
  // Stel defaults in die handig zijn voor een dag-taak
  bewerkTaakId = null;
  document.getElementById('modal-titel').textContent = 'Nieuwe taak voor vandaag';
  document.getElementById('taak-omschrijving').value = '';
  document.getElementById('taak-thema').value = 'Overig';
  document.getElementById('taak-type').value = 'zakelijk';
  document.getElementById('taak-periode').value = 'A';
  document.getElementById('taak-grootte').value = 'K';
  document.getElementById('taak-prio').value = 5;
  document.getElementById('taak-tijd').value = '';
  document.getElementById('taak-notities').value = '';
  updateAutoIndicatie();
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('taak-omschrijving').focus();
}

// ===== URGENT / BELANGRIJK (automatisch) =====
// Urgent  = periode A (nu moet het)
// Belangrijk = prioriteit 1 t/m 5
function isUrgent(t)     { return t.periode === 'A'; }
function isBelangrijk(t) { return t.prio <= 5; }

// ===== CLAUDE SUGGESTIES =====
let claudeBoxOpen = true;

function toggleClaudeBox() {
  claudeBoxOpen = !claudeBoxOpen;
  document.getElementById('claude-box-body').style.display = claudeBoxOpen ? 'block' : 'none';
  document.getElementById('claude-box-toggle').textContent = claudeBoxOpen ? '▾' : '▸';
}

function renderClaudeSuggesties() {
  const body = document.getElementById('claude-box-body');
  if (!body) return;

  const planning = dagPlanning[huidigeDag] || {};
  const dagTaken = Object.keys(planning).map(id => {
    const t = taken.find(t => t.id === id);
    if (!t || t.verwijderd) return null;
    return { ...t, dagInfo: planning[id] };
  }).filter(Boolean).filter(t => !t.dagInfo.gedaan); // alleen open taken

  if (!dagTaken.length) {
    body.innerHTML = '<p class="claude-leeg">Geen open taken vandaag — niets te suggereren.</p>';
    return;
  }

  // Tel hoe vaak een taak al overgenomen is (kijk in dagPlanning history)
  function aantalDagenOvergenomen(taakId) {
    return Object.values(dagPlanning).filter(p => p[taakId]?.overgenomen).length;
  }

  // Categoriseer
  const chatTaken    = dagTaken.filter(t => t.grootte === 'K' || t.grootte === 'M');
  const projectTaken = dagTaken.filter(t => t.grootte === 'L' || t.grootte === 'XL');
  const skillTaken   = dagTaken.filter(t => aantalDagenOvergenomen(t.id) >= 2);

  function taakRegel(t, prompt) {
    return `<div class="claude-taak">
      <div class="claude-taak-naam">${escHtml(t.omschrijving)}</div>
      <button class="claude-copy-btn" onclick="kopieerPrompt(event, \`${prompt.replace(/`/g,"'")}\`)" title="Prompt kopiëren">Kopieer prompt</button>
    </div>`;
  }

  function sectie(icon, label, kleur, beschrijving, lijst, promptFn) {
    if (!lijst.length) return '';
    return `<div class="claude-sectie">
      <div class="claude-sectie-header" style="color:${kleur}">
        <span class="claude-sectie-icon">${icon}</span>
        <span><strong>${label}</strong> — ${beschrijving}</span>
      </div>
      ${lijst.map(t => taakRegel(t, promptFn(t))).join('')}
    </div>`;
  }

  body.innerHTML = [
    sectie('💬', 'Chat',
      '#2563eb',
      'Snel afronden via een gesprek',
      chatTaken,
      t => `Ik wil je helpen met de volgende actie: "${t.omschrijving}" (thema: ${t.thema}, verwachte tijd: ${t.grootte}). Kun je me helpen dit concreet aan te pakken?`
    ),
    sectie('📁', 'Project',
      '#9333ea',
      'Zet op als Claude Project voor een langere aanpak',
      projectTaken,
      t => `Ik wil een Claude Project aanmaken voor: "${t.omschrijving}" (thema: ${t.thema}). Help me dit op te zetten met een aanpak, deelstappen en relevante context.`
    ),
    sectie('⚡', 'Skill',
      '#d97706',
      'Staat al meerdere dagen open — overweeg een herbruikbare aanpak',
      skillTaken,
      t => `De actie "${t.omschrijving}" komt al meerdere keren terug op mijn lijst. Kun je me helpen hier een skill, template of aanpak voor te maken zodat ik het sneller kan afhandelen?`
    )
  ].join('') || '<p class="claude-leeg">Geen specifieke suggesties op basis van de huidige taken.</p>';
}

function kopieerPrompt(event, tekst) {
  event.stopPropagation();
  navigator.clipboard.writeText(tekst).then(() => {
    const btn = event.target;
    btn.textContent = 'Gekopieerd!';
    btn.classList.add('gekopieerd');
    setTimeout(() => { btn.textContent = 'Kopieer prompt'; btn.classList.remove('gekopieerd'); }, 2000);
  }).catch(() => {
    // Fallback voor omgevingen zonder clipboard API
    const ta = document.createElement('textarea');
    ta.value = tekst;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const btn = event.target;
    btn.textContent = 'Gekopieerd!';
    setTimeout(() => btn.textContent = 'Kopieer prompt', 2000);
  });
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
  // Herrender relevante tab zodat data altijd actueel is
  if (naam === 'dag') renderDag();
  if (naam === 'master') renderMaster();
  if (naam === 'matrix') renderMatrix();
  if (naam === 'archief') renderArchief();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  laadData();
  carryForward();
  initFirebase();
  renderAlles();

  // Tab navigatie
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => wisselTab(btn.dataset.tab));
  });

  // Dag navigatie (skip weekends)
  document.getElementById('prev-dag').addEventListener('click', () => {
    huidigeDag = werkdagStap(-1, huidigeDag);
    renderDag();
  });
  document.getElementById('next-dag').addEventListener('click', () => {
    huidigeDag = werkdagStap(1, huidigeDag);
    renderDag();
  });
  document.getElementById('naar-vandaag').addEventListener('click', () => {
    huidigeDag = vandaagStr();
    renderDag();
  });

  // Dag acties
  document.getElementById('taak-toevoegen-dag').addEventListener('click', snelTaakToevoegen);
  document.getElementById('taken-selecteren').addEventListener('click', openSelecteerModal);

  // Master nieuw
  document.getElementById('nieuwe-taak-btn').addEventListener('click', openNieuweTaakModal);

  // Master filters
  ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio','filter-status'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderMaster);
  });
  document.getElementById('filter-reset').addEventListener('click', () => {
    ['filter-thema','filter-periode','filter-grootte','filter-type','filter-prio'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('filter-status').value = 'actief';
    renderMaster();
  });

  // Auto-indicatie in modal bijwerken bij wijzigen periode/prio
  document.getElementById('taak-periode').addEventListener('change', updateAutoIndicatie);
  document.getElementById('taak-prio').addEventListener('input', updateAutoIndicatie);

  // Modal opslaan/sluiten
  document.getElementById('modal-opslaan').addEventListener('click', slaModalOp);
  document.getElementById('modal-sluiten').addEventListener('click', sluitModal);
  document.getElementById('modal-annuleren').addEventListener('click', sluitModal);
  document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) sluitModal(); });

  // Enter in modal
  document.getElementById('taak-omschrijving').addEventListener('keydown', e => { if (e.key === 'Enter') slaModalOp(); });

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
  document.getElementById('sync-btn').addEventListener('click', () => laadVanFirebase().then(renderAlles));
});
