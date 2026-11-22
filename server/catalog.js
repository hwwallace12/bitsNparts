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

export const CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

export const SCALE_REFERENCES = {
  auto: {
    id: 'auto',
    label: 'Auto / Markings',
    referenceMm: null,
    promptHint:
      'Look for stamped/etched markings on the shank or barrel and any ruler, coin, or card visible in frame.',
  },
  mat: {
    id: 'mat',
    label: 'Calibration Mat (100mm)',
    referenceMm: 100,
    promptHint:
      'The bits are resting on the printable bitsNparts Calibration Mat with an exact 100mm x 100mm fiducial square, metric/imperial rulers, and reference diameter strips.',
  },
  quarter: {
    id: 'quarter',
    label: 'US Quarter (24.26mm)',
    referenceMm: 24.26,
    promptHint:
      'A US Quarter coin (exact outer diameter 24.26 mm / 0.955 in) is placed on the same surface next to the bits as a scale reference.',
  },
  card: {
    id: 'card',
    label: 'Credit Card (85.6x54mm)',
    referenceMm: 85.6,
    promptHint:
      'A standard CR80 credit/ID card (85.60 mm wide x 53.98 mm tall) is placed on the same surface next to the bits as a scale reference.',
  },
  hex_shank: {
    id: 'hex_shank',
    label: '1/4" Hex Shank (6.35mm)',
    referenceMm: 6.35,
    promptHint:
      'Use the standard 1/4-inch (6.35 mm across flats) quick-change hex shank on the bit(s) as the known scale reference.',
  },
};

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
    n = n % d;
  }
  if (n === 0) {
    return `${w}"`;
  }
  const factor = gcd(n, d);
  n /= factor;
  d /= factor;
  if (w > 0) {
    return `${w}-${n}/${d}"`;
  }
  return `${n}/${d}"`;
}

export function normalizeCategory(raw) {
  if (!raw || typeof raw !== 'string') return 'Specialty / Other';
  const exact = CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  if (exact) return exact;

  const s = raw.toLowerCase();
  if (s.includes('masonry') || s.includes('concrete') || s.includes('sds') || s.includes('hammer')) {
    return 'Masonry';
  }
  if (s.includes('hole saw') || s.includes('holesaw')) {
    return 'Hole Saw';
  }
  if (s.includes('wood') || s.includes('brad') || s.includes('spade') || s.includes('auger') || s.includes('forstner')) {
    return 'Wood';
  }
  if (s.includes('step') || s.includes('countersink') || s.includes('unibit') || s.includes('chamfer')) {
    return 'Step / Countersink';
  }
  if (
    s.includes('driver') ||
    s.includes('screwdriver') ||
    s.includes('phillips') ||
    s.includes('torx') ||
    s.includes('nut') ||
    s.includes('impact bit')
  ) {
    return 'Screwdriver / Driver';
  }
  if (s.includes('metal') || s.includes('all-purpose') || s.includes('all purpose') || s.includes('hss') || s.includes('cobalt') || s.includes('twist')) {
    return 'All-Purpose / Metal';
  }
  return 'Specialty / Other';
}

export function normalizeCondition(raw) {
  if (!raw || typeof raw !== 'string') return 'Good';
  const exact = CONDITIONS.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  if (exact) return exact;
  const s = raw.toLowerCase();
  if (s.includes('new') || s.includes('mint') || s.includes('unused')) return 'New';
  if (s.includes('damag') || s.includes('broken') || s.includes('chip') || s.includes('bent') || s.includes('snap')) {
    return 'Damaged';
  }
  if (s.includes('worn') || s.includes('dull') || s.includes('rust') || s.includes('round') || s.includes('used')) {
    return 'Worn';
  }
  return 'Good';
}

export function normalizeSize(rawSize) {
  if (rawSize === null || rawSize === undefined) return '';
  let s = String(rawSize)
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (!s) return '';

  // Nut driver forms like "1/4\" Nut", "5/16 nut driver", "3/8 in hex nut"
  const nutMatch = s.match(/^(.+?)\s*(?:hex\s*)?nut(?:\s*driver)?$/i);
  if (nutMatch) {
    const inner = normalizeSize(nutMatch[1]);
    return inner ? `${inner} Nut` : s;
  }

  // Driver codes
  const phMatch = s.match(/^(?:ph|phillips)\s*#?\s*([0-4])$/i);
  if (phMatch) return `PH${phMatch[1]}`;

  const pzMatch = s.match(/^(?:pz|pozidriv|pozi)\s*#?\s*([0-4])$/i);
  if (pzMatch) return `PZ${pzMatch[1]}`;

  const torxMatch = s.match(/^(?:t|tx|torx|star)\s*#?\s*(\d+)$/i);
  if (torxMatch) return `T${torxMatch[1]}`;

  const sqMatch = s.match(/^(?:sq|robertson|rob|square)\s*#?\s*([0-4])$/i);
  if (sqMatch) return `SQ${sqMatch[1]}`;

  const slMatch = s.match(/^(?:sl|slotted|flat)\s*#?\s*(\d+(?:\/\d+)?)$/i);
  if (slMatch) return `SL${slMatch[1]}`;

  // Metric (e.g. "6.0 mm" -> "6mm")
  const mmMatch = s.match(/^(\d+(?:\.\d+)?)\s*mm$/i);
  if (mmMatch) {
    const val = Number.parseFloat(mmMatch[1]);
    if (Number.isFinite(val) && val > 0) {
      const clean = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(2)));
      return `${clean}mm`;
    }
  }

  // Mixed imperial fraction (e.g. "1-1/8\"", "1 2/8 in")
  const mixedMatch = s.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)\s*(?:"|in(?:ch(?:es)?)?)?$/i);
  if (mixedMatch) {
    const whole = Number.parseInt(mixedMatch[1], 10);
    const num = Number.parseInt(mixedMatch[2], 10);
    const den = Number.parseInt(mixedMatch[3], 10);
    if (den > 0) return formatReducedFraction(whole, num, den);
  }

  // Simple imperial fraction (e.g. "2/8", "1/4 in", "3/8\"")
  const fracMatch = s.match(/^(\d+)\s*\/\s*(\d+)\s*(?:"|in(?:ch(?:es)?)?)?$/i);
  if (fracMatch) {
    const num = Number.parseInt(fracMatch[1], 10);
    const den = Number.parseInt(fracMatch[2], 10);
    if (den > 0) return formatReducedFraction(0, num, den);
  }

  // Whole inch with unit (e.g. "1 in", "2\"")
  const wholeInchMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in(?:ch(?:es)?)?)$/i);
  if (wholeInchMatch) {
    const val = Number.parseFloat(wholeInchMatch[1]);
    if (Number.isFinite(val) && val > 0) {
      return `${Number(val.toFixed(4))}"`;
    }
  }

  return s;
}

export function parseSizeToMm(rawSize) {
  const norm = normalizeSize(rawSize);
  if (!norm) return null;

  const mmMatch = norm.match(/^(\d+(?:\.\d+)?)mm$/i);
  if (mmMatch) return Number.parseFloat(mmMatch[1]);

  const mixedMatch = norm.match(/^(\d+)-(\d+)\/(\d+)"$/);
  if (mixedMatch) {
    const inches =
      Number.parseInt(mixedMatch[1], 10) +
      Number.parseInt(mixedMatch[2], 10) / Number.parseInt(mixedMatch[3], 10);
    return Number((inches * 25.4).toFixed(3));
  }

  const fracMatch = norm.match(/^(\d+)\/(\d+)"$/);
  if (fracMatch) {
    const inches = Number.parseInt(fracMatch[1], 10) / Number.parseInt(fracMatch[2], 10);
    return Number((inches * 25.4).toFixed(3));
  }

  const decInchMatch = norm.match(/^(\d+(?:\.\d+)?)"$/);
  if (decInchMatch) {
    return Number((Number.parseFloat(decInchMatch[1]) * 25.4).toFixed(3));
  }

  return null;
}

/**
 * Given a diameter in millimeters, snap to the nearest standard imperial
 * fractional drill/hole-saw size and nearest 0.5mm metric size.
 */
export function snapDiameterMm(mm) {
  const value = Number(mm);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  let bestImp = null;
  if (value <= 52) {
    // 1/64" increments up to 2" (128/64)
    for (let sixtyFourths = 1; sixtyFourths <= 128; sixtyFourths += 1) {
      const inches = sixtyFourths / 64;
      const candidateMm = inches * 25.4;
      const deltaMm = Math.abs(value - candidateMm);
      if (!bestImp || deltaMm < bestImp.deltaMm) {
        bestImp = {
          label: formatReducedFraction(0, sixtyFourths, 64),
          inches: Number(inches.toFixed(4)),
          mm: Number(candidateMm.toFixed(2)),
          deltaMm: Number(deltaMm.toFixed(2)),
        };
      }
    }
  } else {
    // 1/8" increments from 2" up to 6.5" (hole saws)
    for (let eighths = 16; eighths <= 52; eighths += 1) {
      const inches = eighths / 8;
      const candidateMm = inches * 25.4;
      const deltaMm = Math.abs(value - candidateMm);
      if (!bestImp || deltaMm < bestImp.deltaMm) {
        bestImp = {
          label: formatReducedFraction(0, eighths, 8),
          inches: Number(inches.toFixed(4)),
          mm: Number(candidateMm.toFixed(2)),
          deltaMm: Number(deltaMm.toFixed(2)),
        };
      }
    }
  }

  const metricHalfSteps = Math.max(1, Math.round(value * 2));
  const metricVal = metricHalfSteps / 2;
  const metricLabel = `${Number.isInteger(metricVal) ? metricVal : metricVal.toFixed(1)}mm`;
  const metricDelta = Number(Math.abs(value - metricVal).toFixed(2));

  const bestMetric = {
    label: metricLabel,
    mm: metricVal,
    deltaMm: metricDelta,
  };

  return {
    inputMm: Number(value.toFixed(2)),
    imperial: bestImp,
    metric: bestMetric,
    bestMatch: bestImp.deltaMm <= bestMetric.deltaMm ? bestImp.label : bestMetric.label,
  };
}

function buildFractionalRange(startNum, endNum, den) {
  const list = [];
  for (let n = startNum; n <= endNum; n += 1) {
    list.push(formatReducedFraction(0, n, den));
  }
  return list;
}

function buildMetricRange(startMm, endMm, stepMm) {
  const list = [];
  const count = Math.round((endMm - startMm) / stepMm);
  for (let i = 0; i <= count; i += 1) {
    const v = Number((startMm + i * stepMm).toFixed(1));
    list.push(`${Number.isInteger(v) ? v : v}mm`);
  }
  return list;
}

export const STANDARD_SETS = [
  {
    id: 'fractional-29',
    name: '29-Piece Fractional Index',
    description: '1/16" to 1/2" by 1/64" increments',
    filterMode: 'drill',
    metricToleranceMm: 0.18,
    sizes: buildFractionalRange(4, 32, 64),
  },
  {
    id: 'fractional-15',
    name: '15-Piece Fractional Set',
    description: '1/16" to 1/2" by 1/32" increments',
    filterMode: 'drill',
    metricToleranceMm: 0.18,
    sizes: buildFractionalRange(2, 16, 32),
  },
  {
    id: 'metric-1-13',
    name: '25-Piece Metric Jobber Set',
    description: '1mm to 13mm by 0.5mm increments',
    filterMode: 'drill',
    metricToleranceMm: 0.18,
    sizes: buildMetricRange(1, 13, 0.5),
  },
  {
    id: 'masonry-common',
    name: 'Common Masonry Set',
    description: 'Essential carbide hammer/masonry sizes',
    filterMode: 'masonry',
    metricToleranceMm: 0.18,
    sizes: ['5/32"', '3/16"', '1/4"', '5/16"', '3/8"', '1/2"', '5/8"', '3/4"'],
  },
  {
    id: 'driver-essential',
    name: 'Essential Driver & Nut Set',
    description: 'Phillips, Torx, Square, Slotted & Nut drivers',
    filterMode: 'driver',
    metricToleranceMm: 0,
    sizes: [
      'PH1',
      'PH2',
      'PH3',
      'T15',
      'T20',
      'T25',
      'T30',
      'SQ1',
      'SQ2',
      'SQ3',
      'SL6',
      'SL8',
      '1/4" Nut',
      '5/16" Nut',
      '3/8" Nut',
    ],
  },
];

function bitMatchesSetFilter(bit, filterMode) {
  const cat = normalizeCategory(bit.category);
  const sub = String(bit.subtype || '').toLowerCase();
  const name = String(bit.name || '').toLowerCase();
  const sizeNorm = normalizeSize(bit.size_normalized || bit.size_primary);

  if (filterMode === 'masonry') {
    return cat === 'Masonry' || sub.includes('masonry') || sub.includes('carbide') || name.includes('masonry');
  }
  if (filterMode === 'driver') {
    return (
      cat === 'Screwdriver / Driver' ||
      /^(PH|PZ|T|SQ|SL)\d/.test(sizeNorm) ||
      sizeNorm.endsWith(' Nut') ||
      sub.includes('nut driver') ||
      sub.includes('driver')
    );
  }
  // 'drill' sets include drill bits, excluding driver bits and hole saws
  return cat !== 'Screwdriver / Driver' && cat !== 'Hole Saw';
}

function bitMatchesSlot(bit, targetNorm, targetMm, metricToleranceMm) {
  const primaryNorm = normalizeSize(bit.size_normalized || bit.size_primary);
  const impNorm = normalizeSize(bit.size_imperial);

  if (primaryNorm === targetNorm || (impNorm && impNorm === targetNorm)) {
    return true;
  }

  // Handle nut driver logged as "1/4\"" with subtype "Nut Driver"
  if (targetNorm.endsWith(' Nut')) {
    const baseSize = targetNorm.replace(/ Nut$/, '');
    const subAndName = `${bit.subtype || ''} ${bit.name || ''}`.toLowerCase();
    if (subAndName.includes('nut') && (primaryNorm === baseSize || impNorm === baseSize)) {
      return true;
    }
  }

  if (metricToleranceMm > 0 && targetMm !== null) {
    const bitMm =
      Number(bit.size_metric_mm) > 0
        ? Number(bit.size_metric_mm)
        : parseSizeToMm(primaryNorm || impNorm);
    if (bitMm !== null && Math.abs(bitMm - targetMm) <= metricToleranceMm) {
      return true;
    }
  }

  return false;
}

export function computeSetAudit(inventoryBits = []) {
  const activeBits = inventoryBits.filter((b) => Number(b.quantity ?? 1) > 0);

  return STANDARD_SETS.map((setDef) => {
    const eligibleBits = activeBits.filter((bit) => bitMatchesSetFilter(bit, setDef.filterMode));
    let ownedCount = 0;
    let wornCount = 0;
    const missingSizes = [];

    const slots = setDef.sizes.map((size) => {
      const targetNorm = normalizeSize(size);
      const targetMm = setDef.metricToleranceMm > 0 ? parseSizeToMm(targetNorm) : null;
      const matches = eligibleBits.filter((bit) =>
        bitMatchesSlot(bit, targetNorm, targetMm, setDef.metricToleranceMm),
      );

      let status = 'missing';
      if (matches.length > 0) {
        const hasHealthy = matches.some((m) => {
          const cond = normalizeCondition(m.condition);
          return cond === 'New' || cond === 'Good';
        });
        if (hasHealthy) {
          status = 'owned';
          ownedCount += 1;
        } else {
          status = 'worn';
          wornCount += 1;
        }
      } else {
        missingSizes.push(targetNorm);
      }

      const totalQty = matches.reduce((sum, m) => sum + Number(m.quantity ?? 1), 0);

      return {
        size: targetNorm,
        status,
        totalQty,
        matchedIds: matches.map((m) => m.id),
      };
    });

    const totalSizes = setDef.sizes.length;
    const presentCount = ownedCount + wornCount;
    const missingCount = missingSizes.length;
    const completionPct = totalSizes > 0 ? Math.round((presentCount / totalSizes) * 100) : 0;

    return {
      id: setDef.id,
      name: setDef.name,
      description: setDef.description,
      totalSizes,
      ownedCount,
      wornCount,
      presentCount,
      missingCount,
      completionPct,
      missingSizes,
      missingText: missingSizes.join(', '),
      slots,
    };
  });
}
