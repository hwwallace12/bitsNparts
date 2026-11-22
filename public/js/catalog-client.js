export const CATEGORIES = [
  'Masonry',
  'Wood',
  'All-Purpose / Metal',
  'Hole Saw',
  'Screwdriver / Driver',
  'Step / Countersink',
  'Specialty / Other',
];

export const CONDITIONS = ['New', 'Good', 'Worn', 'Damaged'];

export const CATEGORY_META = {
  Masonry: { icon: '🧱', cls: 'cat-masonry' },
  Wood: { icon: '🪵', cls: 'cat-wood' },
  'All-Purpose / Metal': { icon: '🔩', cls: 'cat-metal' },
  'Hole Saw': { icon: '⭕', cls: 'cat-holesaw' },
  'Screwdriver / Driver': { icon: '🔧', cls: 'cat-driver' },
  'Step / Countersink': { icon: '📐', cls: 'cat-step' },
  'Specialty / Other': { icon: '🧰', cls: 'cat-other' },
};

export const CONDITION_META = {
  New: { icon: '✦', cls: 'cond-new' },
  Good: { icon: '✓', cls: 'cond-good' },
  Worn: { icon: '⚠', cls: 'cond-worn' },
  Damaged: { icon: '✕', cls: 'cond-damaged' },
};

export const CALIPER_REFERENCES = [
  { id: 'quarter', label: 'US Quarter (24.26 mm)', mm: 24.26 },
  { id: 'card_w', label: 'Credit Card Width (85.60 mm)', mm: 85.6 },
  { id: 'card_h', label: 'Credit Card Height (53.98 mm)', mm: 53.98 },
  { id: 'mat_100', label: 'Calibration Mat 100mm Box', mm: 100.0 },
  { id: 'hex_shank', label: '1/4" Hex Shank Flats (6.35 mm)', mm: 6.35 },
];

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function formatReducedFraction(whole, num, den) {
  if (!den || den <= 0) return '';
  let w = Math.trunc(whole || 0);
  let n = Math.trunc(num || 0);
  let d = Math.trunc(den);
  if (n < 0) n = 0;
  if (n >= d) {
    w += Math.floor(n / d);
    n %= d;
  }
  if (n === 0) return `${w}"`;
  const factor = gcd(n, d);
  n /= factor;
  d /= factor;
  return w > 0 ? `${w}-${n}/${d}"` : `${n}/${d}"`;
}

export function snapDiameterMm(mm) {
  const value = Number(mm);
  if (!Number.isFinite(value) || value <= 0) return null;

  let bestImp = null;
  if (value <= 52) {
    for (let i = 1; i <= 128; i += 1) {
      const inches = i / 64;
      const candMm = inches * 25.4;
      const deltaMm = Math.abs(value - candMm);
      if (!bestImp || deltaMm < bestImp.deltaMm) {
        bestImp = {
          label: formatReducedFraction(0, i, 64),
          inches: Number(inches.toFixed(4)),
          mm: Number(candMm.toFixed(2)),
          deltaMm: Number(deltaMm.toFixed(2)),
        };
      }
    }
  } else {
    for (let i = 16; i <= 52; i += 1) {
      const inches = i / 8;
      const candMm = inches * 25.4;
      const deltaMm = Math.abs(value - candMm);
      if (!bestImp || deltaMm < bestImp.deltaMm) {
        bestImp = {
          label: formatReducedFraction(0, i, 8),
          inches: Number(inches.toFixed(4)),
          mm: Number(candMm.toFixed(2)),
          deltaMm: Number(deltaMm.toFixed(2)),
        };
      }
    }
  }

  const halfSteps = Math.max(1, Math.round(value * 2));
  const metricVal = halfSteps / 2;
  const metricLabel = `${Number.isInteger(metricVal) ? metricVal : metricVal.toFixed(1)}mm`;
  const metricDelta = Number(Math.abs(value - metricVal).toFixed(2));

  return {
    inputMm: Number(value.toFixed(2)),
    imperial: bestImp,
    metric: {
      label: metricLabel,
      mm: metricVal,
      deltaMm: metricDelta,
    },
    bestMatch: bestImp.deltaMm <= metricDelta ? bestImp.label : metricLabel,
  };
}
