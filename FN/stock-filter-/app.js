/**
 * app.js
 * -----------------------------------------------------------------------
 * Application entry point. Builds the 3D scene (THREE.js), wires up the
 * filter form, and reacts to input by recomputing matches (filters.js)
 * and re-rendering node state. THREE is loaded globally via a <script>
 * tag in index.html before this module runs.
 * -----------------------------------------------------------------------
 */

import { STOCKS, SECTOR_COLORS, TIER_Z, applyFilters } from "./filters.js";
import { analyzePB, signalOf } from "./analysis.js";
import { openAnalysis } from "./analysis-ui.js";

/* =========================================================================
   THREE.JS SCENE
   ========================================================================= */
const CUSTOM_STORAGE_KEY = "stock-filter-custom-stocks-v1";
const formatINR = value => "₹" + Number(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
// P/B signal: price vs. a sector reference P/B (see analysis.js). Educational screening, not advice.
function getSignal(stock) { return signalOf(stock); }
function loadCustomStocks() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(s => s && typeof s.name === "string" &&
      Number(s.price) > 0 && Number(s.bookValue) > 0) : [];
  } catch { return []; }
}
function saveCustomStocks() {
  try {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customStocks));
  } catch { /* Browser storage may be disabled; the current session still works. */ }
}
const customStocks = loadCustomStocks();
STOCKS.forEach(stock => {
  if (!(Number(stock.price) > 0)) stock.price = Number((stock.bookValue * stock.pbRatio).toFixed(2));
  stock.isCustom = false;
});
const allStocks = [...STOCKS];
const BV_MAX = Math.max(...allStocks.map(s => s.bookValue), 1);
const PB_MAX = Math.max(...allStocks.map(s => s.pbRatio), 1);
const PLANE_W = 200, PLANE_H = 120;

function bvToX(bv){ return (Math.sqrt(bv / BV_MAX)) * PLANE_W - PLANE_W / 2; }
function pbToY(pb){ return (pb / PB_MAX) * PLANE_H - 10; }

const canvas = document.getElementById('scene-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0e17, 0.0028);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 3000);
let camDist = 340, camTheta = 0.6, camPhi = 1.15;
function updateCamera(){
  camera.position.set(
    camDist * Math.sin(camPhi) * Math.sin(camTheta),
    camDist * Math.cos(camPhi) + 20,
    camDist * Math.sin(camPhi) * Math.cos(camTheta)
  );
  camera.lookAt(0, 20, 0);
}
updateCamera();

// Ambient + key lights
scene.add(new THREE.AmbientLight(0x33395a, 1.1));
const key = new THREE.PointLight(0x9fb4ff, 1.4, 900);
key.position.set(120, 220, 160);
scene.add(key);
const rim = new THREE.PointLight(0x43e0c4, 0.7, 900);
rim.position.set(-160, 60, -140);
scene.add(rim);

// Ground grid (reference plane)
const grid = new THREE.GridHelper(PLANE_W * 1.15, 24, 0x2a3a63, 0x18213a);
grid.position.y = -10;
scene.add(grid);

// Axis lines
function makeAxisLine(from, to, color){
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.85 });
  return new THREE.Line(geo, mat);
}
scene.add(makeAxisLine(new THREE.Vector3(-PLANE_W/2,-10,0), new THREE.Vector3(PLANE_W/2,-10,0), 0x43e0c4));
scene.add(makeAxisLine(new THREE.Vector3(-PLANE_W/2,-10,0), new THREE.Vector3(-PLANE_W/2,PLANE_H-10,0), 0xd4af37));
scene.add(makeAxisLine(new THREE.Vector3(-PLANE_W/2,-10,-70), new THREE.Vector3(-PLANE_W/2,-10,70), 0x8a7fe0));

// Stock nodes
const nodeGeo = new THREE.IcosahedronGeometry(3.1, 1);
const nodes = [];
function createStockNode(stock) {
  const color = SECTOR_COLORS[stock.sector] || 0x9aa3bf;
  const mat = new THREE.MeshStandardMaterial({
    color, emissive:color, emissiveIntensity:0.55,
    roughness:0.35, metalness:0.25, transparent:true, opacity:1
  });
  const mesh = new THREE.Mesh(nodeGeo, mat);
  const x = bvToX(stock.bookValue);
  const y = pbToY(stock.pbRatio);
  const tier = stock.tier || "Mid";
  const z = (TIER_Z[tier] ?? 0) + (Math.random()*18 - 9);
  mesh.position.set(x, y, z);
  mesh.userData = { stock, baseScale: 1, matched:true, floatSeed: Math.random()*Math.PI*2 };
  scene.add(mesh);
  nodes.push(mesh);
  return mesh;
}
allStocks.forEach(createStockNode);
customStocks.forEach(stock => {
  stock.isCustom = true;
  stock.tier = stock.tier || "Mid";
  if (!allStocks.some(s => s.id && s.id === stock.id)) allStocks.push(stock);
});
customStocks.forEach(stock => {
  if (!nodes.some(n => n.userData.stock === stock)) createStockNode(stock);
});

/* ---------- drag-to-rotate / scroll-to-zoom (no external controls lib) ---------- */
let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
let downX = 0, downY = 0;
canvas.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });
canvas.addEventListener('pointerup', e => {
  dragging = false;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;      // it was a drag, not a click
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(nodes.filter(n => n.userData.matched));
  if (hits.length) { hideCard(); openAnalysis(hits[0].object.userData.stock, allStocks); }
});
canvas.addEventListener('pointercancel', () => dragging = false);
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  camTheta -= dx * 0.005;
  camPhi = Math.min(Math.max(camPhi - dy * 0.005, 0.35), 1.55);
  updateCamera();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  camDist = Math.min(Math.max(camDist + e.deltaY * 0.4, 140), 640);
  updateCamera();
}, { passive:false });

/* ---------- hover / click detail card ---------- */
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
const card = document.getElementById('nodeCard');
const cardEls = {
  sector: document.getElementById('cardSector'),
  name: document.getElementById('cardName'),
  price: document.getElementById('cardPrice'),
  signal: document.getElementById('cardSignal'),
  advice: document.getElementById('cardAdvice'),
  bv: document.getElementById('cardBookValue'),
  pb: document.getElementById('cardPB'),
  tier: document.getElementById('cardTier'),
};

function showCard(mesh, clientX, clientY){
  const s = mesh.userData.stock;
  cardEls.sector.textContent = s.sector;
  cardEls.name.textContent = s.name;
  cardEls.price.textContent = Number(s.price) > 0 ? formatINR(s.price) : "Price unavailable";
  cardEls.bv.textContent = Number(s.bookValue) > 0 ? formatINR(s.bookValue) : "—";
  const calculatedPB = Number(s.bookValue) > 0 && Number(s.price) > 0 ? Number(s.price) / Number(s.bookValue) : Number(s.pbRatio);
  cardEls.pb.textContent = Number.isFinite(calculatedPB) ? calculatedPB.toFixed(2) + 'x' : "—";
  const stockSignal = getSignal(s);
  cardEls.signal.textContent = stockSignal.label;
  cardEls.signal.style.color = `var(--${{buy:'teal',hold:'gold',sell:'danger'}[stockSignal.className] || 'gold'})`;
  cardEls.advice.textContent = stockSignal.analysis ? `${stockSignal.analysis.upside >= 0 ? '+' : '−'}${Math.abs(stockSignal.analysis.upside * 100).toFixed(0)}% vs fair value` : stockSignal.advice;
  cardEls.tier.textContent = s.tier + ' cap';
  const left = Math.min(clientX + 16, window.innerWidth - 246);
  const top = Math.min(clientY + 16, window.innerHeight - 190);
  card.style.left = left + 'px';
  card.style.top = top + 'px';
  card.classList.add('visible');
}
function hideCard(){ card.classList.remove('visible'); }

canvas.addEventListener('pointermove', e => {
  if (dragging) { hideCard(); return; }
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObjects(nodes.filter(n => n.userData.matched));
  if (hits.length){
    showCard(hits[0].object, e.clientX, e.clientY);
    canvas.style.cursor = 'pointer';
  } else {
    hideCard();
    canvas.style.cursor = dragging ? 'grabbing' : 'grab';
  }
});
canvas.addEventListener('pointerleave', hideCard);

/* =========================================================================
   DOM WIRING — reads criteria, applies filters, updates node visuals + stats
   ========================================================================= */
const dom = {
  form: document.getElementById('filterForm'),
  minBookValue: document.getElementById('minBookValue'),
  maxBookValue: document.getElementById('maxBookValue'),
  minPB: document.getElementById('minPB'),
  maxPB: document.getElementById('maxPB'),
  resetBtn: document.getElementById('resetFiltersBtn'),
  emptyState: document.getElementById('emptyState'),
  resultCount: document.getElementById('resultCount'),
  statTotal: document.getElementById('statTotal'),
  statShown: document.getElementById('statShown'),
  statAvgPB: document.getElementById('statAvgPB'),
};

function readCriteria(){
  const n = v => v === '' ? null : Number(v);
  return {
    minBookValue: n(dom.minBookValue.value),
    maxBookValue: n(dom.maxBookValue.value),
    minPB: n(dom.minPB.value),
    maxPB: n(dom.maxPB.value),
  };
}

function refresh(){
  const criteria = readCriteria();
  const matchedStocks = applyFilters(allStocks, criteria);
  const matchedSet = new Set(matchedStocks);

  nodes.forEach(mesh => {
    const matched = matchedSet.has(mesh.userData.stock);
    mesh.userData.matched = matched;
    mesh.userData.targetScale = matched ? 1 : 0.34;
    mesh.userData.targetOpacity = matched ? 1 : 0.16;
    mesh.userData.targetEmissive = matched ? 0.55 : 0.05;
  });

  dom.statTotal.textContent = allStocks.length;
  dom.statShown.textContent = matchedStocks.length;
  const avgPB = matchedStocks.length
    ? (matchedStocks.reduce((sum, s) => sum + s.pbRatio, 0) / matchedStocks.length)
    : 0;
  dom.statAvgPB.textContent = avgPB.toFixed(2);

  dom.resultCount.textContent = `Showing ${matchedStocks.length} of ${allStocks.length} stocks`;
  dom.emptyState.hidden = matchedStocks.length !== 0;
}

dom.form.addEventListener('submit', e => { e.preventDefault(); refresh(); });
[dom.minBookValue, dom.maxBookValue, dom.minPB, dom.maxPB].forEach(el =>
  el.addEventListener('input', refresh)
);
dom.resetBtn.addEventListener('click', () => { dom.form.reset(); refresh(); });

/* =========================================================================
   USER-ADDED STOCKS — persistence, P/B calculation and screening signal
   ========================================================================= */
const addStockForm = document.getElementById("addStockForm");
const stockFormFeedback = document.getElementById("stockFormFeedback");
const customStockList = document.getElementById("customStockList");
const customStockCount = document.getElementById("customStockCount");
const analysisResult = document.getElementById("analysisResult");

function renderCustomStockList() {
  customStockCount.textContent = customStocks.length;
  if (!customStocks.length) {
    customStockList.innerHTML = '<p class="stock-feedback">No custom stocks added yet.</p>';
    return;
  }
  customStockList.innerHTML = "";
  customStocks.forEach(stock => {
    const item = document.createElement("div");
    item.className = "custom-stock-item";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = stock.name;
    const details = document.createElement("small");
    details.textContent = `${formatINR(stock.price)} · P/B ${stock.pbRatio.toFixed(2)}x · ${getSignal(stock).label}`;
    name.title = "Open full analysis";
    name.addEventListener("click", () => openAnalysis(stock, allStocks));
    info.append(name, details);
    const remove = document.createElement("button");
    remove.className = "remove-stock";
    remove.type = "button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${stock.name}`);
    remove.addEventListener("click", () => {
      const index = customStocks.findIndex(s => s.id === stock.id);
      if (index >= 0) customStocks.splice(index, 1);
      const allIndex = allStocks.findIndex(s => s.id === stock.id);
      if (allIndex >= 0) allStocks.splice(allIndex, 1);
      const nodeIndex = nodes.findIndex(n => n.userData.stock.id === stock.id);
      if (nodeIndex >= 0) {
        const [mesh] = nodes.splice(nodeIndex, 1);
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      saveCustomStocks();
      renderCustomStockList();

      refresh();
      hideCard();
    });
    item.append(info, remove);
    customStockList.append(item);
  });
}


function renderExistingStockAdvice() {
  const container = document.getElementById("allStockAdviceList");
  if (!container) return;
  container.innerHTML = "";
  STOCKS.forEach(stock => {
    const signal = getSignal({ ...stock, price: Number(stock.price) || stock.bookValue * stock.pbRatio });
    const item = document.createElement("div");
    item.className = "existing-advice-item";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.addEventListener("click", () => openAnalysis(stock, allStocks));
    item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openAnalysis(stock, allStocks); } });
    const heading = document.createElement("strong");
    const name = document.createElement("span");
    name.textContent = stock.name;
    const label = document.createElement("span");
    label.className = signal.className === "buy" ? "advice-buy" : signal.className === "sell" ? "advice-sell" : "advice-hold";
    label.textContent = signal.label;
    heading.append(name, label);
    const detail = document.createElement("small");
    detail.textContent = `P/B ${Number(stock.pbRatio).toFixed(2)}x · fair ${signal.analysis.fairPB.toFixed(1)}x · ${signal.analysis.upside >= 0 ? "+" : "−"}${Math.abs(signal.analysis.upside * 100).toFixed(0)}% vs fair value`;
    item.append(heading, detail);
    container.append(item);
  });
}
renderExistingStockAdvice();

let previewStock = null;
function showAnalysis(stock) {
  const signal = getSignal(stock);
  previewStock = stock;
  document.getElementById("viewAnalysisBtn").hidden = false;
  document.getElementById("analysisStockName").textContent = stock.name;
  const signalEl = document.getElementById("analysisSignal");
  signalEl.textContent = signal.label;
  signalEl.className = `signal ${signal.className}`;
  document.getElementById("analysisPB").textContent = `${stock.pbRatio.toFixed(2)}x`;
  document.getElementById("analysisPrice").textContent = formatINR(stock.price);
  document.getElementById("analysisBook").textContent = formatINR(stock.bookValue);
  document.getElementById("analysisAdvice").textContent = signal.advice;
  const reasonEl = document.getElementById("analysisReason");
  if (reasonEl) reasonEl.textContent = signal.advice;
  analysisResult.hidden = false;
}

function updateLivePreview() {
  const name = document.getElementById("customStockName").value.trim() || "Your stock";
  const priceText = document.getElementById("customMarketPrice").value;
  const bookText = document.getElementById("customBookValue").value;
  const price = Number(priceText), bookValue = Number(bookText);
  const adviceEl = document.getElementById("analysisAdvice");
  if (priceText === "" || bookText === "" || !Number.isFinite(price) || !Number.isFinite(bookValue) || price <= 0 || bookValue <= 0) {
    document.getElementById("analysisStockName").textContent = "Live screening preview";
    const signalEl = document.getElementById("analysisSignal");
    signalEl.textContent = "ENTER VALID VALUES";
    signalEl.className = "signal hold";
    document.getElementById("analysisPB").textContent = "—";
    document.getElementById("analysisPrice").textContent = priceText ? (Number.isFinite(price) && price > 0 ? formatINR(price) : "Invalid") : "—";
    document.getElementById("analysisBook").textContent = bookText ? (Number.isFinite(bookValue) && bookValue > 0 ? formatINR(bookValue) : "Invalid") : "—";
    adviceEl.textContent = "Enter a positive market price and book value per share. Advice appears automatically.";
    previewStock = null;
    document.getElementById("viewAnalysisBtn").hidden = true;
    analysisResult.hidden = false;
    return;
  }
  const stock = {name, price, bookValue, pbRatio: price / bookValue, sector: document.getElementById("customStockSector").value};
  const signal = getSignal(stock);
  document.getElementById("analysisStockName").textContent = `Preview: ${name}`;
  const signalEl = document.getElementById("analysisSignal");
  signalEl.textContent = signal.label;
  signalEl.className = `signal ${signal.className}`;
  document.getElementById("analysisPB").textContent = `${stock.pbRatio.toFixed(2)}x`;
  document.getElementById("analysisPrice").textContent = formatINR(price);
  document.getElementById("analysisBook").textContent = formatINR(bookValue);
  adviceEl.textContent = signal.advice;
  previewStock = { ...stock, isCustom: true };
  document.getElementById("viewAnalysisBtn").hidden = false;
  analysisResult.hidden = false;
}
document.getElementById("viewAnalysisBtn").addEventListener("click", () => { if (previewStock) openAnalysis(previewStock, allStocks); });
["customStockName", "customMarketPrice", "customBookValue", "customStockSector"].forEach(id => {
  document.getElementById(id).addEventListener("input", updateLivePreview);
  document.getElementById(id).addEventListener("change", updateLivePreview);
});
updateLivePreview();

addStockForm.addEventListener("submit", event => {
  event.preventDefault();
  const name = document.getElementById("customStockName").value.trim();
  const sector = document.getElementById("customStockSector").value;
  const price = Number(document.getElementById("customMarketPrice").value);
  const bookValue = Number(document.getElementById("customBookValue").value);
  if (!name || !Number.isFinite(price) || !Number.isFinite(bookValue) || price <= 0 || bookValue <= 0) {
    stockFormFeedback.textContent = "Enter a stock name and positive market price and book value.";
    stockFormFeedback.className = "stock-feedback error";
    return;
  }
  if (customStocks.some(s => s.name.toLowerCase() === name.toLowerCase())) {
    stockFormFeedback.textContent = "You already added a stock with that name. Remove it first if you want to replace its values.";
    stockFormFeedback.className = "stock-feedback error";
    return;
  }
  const pbRatio = price / bookValue;
  const stock = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name, sector, price, bookValue, pbRatio,
    tier: "Mid", isCustom: true
  };
  customStocks.push(stock);
  allStocks.push(stock);
  createStockNode(stock);
  saveCustomStocks();
  renderCustomStockList();
  showAnalysis(stock);
  stockFormFeedback.textContent = "Stock added to the 3D field and saved in this browser.";
  stockFormFeedback.className = "stock-feedback success";
  addStockForm.reset();
  refresh();
  document.getElementById("analysisStockName").textContent = `Added: ${stock.name}`;
});

renderCustomStockList();

/* ---------- "Stock analysis & chart" picker ---------- */
const analyzeSelect = document.getElementById("analyzeSelect");
[...STOCKS].sort((a, b) => a.name.localeCompare(b.name)).forEach(stock => {
  const opt = document.createElement("option");
  opt.value = stock.name; opt.textContent = stock.name.trim();
  analyzeSelect.append(opt);
});
analyzeSelect.addEventListener("change", () => {
  const stock = allStocks.find(s => s.name === analyzeSelect.value);
  if (stock) openAnalysis(stock, allStocks);
  analyzeSelect.value = "";
});

/* =========================================================================
   RENDER LOOP
   ========================================================================= */
let autoRotate = true;
canvas.addEventListener('pointerdown', () => autoRotate = false);

function animate(t){
  requestAnimationFrame(animate);
  const time = t * 0.001;

  if (autoRotate && !dragging){
    camTheta += 0.0009;
    updateCamera();
  }

  nodes.forEach(mesh => {
    const ts = mesh.userData.targetScale ?? 1;
    const to = mesh.userData.targetOpacity ?? 1;
    const te = mesh.userData.targetEmissive ?? 0.55;
    const cs = mesh.scale.x + (ts - mesh.scale.x) * 0.12;
    mesh.scale.setScalar(cs);
    mesh.material.opacity += (to - mesh.material.opacity) * 0.12;
    mesh.material.emissiveIntensity += (te - mesh.material.emissiveIntensity) * 0.12;

    mesh.position.y += Math.sin(time * 0.9 + mesh.userData.floatSeed) * 0.01;
    mesh.rotation.y += 0.003;
    mesh.rotation.x += 0.0015;
  });

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

refresh();
requestAnimationFrame(animate);

const loading = document.getElementById('loading');
setTimeout(() => { loading.style.opacity = '0'; setTimeout(()=>loading.remove(), 400); }, 350);
