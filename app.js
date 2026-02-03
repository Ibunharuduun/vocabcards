const CSV_FILES = [
  "eng1.csv",
  "eng2.csv",
  "eng3.csv",
  "old1.csv",
  "old2.csv"
];

let cards = [];
let index = 0;

// DOMキャッシュ
const frontEl = document.getElementById("front");
const backEl  = document.getElementById("back");
const cardEl  = document.getElementById("card");
const slider  = document.getElementById("cardSlider");
const counter = document.getElementById("cardCount");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

// メニュー開閉
document.querySelectorAll(".menu-parent").forEach(parent => {
  parent.addEventListener("click", () => parent.nextElementSibling.classList.toggle("open"));
});

// セット読み込み
document.querySelectorAll(".menu-item").forEach(item => {
  item.addEventListener("click", () => loadSet(Number(item.dataset.set)));
});

async function loadSet(id){
  try {
    const res = await fetch(CSV_FILES[id]);
    const text = await res.text();
    const parsed = Papa.parse(text);
    cards = parsed.data.filter(r=>r.length>=2 && r[0] && r[1])
                       .map(r=>({front:r[0], back:r[1]}));
    index=0;
    slider.max = Math.max(cards.length-1,0);
    slider.value = 0;
    show();
  } catch(e) { alert("読み込みエラー："+e); }
}

function show(){
  if(!cards.length) return;
  frontEl.textContent = cards[index].front;
  backEl.textContent  = cards[index].back;
  cardEl.classList.remove("flipped");
  slider.value = index;
  counter.textContent = `${index+1} / ${cards.length}`;
}

function next(){ if(index<cards.length-1) index++; show(); }
function prev(){ if(index>0) index--; show(); }

slider.addEventListener("input", ()=>{ index=Number(slider.value); show(); });
cardEl.addEventListener("click", ()=>cardEl.classList.toggle("flipped"));

// ボタン
nextBtn.addEventListener("click", next);
prevBtn.addEventListener("click", prev);

// 初期ロード
loadSet(0);
