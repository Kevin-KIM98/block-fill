// 블럭 모양 정의. 기본형을 회전시켜 중복 없는 전체 목록을 만든다.
// weight: 뽑힐 비중. 테트리스 7종(i4·o2·t4·s4·z4·l4·j4)이 전체의 약 2/3,
// 작은 블럭(1~3칸)이 약 15%, 큰 블럭(5칸 이상)이 약 20%가 되도록 맞춘다.
// 순서·weight를 바꾸면 일일 도전 판이 달라지므로 자정(KST) 직후에만 배포한다.
const BASES = [
  // 처음 15종. 순서를 바꾸면 저장된 판의 블럭 id가 어긋나므로 그대로 둔다.
  { name: 'dot', weight: 2, rows: ['#'] },
  { name: 'i2', weight: 3, rows: ['##'] },
  { name: 'i3', weight: 4, rows: ['###'] },
  { name: 'i4', weight: 10, rows: ['####'] },
  { name: 'i5', weight: 3, rows: ['#####'] },
  { name: 'o2', weight: 8, rows: ['##', '##'] },
  { name: 'o3', weight: 1, rows: ['###', '###', '###'] },
  { name: 'r23', weight: 2, rows: ['###', '###'] },
  { name: 'l3', weight: 4, rows: ['#.', '##'] },
  { name: 'l4', weight: 9, rows: ['#.', '#.', '##'] },
  { name: 'j4', weight: 9, rows: ['.#', '.#', '##'] },
  { name: 't4', weight: 9, rows: ['###', '.#.'] },
  { name: 's4', weight: 7, rows: ['.##', '##.'] },
  { name: 'z4', weight: 7, rows: ['##.', '.##'] },
  { name: 'l5', weight: 2, rows: ['#..', '#..', '###'] },
  // 추가 모양 (v1.2). 새 모양은 반드시 목록 끝에만 붙인다.
  { name: 'diag2', weight: 1, rows: ['#.', '.#'] },
  { name: 'diag3', weight: 1, rows: ['#..', '.#.', '..#'] },
  { name: 't5', weight: 2, rows: ['###', '.#.', '.#.'] },
  { name: 'plus', weight: 1, rows: ['.#.', '###', '.#.'] },
  { name: 'u5', weight: 2, rows: ['#.#', '###'] },
  { name: 'n5', weight: 1, rows: ['.##', '.#.', '##.'] },
  { name: 'w5', weight: 1, rows: ['#..', '##.', '.##'] },
  { name: 'tall5', weight: 2, rows: ['#.', '#.', '#.', '##'] },
  { name: 'tallj5', weight: 2, rows: ['.#', '.#', '.#', '##'] },
];

// 색 번호: 기본형 순서대로 1부터. 8은 기본 블럭(game.js의 STONE)이라 건너뛴다.
let colorNo = 1;
for (const b of BASES) { if (colorNo === 8) colorNo++; b.color = colorNo++; }

function toCells(rows) {
  const cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') cells.push([r, c]); }));
  return cells;
}

function normalize(cells) {
  const minR = Math.min(...cells.map((p) => p[0]));
  const minC = Math.min(...cells.map((p) => p[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

const rotate = (cells) => normalize(cells.map(([r, c]) => [c, -r]));

export const SHAPES = [];
for (const base of BASES) {
  const seen = new Set();
  const variants = [];
  let cells = normalize(toCells(base.rows));
  for (let i = 0; i < 4; i++) {
    const key = JSON.stringify(cells);
    if (!seen.has(key)) { seen.add(key); variants.push(cells); }
    cells = rotate(cells);
  }
  variants.forEach((v, i) => {
    SHAPES.push({
      id: SHAPES.length,
      name: `${base.name}_${i}`,
      color: base.color,
      weight: base.weight / variants.length,
      cells: v,
      h: Math.max(...v.map((p) => p[0])) + 1,
      w: Math.max(...v.map((p) => p[1])) + 1,
    });
  });
}

export const TOTAL_WEIGHT = SHAPES.reduce((s, x) => s + x.weight, 0);
