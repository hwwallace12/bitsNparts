import { GoogleGenAI } from '@google/genai';
import {
  CATEGORIES,
  CONDITIONS,
  CONFIDENCE_LEVELS,
  SCALE_REFERENCES,
  normalizeCategory,
  normalizeCondition,
  normalizeSize,
  parseSizeToMm,
  snapDiameterMm,
} from './catalog.js';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.statusCode = 503;
  }
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export function isTransientOverloadError(err) {
  return Boolean(
    err?.status === 503 ||
      err?.statusCode === 503 ||
      err?.status === 429 ||
      err?.statusCode === 429 ||
      /\b(503|429|high demand|overloaded|unavailable)\b/i.test(String(err?.message || '')),
  );
}

export const SCAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    scene_summary: {
      type: 'string',
      description: 'Short 1-sentence summary of what bits/accessories and scale references are visible.',
    },
    scale_reference_detected: {
      type: 'string',
      description:
        'Scale reference observed in image (e.g. "US Quarter", "Calibration Mat", "Credit Card", "1/4 Hex Shank", "Ruler", "Markings Only", or "None").',
    },
    bits: {
      type: 'array',
      description: 'Every distinct drill bit, hole saw, or screwdriver/driver bit identified in the image.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Concise descriptive name, e.g. "1/4\\" DeWalt Impact Ready Masonry Bit".',
          },
          category: {
            type: 'string',
            enum: CATEGORIES,
            description: 'Primary tool category.',
          },
          subtype: {
            type: 'string',
            description:
              'Specific bit geometry/type, e.g. "Brad Point", "Spade / Paddle", "Twist Jobber", "Carbide Hammer", "Bi-Metal Hole Saw", "Phillips #2 Impact", "Torx T25", "Step Drill", "Forstner", "Countersink".',
          },
          size_primary: {
            type: 'string',
            description:
              'Primary labeled or measured size, e.g. "1/4\\"", "6mm", "PH2", "T25", "2-1/8\\"", "#8 Countersink".',
          },
          size_imperial: {
            type: 'string',
            description: 'Imperial equivalent size if applicable (e.g. "1/4\\""), or empty string "".',
          },
          size_metric_mm: {
            type: 'number',
            description: 'Cutting/nominal diameter in millimeters (e.g. 6.35), or 0 if not a diameter-sized bit.',
          },
          length_class: {
            type: 'string',
            description: 'Length class such as "Stubby", "Jobber", "Mechanics", "1-inch Insert", "2-inch Power", "6-inch Extension", or "Standard".',
          },
          shank_type: {
            type: 'string',
            description: 'Shank style such as "Round", "1/4\\" Hex Quick-Change", "3-Flat Reduced", "SDS-Plus", "SDS-Max", or "Hole Saw Arbor".',
          },
          material_coating: {
            type: 'string',
            description: 'Suspected alloy/coating such as "Black Oxide HSS", "Titanium Nitride (TiN)", "Cobalt M35/M42", "Carbide-Tipped", "Bi-Metal HSS", or "S2 Tool Steel".',
          },
          manufacturer: {
            type: 'string',
            description: 'Brand/manufacturer ONLY if markings, logo, color band, or distinctive design confirms it (e.g. "Milwaukee", "DeWalt", "Bosch", "Makita", "Irwin", "Diablo", "Wera"); otherwise "Unknown".',
          },
          model_line: {
            type: 'string',
            description: 'Product family if identifiable (e.g. "Shockwave", "Red Helix", "FlexTorq", "Speedbor"), or empty string "".',
          },
          markings_read: {
            type: 'string',
            description: 'Exact verbatim characters stamped, laser-etched, or printed on the bit/collar, or empty string "".',
          },
          condition: {
            type: 'string',
            enum: CONDITIONS,
            description: 'Observed cutting-edge / tip wear state.',
          },
          condition_notes: {
            type: 'string',
            description: 'Specific observation about edge sharpness, cam-out wear, rust, heat discoloration, or chipping.',
          },
          recommended_materials: {
            type: 'array',
            items: { type: 'string' },
            description: 'Target materials (e.g. ["Hardwood", "Plywood"], ["Concrete", "Brick"], ["Mild Steel", "Aluminum"]).',
          },
          pilot_or_fastener: {
            type: 'string',
            description: 'Matching fastener/anchor or pilot-hole guidance (e.g. "1/4\\" Tapcon masonry screw needs 3/16\\" pilot", "Common #10 wood screw clearance hole", "2-1/8\\" standard deadbolt bore").',
          },
          speed_rpm_tip: {
            type: 'string',
            description: 'Practical drill speed / technique advice (e.g. "Slow-medium 400-800 RPM with cutting oil", "Hammer mode only, clear dust every 1 inch", "Impact driver friendly").',
          },
          usage_notes: {
            type: 'string',
            description: '1-2 concise workshop tips or warnings for this specific bit.',
          },
          confidence: {
            type: 'string',
            enum: CONFIDENCE_LEVELS,
            description: 'Overall confidence in size and type identification.',
          },
          box_2d: {
            type: 'array',
            items: { type: 'integer' },
            description: '2D bounding box of this bit as [ymin, xmin, ymax, xmax] normalized 0 to 1000.',
          },
        },
        required: [
          'name',
          'category',
          'subtype',
          'size_primary',
          'size_imperial',
          'size_metric_mm',
          'length_class',
          'shank_type',
          'material_coating',
          'manufacturer',
          'model_line',
          'markings_read',
          'condition',
          'condition_notes',
          'recommended_materials',
          'pilot_or_fastener',
          'speed_rpm_tip',
          'usage_notes',
          'confidence',
          'box_2d',
        ],
      },
    },
  },
  required: ['scene_summary', 'scale_reference_detected', 'bits'],
};

const SYSTEM_INSTRUCTION = `You are an expert toolmaker and hardware specialist identifying drill bits, masonry bits, wood bits (brad-point, spade, auger, Forstner), hole saws, step drills, countersinks, and screwdriver/nut driver bits from phone photos.

Identification protocol (follow strictly):
1. READ MARKINGS FIRST: Closely inspect the shank, collar, color band, or hole-saw cup for stamped or laser-etched size fractions, millimeter numbers, Phillips/Torx/Square codes (PH2, T25, SQ2), alloy stamps (HSS, M35, M2, S2, CARBIDE), and brand names/logos. Transcribe readable text verbatim into "markings_read".
2. CLASSIFY TYPE BY GEOMETRY:
   - Masonry: brazed tungsten-carbide spade tip at head + wide dust-clearing flutes; often SDS-Plus slotted shank or 3-flat/round carbide-tipped masonry shank.
   - Wood: brad-point (sharp center spur + outer cutting spurs), spade/paddle (flat blade with center point), auger (lead screw tip + deep single spiral), Forstner (circular rim + central spur).
   - All-Purpose / Metal: standard 118° or 135° split-point twist flutes; finish clues include bright polished HSS, black oxide, gold Titanium Nitride (TiN), or bronze/straw Cobalt (M35/M42).
   - Hole Saw: cylindrical saw cup with teeth and pilot arbor.
   - Screwdriver / Driver: 1/4" hex shank (often with torsion waist) and Phillips, Torx/Star, Torx Security, Robertson/Square, Pozidriv, Slotted, Hex/Allen, or magnetic nut-setter head.
   - Step / Countersink: stepped conical flutes or multi-flute chamfer/countersink collar.
3. SIZE WITH PRECISION:
   - Use legible stamped/etched markings first.
   - When markings are absent or worn, compare the bit's cutting diameter (and shank diameter) proportionally against any visible reference object (US Quarter = 24.26 mm, CR80 Credit Card = 85.60 x 53.98 mm, Calibration Mat 100mm square/rulers, or standard 1/4" hex shank = 6.35 mm across flats) AND against any caliper measurement supplied by the user.
   - Snap drill diameters to the nearest plausible standard imperial fractional (1/64" increments) or metric (0.5mm increments) size. Note uncertainty in "confidence" ("low" or "medium") when estimating without readable markings or scale reference.
4. MANUFACTURER INTEGRITY:
   - Only name a manufacturer when supported by legible text/logo or unmistakable proprietary styling (e.g. Milwaukee red band/Shockwave, DeWalt yellow/FlexTorq, Bosch Daredevil/blue band, Makita Impact XPS/Gold, Diablo red cup, Irwin Speedbor blue groove). Otherwise set "manufacturer" to "Unknown". Never guess blindly.
5. SINGLE OR BATCH:
   - Detect EVERY prominent bit in the frame (whether 1 bit or 15 bits laid out side-by-side), ordered left-to-right, top-to-bottom.
   - Provide tight normalized [ymin, xmin, ymax, xmax] bounding boxes in 0-1000 coordinates for each bit.`;

function clampBox2d(rawBox) {
  if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;
  const nums = rawBox.map((v) => Math.max(0, Math.min(1000, Math.round(Number(v)))));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  let [ymin, xmin, ymax, xmax] = nums;
  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
  if (ymax - ymin < 2 || xmax - xmin < 2) return null;
  return [ymin, xmin, ymax, xmax];
}

export function normalizeAnalysisResult(parsed, { measuredMm = null } = {}) {
  const safeBits = Array.isArray(parsed?.bits) ? parsed.bits : [];
  const snappedCaliper = measuredMm && Number(measuredMm) > 0 ? snapDiameterMm(Number(measuredMm)) : null;

  const normalizedBits = safeBits.map((raw, idx) => {
    const category = normalizeCategory(raw?.category);
    const condition = normalizeCondition(raw?.condition);
    let sizePrimary = String(raw?.size_primary || '').trim();
    if (!sizePrimary && snappedCaliper && safeBits.length === 1) {
      sizePrimary = snappedCaliper.bestMatch;
    }
    if (!sizePrimary) sizePrimary = 'Unknown';

    const sizeNormalized = normalizeSize(sizePrimary) || sizePrimary;
    const sizeImperial = raw?.size_imperial ? normalizeSize(raw.size_imperial) : '';

    let sizeMetricMm = Number(raw?.size_metric_mm);
    if (!Number.isFinite(sizeMetricMm) || sizeMetricMm <= 0) {
      sizeMetricMm = parseSizeToMm(sizeNormalized) || parseSizeToMm(sizeImperial) || 0;
    } else {
      sizeMetricMm = Number(sizeMetricMm.toFixed(2));
    }

    const confidence = CONFIDENCE_LEVELS.includes(String(raw?.confidence || '').toLowerCase())
      ? String(raw.confidence).toLowerCase()
      : 'medium';

    const materials = Array.isArray(raw?.recommended_materials)
      ? raw.recommended_materials.map((m) => String(m).trim()).filter(Boolean)
      : [];

    const manufacturer = String(raw?.manufacturer || 'Unknown').trim() || 'Unknown';
    const name = String(raw?.name || `${sizeNormalized} ${raw?.subtype || category}`).trim();

    return {
      index: idx,
      name,
      category,
      subtype: String(raw?.subtype || '').trim(),
      size_primary: sizePrimary,
      size_normalized: sizeNormalized,
      size_imperial: sizeImperial,
      size_metric_mm: sizeMetricMm,
      length_class: String(raw?.length_class || 'Standard').trim(),
      shank_type: String(raw?.shank_type || '').trim(),
      material_coating: String(raw?.material_coating || '').trim(),
      manufacturer,
      model_line: String(raw?.model_line || '').trim(),
      markings_read: String(raw?.markings_read || '').trim(),
      condition,
      condition_notes: String(raw?.condition_notes || '').trim(),
      recommended_materials: materials,
      pilot_or_fastener: String(raw?.pilot_or_fastener || '').trim(),
      speed_rpm_tip: String(raw?.speed_rpm_tip || '').trim(),
      usage_notes: String(raw?.usage_notes || '').trim(),
      confidence,
      box_2d: clampBox2d(raw?.box_2d),
    };
  });

  return {
    scene_summary: String(parsed?.scene_summary || '').trim(),
    scale_reference_detected: String(parsed?.scale_reference_detected || 'None').trim(),
    caliper_snap: snappedCaliper,
    bits: normalizedBits,
  };
}

export function createGeminiAnalyzer({ apiKey, model, fallbackModel } = {}) {
  const activeModel = (model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const resolvedFallback = (
    fallbackModel ??
    process.env.GEMINI_FALLBACK_MODEL ??
    DEFAULT_FALLBACK_MODEL
  ).trim();

  async function analyzeImage({
    base64Data,
    mimeType = 'image/jpeg',
    scaleReference = 'auto',
    measuredMm = null,
    mode = 'auto',
    notes = '',
  }) {
    const resolvedKey = (apiKey ?? process.env.GEMINI_API_KEY ?? '').trim();
    if (!resolvedKey) {
      throw new ConfigError(
        'GEMINI_API_KEY is not configured. Add GEMINI_API_KEY to your .env file and restart the server.',
      );
    }

    const scaleInfo = SCALE_REFERENCES[scaleReference] || SCALE_REFERENCES.auto;
    const promptLines = [
      `Analyze the drill bit(s), hole saw(s), or driver bit(s) in this photo.`,
      `Scan mode: ${mode === 'batch' ? 'Batch scan — detect every distinct bit laid out in the photo.' : mode === 'single' ? 'Single-bit close-up — focus carefully on fine markings, flute tip, and shank details.' : 'Auto — detect 1 bit or multiple bits depending on what is present.'}`,
      `Scale reference guidance: ${scaleInfo.promptHint}`,
    ];

    if (measuredMm && Number(measuredMm) > 0) {
      const snapped = snapDiameterMm(Number(measuredMm));
      if (snapped) {
        promptLines.push(
          `User photo-caliper measurement for the primary bit: ${snapped.inputMm} mm (nearest standard imperial: ${snapped.imperial.label} [${snapped.imperial.mm} mm], nearest metric: ${snapped.metric.label}). Use this to anchor diameter sizing unless stamped markings prove otherwise.`,
        );
      }
    }

    if (notes && String(notes).trim()) {
      promptLines.push(`User context note: ${String(notes).trim()}`);
    }

    const promptText = promptLines.join('\n');
    const client = new GoogleGenAI({ apiKey: resolvedKey, apiVersion: 'v1beta' });

    const invokeModel = (modelName) =>
      client.interactions.create({
        model: modelName,
        store: false,
        system_instruction: SYSTEM_INSTRUCTION,
        input: [
          { type: 'text', text: promptText },
          {
            type: 'image',
            data: base64Data,
            mime_type: mimeType,
            resolution: 'high',
          },
        ],
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: SCAN_RESPONSE_SCHEMA,
        },
      });

    let usedModel = activeModel;
    let interaction;
    try {
      interaction = await invokeModel(activeModel);
    } catch (err) {
      if (
        isTransientOverloadError(err) &&
        resolvedFallback &&
        resolvedFallback !== activeModel
      ) {
        console.warn(
          `Gemini model ${activeModel} transient overload (${err?.status || err?.statusCode || err?.message}); retrying with ${resolvedFallback}`,
        );
        usedModel = resolvedFallback;
        interaction = await invokeModel(resolvedFallback);
      } else {
        throw err;
      }
    }

    const outputText = interaction?.output_text;
    if (!outputText || typeof outputText !== 'string') {
      throw new Error('Gemini returned an empty response for this image.');
    }

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (err) {
      throw new Error(`Gemini returned invalid JSON: ${err.message}`);
    }

    return {
      ...normalizeAnalysisResult(parsed, { measuredMm }),
      model_used: usedModel,
    };
  }

  return {
    model: activeModel,
    fallbackModel: resolvedFallback,
    analyzeImage,
  };
}
