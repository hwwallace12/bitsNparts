import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { computeSetAudit, normalizeSize, snapDiameterMm } from '../server/catalog.js';
import { createDatabase } from '../server/db.js';
import { normalizeAnalysisResult } from '../server/gemini.js';
import { createApp } from '../server/index.js';

function makeTempDir(prefix = 'bitsnparts-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const SAMPLE_DATA_URL = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;

test('catalog.normalizeSize normalizes imperial, metric, and driver sizes', () => {
  assert.equal(normalizeSize('2/8"'), '1/4"');
  assert.equal(normalizeSize(' 8/16 in '), '1/2"');
  assert.equal(normalizeSize('1 2/8 inches'), '1-1/4"');
  assert.equal(normalizeSize('6.0 mm'), '6mm');
  assert.equal(normalizeSize('6.50mm'), '6.5mm');
  assert.equal(normalizeSize('ph 2'), 'PH2');
  assert.equal(normalizeSize('Torx #25'), 'T25');
  assert.equal(normalizeSize('sq 2'), 'SQ2');
  assert.equal(normalizeSize('pz 1'), 'PZ1');
  assert.equal(normalizeSize('1/4" nut driver'), '1/4" Nut');
});

test('catalog.snapDiameterMm snaps measured diameters to imperial and metric', () => {
  const quarterInch = snapDiameterMm(6.35);
  assert.equal(quarterInch.imperial.label, '1/4"');
  assert.equal(quarterInch.imperial.deltaMm, 0);
  assert.equal(quarterInch.metric.label, '6.5mm');

  const sixMm = snapDiameterMm(6.0);
  assert.equal(sixMm.metric.label, '6mm');
  assert.equal(sixMm.bestMatch, '6mm');

  const holeSaw = snapDiameterMm(57.15);
  assert.equal(holeSaw.imperial.label, '2-1/4"');

  assert.equal(snapDiameterMm(0), null);
  assert.equal(snapDiameterMm(-5), null);
  assert.equal(snapDiameterMm('abc'), null);
});

test('catalog.computeSetAudit filters by category and detects owned, worn, and missing sizes', () => {
  const inventory = [
    { id: '1', category: 'Wood', size_primary: '1/4"', size_normalized: '1/4"', size_metric_mm: 6.35, condition: 'Good', quantity: 2 },
    { id: '2', category: 'All-Purpose / Metal', size_primary: '1/8"', size_normalized: '1/8"', size_metric_mm: 3.18, condition: 'Worn', quantity: 1 },
    { id: '3', category: 'Masonry', size_primary: '3/16"', size_normalized: '3/16"', size_metric_mm: 4.76, condition: 'New', quantity: 1 },
    { id: '4', category: 'Screwdriver / Driver', size_primary: 'PH2', size_normalized: 'PH2', size_metric_mm: 0, condition: 'Good', quantity: 3 },
    { id: '5', category: 'All-Purpose / Metal', size_primary: '3/8"', size_normalized: '3/8"', size_metric_mm: 9.53, condition: 'Good', quantity: 0 },
  ];

  const audit = computeSetAudit(inventory);
  const frac29 = audit.find((s) => s.id === 'fractional-29');
  assert.ok(frac29);
  assert.equal(frac29.slots.find((s) => s.size === '1/4"').status, 'owned');
  assert.equal(frac29.slots.find((s) => s.size === '1/8"').status, 'worn');
  assert.equal(frac29.slots.find((s) => s.size === '3/8"').status, 'missing');
  assert.equal(frac29.slots.find((s) => s.size === 'PH2'), undefined);

  const masonry = audit.find((s) => s.id === 'masonry-common');
  assert.equal(masonry.slots.find((s) => s.size === '3/16"').status, 'owned');
  // Wood 1/4" bit must NOT count as owning 1/4" masonry bit
  assert.equal(masonry.slots.find((s) => s.size === '1/4"').status, 'missing');

  const drivers = audit.find((s) => s.id === 'driver-essential');
  assert.equal(drivers.slots.find((s) => s.size === 'PH2').status, 'owned');
  assert.equal(drivers.slots.find((s) => s.size === 'T25').status, 'missing');
});

test('db layer persists scans, bits, transactions, filters, and orphan tracking', () => {
  const dir = makeTempDir();
  const db = createDatabase({ dataDir: dir });
  try {
    const scan = db.createScan({
      imageFilename: '11111111-1111-4111-8111-111111111111.png',
      scaleReference: 'quarter',
      measuredMm: 6.35,
      modelUsed: 'gemini-3.8-flash',
      sceneSummary: 'One 1/4 inch masonry bit beside a quarter',
      rawResult: { bits: [] },
      detectedCount: 1,
    });
    assert.equal(scan.scale_reference, 'quarter');

    const created = db.createBitsBatch([
      {
        scan_id: scan.id,
        image_filename: scan.image_filename,
        name: '1/4" Carbide Masonry Bit',
        category: 'masonry',
        size_primary: '2/8"',
        manufacturer: 'Bosch',
        condition: 'good',
        location: 'Masonry Drawer',
        quantity: 2,
      },
      {
        name: 'PH2 Impact Bit',
        category: 'Screwdriver / Driver',
        size_primary: 'ph 2',
        manufacturer: 'Milwaukee',
        condition: 'worn',
        location: 'Impact Case',
        quantity: 1,
      },
    ]);
    assert.equal(created.length, 2);
    assert.equal(created[0].size_normalized, '1/4"');
    assert.equal(created[0].category, 'Masonry');
    assert.equal(created[1].size_normalized, 'PH2');

    const filtered = db.listBits({ q: 'bosch', category: 'Masonry' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].location, 'Masonry Drawer');

    const facets = db.getFacets();
    assert.equal(facets.distinctEntries, 2);
    assert.equal(facets.totalQuantity, 3);
    assert.equal(facets.needsReplacement, 1);

    // Deleting scan while bit still references image_filename should NOT mark orphan
    const scanDel = db.deleteScan(scan.id);
    assert.equal(scanDel.deleted, true);
    assert.equal(scanDel.orphanImage, null);

    // Deleting the last referencing bit SHOULD mark image as orphan
    const bitDel = db.deleteBit(created[0].id);
    assert.equal(bitDel.deleted, true);
    assert.equal(bitDel.orphanImage, '11111111-1111-4111-8111-111111111111.png');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeAnalysisResult clamps box_2d and normalizes Gemini output', () => {
  const normalized = normalizeAnalysisResult(
    {
      scene_summary: 'Two bits on tray',
      scale_reference_detected: 'US Quarter',
      bits: [
        {
          name: 'Cobalt Twist Bit',
          category: 'metal',
          subtype: '135-deg Split Point',
          size_primary: '3/8 in',
          size_imperial: '3/8"',
          size_metric_mm: 0,
          manufacturer: 'DeWalt',
          condition: 'worn',
          recommended_materials: ['Stainless Steel', 'Aluminum'],
          confidence: 'HIGH',
          box_2d: [-15, 900, 1200, 100],
        },
      ],
    },
    { measuredMm: 9.53 },
  );

  assert.equal(normalized.bits.length, 1);
  const bit = normalized.bits[0];
  assert.equal(bit.category, 'All-Purpose / Metal');
  assert.equal(bit.size_normalized, '3/8"');
  assert.equal(bit.size_metric_mm, 9.525);
  assert.equal(bit.condition, 'Worn');
  assert.equal(bit.confidence, 'high');
  assert.deepEqual(bit.box_2d, [0, 100, 1000, 900]);
  assert.equal(normalized.caliper_snap.imperial.label, '3/8"');
});

test('HTTP API integration: headers, scan flow, inventory CRUD, sets, export, and path safety', async () => {
  const dir = makeTempDir();
  let mockCalled = 0;
  const mockAnalyzer = {
    model: 'gemini-3.8-flash',
    async analyzeImage({ measuredMm }) {
      mockCalled += 1;
      return normalizeAnalysisResult(
        {
          scene_summary: '1/4 inch masonry bit detected',
          scale_reference_detected: 'US Quarter',
          bits: [
            {
              name: '1/4" Milwaukee Carbide Masonry Bit',
              category: 'Masonry',
              subtype: 'Carbide Hammer Bit',
              size_primary: '1/4"',
              size_imperial: '1/4"',
              size_metric_mm: 6.35,
              length_class: 'Jobber',
              shank_type: '1/4" Hex Quick-Change',
              material_coating: 'Carbide Tipped',
              manufacturer: 'Milwaukee',
              model_line: 'Shockwave',
              markings_read: 'MILWAUKEE 1/4',
              condition: 'Good',
              condition_notes: 'Clean carbide braze, light dust',
              recommended_materials: ['Concrete', 'Brick', 'Block'],
              pilot_or_fastener: '1/4" plastic anchor / Tapcon pilot',
              speed_rpm_tip: 'Hammer mode 800-1200 RPM',
              usage_notes: 'Pull bit out frequently to clear masonry dust.',
              confidence: 'high',
              box_2d: [120, 200, 880, 420],
            },
          ],
        },
        { measuredMm },
      );
    },
  };

  const { app, close } = createApp({
    dataDir: dir,
    analyzer: mockAnalyzer,
    geminiConfigured: true,
    model: 'gemini-3.8-flash',
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    // Health & security headers
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    assert.match(healthRes.headers.get('content-security-policy'), /require-trusted-types-for 'script'/);
    assert.match(healthRes.headers.get('permissions-policy'), /camera=\(self\)/);
    assert.equal(healthRes.headers.get('x-frame-options'), 'DENY');
    assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.geminiConfigured, true);

    // Fetch Metadata blocks cross-site API POST
    const crossSiteRes = await fetch(`${baseUrl}/api/bits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
      },
      body: JSON.stringify({ name: 'Sneaky Bit', size_primary: '1/4"' }),
    });
    assert.equal(crossSiteRes.status, 403);

    // Validation errors on /api/scan
    const badScanRes = await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: 'not-an-image' }),
    });
    assert.equal(badScanRes.status, 400);

    // Valid scan saves image + scan row
    const scanRes = await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl: SAMPLE_DATA_URL,
        scaleReference: 'quarter',
        measuredMm: 6.35,
        mode: 'single',
      }),
    });
    assert.equal(scanRes.status, 200);
    assert.equal(mockCalled, 1);
    const scanData = await scanRes.json();
    assert.equal(scanData.bits.length, 1);
    assert.equal(scanData.bits[0].manufacturer, 'Milwaukee');
    const uploadUrl = scanData.scan.image_url;
    assert.match(uploadUrl, /^\/api\/uploads\/[0-9a-f-]{36}\.png$/);

    // Uploaded image is retrievable; path traversal is rejected
    const imgRes = await fetch(`${baseUrl}${uploadUrl}`);
    assert.equal(imgRes.status, 200);
    const traversalRes = await fetch(`${baseUrl}/api/uploads/..%2Fbitsnparts.db`);
    assert.equal(traversalRes.status, 400);

    // Batch save to toolbox
    const batchRes = await fetch(`${baseUrl}/api/bits/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bits: [
          {
            ...scanData.bits[0],
            scan_id: scanData.scan.id,
            image_filename: scanData.scan.image_filename,
            location: 'Masonry Drawer',
            quantity: 2,
          },
          {
            name: '=SUM(1,1) Tricky Note',
            category: 'Wood',
            size_primary: '1/2"',
            location: 'Wood Rack',
            quantity: 1,
          },
        ],
      }),
    });
    assert.equal(batchRes.status, 201);
    const batchJson = await batchRes.json();
    assert.equal(batchJson.bits.length, 2);

    // Patch quantity & location
    const firstId = batchJson.bits[0].id;
    const patchRes = await fetch(`${baseUrl}/api/bits/${firstId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 4 }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.bit.quantity, 4);

    // Sets audit reflects Masonry 1/4" owned
    const setsRes = await fetch(`${baseUrl}/api/sets`);
    assert.equal(setsRes.status, 200);
    const setsJson = await setsRes.json();
    const masonrySet = setsJson.sets.find((s) => s.id === 'masonry-common');
    assert.equal(masonrySet.slots.find((s) => s.size === '1/4"').status, 'owned');

    // CSV & JSON export (including CSV formula neutralization)
    const csvRes = await fetch(`${baseUrl}/api/export?format=csv`);
    assert.equal(csvRes.status, 200);
    const csvText = await csvRes.text();
    assert.match(csvText, /'=SUM\(1,1\) Tricky Note/);

    const jsonRes = await fetch(`${baseUrl}/api/export?format=json`);
    assert.equal(jsonRes.status, 200);
    const jsonExport = await jsonRes.json();
    assert.equal(jsonExport.count, 2);

    // Delete scan then delete bit -> cleans up orphan file
    const delScanRes = await fetch(`${baseUrl}/api/scans/${scanData.scan.id}`, { method: 'DELETE' });
    assert.equal(delScanRes.status, 200);
    const delBitRes = await fetch(`${baseUrl}/api/bits/${firstId}`, { method: 'DELETE' });
    assert.equal(delBitRes.status, 200);
    const imgAfterCleanup = await fetch(`${baseUrl}${uploadUrl}`);
    assert.equal(imgAfterCleanup.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/scan returns 503 when Gemini API key is missing', async () => {
  const dir = makeTempDir();
  const prevKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const { app, close } = createApp({
    dataDir: dir,
    geminiConfigured: false,
    model: 'gemini-3.8-flash',
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: SAMPLE_DATA_URL }),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /GEMINI_API_KEY/);
  } finally {
    if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
    await new Promise((resolve) => server.close(resolve));
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
