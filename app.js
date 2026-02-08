// app.js — 完全版（GASのデプロイ先URLを置き換えて使ってください）
const GAS_URL = "https://script.google.com/macros/s/AKfycby-mknctB0oetIWm23X2o-OnP16q0e3VcBdqzos_X0Xdl5uvaDfxUp7K22fjaMa2OJ1/exec";

// シート一覧（HTML のメニューと合わせる）
const SHEETS = {
  0: "eng1",
  1: "eng2",
  2: "eng3",
  3: "old1",
  4: "old2"
};

// アプリ状態
let currentSetId = 0;
let cards = []; // {id, front, back, level}
let index = 0;
let cache = {}; // シートごとのキャッシュ（deep copy）
let dirty = false; // ローカルに未コミットの変更ありフラグ
let batchSelectMode = false;
let batchSelected = new Set();
let filters = new Set([1,2,3,4,5]);

// DOM 参照（DOMContentLoaded 後に確実に存在する）
let slider, counter;

window.addEventListener("DOMContentLoaded", async () => {
  slider  = document.getElementById("cardSlider");
  counter = document.getElementById("cardCount");
  attachUI();
  await preloadAll();
  await loadSet(0);
});

// ---------- UI 初期化 ----------
function attachUI() {
  const cardContainer = document.getElementById("card");
  if (cardContainer) {
    cardContainer.addEventListener("click", () => {
      cardContainer.classList.toggle("flipped");
    });
  }

  if (slider) {
    slider.addEventListener("input", () => {
      index = Number(slider.value) || 0;
      show();
    });
  }

  // filter checkboxes
  document.querySelectorAll(".filterCheckbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const lv = Number(cb.dataset.lv);
      if (cb.checked) filters.add(lv); else filters.delete(lv);
      applyFiltersAndShow();
    });
  });
}

// ---------- データ読み込み（プリロード） ----------
async function preloadAll() {
  showLoading();
  try {
    const entries = Object.entries(SHEETS);
    for (const [id, sheet] of entries) {
      if (cache[id]) continue;
      try {
        const res = await fetch(`${GAS_URL}?id=${encodeURIComponent(sheet)}`);
        if (!res.ok) {
          console.warn(`preload: ${sheet} fetch failed status=${res.status}`);
          cache[id] = [];
          continue;
        }
        const json = await res.json();
        const rows = Array.isArray(json) ? json : (json && json.data ? json.data : []);
        cache[id] = rows
          .filter(r => Array.isArray(r) && r.length >= 2)
          .map((r,i) => ({
            id: i+1,
            front: String(r[0] || ""),
            back: String(r[1] || ""),
            level: (r.length >= 3 && !isNaN(Number(r[2]))) ? Number(r[2]) : 3
          }));
      } catch (e) {
        console.error("preload error for sheet:", sheet, e);
        cache[id] = [];
      }
    }
  } finally {
    hideLoading();
  }
}

// ---------- シート切替（別シートに移るとローカル変更は破棄する仕様） ----------
async function changeSheet(id) {
  // id は数値または文字列
  if (dirty) {
    // 仕様で破棄する。必要ならここで confirm を入れる実装も可能。
    dirty = false;
  }
  await loadSet(id);
}

async function loadSet(id) {
  showLoading();
  try {
    currentSetId = String(id);
    if (cache[currentSetId]) {
      // deep copy を作ってローカル編集可能にする
      cards = cache[currentSetId].map(c => ({...c}));
      index = 0;
      slider.max = Math.max(cards.length - 1, 0);
      slider.value = 0;
      applyFiltersAndShow();
      return;
    }

    const sheet = SHEETS[id];
    const res = await fetch(`${GAS_URL}?id=${encodeURIComponent(sheet)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows = Array.isArray(json) ? json : (json && json.data ? json.data : []);
    cards = rows
      .filter(r => Array.isArray(r) && r.length >= 2)
      .map((r,i) => ({
        id: i+1,
        front: String(r[0] || ""),
        back: String(r[1] || ""),
        level: (r.length >= 3 && !isNaN(Number(r[2]))) ? Number(r[2]) : 3
      }));
    cache[currentSetId] = cards.map(c => ({...c}));
    index = 0;
    slider.max = Math.max(cards.length - 1, 0);
    slider.value = 0;
    applyFiltersAndShow();
  } catch (err) {
    console.error("loadSet error:", err);
    alert("読み込みに失敗しました: " + (err.message || err));
  } finally {
    hideLoading();
  }
}

// ---------- 表示ロジック ----------
function applyFiltersAndShow() {
  if (!cards || cards.length === 0) {
    clearShow();
    return;
  }
  const visibleIndices = cards.map((c,i)=>({c,i})).filter(x=>filters.has(x.c.level)).map(x=>x.i);
  if (visibleIndices.length === 0) {
    document.getElementById("front").textContent = "(表示するカードがありません)";
    document.getElementById("back").textContent = "";
    counter.textContent = `0 / ${cards.length}`;
    slider.value = 0;
    slider.max = Math.max(cards.length - 1, 0);
    return;
  }
  if (!visibleIndices.includes(index)) {
    index = visibleIndices[0];
  }
  slider.max = Math.max(cards.length - 1, 0);
  slider.value = index;
  show();
}

function clearShow() {
  document.getElementById("front").textContent = "";
  document.getElementById("back").textContent = "";
  counter.textContent = "";
}

function show() {
  if (!cards || cards.length === 0) return clearShow();
  const front = document.getElementById("front");
  const back  = document.getElementById("back");
  const cardEl = document.getElementById("card");
  const levEl = document.getElementById("levelVal");

  const c = cards[index];
  front.textContent = c.front;
  back.textContent  = c.back;
  levEl.textContent = c.level || 3;
  cardEl.classList.remove("flipped");
  if (slider) slider.value = index;
  counter.textContent = `${index + 1} / ${cards.length}`;
}

// ---------- ナビ ----------
function next() {
  const nextIdx = findNextVisibleIndex(index + 1);
  if (nextIdx !== null) index = nextIdx;
  show();
}
function prev() {
  const prevIdx = findPrevVisibleIndex(index - 1);
  if (prevIdx !== null) index = prevIdx;
  show();
}
function findNextVisibleIndex(start) {
  for (let i=start; i<cards.length; i++) if (filters.has(cards[i].level)) return i;
  return null;
}
function findPrevVisibleIndex(start) {
  for (let i=start; i>=0; i--) if (filters.has(cards[i].level)) return i;
  return null;
}

// ---------- レベル選択 ----------
function toggleLevelSelector() {
  const el = document.getElementById("levelSelector");
  if (!el) return;
  el.style.display = (el.style.display === "block") ? "none" : "block";
}
function setCardLevel(lv) {
  if (!cards[index]) return;
  cards[index].level = lv;
  dirty = true;
  document.getElementById("levelVal").textContent = lv;
  const sel = document.getElementById("levelSelector");
  if (sel) sel.style.display = "none";
  cache[currentSetId] = cards.map(c=>({...c}));
  show();
}

// ---------- 単一カード編集 ----------
function openEditPopup() {
  if (!cards[index]) return;
  document.getElementById("editFront").value = cards[index].front;
  document.getElementById("editBack").value  = cards[index].back;
  document.getElementById("editLevel").value = String(cards[index].level || 3);
  document.getElementById("editPopup").style.display = "flex";
}
function closeEditPopup() {
  document.getElementById("editPopup").style.display = "none";
}
function applyEdit() {
  const f = document.getElementById("editFront").value.trim();
  const b = document.getElementById("editBack").value.trim();
  const lv = Number(document.getElementById("editLevel").value);
  if (!cards[index]) return;
  cards[index].front = f;
  cards[index].back  = b;
  cards[index].level = lv;
  dirty = true;
  cache[currentSetId] = cards.map(c=>({...c}));
  closeEditPopup();
  show();
}
function deleteCurrentCard() {
  if (!cards[index]) return;
  if (!confirm("このカードを削除します。よろしいですか？")) return;
  cards.splice(index, 1);
  cards.forEach((c,i)=>c.id = i+1);
  dirty = true;
  cache[currentSetId] = cards.map(c=>({...c}));
  closeEditPopup();
  if (index >= cards.length) index = Math.max(cards.length - 1, 0);
  applyFiltersAndShow();
}

// ---------- 一括編集（バッチ） ----------
function openBatchEditor() {
  batchSelectMode = false;
  batchSelected = new Set();
  document.getElementById("batchPopup").style.display = "flex";
  document.getElementById("batchSearch").value = "";
  document.getElementById("batchFilterLevel").value = "";
  renderBatchList();
}
function closeBatchEditor() {
  document.getElementById("batchPopup").style.display = "none";
}
function toggleBatchSelectMode() {
  batchSelectMode = !batchSelectMode;
  batchSelected = new Set();
  renderBatchList();
}
function renderBatchList() {
  const container = document.getElementById("batchList");
  const q = (document.getElementById("batchSearch").value || "").trim().toLowerCase();
  const levelFilter = document.getElementById("batchFilterLevel").value;
  container.innerHTML = "";
  cards.forEach((c,i) => {
    if (levelFilter && String(c.level) !== levelFilter) return;
    if (q) {
      const s = (c.front + " " + c.back).toLowerCase();
      if (!s.includes(q)) return;
    }
    const row = document.createElement("div");
    row.className = "batch-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.display = batchSelectMode ? "block" : "none";
    checkbox.checked = batchSelected.has(i);
    checkbox.onchange = (e)=> {
      if (e.target.checked) batchSelected.add(i); else batchSelected.delete(i);
      // stop propagation to avoid opening card
      e.stopPropagation();
    };

    const num = document.createElement("div"); num.className = "num"; num.textContent = i+1;
    const text = document.createElement("div"); text.className = "text"; text.textContent = `${c.front} → ${c.back}`;
    const lv = document.createElement("div"); lv.className = "lv"; lv.textContent = `Lv${c.level}`;

    row.appendChild(checkbox);
    row.appendChild(num);
    row.appendChild(text);
    row.appendChild(lv);

    row.onclick = (e) => {
      if (batchSelectMode) {
        // toggle checkbox
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) batchSelected.add(i); else batchSelected.delete(i);
      } else {
        index = i;
        closeBatchEditor();
        show();
      }
    };

    container.appendChild(row);
  });
}
function applyBatchChange() {
  let targets = [];
  if (batchSelectMode) {
    targets = Array.from(batchSelected);
    if (!targets.length) { alert("行を選択してください"); return; }
  } else {
    const q = (document.getElementById("batchSearch").value || "").trim().toLowerCase();
    const levelFilter = document.getElementById("batchFilterLevel").value;
    cards.forEach((c,i) => {
      if (levelFilter && String(c.level) !== levelFilter) return;
      if (q) {
        const s = (c.front + " " + c.back).toLowerCase();
        if (!s.includes(q)) return;
      }
      targets.push(i);
    });
  }

  const actionLv = document.getElementById("batchActionLevel").value;
  if (!actionLv) {
    if (!confirm("選択されたカードを削除します。よろしいですか？")) return;
    targets.sort((a,b)=>b-a).forEach(i => cards.splice(i,1));
  } else {
    targets.forEach(i => { cards[i].level = Number(actionLv); });
  }

  cards.forEach((c,i)=>c.id = i+1);
  dirty = true;
  cache[currentSetId] = cards.map(c=>({...c}));
  renderBatchList();
  applyFiltersAndShow();
}

// ---------- 保存（GAS へ一括送信） ----------
async function saveAll() {
  if (!dirty) { alert("保存する変更はありません"); return; }
  const sheet = SHEETS[currentSetId];
  showLoading();
  try {
    const payload = cards.map(c => [c.front, c.back, c.level]);
    const res = await saveToGAS(sheet, payload);
    // GAS の戻り値は環境によって {status: "success"} や {status: "ok"} などあり得るため寛容に扱う
    if (res && (res.status === "success" || res.status === "ok" || res.status === "done")) {
      dirty = false;
      cache[currentSetId] = cards.map(c=>({...c}));
      alert("保存しました（GAS に反映）");
    } else {
      console.warn("saveAll: unexpected response", res);
      alert("保存は完了しましたが、サーバー応答が不定です（詳細はコンソール）。");
    }
  } catch (e) {
    console.error("saveAll error:", e);
    alert("保存に失敗しました: " + (e.message || e));
  } finally {
    hideLoading();
  }
}

async function saveToGAS(sheet, data) {
  const res = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: sheet, data })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// ---------- ユーティリティ ----------
function showLoading() { const el = document.getElementById("loading"); if (el) el.style.display = "flex"; }
function hideLoading() { const el = document.getElementById("loading"); if (el) el.style.display = "none"; }

function toggleMenu(el) {
  const box = el.nextElementSibling;
  if (!box) return;
  const isOpen = box.style.display === "block";
  box.style.display = isOpen ? "none" : "block";
  el.textContent = (isOpen ? "▸" : "▾") + el.textContent.slice(1);
}

function toggleFilterPanel() {
  const el = document.getElementById("filterPanel");
  if (!el) return;
  el.style.display = (el.style.display === "block") ? "none" : "block";
}

// テスト用（コンソールで回す）
async function testLoad() {
  try {
    const res = await fetch(`${GAS_URL}?id=${encodeURIComponent(SHEETS[0])}`);
    const json = await res.json();
    console.log("取得データ:", json);
  } catch (e) {
    console.error(e);
  }
}
