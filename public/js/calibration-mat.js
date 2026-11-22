import { clearAndAppend, el, svgEl } from './dom.js';

const REFERENCE_SIZES = [
  { label: '1/16" (1.59mm)', mm: 1.59 },
  { label: '3/32" (2.38mm)', mm: 2.38 },
  { label: '1/8" (3.18mm)', mm: 3.18 },
  { label: '5/32" (3.97mm)', mm: 3.97 },
  { label: '3/16" (4.76mm)', mm: 4.76 },
  { label: '7/32" (5.56mm)', mm: 5.56 },
  { label: '1/4" (6.35mm)', mm: 6.35 },
  { label: '5/16" (7.94mm)', mm: 7.94 },
  { label: '3/8" (9.53mm)', mm: 9.53 },
  { label: '7/16" (11.11mm)', mm: 11.11 },
  { label: '1/2" (12.70mm)', mm: 12.7 },
  { label: '3mm', mm: 3.0 },
  { label: '4mm', mm: 4.0 },
  { label: '5mm', mm: 5.0 },
  { label: '6mm', mm: 6.0 },
  { label: '8mm', mm: 8.0 },
  { label: '10mm', mm: 10.0 },
  { label: '12mm', mm: 12.0 },
];

function buildGauges() {
  const container = document.getElementById('diameter-gauges');
  const rows = REFERENCE_SIZES.map((item) => {
    const bar = el('span', { className: 'gauge-bar' });
    bar.style.height = `${item.mm}mm`;
    return el('div', { className: 'gauge-row' }, bar, el('span', null, item.label));
  });
  clearAndAppend(container, rows);
}

function buildMetricRuler() {
  const svg = document.getElementById('metric-ruler-svg');
  const children = [
    svgEl('text', { x: 4, y: 17, 'font-size': 3.2, 'font-weight': 700, fill: '#0f172a' }, 'METRIC (mm)'),
  ];
  const offset = 10;
  for (let mm = 0; mm <= 160; mm += 1) {
    const x = offset + mm;
    const isMajor = mm % 10 === 0;
    const isMid = mm % 5 === 0;
    const tickH = isMajor ? 8 : isMid ? 5.5 : 3.2;
    children.push(
      svgEl('line', {
        x1: x,
        y1: 0,
        x2: x,
        y2: tickH,
        stroke: '#0f172a',
        'stroke-width': isMajor ? 0.45 : 0.25,
      }),
    );
    if (isMajor) {
      children.push(
        svgEl(
          'text',
          {
            x,
            y: 12.2,
            'text-anchor': 'middle',
            'font-size': 3,
            'font-weight': 700,
            fill: '#0f172a',
          },
          String(mm),
        ),
      );
    }
  }
  clearAndAppend(svg, children);
}

function buildImperialRuler() {
  const svg = document.getElementById('imperial-ruler-svg');
  const children = [
    svgEl('text', { x: 4, y: 17, 'font-size': 3.2, 'font-weight': 700, fill: '#0f172a' }, 'IMPERIAL (inches · 1/16")'),
  ];
  const offset = 10;
  const totalSixteenths = 6 * 16; // 6 inches = 152.4 mm
  for (let s = 0; s <= totalSixteenths; s += 1) {
    const x = offset + (s / 16) * 25.4;
    const isInch = s % 16 === 0;
    const isHalf = s % 8 === 0;
    const isQuarter = s % 4 === 0;
    const isEighth = s % 2 === 0;
    const tickH = isInch ? 8.5 : isHalf ? 6.8 : isQuarter ? 5.2 : isEighth ? 4 : 2.6;
    children.push(
      svgEl('line', {
        x1: x.toFixed(3),
        y1: 0,
        x2: x.toFixed(3),
        y2: tickH,
        stroke: '#0f172a',
        'stroke-width': isInch ? 0.45 : 0.25,
      }),
    );
    if (isInch) {
      children.push(
        svgEl(
          'text',
          {
            x: x.toFixed(3),
            y: 12.4,
            'text-anchor': 'middle',
            'font-size': 3.2,
            'font-weight': 700,
            fill: '#0f172a',
          },
          `${s / 16}"`,
        ),
      );
    }
  }
  clearAndAppend(svg, children);
}

buildGauges();
buildMetricRuler();
buildImperialRuler();

document.getElementById('btn-print-mat').addEventListener('click', () => {
  window.print();
});
