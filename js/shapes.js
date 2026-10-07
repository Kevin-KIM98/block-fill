// 블럭 모양 정의. 기본형을 회전시켜 중복 없는 전체 목록을 만든다.
// color는 모양마다 고유한 색 번호(css의 --cN). 8은 기본 블럭(game.js의 STONE)이라 쓰지 않는다.
// 순서·weight를 바꾸면 일일 도전 판이 달라지므로 자정(KST) 직후에만 배포한다.
const BASES = [
  { name: 'dot', color: 1, weight: 4, rows: ['#'] },
  { name: 'i2', color: 2, weight: 6, rows: ['##'] },
  { name: 'i3', color: 3, weight: 7, rows: ['###'] },
  { name: 'i4', color: 4, weight: 5, rows: ['####'] },
  { name: 'i5', color: 5, weight: 3, rows: ['#####'] },
  { name: 'o2', color: 6, weight: 7, rows: ['##', '##'] },
  { name: 'o3', color: 7, weight: 3, rows: ['###', '###', '###'] },
  { name: 'r23', color: 9, weight: 4, rows: ['###', '###'] },
  { name: 'l3', color: 10, weight: 7, rows: ['#.', '##'] },
  { name: 'l4', color: 11, weight: 5, rows: ['#.', '#.', '##'] },
  { name: 'j4', color: 12, weight: 5, rows: ['.#', '.#', '##'] },
  { name: 't4', color: 13, weight: 5, rows: ['###', '.#.'] },
  { name: 's4', color: 14, weight: 3, rows: ['.##', '##.'] },
  { name: 'z4', color: 15, weight: 3, rows: ['##.', '.##'] },
  { name: 'l5', color: 16, weight: 3, rows: ['#..', '#..', '###'] },
];

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
