const SVG_NS = 'http://www.w3.org/2000/svg';

function applyAttrs(node, attrs) {
  if (!attrs) return;
  for (const [key, val] of Object.entries(attrs)) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'className') {
      node.className = String(val);
    } else if (key === 'text') {
      node.textContent = String(val);
    } else if (key === 'dataset' && typeof val === 'object') {
      for (const [dk, dv] of Object.entries(val)) {
        if (dv !== undefined && dv !== null) {
          node.dataset[dk] = String(dv);
        }
      }
    } else if (key.startsWith('on') && typeof val === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (val === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(val));
    }
  }
}

function appendChildren(node, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) {
      appendChildren(node, child);
    } else if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  appendChildren(node, children);
  return node;
}

export function svgEl(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (val === undefined || val === null || val === false) continue;
      if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else {
        node.setAttribute(key, String(val));
      }
    }
  }
  appendChildren(node, children);
  return node;
}

export function clearAndAppend(parent, ...children) {
  const nodes = [];
  const collect = (items) => {
    for (const item of items) {
      if (item === undefined || item === null || item === false) continue;
      if (Array.isArray(item)) {
        collect(item);
      } else if (item instanceof Node) {
        nodes.push(item);
      } else {
        nodes.push(document.createTextNode(String(item)));
      }
    }
  };
  collect(children);
  parent.replaceChildren(...nodes);
}
