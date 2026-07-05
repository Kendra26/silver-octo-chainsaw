// Pure JSON-wrangling helpers, ported unchanged in behavior from the
// original vanilla-JS build (span finding, deep array discovery,
// path get/set, and the date-based deep sort).

export function findJsonSpans(text) {
  const found = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '{' || c === '[') {
      const res = tryMatch(text, i);
      if (res) {
        found.push(res);
        i = res.end + 1;
        continue;
      }
    }
    i++;
  }
  return found;
}

function tryMatch(text, start) {
  const stack = [];
  let inString = false;
  let escape = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if (ch === '}' || ch === ']') {
      if (stack.length === 0) return null;
      const open = stack.pop();
      if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) return null;
      if (stack.length === 0) {
        const substr = text.slice(start, j + 1);
        try {
          const val = JSON.parse(substr);
          return { start, end: j, text: substr, value: val, length: substr.length };
        } catch (e) {
          return null;
        }
      }
    }
  }
  return null;
}

export function describeSpan(span) {
  const v = span.value;
  if (Array.isArray(v)) return `array · ${v.length} item${v.length === 1 ? '' : 's'}`;
  if (v && typeof v === 'object') return `object · ${Object.keys(v).length} key${Object.keys(v).length === 1 ? '' : 's'}`;
  return typeof v;
}

export function findArraysDeep(root) {
  const results = [];
  function walk(val, path) {
    if (Array.isArray(val)) {
      results.push({ path: path.slice(), arr: val });
      val.forEach((item, idx) => {
        if (item && typeof item === 'object') walk(item, path.concat(idx));
      });
    } else if (val && typeof val === 'object') {
      Object.keys(val).forEach((k) => walk(val[k], path.concat(k)));
    }
  }
  walk(root, []);
  return results;
}

export function pathLabel(path) {
  if (path.length === 0) return '(root)';
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : (i === 0 ? p : `.${p}`))).join('');
}

export function getAtPath(obj, path) {
  let cur = obj;
  for (const key of path) cur = cur[key];
  return cur;
}

export function setAtPath(obj, path, value) {
  if (path.length === 0) return value;
  const clone = JSON.parse(JSON.stringify(obj));
  let cur = clone;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = value;
  return clone;
}

export function applyDateTimeSortingDeep(inputVal, sortDirection) {
  if (sortDirection === 'none' || !inputVal) return inputVal;
  const cloned = JSON.parse(JSON.stringify(inputVal));

  function sortArrayInline(arr) {
    if (!Array.isArray(arr)) return;
    const elementsHaveDates = arr.some(
      (item) => item && typeof item === 'object' && (item.createdDateTime || item.created_at)
    );
    if (elementsHaveDates) {
      arr.sort((a, b) => {
        const dateA = a ? (a.createdDateTime || a.created_at || '') : '';
        const dateB = b ? (b.createdDateTime || b.created_at || '') : '';
        const timeA = dateA ? new Date(dateA).getTime() : 0;
        const timeB = dateB ? new Date(dateB).getTime() : 0;
        return sortDirection === 'desc' ? timeB - timeA : timeA - timeB;
      });
    }
    arr.forEach((element) => {
      if (element && typeof element === 'object') walkAndSort(element);
    });
  }

  function walkAndSort(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      sortArrayInline(node);
    } else {
      Object.keys(node).forEach((key) => {
        if (Array.isArray(node[key])) sortArrayInline(node[key]);
        else if (node[key] && typeof node[key] === 'object') walkAndSort(node[key]);
      });
    }
  }

  if (Array.isArray(cloned)) sortArrayInline(cloned);
  else walkAndSort(cloned);

  return cloned;
}

export function formatJSON(val, minify) {
  return minify ? JSON.stringify(val) : JSON.stringify(val, null, 2);
}
