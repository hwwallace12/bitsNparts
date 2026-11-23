import { api } from './api.js';
import { createCaliperController } from './caliper.js';
import { createCameraController, fileToResizedDataUrl, isLiveCameraSupported } from './camera.js';
import { CATEGORIES, CATEGORY_META, CONDITION_META } from './catalog-client.js';
import { createConfirmController, installClosedByFallback, wireDialogReset } from './dialogs.js';
import { clearAndAppend, el, svgEl } from './dom.js';

const state = {
  activeTab: 'scan',
  currentPhotoDataUrl: null,
  currentScan: null,
  scanBits: [],
  highlightedIndex: null,
  measuredMm: null,
  measuredSnap: null,
  inventoryBits: [],
  sets: [],
  selectedSetId: 'fractional-29',
  scansHistory: [],
  config: null,
};

// Elements
const toastRegion = document.getElementById('toast-region');
const geminiStatusBadge = document.getElementById('gemini-status-badge');

const tabButtons = [...document.querySelectorAll('.tab-btn')];
const panels = {
  scan: document.getElementById('panel-scan'),
  toolbox: document.getElementById('panel-toolbox'),
  sets: document.getElementById('panel-sets'),
  tools: document.getElementById('panel-tools'),
};

// Camera & scan elements
const cameraStage = document.getElementById('camera-stage');
const cameraVideo = document.getElementById('camera-video');
const btnStartCamera = document.getElementById('btn-start-camera');
const btnCaptureFrame = document.getElementById('btn-capture-frame');
const btnStopCamera = document.getElementById('btn-stop-camera');
const btnTorch = document.getElementById('btn-torch');
const emptyCaptureBox = document.getElementById('empty-capture-box');
const cameraEnvNote = document.getElementById('camera-env-note');
const inputCameraPhoto = document.getElementById('input-camera-photo');
const inputGalleryPhoto = document.getElementById('input-gallery-photo');

const previewStage = document.getElementById('preview-stage');
const scanPreviewImg = document.getElementById('scan-preview-img');
const scanBoxesSvg = document.getElementById('scan-boxes-svg');
const btnOpenCaliper = document.getElementById('btn-open-caliper');
const btnClearPhoto = document.getElementById('btn-clear-photo');
const caliperReadout = document.getElementById('caliper-readout');

const scanForm = document.getElementById('scan-form');
const scanNotesInput = document.getElementById('scan-notes');
const btnAnalyze = document.getElementById('btn-analyze');
const scanResultsSection = document.getElementById('scan-results-section');
const scanResultCount = document.getElementById('scan-result-count');
const scanSceneSummary = document.getElementById('scan-scene-summary');
const scanResultsGrid = document.getElementById('scan-results-grid');
const batchLocationInput = document.getElementById('batch-location');
const btnSaveAll = document.getElementById('btn-save-all');

// Toolbox elements
const toolboxStatsLine = document.getElementById('toolbox-stats-line');
const toolboxFilterForm = document.getElementById('toolbox-filter-form');
const toolboxSearch = document.getElementById('toolbox-search');
const filterCategory = document.getElementById('filter-category');
const filterLocation = document.getElementById('filter-location');
const filterCondition = document.getElementById('filter-condition');
const filterSort = document.getElementById('filter-sort');
const toolboxGrid = document.getElementById('toolbox-grid');
const toolboxEmpty = document.getElementById('toolbox-empty');
const btnAddManual = document.getElementById('btn-add-manual');

// Sets elements
const setSelector = document.getElementById('set-selector');
const setSummaryBar = document.getElementById('set-summary-bar');
const setSlotsGrid = document.getElementById('set-slots-grid');
const btnCopyMissing = document.getElementById('btn-copy-missing');

// Tools & history elements
const btnRefreshHealth = document.getElementById('btn-refresh-health');
const serverStatusDl = document.getElementById('server-status-dl');
const scansHistoryList = document.getElementById('scans-history-list');

// Dialogs
const editDialog = document.getElementById('edit-bit-dialog');
const editDialogTitle = document.getElementById('edit-bit-title');
const editForm = document.getElementById('edit-bit-form');
const btnCloseEdit = document.getElementById('btn-close-edit');
const btnCancelEdit = document.getElementById('btn-cancel-edit');
const editCategorySelect = document.getElementById('bit-category');

const detailDialog = document.getElementById('bit-detail-dialog');
const detailTitle = document.getElementById('bit-detail-title');
const detailBody = document.getElementById('bit-detail-body');

const askConfirm = createConfirmController(document.getElementById('delete-confirm-dialog'), {
  titleEl: document.getElementById('delete-confirm-title'),
  messageEl: document.getElementById('delete-confirm-message'),
  confirmBtn: document.getElementById('delete-confirm-btn'),
});

const openCaliper = createCaliperController({
  dialog: document.getElementById('caliper-dialog'),
  canvas: document.getElementById('caliper-canvas'),
  refSelect: document.getElementById('caliper-ref-select'),
  stepTextEl: document.getElementById('caliper-step-text'),
  resultTextEl: document.getElementById('caliper-result-text'),
  resetRefBtn: document.getElementById('btn-caliper-reset-ref'),
  resetBitBtn: document.getElementById('btn-caliper-reset-bit'),
  applyBtn: document.getElementById('btn-caliper-apply'),
});

const camera = createCameraController(cameraVideo);

function showToast(message, type = 'info') {
  if (!message) {
    clearAndAppend(toastRegion);
    return;
  }
  const cls = type === 'error' ? 'toast is-error' : type === 'ok' ? 'toast is-ok' : 'toast';
  clearAndAppend(toastRegion, el('div', { className: cls }, message));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let swUrl = '/sw.js';
  if (window.trustedTypes?.createPolicy) {
    const policy = window.trustedTypes.createPolicy('bitsnparts-sw', {
      createScriptURL(input) {
        if (input !== '/sw.js') {
          throw new TypeError(`Blocked untrusted Service Worker URL: ${input}`);
        }
        return input;
      },
    });
    swUrl = policy.createScriptURL('/sw.js');
  }
  navigator.serviceWorker.register(swUrl).catch((err) => {
    console.warn('Service worker registration skipped:', err);
  });
}

function populateSelectOptions() {
  for (const cat of CATEGORIES) {
    filterCategory.appendChild(el('option', { value: cat }, cat));
    editCategorySelect.appendChild(el('option', { value: cat }, cat));
  }
  for (const cond of Object.keys(CONDITION_META)) {
    filterCondition.appendChild(el('option', { value: cond }, cond));
  }
}

function getCheckedRadioValue(form, name, fallback) {
  const checked = form.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : fallback;
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  if (tabName !== 'scan' && camera.isActive()) {
    camera.stop();
    cameraStage.hidden = true;
    emptyCaptureBox.hidden = Boolean(state.currentPhotoDataUrl);
  }

  for (const btn of tabButtons) {
    const active = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  for (const [name, panel] of Object.entries(panels)) {
    panel.hidden = name !== tabName;
  }

  if (tabName === 'toolbox') loadToolbox();
  if (tabName === 'sets') loadSets();
  if (tabName === 'tools') {
    loadHealth();
    loadScanHistory();
  }
}

function updateCaptureUI() {
  const hasPhoto = Boolean(state.currentPhotoDataUrl);
  previewStage.hidden = !hasPhoto;
  emptyCaptureBox.hidden = hasPhoto || camera.isActive();
  btnAnalyze.disabled = !hasPhoto;
  btnOpenCaliper.hidden = !hasPhoto;

  if (hasPhoto) {
    scanPreviewImg.src = state.currentPhotoDataUrl;
  } else {
    scanPreviewImg.removeAttribute('src');
    clearAndAppend(scanBoxesSvg);
  }

  if (state.measuredMm && state.measuredSnap) {
    caliperReadout.hidden = false;
    caliperReadout.textContent = `Caliper calibrated: ${state.measuredMm.toFixed(2)} mm (Nearest Imperial: ${state.measuredSnap.imperial.label}, Metric: ${state.measuredSnap.metric.label})`;
  } else {
    caliperReadout.hidden = true;
    caliperReadout.textContent = '';
  }
}

function setCapturedPhoto(dataUrl, { keepResults = false } = {}) {
  state.currentPhotoDataUrl = dataUrl;
  state.measuredMm = null;
  state.measuredSnap = null;
  state.highlightedIndex = null;
  if (!keepResults) {
    state.currentScan = null;
    state.scanBits = [];
    scanResultsSection.hidden = true;
    clearAndAppend(scanResultsGrid);
  }
  updateCaptureUI();
}

function renderBoundingBoxes() {
  clearAndAppend(scanBoxesSvg);
  if (!state.scanBits.length) return;

  for (const bit of state.scanBits) {
    if (!Array.isArray(bit.box_2d) || bit.box_2d.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = bit.box_2d;
    const width = Math.max(8, xmax - xmin);
    const height = Math.max(8, ymax - ymin);
    const highlighted = state.highlightedIndex === bit.index;

    const rect = svgEl('rect', {
      x: xmin,
      y: ymin,
      width,
      height,
      rx: 8,
      class: highlighted ? 'box-rect is-highlighted' : 'box-rect',
      onClick: () => highlightScannedBit(bit.index, true),
    });

    const labelText = `#${bit.index + 1} ${bit.size_normalized || bit.size_primary}`;
    const labelW = Math.min(340, Math.max(120, labelText.length * 18 + 20));
    const labelY = Math.max(0, ymin - 36);

    const bg = svgEl('rect', {
      x: xmin,
      y: labelY,
      width: labelW,
      height: 34,
      rx: 6,
      class: 'box-label-bg',
    });

    const txt = svgEl(
      'text',
      {
        x: xmin + 10,
        y: labelY + 25,
        class: 'box-label-text',
      },
      labelText,
    );

    scanBoxesSvg.appendChild(rect);
    scanBoxesSvg.appendChild(bg);
    scanBoxesSvg.appendChild(txt);
  }
}

function highlightScannedBit(index, scrollIntoView = false) {
  state.highlightedIndex = index;
  renderBoundingBoxes();
  for (const card of scanResultsGrid.querySelectorAll('.bit-card')) {
    const isMatch = Number(card.dataset.bitIndex) === index;
    card.classList.toggle('is-highlighted', isMatch);
    if (isMatch && scrollIntoView) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function createBadgeRow(bit) {
  const catMeta = CATEGORY_META[bit.category] || CATEGORY_META['Specialty / Other'];
  const condMeta = CONDITION_META[bit.condition] || CONDITION_META.Good;
  return el(
    'div',
    { className: 'badge-row' },
    el('span', { className: `badge ${catMeta.cls}` }, `${catMeta.icon} ${bit.category}`),
    bit.subtype ? el('span', { className: 'badge' }, bit.subtype) : null,
    el('span', { className: `badge ${condMeta.cls}` }, `${condMeta.icon} ${bit.condition}`),
    bit.confidence ? el('span', { className: 'badge' }, `AI: ${bit.confidence}`) : null,
  );
}

function renderSpecList(bit) {
  const entries = [
    ['Brand', bit.manufacturer && bit.manufacturer !== 'Unknown' ? `${bit.manufacturer}${bit.model_line ? ` (${bit.model_line})` : ''}` : 'Unknown'],
    ['Size (mm)', bit.size_metric_mm > 0 ? `${bit.size_metric_mm} mm${bit.size_imperial ? ` / ${bit.size_imperial}` : ''}` : bit.size_imperial || '—'],
    ['Shank', bit.shank_type || '—'],
    ['Material', bit.material_coating || '—'],
    ['Markings', bit.markings_read || 'None read'],
  ];
  const dl = el('dl', { className: 'spec-dl' });
  for (const [k, v] of entries) {
    dl.appendChild(el('dt', null, k));
    dl.appendChild(el('dd', null, v));
  }
  return dl;
}

function buildBitPayloadFromScan(bit, locationOverride, quantityOverride) {
  return {
    scan_id: state.currentScan?.id || null,
    image_filename: state.currentScan?.image_filename || null,
    name: bit.name,
    category: bit.category,
    subtype: bit.subtype,
    size_primary: bit.size_primary,
    size_imperial: bit.size_imperial,
    size_metric_mm: bit.size_metric_mm,
    length_class: bit.length_class,
    shank_type: bit.shank_type,
    material_coating: bit.material_coating,
    manufacturer: bit.manufacturer,
    model_line: bit.model_line,
    markings_read: bit.markings_read,
    condition: bit.condition,
    condition_notes: bit.condition_notes,
    recommended_materials: bit.recommended_materials,
    pilot_or_fastener: bit.pilot_or_fastener,
    speed_rpm_tip: bit.speed_rpm_tip,
    usage_notes: bit.usage_notes,
    quantity: quantityOverride ?? 1,
    location: locationOverride || batchLocationInput.value.trim() || 'Main Drill Index',
    box_2d: bit.box_2d,
    confidence: bit.confidence,
  };
}

function renderScanResults() {
  const bits = state.scanBits;
  scanResultCount.textContent = String(bits.length);
  scanSceneSummary.textContent = state.currentScan?.scene_summary || '';
  scanResultsSection.hidden = false;
  btnSaveAll.disabled = bits.length === 0 || bits.every((b) => b._saved);

  const cards = bits.map((bit) => {
    const qtyInput = el('input', {
      type: 'text',
      inputmode: 'numeric',
      pattern: '\\d+',
      value: String(bit._qty || 1),
      'aria-label': 'Quantity to save',
      className: 'btn-sm',
    });
    const saveBtn = el(
      'button',
      {
        type: 'button',
        className: bit._saved ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm',
        disabled: Boolean(bit._saved),
        onClick: async () => {
          saveBtn.disabled = true;
          try {
            const qty = Math.max(1, Number.parseInt(qtyInput.value, 10) || 1);
            await api.createBit(buildBitPayloadFromScan(bit, batchLocationInput.value.trim(), qty));
            bit._saved = true;
            saveBtn.textContent = '✓ Saved';
            saveBtn.className = 'btn btn-secondary btn-sm';
            btnSaveAll.disabled = state.scanBits.every((b) => b._saved);
            showToast(`Saved ${bit.size_normalized || bit.size_primary} to toolbox.`, 'ok');
          } catch (err) {
            saveBtn.disabled = false;
            showToast(err.message, 'error');
          }
        },
      },
      bit._saved ? '✓ Saved' : 'Save to Toolbox',
    );

    const editBeforeSaveBtn = el(
      'button',
      {
        type: 'button',
        className: 'btn btn-secondary btn-sm',
        onClick: () => {
          openEditBitDialog(buildBitPayloadFromScan(bit, batchLocationInput.value.trim(), 1), () => {
            bit._saved = true;
            renderScanResults();
          });
        },
      },
      'Edit & Save',
    );

    const detailBtn = el(
      'button',
      {
        type: 'button',
        className: 'btn btn-ghost btn-sm',
        onClick: () => openDetailDialog(bit),
      },
      'Usage Guide',
    );

    const usageBox = el(
      'div',
      { className: 'bit-usage-box' },
      bit.recommended_materials?.length
        ? el('p', null, el('strong', null, 'Materials: '), bit.recommended_materials.join(', '))
        : null,
      bit.pilot_or_fastener
        ? el('p', null, el('strong', null, 'Pilot / Fastener: '), bit.pilot_or_fastener)
        : null,
      bit.speed_rpm_tip ? el('p', null, el('strong', null, 'Speed / Tip: '), bit.speed_rpm_tip) : null,
      bit.condition_notes ? el('p', null, el('strong', null, 'Wear: '), bit.condition_notes) : null,
    );

    const card = el(
      'article',
      {
        className: state.highlightedIndex === bit.index ? 'bit-card is-highlighted' : 'bit-card',
        dataset: { bitIndex: bit.index },
        onClick: (e) => {
          if (e.target.closest('button, input')) return;
          highlightScannedBit(bit.index, false);
        },
      },
      el(
        'div',
        { className: 'bit-card-top' },
        el(
          'div',
          null,
          el('span', { className: 'bit-size-hero' }, `#${bit.index + 1} · ${bit.size_normalized || bit.size_primary}`),
          el('h3', { className: 'bit-title' }, bit.name),
        ),
        detailBtn,
      ),
      createBadgeRow(bit),
      renderSpecList(bit),
      usageBox,
      el('div', { className: 'bit-card-footer' }, el('div', { className: 'toolbar' }, editBeforeSaveBtn, saveBtn)),
    );
    return card;
  });

  clearAndAppend(scanResultsGrid, cards);
  renderBoundingBoxes();
}

function openDetailDialog(bit) {
  detailTitle.textContent = `${bit.size_normalized || bit.size_primary} — ${bit.name}`;
  const nodes = [];
  if (bit.image_url) {
    nodes.push(el('img', { className: 'detail-img', src: bit.image_url, alt: bit.name }));
  }
  nodes.push(createBadgeRow(bit));
  nodes.push(renderSpecList(bit));
  nodes.push(
    el(
      'div',
      { className: 'bit-usage-box' },
      el('p', null, el('strong', null, 'Recommended Materials: '), (bit.recommended_materials || []).join(', ') || 'General use'),
      el('p', null, el('strong', null, 'Pilot / Fastener: '), bit.pilot_or_fastener || '—'),
      el('p', null, el('strong', null, 'Speed / RPM Tip: '), bit.speed_rpm_tip || '—'),
      el('p', null, el('strong', null, 'Wear Notes: '), bit.condition_notes || '—'),
      el('p', null, el('strong', null, 'Usage Notes: '), bit.usage_notes || bit.notes || '—'),
    ),
  );
  clearAndAppend(detailBody, nodes);
  detailDialog.showModal();
}

let editSaveCallback = null;

function openEditBitDialog(bit = null, onSaved = null) {
  editSaveCallback = onSaved;
  const isUpdate = Boolean(bit && bit.id);
  editDialogTitle.textContent = isUpdate ? 'Edit Bit' : 'Add Bit to Toolbox';
  editForm.elements.id.value = bit?.id || '';
  editForm.elements.size_primary.value = bit?.size_primary || '';
  editForm.elements.category.value = bit?.category || CATEGORIES[2];
  editForm.elements.name.value = bit?.name || '';
  editForm.elements.subtype.value = bit?.subtype || '';
  editForm.elements.manufacturer.value = bit?.manufacturer || 'Unknown';
  editForm.elements.shank_type.value = bit?.shank_type || '';
  editForm.elements.material_coating.value = bit?.material_coating || '';
  editForm.elements.location.value = bit?.location || 'Main Drill Index';
  editForm.elements.quantity.value = String(bit?.quantity ?? 1);
  editForm.elements.size_metric_mm.value = bit?.size_metric_mm > 0 ? String(bit.size_metric_mm) : '';
  editForm.elements.markings_read.value = bit?.markings_read || '';
  editForm.elements.pilot_or_fastener.value = bit?.pilot_or_fastener || '';
  editForm.elements.usage_notes.value = bit?.usage_notes || bit?.notes || '';

  const condVal = bit?.condition || 'Good';
  const radio = editForm.querySelector(`input[name="condition"][value="${condVal}"]`);
  if (radio) radio.checked = true;

  editForm.dataset.pendingScanId = bit?.scan_id || '';
  editForm.dataset.pendingImageFilename = bit?.image_filename || '';
  editForm.dataset.pendingConfidence = bit?.confidence || 'medium';
  editForm.dataset.pendingSpeed = bit?.speed_rpm_tip || '';
  editForm.dataset.pendingMaterials = JSON.stringify(bit?.recommended_materials || []);
  editForm.dataset.pendingBox2d = JSON.stringify(bit?.box_2d || null);

  editDialog.showModal();
}

function updateToolboxFacets(facets) {
  if (!facets) return;
  const currentLoc = filterLocation.value;
  clearAndAppend(
    filterLocation,
    el('option', { value: 'all' }, 'All locations'),
    ...facets.locations.map((loc) => el('option', { value: loc }, loc)),
  );
  if ([...filterLocation.options].some((o) => o.value === currentLoc)) {
    filterLocation.value = currentLoc;
  }

  const datalist = document.getElementById('location-options');
  const existingSet = new Set([...datalist.options].map((o) => o.value));
  for (const loc of facets.locations) {
    if (!existingSet.has(loc)) {
      datalist.appendChild(el('option', { value: loc }));
    }
  }

  toolboxStatsLine.textContent = `${facets.distinctEntries} distinct entries · ${facets.totalQuantity} total bits · ${facets.needsReplacement} worn/damaged`;
}

function renderToolboxCards(bits) {
  toolboxEmpty.hidden = bits.length > 0;
  const cards = bits.map((bit) => {
    const qtyEl = el('span', { className: 'qty-value' }, String(bit.quantity ?? 1));
    const adjustQty = async (delta) => {
      const nextQty = Math.max(0, Number(bit.quantity ?? 1) + delta);
      try {
        const res = await api.updateBit(bit.id, { quantity: nextQty });
        bit.quantity = res.bit.quantity;
        qtyEl.textContent = String(bit.quantity);
        updateToolboxFacets(res.facets);
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    return el(
      'article',
      { className: 'bit-card' },
      el(
        'div',
        { className: 'bit-card-top' },
        el(
          'div',
          null,
          el('span', { className: 'bit-size-hero' }, bit.size_normalized || bit.size_primary),
          el('h3', { className: 'bit-title' }, bit.name),
        ),
        el('span', { className: 'badge' }, `📍 ${bit.location}`),
      ),
      createBadgeRow(bit),
      renderSpecList(bit),
      el(
        'div',
        { className: 'bit-card-footer' },
        el(
          'div',
          { className: 'qty-stepper' },
          el('button', { type: 'button', className: 'btn btn-secondary btn-sm', 'aria-label': 'Decrease quantity', onClick: () => adjustQty(-1) }, '−'),
          qtyEl,
          el('button', { type: 'button', className: 'btn btn-secondary btn-sm', 'aria-label': 'Increase quantity', onClick: () => adjustQty(1) }, '+'),
        ),
        el(
          'div',
          { className: 'toolbar' },
          el('button', { type: 'button', className: 'btn btn-ghost btn-sm', onClick: () => openDetailDialog(bit) }, 'Details'),
          el('button', { type: 'button', className: 'btn btn-secondary btn-sm', onClick: () => openEditBitDialog(bit, () => loadToolbox()) }, 'Edit'),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              onClick: async () => {
                const ok = await askConfirm({
                  title: `Delete ${bit.size_normalized || bit.size_primary}?`,
                  message: `Remove "${bit.name}" from ${bit.location}?`,
                  confirmLabel: 'Delete Bit',
                });
                if (!ok) return;
                try {
                  await api.deleteBit(bit.id);
                  showToast('Bit removed from toolbox.', 'ok');
                  loadToolbox();
                } catch (err) {
                  showToast(err.message, 'error');
                }
              },
            },
            'Delete',
          ),
        ),
      ),
    );
  });
  clearAndAppend(toolboxGrid, cards);
}

async function loadToolbox() {
  try {
    const res = await api.listBits({
      q: toolboxSearch.value,
      category: filterCategory.value,
      location: filterLocation.value,
      condition: filterCondition.value,
      sort: filterSort.value,
    });
    state.inventoryBits = res.bits;
    updateToolboxFacets(res.facets);
    renderToolboxCards(res.bits);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderActiveSet() {
  const active = state.sets.find((s) => s.id === state.selectedSetId) || state.sets[0];
  if (!active) {
    clearAndAppend(setSummaryBar);
    clearAndAppend(setSlotsGrid);
    return;
  }

  const fillEl = el('div', { className: 'progress-fill' });
  fillEl.style.width = `${active.completionPct}%`;

  clearAndAppend(
    setSummaryBar,
    el(
      'div',
      null,
      el(
        'strong',
        null,
        `${active.name}: ${active.presentCount}/${active.totalSizes} present (${active.completionPct}%) — ${active.ownedCount} healthy, ${active.wornCount} worn/damaged, ${active.missingCount} missing`,
      ),
      el('div', { className: 'progress-track' }, fillEl),
    ),
  );

  const tiles = active.slots.map((slot) => {
    const statusCls =
      slot.status === 'owned' ? 'slot-tile slot-owned' : slot.status === 'worn' ? 'slot-tile slot-worn' : 'slot-tile slot-missing';
    const label =
      slot.status === 'owned' ? `✓ Owned (${slot.totalQty})` : slot.status === 'worn' ? '⚠ Replace' : '✕ Missing';
    return el(
      'div',
      { className: statusCls },
      el('span', null, slot.size),
      el('span', { className: 'slot-status-label' }, label),
    );
  });
  clearAndAppend(setSlotsGrid, tiles);
}

async function loadSets() {
  try {
    const res = await api.getSets();
    state.sets = res.sets || [];
    if (!state.sets.some((s) => s.id === state.selectedSetId) && state.sets[0]) {
      state.selectedSetId = state.sets[0].id;
    }
    clearAndAppend(
      setSelector,
      ...state.sets.map((s) => el('option', { value: s.id }, `${s.name} (${s.completionPct}%)`)),
    );
    setSelector.value = state.selectedSetId;
    renderActiveSet();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

const MODEL_STORAGE_KEY = 'bitsnparts_selected_model';

function applySelectedModel(modelId, { persist = false } = {}) {
  const radio = scanForm.querySelector(`input[name="scan_model"][value="${modelId}"]`);
  if (radio) {
    radio.checked = true;
    if (persist) {
      try {
        localStorage.setItem(MODEL_STORAGE_KEY, modelId);
      } catch {
        // ignore storage quota errors
      }
    }
  }
  const active = getCheckedRadioValue(scanForm, 'scan_model', modelId || 'gemini-3.5-flash-lite');
  if (geminiStatusBadge.classList.contains('status-ok')) {
    geminiStatusBadge.textContent = `AI Ready · ${active}`;
  }
  return active;
}

async function loadHealth() {
  try {
    const health = await api.getHealth();
    let savedModel = '';
    try {
      savedModel = localStorage.getItem(MODEL_STORAGE_KEY) || '';
    } catch {
      savedModel = '';
    }
    const activeModel = applySelectedModel(savedModel || health.model);
    geminiStatusBadge.textContent = health.geminiConfigured ? `AI Ready · ${activeModel}` : 'API Key Missing';
    geminiStatusBadge.className = health.geminiConfigured ? 'status-pill status-ok' : 'status-pill status-warn';

    const rows = [
      ['Service', health.service],
      ['Default AI Model', health.model],
      ['Selected Model', activeModel],
      ['Gemini Key', health.geminiConfigured ? 'Configured' : 'Missing (.env GEMINI_API_KEY)'],
      ['SQLite DB', health.sqlite?.ok ? `Healthy (${health.sqlite.distinctEntries} entries / ${health.sqlite.totalQuantity} qty)` : 'Error'],
      ['Saved Scans', String(health.sqlite?.scanCount ?? 0)],
      ['Camera Live View', isLiveCameraSupported() ? 'Supported (HTTPS / localhost)' : 'Use Take Photo (HTTP fallback)'],
    ];
    clearAndAppend(
      serverStatusDl,
      ...rows.flatMap(([k, v]) => [el('dt', null, k), el('dd', null, v)]),
    );
  } catch (err) {
    geminiStatusBadge.textContent = 'Server Offline';
    geminiStatusBadge.className = 'status-pill status-danger';
  }
}

async function loadScanHistory() {
  try {
    const res = await api.listScans(30);
    state.scansHistory = res.scans || [];
    if (!state.scansHistory.length) {
      clearAndAppend(scansHistoryList, el('p', { className: 'muted' }, 'No past scans yet.'));
      return;
    }
    const items = state.scansHistory.map((scan) =>
      el(
        'div',
        { className: 'history-item' },
        scan.image_url
          ? el('img', { className: 'history-thumb', src: scan.image_url, alt: scan.scene_summary || 'Scan photo' })
          : null,
        el(
          'div',
          { className: 'history-meta' },
          el('strong', null, `${scan.detected_count} bit(s) · ${scan.scale_reference}`),
          el('p', { className: 'muted' }, scan.scene_summary || scan.created_at),
        ),
        el(
          'div',
          { className: 'toolbar' },
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-secondary btn-sm',
              onClick: async () => {
                try {
                  const full = await api.getScan(scan.id);
                  const s = full.scan;
                  state.currentScan = s;
                  state.scanBits = (s.raw_result?.bits || []).map((b, i) => ({ ...b, index: b.index ?? i }));
                  state.currentPhotoDataUrl = s.image_url;
                  state.measuredMm = s.measured_mm;
                  state.measuredSnap = s.raw_result?.caliper_snap || null;
                  setActiveTab('scan');
                  updateCaptureUI();
                  renderScanResults();
                } catch (err) {
                  showToast(err.message, 'error');
                }
              },
            },
            'Load',
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-danger btn-sm',
              onClick: async () => {
                const ok = await askConfirm({
                  title: 'Delete scan record?',
                  message: 'Delete this scan from history? Any bits already saved to your toolbox stay intact.',
                  confirmLabel: 'Delete Scan',
                });
                if (!ok) return;
                try {
                  await api.deleteScan(scan.id);
                  loadScanHistory();
                } catch (err) {
                  showToast(err.message, 'error');
                }
              },
            },
            'Delete',
          ),
        ),
      ),
    );
    clearAndAppend(scansHistoryList, items);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function wireEvents() {
  for (const btn of tabButtons) {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  }

  btnStartCamera.addEventListener('click', async () => {
    try {
      showToast('');
      const { torchSupported } = await camera.start();
      cameraStage.hidden = false;
      emptyCaptureBox.hidden = true;
      btnTorch.hidden = !torchSupported;
      btnTorch.textContent = 'Flash: Off';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  btnTorch.addEventListener('click', async () => {
    try {
      const enabled = await camera.toggleTorch();
      btnTorch.textContent = enabled ? 'Flash: On' : 'Flash: Off';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  btnCaptureFrame.addEventListener('click', () => {
    try {
      const { dataUrl } = camera.captureFrame();
      camera.stop();
      cameraStage.hidden = true;
      setCapturedPhoto(dataUrl);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  btnStopCamera.addEventListener('click', () => {
    camera.stop();
    cameraStage.hidden = true;
    emptyCaptureBox.hidden = Boolean(state.currentPhotoDataUrl);
  });

  const handleFileInput = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      showToast('');
      const { dataUrl } = await fileToResizedDataUrl(file);
      setCapturedPhoto(dataUrl);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  inputCameraPhoto.addEventListener('change', handleFileInput);
  inputGalleryPhoto.addEventListener('change', handleFileInput);

  btnClearPhoto.addEventListener('click', () => {
    setCapturedPhoto(null);
  });

  btnOpenCaliper.addEventListener('click', async () => {
    if (!state.currentPhotoDataUrl) return;
    try {
      const scaleRef = getCheckedRadioValue(scanForm, 'scale_reference', 'auto');
      const result = await openCaliper(state.currentPhotoDataUrl, scaleRef);
      if (result) {
        state.measuredMm = result.measuredMm;
        state.measuredSnap = result.snapped;
        updateCaptureUI();
        showToast(
          `Caliper measurement set: ${result.measuredMm.toFixed(2)} mm (~${result.snapped.bestMatch}).`,
          'ok',
        );
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  for (const radio of scanForm.querySelectorAll('input[name="scan_model"]')) {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        applySelectedModel(radio.value, { persist: true });
      }
    });
  }

  scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.currentPhotoDataUrl) {
      showToast('Take or upload a photo first.', 'error');
      return;
    }
    const chosenModel = getCheckedRadioValue(scanForm, 'scan_model', 'gemini-3.5-flash-lite');
    btnAnalyze.disabled = true;
    const origText = btnAnalyze.textContent;
    btnAnalyze.textContent = `Analyzing with ${chosenModel}...`;
    showToast(`Inspecting bit geometry, stamped markings, and wear (${chosenModel})...`);

    try {
      const payload = {
        imageDataUrl: state.currentPhotoDataUrl,
        mode: getCheckedRadioValue(scanForm, 'scan_mode', 'auto'),
        scaleReference: getCheckedRadioValue(scanForm, 'scale_reference', 'auto'),
        model: chosenModel,
        measuredMm: state.measuredMm,
        notes: scanNotesInput.value.trim(),
      };
      const result = await api.scanImage(payload);
      state.currentScan = result.scan;
      state.scanBits = (result.bits || []).map((b, i) => ({ ...b, index: b.index ?? i }));
      state.highlightedIndex = state.scanBits.length ? 0 : null;
      renderScanResults();
      const usedModel = result.model_used || result.scan?.model_used || chosenModel;
      showToast(`Identified ${state.scanBits.length} bit(s) with ${usedModel}.`, 'ok');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnAnalyze.disabled = !state.currentPhotoDataUrl;
      btnAnalyze.textContent = origText;
    }
  });

  btnSaveAll.addEventListener('click', async () => {
    const unsaved = state.scanBits.filter((b) => !b._saved);
    if (!unsaved.length) return;
    btnSaveAll.disabled = true;
    try {
      const loc = batchLocationInput.value.trim() || 'Main Drill Index';
      const payloads = unsaved.map((b) => buildBitPayloadFromScan(b, loc, 1));
      await api.createBitsBatch(payloads);
      for (const b of unsaved) b._saved = true;
      renderScanResults();
      showToast(`Saved ${payloads.length} bit(s) to "${loc}".`, 'ok');
    } catch (err) {
      btnSaveAll.disabled = false;
      showToast(err.message, 'error');
    }
  });

  // Toolbox filter events
  let searchTimer = null;
  toolboxSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadToolbox, 200);
  });
  for (const sel of [filterCategory, filterLocation, filterCondition, filterSort]) {
    sel.addEventListener('change', loadToolbox);
  }
  toolboxFilterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loadToolbox();
  });

  btnAddManual.addEventListener('click', () => openEditBitDialog(null, () => loadToolbox()));

  // Edit bit dialog
  const closeEditSafely = () => editDialog.close('cancel');
  btnCloseEdit.addEventListener('click', closeEditSafely);
  btnCancelEdit.addEventListener('click', closeEditSafely);
  wireDialogReset(editDialog);
  wireDialogReset(detailDialog);

  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!editForm.reportValidity()) return;

    const id = editForm.elements.id.value.trim();
    const qty = Math.max(0, Number.parseInt(editForm.elements.quantity.value, 10) || 1);
    const payload = {
      size_primary: editForm.elements.size_primary.value.trim(),
      category: editForm.elements.category.value,
      name: editForm.elements.name.value.trim(),
      subtype: editForm.elements.subtype.value.trim(),
      manufacturer: editForm.elements.manufacturer.value.trim() || 'Unknown',
      shank_type: editForm.elements.shank_type.value.trim(),
      material_coating: editForm.elements.material_coating.value.trim(),
      location: editForm.elements.location.value.trim() || 'Main Drill Index',
      quantity: qty,
      condition: getCheckedRadioValue(editForm, 'condition', 'Good'),
      size_metric_mm: editForm.elements.size_metric_mm.value.trim()
        ? Number(editForm.elements.size_metric_mm.value.trim())
        : null,
      markings_read: editForm.elements.markings_read.value.trim(),
      pilot_or_fastener: editForm.elements.pilot_or_fastener.value.trim(),
      usage_notes: editForm.elements.usage_notes.value.trim(),
    };

    if (!id) {
      payload.scan_id = editForm.dataset.pendingScanId || null;
      payload.image_filename = editForm.dataset.pendingImageFilename || null;
      payload.confidence = editForm.dataset.pendingConfidence || 'medium';
      payload.speed_rpm_tip = editForm.dataset.pendingSpeed || '';
      try {
        payload.recommended_materials = JSON.parse(editForm.dataset.pendingMaterials || '[]');
        payload.box_2d = JSON.parse(editForm.dataset.pendingBox2d || 'null');
      } catch {
        payload.recommended_materials = [];
        payload.box_2d = null;
      }
    }

    try {
      if (id) {
        await api.updateBit(id, payload);
        showToast('Updated bit in toolbox.', 'ok');
      } else {
        await api.createBit(payload);
        showToast('Saved bit to toolbox.', 'ok');
      }
      editDialog.close('save');
      if (typeof editSaveCallback === 'function') {
        editSaveCallback();
      } else if (state.activeTab === 'toolbox') {
        loadToolbox();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Sets tab
  setSelector.addEventListener('change', () => {
    state.selectedSetId = setSelector.value;
    renderActiveSet();
  });

  btnCopyMissing.addEventListener('click', async () => {
    const active = state.sets.find((s) => s.id === state.selectedSetId) || state.sets[0];
    if (!active) return;
    const text = active.missingText || 'None — set is complete!';
    try {
      await navigator.clipboard.writeText(`${active.name} missing sizes: ${text}`);
      showToast('Copied missing sizes list to clipboard.', 'ok');
    } catch {
      showToast(`Missing sizes: ${text}`);
    }
  });

  btnRefreshHealth.addEventListener('click', loadHealth);
}

function initEnvironmentHint() {
  if (isLiveCameraSupported()) {
    btnStartCamera.hidden = false;
    cameraEnvNote.textContent = 'Live camera viewfinder available over HTTPS/localhost.';
  } else {
    btnStartCamera.hidden = true;
    cameraEnvNote.textContent =
      'Running over LAN HTTP: tap "Take Photo" to open your phone camera directly, or enable HTTPS via Tailscale Serve / Cloudflare Tunnel for live viewfinder.';
  }
}

installClosedByFallback();
populateSelectOptions();
wireEvents();
initEnvironmentHint();
updateCaptureUI();
loadHealth();
registerServiceWorker();
