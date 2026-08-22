// tools/thumbnails.ts — 강의 카드의 썸네일을 그린다.
//
//   pnpm run images:thumb        public/images/lecture/thumb/*.svg 를 다시 그린다
//
// ── ★ 왜 볼트 그림을 쓰지 않는가 ────────────────────────────────────────────
// 볼트의 (figure) 는 라벨·눈금·범례가 붙은 matplotlib 도판이라 ★크게 볼 때★
// 읽으라고 만든 것이다. 갤러리 카드는 480×270 이고 그 안에서 축 라벨은 뭉갠 점이
// 된다. 그래서 역할을 가른다 — 볼트 그림은 ★본문★ 으로 가고(tools/vault-images.ts),
// 썸네일은 카드 크기에서 한눈에 읽히도록 여기서 따로 그린다.
//
// ── ★ 왜 글자가 하나도 없는가 ──────────────────────────────────────────────
// <img> 로 들어간 SVG 는 이 사이트의 웹폰트를 불러오지 못한다. 글자를 넣으면
// 기기마다 다른 시스템 폰트로 떨어져 카드 격자의 인상이 흔들린다. 게다가 제목은
// 카드 바로 아래에 글자로 이미 있다 — 썸네일까지 제목을 반복할 이유가 없다.
// 그래서 썸네일은 ★그 차시가 다루는 수학적 대상의 모양★ 만 보여 준다.
//
// ── ★ 왜 REFLECT 팔레트 한 벌인가 ──────────────────────────────────────────
// <img> 한 장은 조명 상태를 따라갈 수 없다(테마마다 다른 파일을 줄 방법이 없다).
// 두 상태 모두에서 버티는 중간색을 찾는 대신 ★종이★ 로 못박았다 —
// REFLECT 에서는 본문에 잠기고 EMIT 에서는 불 켜진 판이 된다. 둘 다 의도된 모습이다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/images/lecture/thumb';
const W = 1280;
const H = 720;

/** src/styles/global.css 의 REFLECT 토큰과 같은 값이다. 바꿀 때 함께 본다. */
const C = {
  paper: '#bfb8a0', // --bg-2
  grid: '#948c76', //  --rule
  ink: '#1a1613', //   --ink
  ink2: '#554b42', //  --ink-3
} as const;

type Point = readonly [number, number];

const round = (n: number) => Math.round(n * 10) / 10;
const xy = ([x, y]: Point) => `${round(x)},${round(y)}`;

const grid = (step = 80) => {
  const lines: string[] = [];
  for (let x = step; x < W; x += step) lines.push(`M${x} 0V${H}`);
  for (let y = step; y < H; y += step) lines.push(`M0 ${y}H${W}`);
  return `<path d="${lines.join('')}" stroke="${C.grid}" stroke-width="1" opacity=".38" fill="none"/>`;
};

const axes = (o: Point) => {
  const [ox, oy] = o;
  return (
    `<path d="M0 ${oy}H${W} M${ox} 0V${H}" stroke="${C.ink2}" stroke-width="2.5" opacity=".55" fill="none"/>` +
    `<circle cx="${ox}" cy="${oy}" r="6" fill="${C.ink2}"/>`
  );
};

/** 화살표 하나. head 는 선을 덮지 않도록 선을 미리 잘라 그린다. */
const arrow = (from: Point, to: Point, width = 7, color: string = C.ink) => {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = width * 3.6;
  const base: Point = [x2 - ux * head, y2 - uy * head];
  const wing = head * 0.42;
  const left: Point = [base[0] - uy * wing, base[1] + ux * wing];
  const right: Point = [base[0] + uy * wing, base[1] - ux * wing];
  return (
    `<path d="M${xy(from)}L${xy(base)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" fill="none"/>` +
    `<polygon points="${xy(left)} ${xy(right)} ${xy(to)}" fill="${color}"/>`
  );
};

const dashed = (d: string, color: string = C.ink2, width = 3) =>
  `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-dasharray="12 10" fill="none" opacity=".85"/>`;

/** 두 방향 사이의 호. 사잇각을 가리킬 때 쓴다. */
const arc = (o: Point, a: Point, b: Point, r: number) => {
  const ang = (p: Point) => Math.atan2(p[1] - o[1], p[0] - o[0]);
  const [a0, a1] = [ang(a), ang(b)];
  const start: Point = [o[0] + r * Math.cos(a0), o[1] + r * Math.sin(a0)];
  const end: Point = [o[0] + r * Math.cos(a1), o[1] + r * Math.sin(a1)];
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const sweep = delta > 0 ? 1 : 0;
  return `<path d="M${xy(start)}A${r} ${r} 0 0 ${sweep} ${xy(end)}" stroke="${C.ink2}" stroke-width="3.5" fill="none"/>`;
};

/** 직각 표시. 투영이 수직임을 말한다. */
const rightAngle = (corner: Point, along: Point, up: Point, size = 26) => {
  const unit = (p: Point): Point => {
    const dx = p[0] - corner[0];
    const dy = p[1] - corner[1];
    const len = Math.hypot(dx, dy) || 1;
    return [dx / len, dy / len];
  };
  const [ax, ay] = unit(along);
  const [bx, by] = unit(up);
  const p1: Point = [corner[0] + ax * size, corner[1] + ay * size];
  const p3: Point = [corner[0] + bx * size, corner[1] + by * size];
  const p2: Point = [p1[0] + bx * size, p1[1] + by * size];
  return `<path d="M${xy(p1)}L${xy(p2)}L${xy(p3)}" stroke="${C.ink2}" stroke-width="3" fill="none"/>`;
};

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
  `<rect width="${W}" height="${H}" fill="${C.paper}"/>` +
  body +
  '</svg>\n';

// ── 도판들 ──────────────────────────────────────────────────────────────────
// 각 함수 = 썸네일 한 장. 이름이 곧 파일 이름이다.

/** 코스 표지(선형대수) — 두 벡터와 그 합. 이 과목이 다루는 것의 요약. */
const coverLinearAlgebra = () => {
  const o: Point = [360, 560];
  const v: Point = [700, 300];
  const w: Point = [780, 470];
  const sum: Point = [v[0] + w[0] - o[0], v[1] + w[1] - o[1]];
  return svg(
    grid() +
      axes(o) +
      dashed(`M${xy(v)}L${xy(sum)} M${xy(w)}L${xy(sum)}`) +
      arrow(o, v, 7) +
      arrow(o, w, 7) +
      arrow(o, sum, 10),
  );
};

/** 01 벡터 — 화살표 하나와 그 성분. 차원·방향이 성분에서 읽힌다. */
const vectors = () => {
  const o: Point = [340, 580];
  const p: Point = [900, 220];
  return svg(
    grid() +
      axes(o) +
      dashed(`M${xy(p)}L${p[0]},${o[1]} M${xy(p)}L${o[0]},${p[1]}`) +
      `<circle cx="${p[0]}" cy="${o[1]}" r="9" fill="${C.ink2}"/>` +
      `<circle cx="${o[0]}" cy="${p[1]}" r="9" fill="${C.ink2}"/>` +
      arrow(o, p, 9),
  );
};

/**
 * 02 노름 — 길이가 제각각인 벡터들이 모두 단위원 위 한 점으로 떨어진다.
 * 한 화살표를 줄여 보이면 "짧아졌다" 로만 읽혀 정규화가 드러나지 않는다(첫 시안).
 * 여럿이 같은 원 위에 앉는 그림이라야 ★길이를 버리고 방향만 남긴다★ 가 보인다.
 */
const norm = () => {
  const o: Point = [600, 450];
  const r = 175;
  const rays: readonly (readonly [number, number])[] = [
    [-0.35, 400],
    [-1.02, 300],
    [-1.85, 250],
    [0.42, 340],
  ];
  const at = (ang: number, len: number): Point => [
    o[0] + Math.cos(ang) * len,
    o[1] + Math.sin(ang) * len,
  ];
  return svg(
    grid() +
      axes(o) +
      rays.map(([ang, len]) => arrow(o, at(ang, len), 5, C.ink2)).join('') +
      `<circle cx="${o[0]}" cy="${o[1]}" r="${r}" stroke="${C.ink}" stroke-width="4.5" fill="none"/>` +
      rays
        .map(([ang]) => {
          const p = at(ang, r);
          return `<circle cx="${round(p[0])}" cy="${round(p[1])}" r="12" fill="${C.ink}"/>`;
        })
        .join(''),
  );
};

/** 05 내적 — 두 벡터, 사잇각, 그리고 하나를 다른 하나 위로 내린 그림자. */
const dotProduct = () => {
  const o: Point = [330, 590];
  const a: Point = [960, 430];
  const b: Point = [700, 200];
  // b 를 a 위로 정사영한 발
  const ax = a[0] - o[0];
  const ay = a[1] - o[1];
  const t = ((b[0] - o[0]) * ax + (b[1] - o[1]) * ay) / (ax * ax + ay * ay);
  const foot: Point = [o[0] + ax * t, o[1] + ay * t];
  return svg(
    grid() +
      axes(o) +
      arc(o, a, b, 130) +
      dashed(`M${xy(b)}L${xy(foot)}`) +
      rightAngle(foot, a, b) +
      arrow(o, a, 7) +
      arrow(o, b, 7) +
      `<path d="M${xy(o)}L${xy(foot)}" stroke="${C.ink}" stroke-width="12" stroke-linecap="round" opacity=".28" fill="none"/>`,
  );
};

/** 코스 표지(벡터 검색) — 점 구름 속 질의점과 그 이웃들. */
const coverVectorSearch = () => {
  const q: Point = [560, 380];
  // 고정 좌표다 — 난수를 쓰면 다시 그릴 때마다 그림이 바뀌어 diff 가 무의미해진다.
  const cloud: Point[] = [
    [250, 180], [400, 250], [690, 250], [880, 200], [1010, 330],
    [200, 430], [430, 520], [640, 560], [860, 480], [1060, 560],
    [330, 640], [760, 660], [980, 130], [150, 300], [520, 150],
  ];
  const near = cloud.filter((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 300);
  return svg(
    grid() +
      near
        .map(
          (p) =>
            `<path d="M${xy(q)}L${xy(p)}" stroke="${C.ink2}" stroke-width="3" opacity=".55" fill="none"/>`,
        )
        .join('') +
      [300, 210, 120]
        .map(
          (r) =>
            `<circle cx="${q[0]}" cy="${q[1]}" r="${r}" stroke="${C.ink2}" stroke-width="2.5" fill="none" opacity=".45"/>`,
        )
        .join('') +
      cloud
        .map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="13" fill="${C.ink2}" opacity=".9"/>`)
        .join('') +
      `<circle cx="${q[0]}" cy="${q[1]}" r="22" fill="${C.ink}"/>`,
  );
};

/** 02 유사도 — 길이를 지운 두 방향과 그 사잇각. 코사인이 재는 것이 각뿐임을 말한다. */
const similarity = () => {
  const o: Point = [500, 460];
  const r = 270;
  const a: Point = [o[0] + r, o[1]];
  const angle = -0.78;
  const b: Point = [o[0] + Math.cos(angle) * r, o[1] + Math.sin(angle) * r];
  const foot: Point = [o[0] + Math.cos(angle) * r, o[1]];
  return svg(
    grid() +
      // 두 벡터가 ★같은 원 위★ 에 있다 = 길이는 이미 지워졌고 남은 차이는 각뿐이다.
      // (첫 시안의 반원은 화면 밖으로 잘려 나가 잡음으로만 읽혔다.)
      `<circle cx="${o[0]}" cy="${o[1]}" r="${r}" stroke="${C.ink2}" stroke-width="2.5" fill="none" opacity=".5"/>` +
      arc(o, a, b, 130) +
      dashed(`M${xy(b)}L${xy(foot)}`) +
      rightAngle(foot, o, b) +
      arrow(o, a, 7) +
      arrow(o, b, 7) +
      `<path d="M${xy(o)}L${xy(foot)}" stroke="${C.ink}" stroke-width="14" stroke-linecap="round" opacity=".3" fill="none"/>`,
  );
};

/** 03 벡터 연산 — 꼬리를 머리에 잇는 덧셈. 평행사변형이 아니라 ★행렬★ 로 잇는 쪽. */
const vectorOperations = () => {
  // ★ 두 벡터의 방향이 비슷하면 셋이 한 뭉치로 겹쳐 삼각형이 안 보인다(첫 시안).
  //   각을 크게 벌려야 "꼬리를 머리에 잇는다" 가 형태로 읽힌다.
  const o: Point = [250, 540];
  const v: Point = [580, 190];
  const sum: Point = [980, 330];
  return svg(
    grid() +
      axes(o) +
      arrow(o, v, 7) +
      arrow(v, sum, 7, C.ink2) +
      arrow(o, sum, 11),
  );
};

/** 04 벡터 공리 — v 와 그 덧셈 역원 −v. 둘을 더하면 원점이다. */
const vectorAxioms = () => {
  const o: Point = [640, 380];
  const v: Point = [1000, 180];
  const neg: Point = [2 * o[0] - v[0], 2 * o[1] - v[1]];
  return svg(
    grid() +
      axes(o) +
      arrow(o, v, 8) +
      arrow(o, neg, 8, C.ink2) +
      `<circle cx="${o[0]}" cy="${o[1]}" r="17" fill="none" stroke="${C.ink}" stroke-width="5"/>`,
  );
};

/** 01 임베딩 — 바깥 세계의 것들이 같은 공간의 점으로 떨어진다. */
const embeddings = () => {
  // ★ 착지점이 경계선 양쪽에 흩어지면 "바깥 → 한 공간" 이 안 읽힌다(첫 시안).
  //   경계 왼쪽은 바깥 세계, 오른쪽은 벡터 공간 — 점은 전부 오른쪽에만 둔다.
  const slots: Point[] = [
    [90, 140],
    [90, 320],
    [90, 500],
  ];
  const landed: Point[] = [
    [700, 200],
    [890, 430],
    [660, 590],
  ];
  const others: Point[] = [
    [840, 140],
    [1090, 300],
    [980, 560],
    [620, 380],
    [1150, 460],
  ];
  return svg(
    grid() +
      // 왼쪽 = 바깥 세계(같은 크기의 무엇이든), 오른쪽 = 하나의 벡터 공간.
      slots
        .map(
          ([x, y]) =>
            `<rect x="${x}" y="${y}" width="150" height="90" rx="6" fill="none" stroke="${C.ink2}" stroke-width="4"/>`,
        )
        .join('') +
      `<path d="M520 60V660" stroke="${C.grid}" stroke-width="2.5" stroke-dasharray="10 12" fill="none"/>` +
      slots
        .map((s, i) => {
          const from: Point = [s[0] + 160, s[1] + 45];
          return arrow(from, landed[i] ?? from, 4, C.ink2);
        })
        .join('') +
      others.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="${C.ink2}" opacity=".55"/>`).join('') +
      landed.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="${C.ink}"/>`).join(''),
  );
};

const SHEETS: Record<string, () => string> = {
  'linear-algebra': coverLinearAlgebra,
  'linear-algebra-01-vectors': vectors,
  'linear-algebra-02-norm': norm,
  'linear-algebra-03-vector-operations': vectorOperations,
  'linear-algebra-04-vector-axioms': vectorAxioms,
  'linear-algebra-05-dot-product': dotProduct,
  'vector-search': coverVectorSearch,
  'vector-search-01-embeddings': embeddings,
  'vector-search-02-similarity': similarity,
};

mkdirSync(OUT, { recursive: true });
for (const [name, draw] of Object.entries(SHEETS)) {
  const file = join(OUT, `${name}.svg`);
  writeFileSync(file, draw(), 'utf8');
  console.log(`  ${file}`);
}
console.log(`[thumbnails] ${Object.keys(SHEETS).length}장 생성`);
