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
let filteredCards = [];

// DOM 参照（DOMContentLoaded 後に確実に存在する）
let slider, counter;

let addMode = false;

let batchPendingAction = null;
let batchTargetLevel = null;



window.addEventListener("DOMContentLoaded", async () => {
  slider  = document.getElementById("cardSlider");
  counter = document.getElementById("cardCount");
  attachUI();
  await preloadAll();
  await loadSet(0);
});

document.addEventListener("keydown", (e) => {

  // モーダルが開いていたら無効
  if (document.querySelector(".modal[style*='flex']")) return;

  // フォーカスが入力系なら無効
  const el = document.activeElement;
  if (!el) return;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return;

  if (e.key === "ArrowRight") {
    e.preventDefault();
    next();
  }

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prev();
  }

});



// ---------- UI 初期化 ----------
function attachUI() {
  const cardContainer = document.getElementById("card");
  if (cardContainer) {
  cardContainer.addEventListener("click", (e) => {
    // 操作系UIをクリックしたら反転しない
    if (e.target.closest("button, .no-flip, input, select, textarea")) return;

    cardContainer.classList.toggle("flipped");
  });
}

  if (slider) {
  slider.addEventListener("input", () => {
    const vis = getVisibleIndices();
    const pos = Number(slider.value) || 0;

    if (vis.length === 0) return;

    index = vis[Math.min(pos, vis.length - 1)];
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

  const vis = getVisibleIndices();

  if (vis.length === 0) {
    document.getElementById("front").textContent = "(表示するカードがありません)";
    document.getElementById("back").textContent = "";
    counter.textContent = `0 / 0`;
    slider.max = 0;
    slider.value = 0;
    return;
  }

  // 今の index が可視に含まれないなら先頭へ
  if (!vis.includes(index)) index = vis[0];

  slider.max = vis.length - 1;
  slider.value = vis.indexOf(index);

  show();
}

function getVisibleIndices() {
  return cards
    .map((c,i)=>({c,i}))
    .filter(x => filters.has(x.c.level))
    .map(x => x.i);
}

function clearShow() {
  document.getElementById("front").textContent = "";
  document.getElementById("back").textContent = "";
  counter.textContent = "";
}

function show() {
  document.getElementById("card").classList.remove("flipped");
  if (!cards || cards.length === 0) return clearShow();

  const vis = getVisibleIndices();
  if (vis.length === 0) return clearShow();

  const pos = vis.indexOf(index);
  if (pos === -1) index = vis[0];

  const c = cards[index];

  document.getElementById("front").textContent = c.front;
  document.getElementById("back").textContent  = c.back;
  document.getElementById("levelVal").textContent = c.level || 3;

  slider.value = vis.indexOf(index);
  counter.textContent = `${vis.indexOf(index)+1} / ${vis.length}`;
}


// ---------- ナビ ----------
function next() {
  const vis = getVisibleIndices();
  if (vis.length === 0) return;

  const card = document.getElementById("card");
  card.classList.remove("flipped");

  setTimeout(() => {
    const pos = vis.indexOf(index);
    const nextPos = (pos + 1) % vis.length;
    index = vis[nextPos];
    show();
  }, 220);
}

function prev() {
  const vis = getVisibleIndices();
  if (vis.length === 0) return;

  const card = document.getElementById("card");
  card.classList.remove("flipped");

  setTimeout(() => {
    const pos = vis.indexOf(index);
    const prevPos = (pos - 1 + vis.length) % vis.length;
    index = vis[prevPos];
    show();
  }, 220);
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
  addMode = false;

  const delBtn = document.getElementById("deleteBtn");
  delBtn.classList.remove("hidden");

  if (!cards[index]) return;
  document.getElementById("editFront").value = cards[index].front;
  document.getElementById("editBack").value  = cards[index].back;
  document.getElementById("editLevel").value = String(cards[index].level || 3);
  document.getElementById("editPopup").style.display = "flex";
}


function closeEditPopup() {
  document.getElementById("editPopup").style.display = "none";
  document.getElementById("deleteBtn").classList.remove("hidden");
}


// ---------- 新規カード追加 ----------
function addNewCard() {
  addMode = true;

  const delBtn = document.getElementById("deleteBtn");
  if (delBtn) delBtn.classList.add("hidden");

  document.getElementById("editFront").value = "";
  document.getElementById("editBack").value  = "";
  document.getElementById("editLevel").value = "3";

  document.getElementById("editPopup").style.display = "flex";
}


function applyEdit() {
  const f = document.getElementById("editFront").value.trim();
  const b = document.getElementById("editBack").value.trim();
  const lv = Number(document.getElementById("editLevel").value);

  if (!f && !b) return;

  if (addMode) {
    const newCard = {
      id: cards.length + 1,
      front: f,
      back: b,
      level: lv
    };

    cards.push(newCard);
    index = cards.length - 1;   // ← 今追加したカードを表示

    addMode = false;

  } else {
    if (!cards[index]) return;
    cards[index].front = f;
    cards[index].back  = b;
    cards[index].level = lv;
  }

  dirty = true;
  cache[currentSetId] = cards.map(c => ({...c}));

  closeEditPopup();
  applyFiltersAndShow();   // フィルタ対応してるならこれ
}



function deleteCurrentCard() {
  if (addMode) return;
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
  openBatchModeModal();
}

function openBatchModeModal() {
  document.getElementById("batchModeModal").style.display = "flex";
}

function closeBatchModeModal() {
  document.getElementById("batchModeModal").style.display = "none";
  document.getElementById("batchLevelChooser").style.display = "none";
}

function startBatchDelete() {
  batchPendingAction = "delete";
  enableBatchSelectMode();
  closeBatchModeModal();
}

function startBatchLevel() {
  batchPendingAction = "level";
  document.getElementById("batchLevelChooser").style.display = "block";
}

function confirmBatchLevel() {
  batchTargetLevel = Number(
    document.getElementById("batchLevelTarget").value
  );

  enableBatchSelectMode();
  closeBatchModeModal();
}

function enableBatchSelectMode() {
  batchSelectMode = true;
  batchSelected.clear();
  renderBatchList();
}

function runBatchAction() {

  if (batchSelected.size === 0) {
    alert("カードを選択してください");
    return;
  }

  const targets = Array.from(batchSelected).sort((a,b)=>b-a);

  if (batchPendingAction === "delete") {

    if (!confirm("削除しますか？")) return;
    targets.forEach(i => cards.splice(i,1));

  }

  if (batchPendingAction === "level") {

    targets.forEach(i => cards[i].level = batchTargetLevel);
  }

  cards.forEach((c,i)=>c.id=i+1);

  batchSelectMode = false;
  batchSelected.clear();
  batchPendingAction = null;

  dirty = true;

  renderBatchList();
  applyFiltersAndShow();
}

function renderBatchList() {
  const container = document.getElementById("batchList");
  const q = (document.getElementById("batchSearch").value || "").toLowerCase();
  const levelFilter = document.getElementById("batchFilterLevel").value;

  container.innerHTML = "";

  cards.forEach((c,i) => {

    if (levelFilter && String(c.level) !== levelFilter) return;
    if (q && !(c.front + c.back).toLowerCase().includes(q)) return;

    const row = document.createElement("div");
    row.className = "batch-row";

    // --- checkbox ---
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.style.display = batchSelectMode ? "block" : "none";
    checkbox.checked = batchSelected.has(i);
    checkbox.onchange = e => {
      if (e.target.checked) batchSelected.add(i);
      else batchSelected.delete(i);
      e.stopPropagation();
    };

    // --- 番号 ---
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = i+1;

    // --- front textarea ---
    const front = document.createElement("textarea");
    front.value = c.front;
    front.className = "batch-text";
    front.oninput = e => {
      cards[i].front = e.target.value;
      dirty = true;
    };

    // --- back textarea ---
    const back = document.createElement("textarea");
    back.value = c.back;
    back.className = "batch-text";
    back.oninput = e => {
      cards[i].back = e.target.value;
      dirty = true;
    };

    // --- level select ---
    const lv = document.createElement("select");
    for (let n=1;n<=5;n++){
      const op = document.createElement("option");
      op.value = n;
      op.textContent = "Lv"+n;
      if (n === c.level) op.selected = true;
      lv.appendChild(op);
    }
    lv.onchange = e => {
      cards[i].level = Number(e.target.value);
      dirty = true;
    };

    row.appendChild(checkbox);
    row.appendChild(num);
    row.appendChild(front);
    row.appendChild(back);
    row.appendChild(lv);

    container.appendChild(row);
  });
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
      alert("保存しました");
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
    headers: {
      "Content-Type": "text/plain"   // ← ここが核心
    },
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

// ===== 外クリックでポップアップ系を全部閉じる =====
document.addEventListener("click", (e) => {

  // ---- モーダル系 ----
  const modals = [
    { id: "editPopup", close: closeEditPopup },
    { id: "batchPopup", close: closeBatchEditor },
    { id: "batchModeModal", close: closeBatchModeModal }
  ];

  modals.forEach(m => {
    const el = document.getElementById(m.id);
    if (!el) return;
    if (el.style.display === "flex" && e.target === el) {
      m.close();
    }
  });


  // ---- レベルセレクタ（カード左下のLvメニュー）----
  const levelSel = document.getElementById("levelSelector");
  if (levelSel && levelSel.style.display === "block") {

    if (
      !e.target.closest("#levelSelector") &&
      !e.target.closest("#levelBadge")
    ) {
      levelSel.style.display = "none";
    }
  }


  // ---- フィルタパネル（☰メニュー）----
  const filter = document.getElementById("filterPanel");
  if (filter && filter.style.display === "block") {

    if (
      !e.target.closest("#filterPanel") &&
      !e.target.closest(".icon-small")
    ) {
      filter.style.display = "none";
    }
  }

});
