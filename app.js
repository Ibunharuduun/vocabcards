// app.js — 完全版（GASのデプロイ先URLを置き換えて使ってください）
const GAS_URL = "https://script.google.com/macros/s/AKfycby-mknctB0oetIWm23X2o-OnP16q0e3VcBdqzos_X0Xdl5uvaDfxUp7K22fjaMa2OJ1/exec";

// シート一覧（HTML のメニューと合わせる）
const SHEETS = {
  0: "eng1",
  1: "eng2",
  2: "new_leap_diff",
  3: "teppeki_diff",
  4: "old1",
  5: "old2"
};

const LOCAL_CACHE_KEY = "vocabcards-cache-v1";
const LOCAL_DIRTY_KEY = "vocabcards-dirty-v1";

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

let batchSelectBtn = null;
let batchRunBtn = null;
let batchSelectVisibleBtn = null;

let testQueue = [];
let testPosition = 0;
let testResults = [];


window.addEventListener("DOMContentLoaded", async () => {
  slider  = document.getElementById("cardSlider");
  counter = document.getElementById("cardCount");
  attachUI();
  loadLocalCache();
  const hadInitialCache = Boolean(cache["0"]);
  await loadSet(0);
  if (hadInitialCache) refreshSet(0, { updateCurrent: true });
  preloadAll();
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

  const key = e.key.toLowerCase();
  if (key === "n") {
    e.preventDefault();
    addNewCard();
  }

  if (key === "e") {
    e.preventDefault();
    openEditPopup();
  }

});



// ---------- UI 初期化 ----------
function attachUI() {
  batchSelectBtn = document.getElementById("batchSelectBtn");
  batchRunBtn = document.getElementById("batchRunBtn");
  batchSelectVisibleBtn = document.getElementById("batchSelectVisibleBtn");

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
function normalizeRows(rows) {
  return rows
    .filter(r => Array.isArray(r) && r.length >= 2)
    .map((r,i) => ({
      id: i+1,
      front: String(r[0] || ""),
      back: String(r[1] || ""),
      level: (r.length >= 3 && !isNaN(Number(r[2]))) ? Number(r[2]) : 3
    }));
}

function cloneCards(list) {
  return list.map(c => ({ ...c }));
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    dirty = localStorage.getItem(LOCAL_DIRTY_KEY) === "1";
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    cache = {};
    Object.keys(SHEETS).forEach(id => {
      if (Array.isArray(parsed[id])) {
        cache[id] = cloneCards(parsed[id]);
      }
    });
  } catch (e) {
    console.warn("Failed to load local cache:", e);
  }
}

function saveLocalCache() {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
    localStorage.setItem(LOCAL_DIRTY_KEY, dirty ? "1" : "0");
  } catch (e) {
    console.warn("Failed to save local cache:", e);
  }
}

async function fetchSheetCards(id) {
  const sheet = SHEETS[id];
  const res = await fetch(`${GAS_URL}?id=${encodeURIComponent(sheet)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json();
  const rows = Array.isArray(json) ? json : (json && json.data ? json.data : []);
  return normalizeRows(rows);
}

async function refreshSet(id, options = {}) {
  const setId = String(id);

  try {
    const freshCards = await fetchSheetCards(setId);
    cache[setId] = cloneCards(freshCards);
    saveLocalCache();

    if (options.updateCurrent && currentSetId === setId && !dirty) {
      cards = cloneCards(freshCards);
      index = Math.min(index, Math.max(cards.length - 1, 0));
      slider.max = Math.max(cards.length - 1, 0);
      applyFiltersAndShow();
    }
  } catch (e) {
    console.warn("Failed to refresh set:", e);
  }
}

async function preloadAll() {
  const entries = Object.keys(SHEETS).filter(id => id !== currentSetId);
  await Promise.all(entries.map(id => refreshSet(id)));
}


// ---------- シート切替（別シートに移るとローカル変更を保存） ----------
async function changeSheet(id) {
  if (dirty) {
    await saveAll();
  }
  const hadCachedSet = Boolean(cache[String(id)]);
  await loadSet(id);
  if (hadCachedSet) refreshSet(id, { updateCurrent: true });
}

async function loadSet(id) {
  currentSetId = String(id);
  if (cache[currentSetId]) {
    cards = cloneCards(cache[currentSetId]);
    index = 0;
    slider.max = Math.max(cards.length - 1, 0);
    slider.value = 0;
    applyFiltersAndShow();
    return;
  }

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
    cache[currentSetId] = cloneCards(cards);
    saveLocalCache();
    index = 0;
    slider.max = Math.max(cards.length - 1, 0);
    slider.value = 0;
    applyFiltersAndShow();
  } catch (err) {
    console.error("loadSet error:", err);
    alert("Failed to load set: " + (err.message || err));
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
    document.getElementById("front").textContent = "(No cards match the filter)";
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

// ===============================
// スワイプでカード移動（スマホ）
// ===============================
const cardElem = document.getElementById("card");

let touchStartX = 0;
let touchStartY = 0;

cardElem.addEventListener("touchstart", (e) => {
  if (isAnyModalOpen()) return; // ← モーダル中は無効

  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

cardElem.addEventListener("touchend", (e) => {
  if (isAnyModalOpen()) return;

  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  // 縦スクロール優先（誤爆防止）
  if (Math.abs(dy) > Math.abs(dx)) return;

  // スワイプ判定（50px以上）
  if (dx > 50) {
    prev();
  } else if (dx < -50) {
    next();
  }
});




// ---------- レベル選択 ----------
function toggleLevelSelector() {
  const el = document.getElementById("levelSelector");
  if (!el) return;
  el.style.display = (el.style.display === "block") ? "none" : "block";
}
function setCardLevel(lv) {
  if (!cards[index]) return;
  const prevVisible = getVisibleIndices();
  const prevPos = prevVisible.indexOf(index);

  cards[index].level = lv;
  dirty = true;
  document.getElementById("levelVal").textContent = lv;
  const sel = document.getElementById("levelSelector");
  if (sel) sel.style.display = "none";
  cache[currentSetId] = cloneCards(cards);
  saveLocalCache();

  const nextVisible = getVisibleIndices();
  if (nextVisible.length > 0 && !nextVisible.includes(index)) {
    index = nextVisible[Math.min(Math.max(prevPos, 0), nextVisible.length - 1)];
  }

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
  cache[currentSetId] = cloneCards(cards);
  saveLocalCache();

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
  cache[currentSetId] = cloneCards(cards);
  saveLocalCache();
  closeEditPopup();
  if (index >= cards.length) index = Math.max(cards.length - 1, 0);
  applyFiltersAndShow();
}

// ---------- 確認テスト ----------
function openTestPopup() {
  testQueue = [];
  testPosition = 0;
  testResults = [];
  showTestView("testSetup");
  document.getElementById("testPopup").style.display = "flex";
  updateTestAvailable();
}

function closeTestPopup() {
  document.getElementById("testPopup").style.display = "none";
}

function showTestView(activeId) {
  ["testSetup", "testRunner", "testSummary"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", id !== activeId);
  });
}

function getSelectedTestLevels() {
  return Array.from(document.querySelectorAll(".testLevelCheckbox"))
    .filter(cb => cb.checked)
    .map(cb => Number(cb.value));
}

function getTestEligibleIndices() {
  const selected = new Set(getSelectedTestLevels());
  return cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => selected.has(Number(c.level || 3)))
    .map(({ i }) => i);
}

function updateTestAvailable() {
  const meta = document.getElementById("testAvailable");
  if (!meta) return;

  const available = getTestEligibleIndices().length;
  const requested = getRequestedTestCount(available);
  meta.textContent = `対象 ${available} 枚 / 出題 ${requested} 枚`;
}

function getRequestedTestCount(maxCount) {
  const countEl = document.getElementById("testCount");
  const raw = countEl ? Number(countEl.value) : 0;
  if (!Number.isFinite(raw) || raw < 1) return maxCount > 0 ? 1 : 0;
  return Math.min(Math.floor(raw), maxCount);
}

function shuffleList(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function startTestSession() {
  const eligible = getTestEligibleIndices();
  if (eligible.length === 0) {
    alert("選択したレベルにカードがありません。");
    return;
  }

  const shouldShuffle = document.getElementById("testShuffle")?.checked;
  const ordered = shouldShuffle ? shuffleList(eligible) : eligible;
  const count = getRequestedTestCount(ordered.length);

  testQueue = ordered.slice(0, count);
  testPosition = 0;
  testResults = [];
  showTestView("testRunner");
  renderTestCard();
}

function renderTestCard() {
  const cardIndex = testQueue[testPosition];
  const card = cards[cardIndex];
  if (!card) {
    showTestSummary();
    return;
  }

  document.getElementById("testProgressText").textContent = `${testPosition + 1} / ${testQueue.length}`;
  document.getElementById("testLevelText").textContent = `Lv${card.level || 3}`;
  document.getElementById("testFront").textContent = card.front;
  document.getElementById("testBack").textContent = card.back;
  document.getElementById("testBack").classList.add("hidden");
  document.getElementById("testRevealBtn").classList.remove("hidden");
  document.getElementById("testAnswerActions").classList.add("hidden");
}

function revealTestBack() {
  document.getElementById("testBack").classList.remove("hidden");
  document.getElementById("testRevealBtn").classList.add("hidden");
  document.getElementById("testAnswerActions").classList.remove("hidden");
}

function recordTestAnswer(result) {
  const cardIndex = testQueue[testPosition];
  if (typeof cardIndex !== "number") return;

  testResults.push({
    cardIndex,
    result,
    level: Number(cards[cardIndex]?.level || 3)
  });

  testPosition += 1;
  if (testPosition >= testQueue.length) {
    showTestSummary();
  } else {
    renderTestCard();
  }
}

function showTestSummary() {
  const counts = testResults.reduce((acc, item) => {
    acc[item.result] = (acc[item.result] || 0) + 1;
    return acc;
  }, { known: 0, iffy: 0, unknown: 0 });

  const stats = document.getElementById("testSummaryStats");
  if (stats) {
    stats.innerHTML = "";
    [
      ["わかった", counts.known || 0],
      ["微妙", counts.iffy || 0],
      ["わからない", counts.unknown || 0]
    ].forEach(([label, count]) => {
      const item = document.createElement("div");
      item.className = "test-summary-item";
      item.innerHTML = `<span>${label}</span><strong>${count}</strong>`;
      stats.appendChild(item);
    });
  }

  showTestView("testSummary");
}

function nextLevelForResult(level, result) {
  if (result === "known") return Math.max(1, level - 1);
  if (result === "unknown") return Math.min(5, level + 1);
  return level;
}

function finishTest(applyLevels) {
  if (applyLevels) {
    let changed = false;
    testResults.forEach(({ cardIndex, result }) => {
      const card = cards[cardIndex];
      if (!card) return;
      const currentLevel = Number(card.level || 3);
      const nextLevel = nextLevelForResult(currentLevel, result);
      if (nextLevel !== currentLevel) {
        card.level = nextLevel;
        changed = true;
      }
    });

    if (changed) {
      dirty = true;
      cache[currentSetId] = cloneCards(cards);
      saveLocalCache();
      applyFiltersAndShow();
    }
  }

  closeTestPopup();
}

// ---------- 一括編集（バッチ） ----------
function openBatchEditor() {
  batchSelectMode = false;
  batchSelected = new Set();
  document.getElementById("batchPopup").style.display = "flex";
  document.getElementById("batchSearch").value = "";
  document.getElementById("batchFilterLevel").value = "";
  // ボタン表示を初期に戻す（DOM取得が出来るタイミングなので安全）
  batchSelectBtn = document.getElementById("batchSelectBtn");
  batchRunBtn = document.getElementById("batchRunBtn");
  batchSelectVisibleBtn = document.getElementById("batchSelectVisibleBtn");
  updateBatchActionBar();
  renderBatchList();
}
function closeBatchEditor() {
  document.getElementById("batchPopup").style.display = "none";
}

function getBatchVisibleIndices() {
  const q = (document.getElementById("batchSearch").value || "").trim().toLowerCase();
  const levelFilter = document.getElementById("batchFilterLevel").value;

  return cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !levelFilter || String(c.level) === levelFilter)
    .filter(({ c }) => {
      if (!q) return true;
      return `${c.front} ${c.back}`.toLowerCase().includes(q);
    })
    .map(({ i }) => i);
}

function getBatchActionName() {
  if (batchPendingAction === "delete") return "Delete";
  if (batchPendingAction === "level") return `Set Lv${batchTargetLevel}`;
  return "Apply";
}

function updateBatchActionBar(visibleCount = getBatchVisibleIndices().length) {
  if (batchSelectBtn) batchSelectBtn.textContent = batchSelectMode ? "Cancel" : "Multi-select";

  if (batchRunBtn) {
    batchRunBtn.textContent = `${getBatchActionName()} (${batchSelected.size})`;
    batchRunBtn.classList.toggle("hidden", !batchSelectMode);
    batchRunBtn.disabled = batchSelected.size === 0;
  }

  if (batchSelectVisibleBtn) {
    batchSelectVisibleBtn.classList.toggle("hidden", !batchSelectMode);
    batchSelectVisibleBtn.disabled = visibleCount === 0;
  }
}

function clearBatchFilters() {
  document.getElementById("batchSearch").value = "";
  document.getElementById("batchFilterLevel").value = "";
  renderBatchList();
}

function openCardFromList(cardIndex) {
  const card = cards[cardIndex];
  if (card) {
    filters.add(card.level);
    const cb = document.querySelector(`.filterCheckbox[data-lv="${card.level}"]`);
    if (cb) cb.checked = true;
  }

  index = cardIndex;
  closeBatchEditor();
  applyFiltersAndShow();
}

function toggleSelectVisible() {
  const visible = getBatchVisibleIndices();
  const allVisibleSelected = visible.length > 0 && visible.every(i => batchSelected.has(i));

  visible.forEach(i => {
    if (allVisibleSelected) batchSelected.delete(i);
    else batchSelected.add(i);
  });

  renderBatchList();
}


function toggleBatchSelectMode() {
  // まだ選択モードでない → 操作選択モーダルを開いてから選択モードへ入る流れ
  if (!batchSelectMode) {
    openBatchModeModal();
    return;
  }

  // すでに選択モード → キャンセル（選択を解除して UI 戻す）
  batchSelectMode = false;
  batchSelected.clear();
  updateBatchActionBar();
  renderBatchList();
}



function openBatchModeModal() {
  document.getElementById("batchModeModal").style.display = "flex";
}

function closeBatchModeModal() {
  document.getElementById("batchModeModal").style.display = "none";

  // ボタンを戻す
  document.querySelectorAll(
    "#batchModeModal > .modal-content > .rounded"
  ).forEach(btn => btn.classList.remove("hidden"));

  // レベル指定UIを隠す
  document.getElementById("batchLevelChooser").style.display = "none";
}


function startBatchDelete() {
  batchPendingAction = "delete";
  enableBatchSelectMode();
  closeBatchModeModal();
}

function startBatchLevel() {
  // アクション選択ボタンを隠す
   document.querySelectorAll(
    "#batchModeModal > .modal-content > .rounded"
  ).forEach(btn => btn.classList.add("hidden"));

  // レベル指定UIを表示
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
  batchSelected = new Set();
  updateBatchActionBar();

  renderBatchList();
}


function runBatchAction() {

  if (batchSelected.size === 0) {
    alert("No cards selected.");
    return;
  }

  const targets = Array.from(batchSelected).sort((a,b)=>b-a);

  if (batchPendingAction === "delete") {

    if (!confirm("Delete selected cards?")) return;
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
  cache[currentSetId] = cloneCards(cards);
  saveLocalCache();

  renderBatchList();
  applyFiltersAndShow();
  updateBatchActionBar();

}

function renderBatchList() {
  const container = document.getElementById("batchList");
  const meta = document.getElementById("batchMeta");
  const visibleIndices = getBatchVisibleIndices();

  container.innerHTML = "";

  if (meta) {
    const selectedText = batchSelectMode ? ` / ${batchSelected.size} selected` : "";
    meta.textContent = `${visibleIndices.length} / ${cards.length} cards${selectedText}`;
  }

  if (visibleIndices.length === 0) {
    const empty = document.createElement("div");
    empty.className = "batch-empty";
    empty.textContent = "No cards found.";
    container.appendChild(empty);
    updateBatchActionBar(0);
    return;
  }

  visibleIndices.forEach(i => {
    const c = cards[i];

    const row = document.createElement("div");
    row.className = "batch-row";
    if (batchSelectMode) row.classList.add("selecting");
    if (i === index) row.classList.add("current");

    // --- checkbox ---
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "batch-check";
    checkbox.style.display = batchSelectMode ? "block" : "none";
    checkbox.checked = batchSelected.has(i);
    checkbox.onchange = e => {
      if (e.target.checked) batchSelected.add(i);
      else batchSelected.delete(i);
      e.stopPropagation();
      updateBatchActionBar(visibleIndices.length);
      renderBatchList();
    };

    // --- 番号 ---
    const num = document.createElement("div");
    num.className = "num";
    num.textContent = i+1;

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "batch-open";
    openBtn.textContent = "Open";
    openBtn.onclick = () => openCardFromList(i);

    // --- front textarea ---
    const frontWrap = document.createElement("label");
    frontWrap.className = "batch-text-wrap";
    const frontLabel = document.createElement("span");
    frontLabel.className = "batch-text-label";
    frontLabel.textContent = "Front";
    const front = document.createElement("textarea");
    front.value = c.front;
    front.className = "batch-text";
    front.oninput = e => {
      cards[i].front = e.target.value;
      dirty = true;
      cache[currentSetId] = cloneCards(cards);
      saveLocalCache();
    };
    frontWrap.appendChild(frontLabel);
    frontWrap.appendChild(front);

    // --- back textarea ---
    const backWrap = document.createElement("label");
    backWrap.className = "batch-text-wrap";
    const backLabel = document.createElement("span");
    backLabel.className = "batch-text-label";
    backLabel.textContent = "Back";
    const back = document.createElement("textarea");
    back.value = c.back;
    back.className = "batch-text";
    back.oninput = e => {
      cards[i].back = e.target.value;
      dirty = true;
      cache[currentSetId] = cloneCards(cards);
      saveLocalCache();
    };
    backWrap.appendChild(backLabel);
    backWrap.appendChild(back);

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
      cache[currentSetId] = cloneCards(cards);
      saveLocalCache();
      renderBatchList();
    };

    row.appendChild(checkbox);
    row.appendChild(num);
    row.appendChild(openBtn);
    row.appendChild(frontWrap);
    row.appendChild(backWrap);
    row.appendChild(lv);

    container.appendChild(row);
  });

  const allVisibleSelected = visibleIndices.length > 0 && visibleIndices.every(i => batchSelected.has(i));
  if (batchSelectVisibleBtn) {
    batchSelectVisibleBtn.textContent = allVisibleSelected ? "Clear visible" : "Select visible";
  }
  updateBatchActionBar(visibleIndices.length);
}

// ---------- 保存（GAS へ一括送信） ----------
async function saveAll() {
  if (!dirty) return;

  showLoading();
  try {
    const sheet = SHEETS[currentSetId];
    const payload = cards.map(c => [c.front, c.back, c.level]);
    const res = await saveToGAS(sheet, payload);

    if (res && (res.status === "success" || res.status === "ok" || res.status === "done")) {
      dirty = false;
      cache[currentSetId] = cloneCards(cards);
      saveLocalCache();
      // ← 成功時は何も表示しない
    } else {
      throw new Error("unexpected response");
    }

  } catch (e) {
    alert("Failed to save: " + (e.message || e));
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
  const card = document.getElementById("card");
  if (!card) return;
  if (card.classList.contains("flipped")) return;// 裏面で開かせない

  const el = document.getElementById("filterPanel");
  if (!el) return;

  const isOpen = getComputedStyle(el).display !== "none";
  el.style.display = isOpen ? "none" : "block";
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
    { id: "testPopup", close: closeTestPopup },
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
      !e.target.closest(".icon-small,.filter")
    ) {
      filter.style.display = "none";
    }
  }

});

function isAnyModalOpen() {
  return Array.from(document.querySelectorAll(".modal"))
    .some(m => getComputedStyle(m).display !== "none");
}
