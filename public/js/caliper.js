import { CALIPER_REFERENCES, snapDiameterMm } from './catalog-client.js';
import { wireDialogReset } from './dialogs.js';

export function createCaliperController({
  dialog,
  canvas,
  refSelect,
  stepTextEl,
  resultTextEl,
  resetRefBtn,
  resetBitBtn,
  applyBtn,
}) {
  const ctx = canvas.getContext('2d');
  let img = null;
  let refPoints = [];
  let bitPoints = [];
  let activeStage = 'ref'; // 'ref' | 'bit'
  let pendingResolve = null;
  let lastSnapped = null;

  // Map UI reference selection from Scan tab to caliper reference select
  function mapScaleRefId(scaleRef) {
    if (scaleRef === 'mat') return 'mat_100';
    if (scaleRef === 'card') return 'card_w';
    if (scaleRef === 'hex_shank') return 'hex_shank';
    return 'quarter';
  }

  function getSelectedRefMm() {
    const found = CALIPER_REFERENCES.find((r) => r.id === refSelect.value);
    return found ? found.mm : 24.26;
  }

  function distPx(p1, p2) {
    return Math.hypot(p2.x - p1.x, p2.y - p1.y);
  }

  function updateComputation() {
    if (refPoints.length < 2) {
      activeStage = 'ref';
      lastSnapped = null;
      applyBtn.disabled = true;
      stepTextEl.textContent =
        refPoints.length === 0
          ? 'Step 1/2: Tap both outer edges of your reference object (coin, card, mat box, or 1/4" hex shank).'
          : 'Step 1/2: Tap the second edge of your reference object.';
      resultTextEl.textContent = 'Waiting for reference endpoints...';
      return;
    }

    if (bitPoints.length < 2) {
      activeStage = 'bit';
      lastSnapped = null;
      applyBtn.disabled = true;
      stepTextEl.textContent =
        bitPoints.length === 0
          ? 'Step 2/2: Tap the two outer cutting edges (diameter) across the drill bit.'
          : 'Step 2/2: Tap the opposite outer edge of the drill bit.';
      resultTextEl.textContent = 'Reference calibrated. Now measure bit diameter.';
      return;
    }

    const refPx = distPx(refPoints[0], refPoints[1]);
    const bitPx = distPx(bitPoints[0], bitPoints[1]);
    if (refPx < 2 || bitPx < 1) {
      lastSnapped = null;
      applyBtn.disabled = true;
      resultTextEl.textContent = 'Points are too close together — tap distinct edges.';
      return;
    }

    const refMm = getSelectedRefMm();
    const measuredMm = (bitPx / refPx) * refMm;
    const snapped = snapDiameterMm(measuredMm);
    lastSnapped = snapped;
    applyBtn.disabled = !snapped;
    stepTextEl.textContent = 'Measurement ready. Adjust endpoints or click Use Measurement.';
    if (snapped) {
      resultTextEl.textContent = `${snapped.inputMm.toFixed(2)} mm  |  Imperial: ${snapped.imperial.label} (Δ ${snapped.imperial.deltaMm} mm)  |  Metric: ${snapped.metric.label} (Δ ${snapped.metric.deltaMm} mm)`;
    }
  }

  function drawLineWithHandles(points, color, label) {
    if (!points.length) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2.5, canvas.width / 260);

    if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      ctx.lineTo(points[1].x, points[1].y);
      ctx.stroke();

      const mx = (points[0].x + points[1].x) / 2;
      const my = (points[0].y + points[1].y) / 2;
      ctx.font = `bold ${Math.max(14, Math.round(canvas.width / 36))}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      const pad = 6;
      const metrics = ctx.measureText(label);
      ctx.fillRect(mx - metrics.width / 2 - pad, my - 22, metrics.width + pad * 2, 24);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.fillText(label, mx, my - 5);
    }

    const r = Math.max(7, canvas.width / 90);
    for (const pt of points) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    drawLineWithHandles(refPoints, '#38bdf8', `REF (${getSelectedRefMm()}mm)`);
    drawLineWithHandles(
      bitPoints,
      '#fbbf24',
      lastSnapped ? `${lastSnapped.inputMm.toFixed(1)}mm (~${lastSnapped.bestMatch})` : 'BIT',
    );
  }

  function pointerToCanvasCoords(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * scaleX)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * scaleY)),
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!img) return;
    const pt = pointerToCanvasCoords(event);
    if (activeStage === 'ref') {
      if (refPoints.length >= 2) refPoints = [];
      refPoints.push(pt);
    } else {
      if (bitPoints.length >= 2) bitPoints = [];
      bitPoints.push(pt);
    }
    updateComputation();
    render();
  });

  refSelect.addEventListener('change', () => {
    updateComputation();
    render();
  });

  resetRefBtn.addEventListener('click', () => {
    refPoints = [];
    bitPoints = [];
    activeStage = 'ref';
    updateComputation();
    render();
  });

  resetBitBtn.addEventListener('click', () => {
    bitPoints = [];
    if (refPoints.length === 2) {
      activeStage = 'bit';
    }
    updateComputation();
    render();
  });

  wireDialogReset(dialog, (returnValue) => {
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      if (returnValue === 'apply' && lastSnapped) {
        resolve({ measuredMm: lastSnapped.inputMm, snapped: lastSnapped });
      } else {
        resolve(null);
      }
    }
  });

  return function openCaliper(imageDataUrl, initialScaleRef = 'auto') {
    return new Promise((resolve, reject) => {
      const loadedImg = new Image();
      loadedImg.onload = () => {
        img = loadedImg;
        const maxDraw = 1200;
        const scale = Math.min(1, maxDraw / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        refPoints = [];
        bitPoints = [];
        activeStage = 'ref';
        refSelect.value = mapScaleRefId(initialScaleRef);
        pendingResolve = resolve;
        updateComputation();
        render();
        dialog.showModal();
      };
      loadedImg.onerror = () => reject(new Error('Could not load photo into caliper tool.'));
      loadedImg.src = imageDataUrl;
    });
  };
}
