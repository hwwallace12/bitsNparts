import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  CATEGORIES,
  CONDITIONS,
  SCALE_REFERENCES,
  computeSetAudit,
  snapDiameterMm,
} from './catalog.js';
import { createDatabase } from './db.js';
import { ConfigError, DEFAULT_GEMINI_MODEL, createGeminiAnalyzer } from './gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME_TO_EXT = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const SAFE_UPLOAD_FILENAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

export function loadEnvFile(envPath = path.join(ROOT_DIR, '.env')) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

function escapeCsvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function removeUploadQuietly(uploadsDir, filename) {
  if (!filename || !SAFE_UPLOAD_FILENAME_RE.test(filename)) return;
  const fullPath = path.resolve(uploadsDir, filename);
  if (!fullPath.startsWith(path.resolve(uploadsDir) + path.sep)) return;
  try {
    fs.unlinkSync(fullPath);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn(`Failed to delete orphan upload ${filename}:`, err.message);
    }
  }
}

export function createApp({
  dataDir,
  dbPath,
  analyzer,
  geminiConfigured,
  model,
} = {}) {
  const db = createDatabase({ dataDir, dbPath });
  const activeModel = (model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const hasGeminiKey =
    typeof geminiConfigured === 'boolean'
      ? geminiConfigured
      : Boolean((process.env.GEMINI_API_KEY || '').trim());

  const activeAnalyzer =
    analyzer ||
    createGeminiAnalyzer({
      apiKey: process.env.GEMINI_API_KEY,
      model: activeModel,
    });

  const app = express();
  app.disable('x-powered-by');

  // Security headers + CSP + Trusted Types
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(self), geolocation=(), microphone=(), focus-without-user-activation=()',
    );
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "font-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "require-trusted-types-for 'script'",
        'trusted-types bitsnparts-sw',
      ].join('; '),
    );

    if (req.secure || req.get('x-forwarded-proto') === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=300; includeSubDomains');
    }
    next();
  });

  // Fetch Metadata resource isolation
  app.use((req, res, next) => {
    res.setHeader('Vary', 'Sec-Fetch-Dest, Sec-Fetch-Mode, Sec-Fetch-Site');
    const site = req.get('Sec-Fetch-Site');
    const mode = req.get('Sec-Fetch-Mode');
    const dest = req.get('Sec-Fetch-Dest');

    if (!site) return next();
    if (['same-origin', 'same-site', 'none'].includes(site)) return next();
    if (
      site === 'cross-site' &&
      mode === 'navigate' &&
      req.method === 'GET' &&
      !['object', 'embed'].includes(dest || '')
    ) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden cross-site request' });
  });

  app.use('/api', express.json({ limit: '15mb' }));

  app.use('/api', (err, _req, res, next) => {
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Image payload too large (max 15 MB).' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON request body.' });
    }
    return next(err);
  });

  app.get('/api/health', (_req, res) => {
    const stats = db.getStats();
    res.json({
      ok: true,
      service: 'bitsNparts',
      model: activeAnalyzer.model || activeModel,
      geminiConfigured: hasGeminiKey,
      sqlite: {
        ok: true,
        distinctEntries: stats.distinctEntries,
        totalQuantity: stats.totalQuantity,
        scanCount: stats.scanCount,
      },
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      categories: CATEGORIES,
      conditions: CONDITIONS,
      scaleReferences: Object.values(SCALE_REFERENCES),
      geminiConfigured: hasGeminiKey,
      model: activeAnalyzer.model || activeModel,
    });
  });

  app.post('/api/scan', async (req, res) => {
    const {
      imageDataUrl,
      scaleReference = 'auto',
      measuredMm = null,
      mode = 'auto',
      notes = '',
    } = req.body || {};

    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      return res.status(400).json({ error: 'imageDataUrl is required.' });
    }

    const match = imageDataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) {
      return res.status(400).json({
        error: 'Unsupported image format. Please provide a JPEG, PNG, or WebP base64 data URL.',
      });
    }

    const rawMime = match[1].toLowerCase();
    const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
    const ext = ALLOWED_MIME_TO_EXT.get(rawMime) || 'jpg';
    const base64Clean = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(base64Clean, 'base64');

    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
      return res.status(400).json({
        error: 'Image must be non-empty and under 12 MB after decoding.',
      });
    }

    const safeScale = Object.hasOwn(SCALE_REFERENCES, scaleReference) ? scaleReference : 'auto';
    const parsedMeasuredMm =
      measuredMm !== null && measuredMm !== undefined && measuredMm !== '' && Number(measuredMm) > 0
        ? Number(Number(measuredMm).toFixed(2))
        : null;

    if (!hasGeminiKey && !analyzer) {
      return res.status(503).json({
        error: 'GEMINI_API_KEY is not configured. Add it to .env on HX90 and restart bitsNparts.',
      });
    }

    const imageFilename = `${randomUUID()}.${ext}`;
    const imagePath = path.join(db.uploadsDir, imageFilename);
    fs.writeFileSync(imagePath, buffer);

    try {
      const analysis = await activeAnalyzer.analyzeImage({
        base64Data: base64Clean,
        mimeType,
        scaleReference: safeScale,
        measuredMm: parsedMeasuredMm,
        mode,
        notes,
      });

      const usedModel = analysis.model_used || activeAnalyzer.model || activeModel;
      const scan = db.createScan({
        imageFilename,
        scaleReference: safeScale,
        measuredMm: parsedMeasuredMm,
        modelUsed: usedModel,
        sceneSummary: analysis.scene_summary,
        rawResult: analysis,
        detectedCount: analysis.bits.length,
      });

      return res.json({
        scan,
        model_used: usedModel,
        scene_summary: analysis.scene_summary,
        scale_reference_detected: analysis.scale_reference_detected,
        caliper_snap: analysis.caliper_snap,
        bits: analysis.bits,
      });
    } catch (err) {
      removeUploadQuietly(db.uploadsDir, imageFilename);
      if (err instanceof ConfigError || err?.statusCode === 503) {
        return res.status(503).json({ error: err.message });
      }
      console.error('Gemini scan failed:', err);
      return res.status(502).json({
        error: `AI scan failed: ${err?.message || 'Unexpected Gemini API error'}`,
      });
    }
  });

  app.get('/api/scans', (req, res) => {
    const scans = db.listScans(req.query.limit);
    res.json({ scans });
  });

  app.get('/api/scans/:id', (req, res) => {
    const scan = db.getScan(req.params.id);
    if (!scan) return res.status(404).json({ error: 'Scan not found.' });
    return res.json({ scan });
  });

  app.delete('/api/scans/:id', (req, res) => {
    const result = db.deleteScan(req.params.id);
    if (!result.deleted) return res.status(404).json({ error: 'Scan not found.' });
    if (result.orphanImage) {
      removeUploadQuietly(db.uploadsDir, result.orphanImage);
    }
    return res.json({ deleted: true });
  });

  app.get('/api/bits', (req, res) => {
    const bits = db.listBits({
      q: req.query.q,
      category: req.query.category,
      manufacturer: req.query.manufacturer,
      location: req.query.location,
      condition: req.query.condition,
      sort: req.query.sort,
    });
    const facets = db.getFacets();
    res.json({ bits, facets });
  });

  app.post('/api/bits', (req, res) => {
    const body = req.body || {};
    if (!body.size_primary && !body.name) {
      return res.status(400).json({ error: 'Bit name or size is required.' });
    }
    const created = db.createBit(body);
    return res.status(201).json({ bit: created, facets: db.getFacets() });
  });

  app.post('/api/bits/batch', (req, res) => {
    const items = req.body?.bits;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'bits array is required.' });
    }
    if (items.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 bits per batch request.' });
    }
    const created = db.createBitsBatch(items);
    return res.status(201).json({ bits: created, facets: db.getFacets() });
  });

  app.patch('/api/bits/:id', (req, res) => {
    const updated = db.updateBit(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Bit not found.' });
    return res.json({ bit: updated, facets: db.getFacets() });
  });

  app.delete('/api/bits/:id', (req, res) => {
    const result = db.deleteBit(req.params.id);
    if (!result.deleted) return res.status(404).json({ error: 'Bit not found.' });
    if (result.orphanImage) {
      removeUploadQuietly(db.uploadsDir, result.orphanImage);
    }
    return res.json({ deleted: true, facets: db.getFacets() });
  });

  app.get('/api/sets', (_req, res) => {
    const allBits = db.listBits({});
    const sets = computeSetAudit(allBits);
    res.json({ sets });
  });

  app.get('/api/snap', (req, res) => {
    const mm = Number(req.query.mm);
    const snapped = snapDiameterMm(mm);
    if (!snapped) {
      return res.status(400).json({ error: 'Query parameter mm must be a positive number.' });
    }
    return res.json(snapped);
  });

  app.get('/api/export', (req, res) => {
    const format = String(req.query.format || 'json').toLowerCase();
    const bits = db.exportAllBits();

    if (format === 'csv') {
      const headers = [
        'id',
        'name',
        'category',
        'subtype',
        'size_primary',
        'size_normalized',
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
        'quantity',
        'location',
        'notes',
        'updated_at',
      ];
      const lines = [headers.join(',')];
      for (const bit of bits) {
        const row = headers.map((key) => {
          const val = key === 'recommended_materials' ? (bit[key] || []).join('; ') : bit[key];
          return escapeCsvCell(val);
        });
        lines.push(row.join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="bitsnparts-inventory.csv"');
      return res.send(lines.join('\r\n'));
    }

    res.setHeader('Content-Disposition', 'attachment; filename="bitsnparts-inventory.json"');
    return res.json({
      exportedAt: new Date().toISOString(),
      count: bits.length,
      bits,
    });
  });

  app.get('/api/uploads/:filename', (req, res) => {
    const { filename } = req.params;
    if (!SAFE_UPLOAD_FILENAME_RE.test(filename)) {
      return res.status(400).json({ error: 'Invalid upload filename.' });
    }
    const uploadsRoot = path.resolve(db.uploadsDir);
    const fullPath = path.resolve(uploadsRoot, filename);
    if (!fullPath.startsWith(uploadsRoot + path.sep)) {
      return res.status(400).json({ error: 'Invalid upload path.' });
    }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Image not found.' });
    }
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.sendFile(fullPath);
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  function close() {
    db.close();
  }

  return { app, db, close };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  loadEnvFile();
  const port = Number(process.env.PORT || 8090);
  const { app, close } = createApp();

  const server = app.listen(port, '0.0.0.0', () => {
    console.log(
      `bitsNparts listening on http://0.0.0.0:${port} (model=${process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL}, geminiKey=${Boolean((process.env.GEMINI_API_KEY || '').trim())})`,
    );
  });

  const shutdown = (signal) => {
    console.log(`Received ${signal}, shutting down bitsNparts...`);
    server.close(() => {
      close();
      process.exit(0);
    });
    setTimeout(() => {
      close();
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
