async function request(url, options = {}) {
  const init = {
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  };
  const response = await fetch(url, init);
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;

  if (!response.ok) {
    const err = new Error(data?.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const api = {
  getHealth: () => request('/api/health'),
  getConfig: () => request('/api/config'),

  scanImage: (payload) =>
    request('/api/scan', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  listScans: (limit = 30) => request(`/api/scans?limit=${encodeURIComponent(limit)}`),
  getScan: (id) => request(`/api/scans/${encodeURIComponent(id)}`),
  deleteScan: (id) => request(`/api/scans/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listBits: (filters = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '' && v !== 'all') {
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    return request(qs ? `/api/bits?${qs}` : '/api/bits');
  },

  createBit: (payload) =>
    request('/api/bits', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  createBitsBatch: (bits) =>
    request('/api/bits/batch', {
      method: 'POST',
      body: JSON.stringify({ bits }),
    }),

  updateBit: (id, patch) =>
    request(`/api/bits/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteBit: (id) =>
    request(`/api/bits/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  getSets: () => request('/api/sets'),
};
