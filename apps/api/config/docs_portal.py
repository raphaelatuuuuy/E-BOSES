"""Documentation portal for the E-Boses API.

/api/docs/ serves a custom, dependency-free portal modelled on the references
the team picked:

* Header follows Postman's API-documentation page: light top bar with brand,
  centered search, utility links and one orange call-to-action.
* Everything below follows the Kimi Platform API docs: dark theme, sticky
  Guides / API Reference tab row, grouped left sidebar with colored method
  badges, an "API Overview" landing page (Service Address, Authentication,
  Error Handling, endpoint table, next steps) and per-endpoint pages with
  Example Value / Model response tabs.

The classic Swagger UI stays at /api/swagger/ and the raw OpenAPI document is
linked as doc.json.
"""

import html

from django.conf import settings
from django.http import HttpResponse
from drf_spectacular.views import SpectacularSwaggerView

PORTAL_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>E-Boses API documentation</title>
<style>
  :root {
    --bg: #0a0b0d; --panel: #101216; --code: #14161a; --border: #23262b;
    --text: #e8eaed; --dim: #9aa3ad; --accent: #f2600c;
    --get: #2da44e; --post: #2f6feb; --put: #9a6700; --patch: #8250df; --delete: #cf222e;
    --ok: #2da44e; --warn: #9a6700; --err: #cf222e;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; font-size: 15px; line-height: 1.6; }
  a { color: inherit; }

  /* ---- Postman-style light header ---- */
  .top { background: #ffffff; color: #17202e; border-bottom: 1px solid #e6e8eb; }
  .top-inner { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; gap: 20px; padding: 10px 24px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; text-decoration: none; white-space: nowrap; }
  .brand .mark { background: var(--accent); color: #fff; border-radius: 8px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; letter-spacing: .02em; }
  .brand .sub { color: #5b6570; font-weight: 500; }
  .search { flex: 1; max-width: 460px; display: flex; align-items: center; gap: 8px; background: #f3f4f6; border: 1px solid #e2e5e9; border-radius: 8px; padding: 6px 10px; color: #5b6570; }
  .search:focus-within { border-color: var(--accent); }
  .search input { flex: 1; border: 0; background: transparent; outline: none; font-size: 14px; color: #17202e; }
  .search kbd { font-family: inherit; font-size: 11px; border: 1px solid #d5d9de; border-radius: 5px; padding: 1px 6px; color: #7a828c; background: #fff; }
  .top-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .top-actions a.util { color: #4070a0; text-decoration: none; font-size: 14px; padding: 6px 10px; border-radius: 8px; white-space: nowrap; }
  .top-actions a.util:hover { background: #f3f4f6; }
  .cta { background: var(--accent); color: #fff !important; text-decoration: none; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: 8px; white-space: nowrap; }
  .cta:hover { filter: brightness(1.08); }

  /* ---- Kimi-style dark tab row ---- */
  .tabs { background: var(--bg); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; }
  .tabs-inner { max-width: 1440px; margin: 0 auto; display: flex; align-items: center; gap: 4px; padding: 0 24px; }
  .tabs a { text-decoration: none; color: var(--dim); font-size: 14px; padding: 12px 14px; border-bottom: 2px solid transparent; }
  .tabs a.active { color: var(--text); border-bottom-color: var(--text); font-weight: 600; }
  .tabs .right { margin-left: auto; display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--dim); }
  .tabs .right a { color: var(--dim); padding: 0; border: 0; }
  .tabs .right a:hover { color: var(--text); }
  .chip { border: 1px solid var(--border); border-radius: 999px; padding: 1px 10px; font-size: 12px; }

  /* ---- Layout ---- */
  .shell { max-width: 1440px; margin: 0 auto; display: grid; grid-template-columns: 300px minmax(0, 1fr); }
  .sidebar { border-right: 1px solid var(--border); padding: 20px 14px 60px; position: sticky; top: 47px; height: calc(100vh - 47px); overflow-y: auto; }
  .group-title { color: var(--dim); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; margin: 22px 10px 8px; }
  .nav-link { display: block; padding: 6px 10px; border-radius: 8px; text-decoration: none; color: var(--text); font-size: 14px; }
  .nav-link:hover { background: var(--panel); }
  .nav-link.active { background: #1b1e24; }
  .nav-op { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-radius: 8px; text-decoration: none; color: var(--text); font-size: 13.5px; cursor: pointer; }
  .nav-op:hover { background: var(--panel); }
  .nav-op.active { background: #1b1e24; }
  .nav-op .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  main { padding: 34px 44px 90px; min-width: 0; }
  .page { max-width: 880px; }

  @media (max-width: 960px) {
    .shell { grid-template-columns: 1fr; }
    .sidebar { display: none; }
    main { padding: 24px 18px 70px; }
    .search { display: none; }
  }

  /* ---- Content ---- */
  .crumb { color: var(--dim); font-size: 13px; margin-bottom: 6px; }
  h1 { font-size: 34px; line-height: 1.2; margin: 0 0 10px; letter-spacing: -0.01em; }
  h2 { font-size: 22px; margin: 38px 0 10px; letter-spacing: -0.01em; }
  h3 { font-size: 17px; margin: 26px 0 8px; }
  p { color: #c9ced4; margin: 8px 0; }
  .lede { font-size: 16px; color: var(--dim); }
  .page-head { display: flex; align-items: flex-start; gap: 14px; justify-content: space-between; }
  .copy-page { border: 1px solid var(--border); background: transparent; color: var(--text); border-radius: 8px; padding: 7px 12px; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
  .copy-page:hover { border-color: #3a3f47; background: var(--panel); }

  .code { position: relative; background: var(--code); border: 1px solid var(--border); border-radius: 10px; margin: 12px 0; }
  .code pre { margin: 0; padding: 14px 16px; overflow-x: auto; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 13px; line-height: 1.55; color: #dce1e7; }
  .code .copy { position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity .15s; border: 1px solid var(--border); background: var(--bg); color: var(--dim); border-radius: 6px; font-size: 12px; padding: 3px 9px; cursor: pointer; }
  .code:hover .copy { opacity: 1; }
  .code .copy:hover { color: var(--text); border-color: #3a3f47; }

  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th { text-align: left; color: var(--dim); font-weight: 600; font-size: 13px; }
  th, td { border-bottom: 1px solid var(--border); padding: 9px 12px 9px 0; vertical-align: top; }
  tr.link-row { cursor: pointer; }
  tr.link-row:hover td { background: var(--panel); }
  td code, p code, li code { background: var(--code); border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px; font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; color: #e3e7ec; }

  .badge { display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .04em; border-radius: 6px; padding: 2px 8px; min-width: 44px; }
  .badge.get { background: var(--get); } .badge.post { background: var(--post); }
  .badge.put { background: var(--put); } .badge.patch { background: var(--patch); }
  .badge.delete { background: var(--delete); }
  .badge.small { min-width: 38px; font-size: 10px; padding: 1px 6px; }

  .pathline { display: flex; align-items: center; gap: 10px; background: var(--code); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin: 14px 0; font-family: ui-monospace, Consolas, monospace; font-size: 14px; }
  .pathline .copy { margin-left: auto; border: 1px solid var(--border); background: transparent; color: var(--dim); border-radius: 6px; font-size: 12px; padding: 3px 9px; cursor: pointer; }
  .pathline .copy:hover { color: var(--text); }

  .status-pill { display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 12px; font-weight: 700; padding: 2px 9px; min-width: 42px; color: #fff; }
  .s2 { background: var(--ok); } .s3 { background: var(--post); } .s4 { background: var(--warn); } .s5 { background: var(--err); }

  .resp { border: 1px solid var(--border); border-radius: 10px; margin: 14px 0; overflow: hidden; }
  .resp-head { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: var(--panel); font-size: 14px; }
  .resp-head .desc { color: var(--dim); }
  .resp-body { padding: 0 14px 14px; }
  .resp-tabs { display: flex; gap: 18px; border-bottom: 1px solid var(--border); margin-top: 4px; }
  .resp-tab { background: none; border: 0; color: var(--dim); font-size: 13px; padding: 8px 2px; cursor: pointer; border-bottom: 2px solid transparent; }
  .resp-tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .resp-pane { display: none; }
  .resp-pane.active { display: block; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 14px 0; }
  .card { border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-decoration: none; background: var(--panel); }
  .card:hover { border-color: #3a3f47; }
  .card .t { font-weight: 700; margin-bottom: 4px; }
  .card .d { color: var(--dim); font-size: 13.5px; }

  .note { border-left: 3px solid var(--accent); background: var(--panel); border-radius: 0 10px 10px 0; padding: 10px 14px; color: #c9ced4; font-size: 14px; margin: 14px 0; }
  .empty { color: var(--dim); font-style: italic; }
  .toast { position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); background: #1b1e24; border: 1px solid var(--border); color: var(--text); border-radius: 10px; padding: 8px 16px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 50; }
  .toast.show { opacity: 1; }
</style>
</head>
<body>

<header class="top">
  <div class="top-inner">
    <a class="brand" href="#/overview"><span class="mark">EB</span> E-Boses <span class="sub">API docs</span></a>
    <div class="search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="search" type="text" placeholder="Search endpoints..." autocomplete="off" />
      <kbd>Ctrl K</kbd>
    </div>
    <nav class="top-actions">
      <a class="util" href="/api/health/" target="_blank" rel="noopener">System status</a>
      <a class="util" href="mailto:__EMAIL__?subject=E-Boses%20API%20support">Support</a>
      <a class="util" href="/api/swagger/" target="_blank" rel="noopener">Swagger UI</a>
      <a class="cta" href="__WEBSITE__" target="_blank" rel="noopener">E-Boses Website</a>
    </nav>
  </div>
</header>

<div class="tabs">
  <div class="tabs-inner">
    <a href="#/overview" data-tab="guides">Guides</a>
    <a href="#/endpoints" data-tab="reference">API Reference</a>
    <div class="right">
      <a href="/api/schema/?format=json" target="_blank" rel="noopener">doc.json</a>
      <span class="chip">v__VERSION__</span>
    </div>
  </div>
</div>

<div class="shell">
  <aside class="sidebar" id="sidebar"></aside>
  <main><div class="page" id="main"></div></main>
</div>

<div class="toast" id="toast">Copied</div>

<script>
const SPEC_URL = "/api/schema/?format=json";
const METHOD_ORDER = { get: 0, post: 1, put: 2, patch: 3, delete: 4 };
let SPEC = null;

const $main = document.getElementById("main");
const $sidebar = document.getElementById("sidebar");
const $toast = document.getElementById("toast");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function toast(msg) {
  $toast.textContent = msg; $toast.classList.add("show");
  setTimeout(() => $toast.classList.remove("show"), 1200);
}
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => toast("Copied")).catch(() => toast("Copy failed"));
}
function mdLite(s) {
  if (!s) return "";
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\n/g, "<br>");
  return out;
}
function badge(method, small) {
  const m = method.toLowerCase();
  return '<span class="badge ' + m + (small ? " small" : "") + '">' + method.toUpperCase() + "</span>";
}
function statusPill(code) {
  const c = String(code)[0];
  return '<span class="status-pill s' + c + '">' + esc(code) + "</span>";
}
function codeBlock(text) {
  const id = "cb" + Math.random().toString(36).slice(2);
  return '<div class="code"><button class="copy" data-copy-id="' + id + '">Copy</button><pre id="' + id + '">' + esc(text) + "</pre></div>";
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy-id]");
  if (btn) copyText(document.getElementById(btn.dataset.copyId).textContent);
  const row = e.target.closest("tr[data-op]");
  if (row) location.hash = row.dataset.op;
});

/* ---------- schema helpers ---------- */
function components() { return (SPEC.components && SPEC.components.schemas) || {}; }
function resolveRef(ref) {
  const name = ref.replace("#/components/schemas/", "").replace(/~1/g, "/").replace(/~0/g, "~");
  return components()[name] || {};
}
function eachOp(fn) {
  const paths = SPEC.paths || {};
  for (const path of Object.keys(paths).sort()) {
    const item = paths[path];
    for (const method of Object.keys(item)) {
      if (!(method in METHOD_ORDER)) continue;
      fn(item[method], method, path);
    }
  }
}
function sortedOps() {
  const ops = [];
  eachOp((op, method, path) => ops.push({ op, method, path }));
  ops.sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER[a.method] - METHOD_ORDER[b.method]);
  return ops;
}
function opKey(method, path) { return "#op=" + encodeURIComponent(method.toUpperCase() + " " + path); }
function findOp(method, path) { return ((SPEC.paths || {})[path] || {})[method.toLowerCase()] || null; }
function firstTag(op) { return (op.tags && op.tags[0]) || "api"; }

/* Walk a schema into an example value ("example") or a type-shaped model ("model"). */
function walk(schema, mode, depth) {
  depth = depth || 0;
  if (!schema || depth > 8) return mode === "model" ? "…" : null;
  if (schema.$ref) return walk(resolveRef(schema.$ref), mode, depth + 1);
  if (schema.allOf) {
    const merged = { type: "object", properties: {}, required: [] };
    for (const part of schema.allOf) {
      const r = part.$ref ? resolveRef(part.$ref) : part;
      Object.assign(merged.properties, r.properties || {});
      merged.required.push(...(r.required || []));
    }
    return walk(merged, mode, depth + 1);
  }
  const branches = schema.oneOf || schema.anyOf;
  if (branches) {
    if (mode === "model") return branches.map(b => walk(b, mode, depth + 1));
    return walk(branches[0], mode, depth + 1);
  }
  if (schema.example !== undefined) return schema.example;
  if (mode !== "model" && schema.default !== undefined) return schema.default;
  if (schema.enum) {
    if (mode === "model") return schema.enum.join(" | ");
    return schema.enum[0];
  }
  let t = schema.type;
  if (!t) t = schema.properties ? "object" : schema.items ? "array" : null;
  switch (t) {
    case "object": {
      const obj = {};
      for (const [k, v] of Object.entries(schema.properties || {})) obj[k] = walk(v, mode, depth + 1);
      if (!Object.keys(obj).length) return mode === "model" ? "{string: any}" : {};
      return obj;
    }
    case "array": return [walk(schema.items, mode, depth + 1)];
    case "string": {
      if (mode === "model") return "string";
      switch (schema.format) {
        case "date-time": return new Date().toISOString();
        case "date": return new Date().toISOString().slice(0, 10);
        case "uuid": return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        case "email": return "user@example.com";
        case "uri": return "https://example.com";
        case "binary": return "<binary file>";
        case "password": return "s3cre7!pass";
        default: return "string";
      }
    }
    case "integer": return mode === "model" ? "integer" : 0;
    case "number": return mode === "model" ? "number" : 0;
    case "boolean": return mode === "model" ? "boolean" : true;
    default: return mode === "model" ? (t || "any") : null;
  }
}
function jsonPretty(value) { return JSON.stringify(value, null, 2); }

function exampleModelTabs(mediaType) {
  const schema = mediaType.schema || {};
  const exampleText = jsonPretty(walk(schema, "example"));
  const modelText = jsonPretty(walk(schema, "model"));
  const id = "t" + Math.random().toString(36).slice(2);
  return '<div class="em-tabs">' +
    '<div class="resp-tabs">' +
    '<button class="resp-tab active" data-pane="' + id + '-ex">Example Value</button>' +
    '<button class="resp-tab" data-pane="' + id + '-model">Model</button></div>' +
    '<div class="resp-pane active" id="' + id + '-ex">' + codeBlock(exampleText) + "</div>" +
    '<div class="resp-pane" id="' + id + '-model">' + codeBlock(modelText) + "</div></div>";
}
document.addEventListener("click", (e) => {
  const tab = e.target.closest(".resp-tab");
  if (!tab) return;
  const wrap = tab.closest(".em-tabs");
  wrap.querySelectorAll(".resp-tab").forEach(t => t.classList.toggle("active", t === tab));
  wrap.querySelectorAll(".resp-pane").forEach(p => p.classList.toggle("active", p.id === tab.dataset.pane));
});

function copyPageButton() {
  return '<button class="copy-page" onclick="copyText(document.getElementById(\'main\').innerText)">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
    + "Copy page</button>";
}

/* ---------- sidebar ---------- */
function buildSidebar() {
  const guides = [
    ["/overview", null, "API Overview"],
    ["/overview", "service-address", "Service Address"],
    ["/overview", "authentication", "Authentication"],
    ["/overview", "error-handling", "Error Handling"],
    ["/overview", "pagination", "Pagination"],
  ];
  let html = '<div class="group-title">Using the API</div>';
  for (const [route, anchor, label] of guides) {
    html += '<a class="nav-link" data-guide="' + (anchor || "") + '" href="#' + route + '">' + esc(label) + "</a>";
  }
  html += '<div class="group-title">API Reference</div>';
  const byTag = {};
  for (const { op, method, path } of sortedOps()) {
    const tag = firstTag(op);
    (byTag[tag] = byTag[tag] || []).push({ op, method, path });
  }
  const tagNames = (SPEC.tags || []).map(t => t.name).filter(n => byTag[n]).concat(
    Object.keys(byTag).filter(n => !(SPEC.tags || []).some(t => t.name === n)));
  for (const tag of tagNames) {
    html += '<div class="group-title" style="text-transform:none;letter-spacing:0;font-size:13px;color:var(--text)">' + esc(tag) + "</div>";
    for (const { op, method, path } of byTag[tag]) {
      const label = op.summary || path;
      html += '<a class="nav-op" data-op="' + esc(opKey(method, path)) + '" data-search="' + esc((label + " " + path + " " + method).toLowerCase()) + '">'
        + badge(method, true) + '<span class="label">' + esc(label) + "</span></a>";
    }
  }
  $sidebar.innerHTML = html;
  $sidebar.addEventListener("click", (e) => {
    const link = e.target.closest(".nav-link[data-guide]");
    if (link && link.dataset.guide) {
      e.preventDefault();
      location.hash = "#/overview";
      setTimeout(() => {
        const target = document.getElementById(link.dataset.guide);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 30);
    }
  });
}

/* ---------- pages ---------- */
function pageHead(crumb, title, lede) {
  return '<div class="crumb">' + esc(crumb) + '</div>'
    + '<div class="page-head"><div><h1>' + esc(title) + "</h1>" + (lede ? '<p class="lede">' + lede + "</p>" : "") + "</div>" + copyPageButton() + "</div>";
}

function renderOverview() {
  const base = location.origin;
  const tagNames = (SPEC.tags || []);
  let endpointRows = "";
  for (const tag of tagNames) {
    endpointRows += '<tr><td colspan="3" style="color:var(--dim);font-weight:700;padding-top:18px">' + esc(tag.name) + "</td></tr>";
    for (const { op, method, path } of sortedOps().filter(o => firstTag(o.op) === tag.name)) {
      endpointRows += '<tr class="link-row" data-op="' + esc(opKey(method, path)) + '"><td style="width:70px">' + badge(method, true)
        + '</td><td><code>' + esc(path) + "</code></td><td>" + esc(op.summary || "") + "</td></tr>";
    }
  }
  $main.innerHTML =
    pageHead("Using the API", "API Overview",
      "Review the E-Boses API base URL, authentication, request conventions and the full endpoint index.")
    + '<h2 id="service-address">Service Address</h2>'
    + codeBlock(base)
    + "<p>All endpoints below are served from this address under the <code>/api</code> prefix. "
    + "The API speaks JSON; photo uploads use <code>multipart/form-data</code>.</p>"
    + '<h2 id="authentication">Authentication</h2>'
    + "<p>Log in at <code>POST /api/auth/login/</code> with <code>identifier</code> (email <strong>or</strong> phone) and <code>password</code>. "
    + "The response carries a short-lived <code>access</code> JWT; the long-lived <code>refresh</code> token rides an HttpOnly cookie.</p>"
    + codeBlock("Authorization: Bearer <access>")
    + '<div class="note">Tokens refresh at <code>POST /api/auth/refresh/</code>. Login and OTP endpoints are rate limited; '
    + "send <code>Authorization</code> on every authenticated call.</div>"
    + '<h2 id="error-handling">Error Handling</h2>'
    + "<p>Errors answer with DRF shapes: <code>{detail: \"...\"}</code> for general failures or <code>{field: [\"message\"]}</code> for validation. "
    + "Every operation documents 401 / 403 / 500 with example bodies.</p>"
    + "<table><tr><th>Status</th><th>Meaning</th></tr>"
    + "<tr><td>" + statusPill("400") + "</td><td>Validation failed — field errors or <code>detail</code></td></tr>"
    + "<tr><td>" + statusPill("401") + "</td><td>Missing or expired bearer token</td></tr>"
    + "<tr><td>" + statusPill("403") + "</td><td>Authenticated, but not permitted</td></tr>"
    + "<tr><td>" + statusPill("429") + "</td><td>Throttled — retry later</td></tr>"
    + "<tr><td>" + statusPill("500") + "</td><td>Unexpected server error, logged for support</td></tr></table>"
    + codeBlock('{\n  "detail": "Authentication credentials were not provided."\n}')
    + '<h2 id="pagination">Pagination</h2>'
    + "<p>List endpoints accept <code>page</code> and <code>page_size</code> (max 100) and answer with an envelope:</p>"
    + codeBlock('{\n  "count": 42,\n  "next": "' + base + '/api/concerns/feed/?page=2",\n  "previous": null,\n  "results": [ ... ]\n}')
    + "<h2>API Endpoints</h2>"
    + "<table>" + endpointRows + "</table>"
    + "<h2>Next Steps</h2>"
    + '<div class="cards">'
    + '<a class="card" href="#op=' + encodeURIComponent("POST /api/auth/login/") + '"><div class="t">Quickstart</div><div class="d">Log in and send your first authenticated request</div></a>'
    + '<a class="card" href="#/endpoints"><div class="t">API Reference</div><div class="d">Browse every endpoint with examples and schemas</div></a>'
    + '<a class="card" href="/api/swagger/" target="_blank"><div class="t">Swagger UI</div><div class="d">Try requests straight from the browser</div></a>'
    + '<a class="card" href="mailto:__EMAIL__"><div class="t">Support</div><div class="d">Questions? Email the E-Boses team</div></a>'
    + "</div>";
}

function renderEndpoints() {
  let rows = "";
  for (const { op, method, path } of sortedOps()) {
    rows += '<tr class="link-row" data-op="' + esc(opKey(method, path)) + '"><td style="width:70px">' + badge(method, true)
      + '</td><td><code>' + esc(path) + "</code></td><td>" + esc(op.summary || "") + "</td></tr>";
  }
  $main.innerHTML =
    pageHead("API Reference", "Endpoints",
      "Every operation in the E-Boses API. Click a row for parameters, request bodies and response examples.")
    + "<table>" + rows + "</table>";
}

function paramTable(params, title) {
  const rows = (params || []).map(p => {
    const schema = p.schema || (p.$ref ? resolveRef(p.$ref) : {}) || {};
    const type = schema.type || (schema.$ref ? "object" : "string");
    return "<tr><td><code>" + esc(p.name) + "</code></td><td>" + esc(p.in) + "</td><td>"
      + esc(type) + "</td><td>" + (p.required ? '<strong>yes</strong>' : "no") + "</td><td>" + mdLite(p.description || "") + "</td></tr>";
  }).join("");
  if (!rows) return "";
  return "<h3>" + esc(title) + '</h3><table><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr>' + rows + "</table>";
}

function renderOp(method, path) {
  const op = findOp(method, path);
  if (!op) { renderError(); return; }
  const tag = firstTag(op);
  let html =
    '<div class="crumb"><a href="#/endpoints" style="color:var(--dim)">' + esc(tag) + "</a></div>"
    + '<div class="page-head"><div><h1>' + esc(op.summary || op.operationId || path) + "</h1></div>" + copyPageButton() + "</div>"
    + '<div class="pathline">' + badge(method) + "<span>" + esc(path) + '</span><button class="copy" data-copy-id="pathline">Copy</button><span id="pathline" style="display:none">' + esc(location.origin + path) + "</span></div>";
  if (op.description) html += "<p>" + mdLite(op.description) + "</p>";
  if (op.deprecated) html += '<div class="note">This endpoint is deprecated.</div>';

  html += paramTable((op.parameters || []).filter(p => (p.in || (resolveParamRef(p) || {}).in) === "path"), "Path parameters");
  html += paramTable((op.parameters || []).filter(p => (p.in || (resolveParamRef(p) || {}).in) === "query"), "Query parameters");

  const body = op.requestBody && op.requestBody.content;
  if (body) {
    for (const [ctype, media] of Object.entries(body)) {
      html += "<h3>Request body <span style='color:var(--dim);font-weight:400'>(" + esc(ctype) + ")</span></h3>";
      const schema = media.schema || {};
      if (ctype.startsWith("multipart") && schema.properties) {
        const rows = Object.entries(schema.properties).map(([name, s]) => {
          const r = s.$ref ? resolveRef(s.$ref) : s;
          return "<tr><td><code>" + esc(name) + "</code></td><td>" + esc(r.type || "string") + "</td><td>"
            + ((schema.required || []).includes(name) ? "<strong>yes</strong>" : "no") + "</td><td>" + mdLite(r.description || "") + "</td></tr>";
        }).join("");
        html += '<table><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr>' + rows + "</table>";
      } else {
        html += exampleModelTabs(media);
      }
    }
  }

  const responses = op.responses || {};
  const codes = Object.keys(responses).sort((a, b) => Number(a) - Number(b));
  html += "<h2>Responses</h2>";
  if (!codes.length) html += '<p class="empty">No documented responses.</p>';
  for (const code of codes) {
    const resp = responses[code] || {};
    html += '<div class="resp"><div class="resp-head">' + statusPill(code) + '<span class="desc">' + esc(resp.description || "") + "</span></div>";
    const json = resp.content && (resp.content["application/json"] || Object.values(resp.content)[0]);
    if (json) {
      html += '<div class="resp-body">' + exampleModelTabs(json) + "</div>";
    } else if (String(code) !== "204") {
      html += '<div class="resp-body"><p class="empty">No body.</p></div>';
    }
    html += "</div>";
  }
  $main.innerHTML = html;
  window.scrollTo(0, 0);
}

function resolveParamRef(p) {
  if (!p.$ref) return null;
  const name = p.$ref.replace("#/components/parameters/", "");
  return ((SPEC.components || {}).parameters || {})[name] || null;
}

function renderError() {
  $main.innerHTML = pageHead("Error", "Not found", "This route does not exist in the API reference.");
}

/* ---------- router ---------- */
function setActiveTab(tab) {
  document.querySelectorAll("[data-tab]").forEach(a => a.classList.toggle("active", a.dataset.tab === tab));
}
function route() {
  const hash = location.hash || "#/overview";
  document.querySelectorAll(".nav-op").forEach(a => a.classList.toggle("active", a.dataset.op === hash));
  if (hash.startsWith("#op=")) {
    setActiveTab("reference");
    const decoded = decodeURIComponent(hash.slice(4));
    const idx = decoded.indexOf(" ");
    renderOp(decoded.slice(0, idx).toLowerCase(), decoded.slice(idx + 1));
  } else if (hash === "#/endpoints") {
    setActiveTab("reference");
    renderEndpoints();
  } else {
    setActiveTab("guides");
    renderOverview();
  }
}

/* ---------- search ---------- */
const $search = document.getElementById("search");
$search.addEventListener("input", () => {
  const q = $search.value.trim().toLowerCase();
  let first = null;
  document.querySelectorAll(".nav-op").forEach(a => {
    const hit = !q || (a.dataset.search || "").includes(q);
    a.style.display = hit ? "" : "none";
    if (hit && !first) first = a;
  });
  $search._first = first;
});
$search.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && $search._first) { location.hash = $search._first.dataset.op; $search.blur(); }
  if (e.key === "Escape") { $search.value = ""; $search.dispatchEvent(new Event("input")); $search.blur(); }
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $search.focus(); }
  if (e.key === "/" && document.activeElement !== $search) { e.preventDefault(); $search.focus(); }
});

/* ---------- boot ---------- */
fetch(SPEC_URL).then(r => r.json()).then(spec => {
  SPEC = spec;
  buildSidebar();
  route();
}).catch(() => {
  $main.innerHTML = pageHead("Error", "Schema unavailable", "The OpenAPI document could not be loaded. Is the API server running?");
});
window.addEventListener("hashchange", route);
</script>
</body>
</html>
"""


def docs_portal(request):
    website_url = getattr(settings, "EBoses_WEBSITE_URL", "") or "https://example.com"
    support_email = getattr(settings, "SUPPORT_EMAIL", "") or "support@example.com"
    page = (
        PORTAL_TEMPLATE.replace("__VERSION__", html.escape(str(getattr(settings, "API_VERSION", "1.0.0"))))
        .replace("__WEBSITE__", html.escape(website_url))
        .replace("__EMAIL__", html.escape(support_email))
    )
    return HttpResponse(page, content_type="text/html")


class SwaggerFallbackView(SpectacularSwaggerView):
    url_name = "api-schema"
