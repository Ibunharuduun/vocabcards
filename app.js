
//const CSV_FILES = {
  //0: "eng1.csv",
  //1: "eng2.csv",
  //2: "eng3.csv",
  //3: "old1.csv",
  //4: "old2.csv"
//};

let currentSetId = 0;

async function testLoad() {
  const res = await fetch(GAS_URL + "?id=eng1");
  const json = await res.json();
  console.log("取得データ:", json);
}



const GAS_URL = "https://script.google.com/macros/s/AKfycby-mknctB0oetIWm23X2o-OnP16q0e3VcBdqzos_X0Xdl5uvaDfxUp7K22fjaMa2OJ1/exec";


let cards = [];
let index = 0;

const slider  = document.getElementById("cardSlider");
const counter = document.getElementById("cardCount");

function toggleMenu(el) {
  const box = el.nextElementSibling;
  if (!box) return;

  const isOpen = box.style.display === "block";
  box.style.display = isOpen ? "none" : "block";
  el.textContent = (isOpen ? "▸" : "▾") + el.textContent.slice(1);
}

const SHEETS = {
  0: "eng1",
  1: "eng2",
  2: "eng3",
  3: "old1",
  4: "old2"
};

async function preloadAll() {
  await Promise.all(
    Object.entries(SHEETS).map(async ([id, sheet]) => {
      if (cache[id]) return;

      const res = await fetch(GAS_URL + "?id=" + sheet);
      const json = await res.json();

      cache[id] = json
        .filter(r => r.length >= 2)
        .map(r => [String(r[0] || ""), String(r[1] || "")]);

      console.log("preloaded:", sheet);
    })
  );
}


window.addEventListener("DOMContentLoaded", () => {
  loadSet(0);     // 最初の表示
  preloadAll();   // 裏で全部読む
});


async function loadSet(id) {
  try {
    currentSetId = id;

    // 🔹キャッシュがあれば即使用
    if (cache[id]) {
      cards = cache[id];
      index = 0;
      slider.max = Math.max(cards.length - 1, 0);
      slider.value = 0;
      show();
      return;
    }

    const sheet = SHEETS[id];
    const res = await fetch(GAS_URL + "?id=" + sheet);
    const json = await res.json();

    cards = json
      .filter(r => r.length >= 2)
      .map(r => [String(r[0] || ""), String(r[1] || "")]);

    cache[id] = cards;   // 🔹保存

    index = 0;
    slider.max = Math.max(cards.length - 1, 0);
    slider.value = 0;
    show();

  } catch (err) {
    alert("読み込みエラー：" + err.message);
  }
}



async function saveCurrent() {
  const sheet = SHEETS[currentSetId];
  await saveToGAS(sheet);
}

const cache = {};

function show() {
  if (!cards.length) return;

  const front = document.getElementById("front");
  const back  = document.getElementById("back");
  const card  = document.getElementById("card");

  front.textContent = cards[index][0];
  back.textContent  = cards[index][1];
  card.classList.remove("flipped");

  slider.value = index;
  counter.textContent = (index + 1) + " / " + cards.length;
}

function next() {
  if (index < cards.length - 1) index++;
  show();
}

function prev() {
  if (index > 0) index--;
  show();
}

slider.addEventListener("input", () => {
  index = Number(slider.value);
  show();
});

document.getElementById("card").onclick = () => {
  document.getElementById("card").classList.toggle("flipped");
};

window.addEventListener("DOMContentLoaded", () => {
  loadSet(0);
});
