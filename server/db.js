import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeCategory, normalizeCondition, normalizeSize, parseSizeToMm } from './catalog.js';

function nullable(value) {
  return value === undefined || value === '' ? null : value;
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeJsonParse(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function deserializeBit(row) {
  if (!row) return null;
  return {
    ...row,
    recommended_materials: safeJsonParse(row.recommended_materials, []),
    box_2d: safeJsonParse(row.box_2d, null),
    image_url: row.image_filename ? `/api/uploads/${row.image_filename}` : null,
  };
}

function deserializeScan(row) {
  if (!row) return null;
  return {
    ...row,
    raw_result: safeJsonParse(row.raw_result, null),
    image_url: row.image_filename ? `/api/uploads/${row.image_filename}` : null,
  };
}

export function createDatabase({ dataDir, dbPath } = {}) {
  const resolvedDataDir = path.resolve(dataDir || process.env.DATA_DIR || './data');
  const uploadsDir = path.join(resolvedDataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const resolvedDbPath = dbPath ? path.resolve(dbPath) : path.join(resolvedDataDir, 'bitsnparts.db');
  fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

  const db = new DatabaseSync(resolvedDbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      image_filename TEXT NOT NULL,
      scale_reference TEXT NOT NULL DEFAULT 'auto',
      measured_mm REAL,
      model_used TEXT NOT NULL,
      scene_summary TEXT,
      raw_result TEXT NOT NULL,
      detected_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bits (
      id TEXT PRIMARY KEY,
      scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
      image_filename TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      subtype TEXT,
      size_primary TEXT NOT NULL,
      size_normalized TEXT NOT NULL,
      size_imperial TEXT,
      size_metric_mm REAL,
      length_class TEXT,
      shank_type TEXT,
      material_coating TEXT,
      manufacturer TEXT NOT NULL DEFAULT 'Unknown',
      model_line TEXT,
      markings_read TEXT,
      condition TEXT NOT NULL DEFAULT 'Good',
      condition_notes TEXT,
      recommended_materials TEXT NOT NULL DEFAULT '[]',
      pilot_or_fastener TEXT,
      speed_rpm_tip TEXT,
      usage_notes TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      location TEXT NOT NULL DEFAULT 'Main Drill Index',
      box_2d TEXT,
      confidence TEXT NOT NULL DEFAULT 'medium',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bits_category ON bits(category);
    CREATE INDEX IF NOT EXISTS idx_bits_manufacturer ON bits(manufacturer);
    CREATE INDEX IF NOT EXISTS idx_bits_location ON bits(location);
    CREATE INDEX IF NOT EXISTS idx_bits_size_norm ON bits(size_normalized);
    CREATE INDEX IF NOT EXISTS idx_bits_updated ON bits(updated_at DESC);
  `);

  const insertScanStmt = db.prepare(`
    INSERT INTO scans (
      id, image_filename, scale_reference, measured_mm, model_used,
      scene_summary, raw_result, detected_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBitStmt = db.prepare(`
    INSERT INTO bits (
      id, scan_id, image_filename, name, category, subtype,
      size_primary, size_normalized, size_imperial, size_metric_mm,
      length_class, shank_type, material_coating, manufacturer, model_line,
      markings_read, condition, condition_notes, recommended_materials,
      pilot_or_fastener, speed_rpm_tip, usage_notes, quantity, location,
      box_2d, confidence, notes
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
  `);

  function prepareBitParams(input) {
    const id = input.id || randomUUID();
    const category = normalizeCategory(input.category);
    const condition = normalizeCondition(input.condition);
    const rawSize = String(input.size_primary || input.size || 'Unknown').trim() || 'Unknown';
    const sizeNormalized = normalizeSize(rawSize) || rawSize;
    const sizeImperial = input.size_imperial ? normalizeSize(input.size_imperial) : null;
    const parsedMm =
      nullableNumber(input.size_metric_mm) ??
      parseSizeToMm(sizeNormalized) ??
      parseSizeToMm(sizeImperial);

    const materials = Array.isArray(input.recommended_materials)
      ? input.recommended_materials.map((m) => String(m).trim()).filter(Boolean)
      : typeof input.recommended_materials === 'string'
        ? input.recommended_materials
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean)
        : [];

    const box2d =
      Array.isArray(input.box_2d) && input.box_2d.length === 4
        ? JSON.stringify(input.box_2d.map((v) => Math.max(0, Math.min(1000, Math.round(Number(v) || 0)))))
        : null;

    const quantity = Math.max(0, Math.min(9999, Math.round(Number(input.quantity ?? 1) || 0)));
    const confidence = ['high', 'medium', 'low'].includes(String(input.confidence || '').toLowerCase())
      ? String(input.confidence).toLowerCase()
      : 'medium';

    return {
      id,
      params: [
        id,
        nullable(input.scan_id),
        nullable(input.image_filename),
        String(input.name || `${sizeNormalized} ${category} Bit`).trim(),
        category,
        nullable(input.subtype),
        rawSize,
        sizeNormalized,
        nullable(sizeImperial),
        parsedMm && parsedMm > 0 ? parsedMm : null,
        nullable(input.length_class),
        nullable(input.shank_type),
        nullable(input.material_coating),
        String(input.manufacturer || 'Unknown').trim() || 'Unknown',
        nullable(input.model_line),
        nullable(input.markings_read),
        condition,
        nullable(input.condition_notes),
        JSON.stringify(materials),
        nullable(input.pilot_or_fastener),
        nullable(input.speed_rpm_tip),
        nullable(input.usage_notes),
        quantity,
        String(input.location || 'Main Drill Index').trim() || 'Main Drill Index',
        box2d,
        confidence,
        nullable(input.notes),
      ],
    };
  }

  function createScan({
    id = randomUUID(),
    imageFilename,
    scaleReference = 'auto',
    measuredMm = null,
    modelUsed,
    sceneSummary = '',
    rawResult,
    detectedCount = 0,
  }) {
    insertScanStmt.run(
      id,
      String(imageFilename),
      String(scaleReference || 'auto'),
      nullableNumber(measuredMm),
      String(modelUsed || 'gemini-3.8-flash'),
      nullable(sceneSummary),
      JSON.stringify(rawResult ?? {}),
      Math.max(0, Math.trunc(Number(detectedCount) || 0)),
    );
    return getScan(id);
  }

  function listScans(limit = 30) {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 30)));
    const rows = db
      .prepare(
        `SELECT id, image_filename, scale_reference, measured_mm, model_used,
                scene_summary, detected_count, created_at
         FROM scans
         ORDER BY datetime(created_at) DESC, rowid DESC
         LIMIT ?`,
      )
      .all(safeLimit);
    return rows.map((row) => ({
      ...row,
      image_url: row.image_filename ? `/api/uploads/${row.image_filename}` : null,
    }));
  }

  function getScan(id) {
    const row = db.prepare(`SELECT * FROM scans WHERE id = ?`).get(String(id));
    return deserializeScan(row);
  }

  function deleteScan(id) {
    const existing = db.prepare(`SELECT id, image_filename FROM scans WHERE id = ?`).get(String(id));
    if (!existing) return { deleted: false, orphanImage: null };

    db.prepare(`DELETE FROM scans WHERE id = ?`).run(String(id));

    const remainingScanRef = db
      .prepare(`SELECT COUNT(*) AS cnt FROM scans WHERE image_filename = ?`)
      .get(existing.image_filename);
    const remainingBitRef = db
      .prepare(`SELECT COUNT(*) AS cnt FROM bits WHERE image_filename = ?`)
      .get(existing.image_filename);

    const orphanImage =
      Number(remainingScanRef?.cnt || 0) === 0 && Number(remainingBitRef?.cnt || 0) === 0
        ? existing.image_filename
        : null;

    return { deleted: true, orphanImage };
  }

  function createBit(bitInput) {
    const { id, params } = prepareBitParams(bitInput);
    insertBitStmt.run(...params);
    return getBit(id);
  }

  function createBitsBatch(bitInputs = []) {
    if (!Array.isArray(bitInputs) || bitInputs.length === 0) return [];
    const createdIds = [];
    db.exec('BEGIN');
    try {
      for (const item of bitInputs) {
        const { id, params } = prepareBitParams(item);
        insertBitStmt.run(...params);
        createdIds.push(id);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return createdIds.map((id) => getBit(id)).filter(Boolean);
  }

  function getBit(id) {
    const row = db.prepare(`SELECT * FROM bits WHERE id = ?`).get(String(id));
    return deserializeBit(row);
  }

  function listBits({ q = '', category = '', manufacturer = '', location = '', condition = '', sort = 'updated' } = {}) {
    const clauses = [];
    const args = [];

    if (q && String(q).trim()) {
      const pattern = `%${String(q).trim().toLowerCase()}%`;
      clauses.push(
        `(LOWER(name) LIKE ? OR LOWER(size_primary) LIKE ? OR LOWER(size_normalized) LIKE ? OR LOWER(COALESCE(size_imperial, '')) LIKE ? OR LOWER(manufacturer) LIKE ? OR LOWER(COALESCE(subtype, '')) LIKE ? OR LOWER(COALESCE(markings_read, '')) LIKE ? OR LOWER(location) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ?)`,
      );
      for (let i = 0; i < 9; i += 1) args.push(pattern);
    }

    if (category && category !== 'all') {
      clauses.push(`category = ?`);
      args.push(normalizeCategory(category));
    }

    if (manufacturer && manufacturer !== 'all') {
      clauses.push(`LOWER(manufacturer) = LOWER(?)`);
      args.push(String(manufacturer).trim());
    }

    if (location && location !== 'all') {
      clauses.push(`LOWER(location) = LOWER(?)`);
      args.push(String(location).trim());
    }

    if (condition && condition !== 'all') {
      clauses.push(`condition = ?`);
      args.push(normalizeCondition(condition));
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    let orderSql = `ORDER BY datetime(updated_at) DESC, rowid DESC`;
    if (sort === 'size') {
      orderSql = `ORDER BY COALESCE(size_metric_mm, 999999) ASC, size_normalized ASC`;
    } else if (sort === 'name') {
      orderSql = `ORDER BY LOWER(name) ASC`;
    } else if (sort === 'location') {
      orderSql = `ORDER BY LOWER(location) ASC, COALESCE(size_metric_mm, 999999) ASC`;
    }

    const rows = db.prepare(`SELECT * FROM bits ${whereSql} ${orderSql}`).all(...args);
    return rows.map(deserializeBit);
  }

  function getFacets() {
    const locations = db
      .prepare(`SELECT DISTINCT location FROM bits WHERE location IS NOT NULL AND location != '' ORDER BY LOWER(location)`)
      .all()
      .map((r) => r.location);

    const manufacturers = db
      .prepare(
        `SELECT DISTINCT manufacturer FROM bits WHERE manufacturer IS NOT NULL AND manufacturer != '' ORDER BY LOWER(manufacturer)`,
      )
      .all()
      .map((r) => r.manufacturer);

    const categories = db
      .prepare(`SELECT category, COUNT(*) AS count, COALESCE(SUM(quantity), 0) AS total_qty FROM bits GROUP BY category ORDER BY count DESC`)
      .all();

    const summary = db
      .prepare(
        `SELECT
           COUNT(*) AS distinct_entries,
           COALESCE(SUM(quantity), 0) AS total_quantity,
           SUM(CASE WHEN condition IN ('Worn', 'Damaged') THEN 1 ELSE 0 END) AS needs_replacement
         FROM bits`,
      )
      .get();

    return {
      locations,
      manufacturers,
      categories,
      distinctEntries: Number(summary?.distinct_entries || 0),
      totalQuantity: Number(summary?.total_quantity || 0),
      needsReplacement: Number(summary?.needs_replacement || 0),
    };
  }

  function updateBit(id, patch = {}) {
    const existing = db.prepare(`SELECT * FROM bits WHERE id = ?`).get(String(id));
    if (!existing) return null;

    const updates = [];
    const args = [];

    const assign = (col, val) => {
      updates.push(`${col} = ?`);
      args.push(val);
    };

    if (patch.name !== undefined) {
      assign('name', String(patch.name).trim() || existing.name);
    }
    if (patch.category !== undefined) {
      assign('category', normalizeCategory(patch.category));
    }
    if (patch.subtype !== undefined) {
      assign('subtype', nullable(patch.subtype));
    }
    if (patch.size_primary !== undefined) {
      const rawSize = String(patch.size_primary).trim() || existing.size_primary;
      const norm = normalizeSize(rawSize) || rawSize;
      assign('size_primary', rawSize);
      assign('size_normalized', norm);
      if (patch.size_metric_mm === undefined) {
        const inferredMm = parseSizeToMm(norm);
        if (inferredMm !== null) assign('size_metric_mm', inferredMm);
      }
    }
    if (patch.size_imperial !== undefined) {
      assign('size_imperial', patch.size_imperial ? normalizeSize(patch.size_imperial) : null);
    }
    if (patch.size_metric_mm !== undefined) {
      const mm = nullableNumber(patch.size_metric_mm);
      assign('size_metric_mm', mm && mm > 0 ? mm : null);
    }
    if (patch.length_class !== undefined) assign('length_class', nullable(patch.length_class));
    if (patch.shank_type !== undefined) assign('shank_type', nullable(patch.shank_type));
    if (patch.material_coating !== undefined) assign('material_coating', nullable(patch.material_coating));
    if (patch.manufacturer !== undefined) {
      assign('manufacturer', String(patch.manufacturer || 'Unknown').trim() || 'Unknown');
    }
    if (patch.model_line !== undefined) assign('model_line', nullable(patch.model_line));
    if (patch.markings_read !== undefined) assign('markings_read', nullable(patch.markings_read));
    if (patch.condition !== undefined) assign('condition', normalizeCondition(patch.condition));
    if (patch.condition_notes !== undefined) assign('condition_notes', nullable(patch.condition_notes));
    if (patch.recommended_materials !== undefined) {
      const mats = Array.isArray(patch.recommended_materials)
        ? patch.recommended_materials.map((m) => String(m).trim()).filter(Boolean)
        : String(patch.recommended_materials || '')
            .split(',')
            .map((m) => m.trim())
            .filter(Boolean);
      assign('recommended_materials', JSON.stringify(mats));
    }
    if (patch.pilot_or_fastener !== undefined) assign('pilot_or_fastener', nullable(patch.pilot_or_fastener));
    if (patch.speed_rpm_tip !== undefined) assign('speed_rpm_tip', nullable(patch.speed_rpm_tip));
    if (patch.usage_notes !== undefined) assign('usage_notes', nullable(patch.usage_notes));
    if (patch.quantity !== undefined) {
      assign('quantity', Math.max(0, Math.min(9999, Math.round(Number(patch.quantity) || 0))));
    }
    if (patch.location !== undefined) {
      assign('location', String(patch.location || 'Main Drill Index').trim() || 'Main Drill Index');
    }
    if (patch.notes !== undefined) assign('notes', nullable(patch.notes));

    if (updates.length === 0) {
      return deserializeBit(existing);
    }

    updates.push(`updated_at = datetime('now')`);
    args.push(String(id));

    db.prepare(`UPDATE bits SET ${updates.join(', ')} WHERE id = ?`).run(...args);
    return getBit(id);
  }

  function deleteBit(id) {
    const existing = db.prepare(`SELECT id, image_filename FROM bits WHERE id = ?`).get(String(id));
    if (!existing) return { deleted: false, orphanImage: null };

    db.prepare(`DELETE FROM bits WHERE id = ?`).run(String(id));

    let orphanImage = null;
    if (existing.image_filename) {
      const scanRef = db
        .prepare(`SELECT COUNT(*) AS cnt FROM scans WHERE image_filename = ?`)
        .get(existing.image_filename);
      const bitRef = db
        .prepare(`SELECT COUNT(*) AS cnt FROM bits WHERE image_filename = ?`)
        .get(existing.image_filename);
      if (Number(scanRef?.cnt || 0) === 0 && Number(bitRef?.cnt || 0) === 0) {
        orphanImage = existing.image_filename;
      }
    }
    return { deleted: true, orphanImage };
  }

  function exportAllBits() {
    return listBits({ sort: 'location' });
  }

  function getStats() {
    const facets = getFacets();
    const scanCount = Number(db.prepare(`SELECT COUNT(*) AS cnt FROM scans`).get()?.cnt || 0);
    return {
      ...facets,
      scanCount,
      dbPath: resolvedDbPath,
      dataDir: resolvedDataDir,
    };
  }

  function close() {
    db.close();
  }

  return {
    dataDir: resolvedDataDir,
    uploadsDir,
    dbPath: resolvedDbPath,
    createScan,
    listScans,
    getScan,
    deleteScan,
    createBit,
    createBitsBatch,
    getBit,
    listBits,
    getFacets,
    updateBit,
    deleteBit,
    exportAllBits,
    getStats,
    close,
  };
}
