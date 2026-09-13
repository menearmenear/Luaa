/* Minimal DOM + mini HTML parser for headless engine testing.
   Provides just enough of the DOM API the engine touches. */
"use strict";

const VOID = new Set(["br", "img", "input", "hr", "meta", "link"]);

function dec(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

function ctx2dStub() {
  const noop = () => {};
  return {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    fillRect: noop, strokeRect: noop, clearRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop,
    arc: noop, closePath: noop, fillText: noop,
  };
}

function matches(el, sel) {
  sel = sel.trim();
  let rest = sel, cls = null, tag = null, attr = null;
  const attrM = /^([^\[\]]+)\[([^\]]*data-[^=]+)="([^"]+)"\]/.exec(sel);
  if (attrM) { tag = attrM[1].trim(); attr = { key: attrM[2], val: attrM[3] }; rest = ""; }
  else {
    const parts = sel.split(".");
    tag = parts[0] || null;
    cls = parts.slice(1).join(" ");
  }
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  if (cls) { const s = new Set(clas(el)); for (const c of cls.split(/\s+/)) { if (c && !s.has(c)) return false; } }
  if (attr && el.getAttribute(attr.key) !== attr.val) return false;
  return true;
}

function clas(el) {
  return (el.className || "").split(/\s+/).filter(Boolean);
}

function descendants(el, out) {
  for (const c of el.children) { out.push(c); descendants(c, out); }
  return out;
}

function makeEl(tag, id, opts) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: id || null,
    children: [],
    parentElement: null,
    _classes: new Set(),
    _events: {},
    _attrs: {},
    textContent: "",
    innerHTML: "",
    value: "",
    style: {},
    className: "",
    scrollTop: 0, scrollLeft: 0, scrollHeight: 0,
    _t: null,
  };
  el.classList = {
    add: (...cs) => { for (const c of cs) el._classes.add(c); el._sync(); },
    remove: (...cs) => { for (const c of cs) el._classes.delete(c); el._sync(); },
    toggle: (c, on) => { if (on === undefined) { if (el._classes.has(c)) el._classes.delete(c); else el._classes.add(c); } else if (on) el._classes.add(c); else el._classes.delete(c); el._sync(); },
    contains: (c) => el._classes.has(c),
  };
  el._sync = () => { el.className = Array.from(el._classes).join(" "); };
  el.getAttribute = (k) => (k in el._attrs ? el._attrs[k] : null);
  el.setAttribute = (k, v) => { el._attrs[k] = v; };
  el.addEventListener = (ev, fn) => { (el._events[ev] = el._events[ev] || []).push(fn); };
  el.appendChild = (c) => { c.parentElement = el; el.children.push(c); return c; };
  el.insertBefore = (c, ref) => { c.parentElement = el; const i = el.children.indexOf(ref); el.children.splice(i < 0 ? el.children.length : i, 0, c); return c; };
  el.removeChild = (c) => { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); c.parentElement = null; return c; };
  el.querySelector = (sel) => descendants(el, []).find((d) => matches(d, sel)) || null;
  el.querySelectorAll = (sel) => descendants(el, []).filter((d) => matches(d, sel));
  el.getContext = () => ctx2dStub();
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: 300 });
  el.focus = () => {};
  el.select = () => {};
  if (opts) Object.assign(el, opts);
  return el;
}

function parseHTML(html) {
  const root = makeEl("body", null, { _classes: new Set(["body"]) });
  const idMap = {};
  const stack = [root];
  let i = 0, n = html.length;
  const textBuf = [];
  const flushText = () => {
    if (!textBuf.length) return;
    const txt = textBuf.join("");
    if (txt.trim()) {
      const host = stack[stack.length - 1];
      if (host.tagName === "TEXTAREA") host.value += dec(txt);
      else host.textContent += txt;
    }
    textBuf.length = 0;
  };
  while (i < n) {
    const c = html[i];
    if (c === "<") {
      if (html.slice(i, i + 4) === "<!--") {
        const end = html.indexOf("-->", i + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      if (html[i + 1] === "/") {
        flushText();
        const end = html.indexOf(">", i);
        const name = html.slice(i + 2, end).trim().split(/\s+/)[0].toUpperCase();
        for (let k = stack.length - 1; k >= 0; k--) {
          if (stack[k].tagName === name) { stack.length = k; break; }
        }
        i = end + 1;
        continue;
      }
      flushText();
      const end = html.indexOf(">", i);
      const raw = html.slice(i + 1, end);
      const m = /^([A-Za-z0-9]+)/.exec(raw);
      const tag = (m ? m[1] : "div").toLowerCase();
      if (tag === "script") { const ce = html.indexOf("</script>", i); i = ce < 0 ? n : ce + 9; continue; }
      const el = makeEl(tag);
      const am = /id="([^"]*)"/.exec(raw); if (am) { el.id = am[1]; idMap[am[1]] = el; }
      const cm = /class="([^"]*)"/.exec(raw); if (cm) { for (const c of cm[1].split(/\s+/)) if (c) el._classes.add(c); el._sync(); }
      const sm = /style="([^"]*)"/.exec(raw); if (sm) for (const kv of sm[1].split(";")) { const p = kv.split(":"); if (p.length === 2) el.style[p[0].trim()] = p[1].trim(); }
      const dm = /data-([a-z-]+)="([^"]*)"/.exec(raw); if (dm) el._attrs["data-" + dm[1]] = dm[2];
      if (stack[stack.length - 1]) stack[stack.length - 1].appendChild(el);
      if (!VOID.has(tag)) stack.push(el);
      i = end + 1;
      continue;
    }
    textBuf.push(c);
    i++;
  }
  flushText();
  return { root, getElementById: (id) => idMap[id] || null, idMap };
}

module.exports = { parseHTML, makeEl, ctx2dStub };