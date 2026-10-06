// 블럭 모양 정의. 기본형을 회전시켜 중복 없는 전체 목록을 만든다.
const BASES = [
  { name: 'dot', color: 1, weight: 4, rows: ['#'] },
  { name: 'i2', color: 2, weight: 6, rows: ['##'] },
  { name: 'i3', color: 3, weight: 7, rows: ['###'] },
  { name: 'i4', color: 4, weight: 5, rows: ['####'] },
  { name: 'i5', color: 5, weight: 3, rows: ['#####'] },
  { name: 'o2', color: 6, weight: 7, rows: ['##', '##'] },
  { name: 'o3', color: 7, weight: 3, rows: ['###', '###', '###'] },
  { name: 'r23', color: 2, weight: 4, rows: ['###', '###'] },
  { name: 'l3', color: 1, weight: 7, rows: ['#.', '##'] },
  { name: 'l4', color: 3, weight: 5, rows: ['#.', '#.', '##'] },
  { name: 'j4', color: 4, weight: 5, rows: ['.#', '.#', '##'] },
  { name: 't4', color: 5, weight: 5, rows: ['###', '.#.'] },
  { name: 's4', color: 6, weight: 3, rows: ['.##', '##.'] },
  { name: 'z4', color: 7, weight: 3, rows: ['##.', '.##'] },
  { name: 'l5', color: 1, weight: 3, rows: ['#..', '#..', '###'] },
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
