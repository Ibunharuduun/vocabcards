
const CSV_FILES = {
  0: "eng1.csv",
  1: "eng2.csv",
  2: "eng3.csv",
  3: "old1.csv",
  4: "old2.csv"
};

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

async function loadSet(id) {
  try {
    const res = await fetch(CSV_FILES[id]);
    const text = await res.text();

    const parsed = Papa.parse(text);

    cards = parsed.data
      .filter(r => r.length >= 2 && r[0] && r[1])
      .map(r => [r[0], r[1]]);

    index = 0;

    slider.max = Math.max(cards.length - 1, 0);
    slider.value = 0;

    show();

  } catch (err) {
    alert("読み込みエラー：" + err);
  }
}

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

loadSet(0);
