// tools/vault-images.ts — 옵시디언 볼트의 그림을 public/images/figures/ 로 옮긴다.
//
// 이 도구의 존재 이유는 복사가 아니라 ★마커 가드★ 다.
// 볼트의 그림 파일명에는 출처가 박혀 있다(볼트 규칙 12).
//
//   (figure)     내가 다시 그린 것          → 발행 가능
//   (replica)    책 도판의 수치·배치 전사    → ★보류★ (docs/content-plan.md §3)
//   (book-scan)  책 스캔                    → 발행 불가
//   (ext-src)    외부 출처(블로그·스톡)      → 발행 불가
//   마커 없음     own work 로 간주            → 발행 가능
//
// ★ 같은 그림이 (figure) 와 (book-scan) 두 벌로 존재하는 경우가 실제로 있다
//   (예: LA6-2 pure-rotation-cw-36deg). 둘은 정규화하면 같은 이름이 되므로,
//   이름만 보고 고르면 책 스캔이 그대로 나갈 수 있다. 그래서 후보가 여럿일 때
//   own work 를 고르고, own work 가 하나도 없으면 ★복사하지 않고 죽는다★.
//
// ── 무엇을 옮길지는 이 파일이 정하지 않는다 ──────────────────────────────────
// 콘텐츠가 `/images/figures/<이름>` 을 참조하면 그것이 곧 주문서다.
// 매니페스트를 따로 두지 않는 이유: 두 벌이 되면 어긋나고, 어긋나면
// 아무도 안 쓰는 그림이 public/ 에 쌓인다. 참조된 것만 존재한다.
//
//   pnpm run images:vault          없는 것을 볼트에서 복사한다
//   pnpm run images:vault --check  복사하지 않고 빠진 것만 알린다(CI 용)
//
// 생성 썸네일(`/images/lecture/thumb/`)은 이 도구의 소관이 아니다 —
// 볼트에 원본이 없고 이 저장소가 직접 그린 것이라 그대로 커밋된다.
import { readFileSync, readdirSync, statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

/** 볼트 위치. iCloud 경로가 길고 기기마다 다를 수 있어 환경변수로 덮을 수 있게 둔다. */
const VAULT =
  process.env['NOTEBOOKS_VAULT'] ??
  join(
    process.env['HOME'] ?? '',
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/notebooks',
  );

/** 볼트에서 읽지 않는 곳. 백업·자동화 산출물에는 옛 마커가 섞여 있다. */
const VAULT_SKIP = new Set(['.git', '.obsidian', '.claude', '90_보관', '__temp', 'node_modules']);

const CONTENT_DIRS = ['src/content/lecture', 'src/content/log'];
const PUBLIC_DIR = 'public/images/figures';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const BLOCKED = new Set(['book-scan', 'ext-src', 'replica']);

const walk = (dir: string, skip: Set<string> = new Set()): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, skip));
    else out.push(full);
  }
  return out;
};

/** 파일명에서 마커를 뽑는다. 없으면 own work 로 간주한다(볼트 규칙 12). */
const markerOf = (file: string): string | null =>
  /\((book-scan|ext-src|figure|replica)\)/.exec(basename(file))?.[1] ?? null;

/**
 * 볼트 파일명 → URL 로 쓸 이름.
 *   `LA1-5 dot-product-sign-vs-angle (figure).png` → `la1-5-dot-product-sign-vs-angle.png`
 * 마커를 지우는 것이 핵심이다 — 마커는 볼트의 관리 정보지 독자에게 보일 것이 아니다.
 */
const publicNameOf = (file: string): string => {
  const ext = extname(file).toLowerCase();
  const stem = basename(file, extname(file))
    .replace(/\s*\((book-scan|ext-src|figure|replica)\)\s*/g, '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\s_·]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${stem}${ext}`;
};

/** 콘텐츠가 참조하는 `/images/figures/…` 이름을 전부 모은다. */
const referencedNames = (): Map<string, string[]> => {
  const wanted = new Map<string, string[]>();
  for (const dir of CONTENT_DIRS) {
    for (const file of walk(dir)) {
      if (extname(file) !== '.md') continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/\/images\/figures\/([\w.-]+)/g)) {
        const name = match[1];
        if (!name) continue;
        wanted.set(name, [...(wanted.get(name) ?? []), file]);
      }
    }
  }
  return wanted;
};

/** 볼트의 그림 전부를 `공개이름 → 후보들` 로 뒤집는다. */
const vaultIndex = (): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const file of walk(VAULT, VAULT_SKIP)) {
    if (!IMAGE_EXT.has(extname(file).toLowerCase())) continue;
    const name = publicNameOf(file);
    index.set(name, [...(index.get(name) ?? []), file]);
  }
  return index;
};

const main = () => {
  const check = process.argv.includes('--check');
  const wanted = referencedNames();

  if (wanted.size === 0) {
    console.log('[vault-images] 참조된 볼트 그림이 없습니다.');
    return;
  }

  const index = vaultIndex();
  const problems: string[] = [];
  const copied: string[] = [];
  let present = 0;

  for (const [name, usedBy] of [...wanted].sort()) {
    const dest = join(PUBLIC_DIR, name);
    if (existsSync(dest)) {
      present += 1;
      continue;
    }

    const candidates = index.get(name) ?? [];
    if (candidates.length === 0) {
      problems.push(`  ${name}\n    볼트에서 찾지 못했습니다. 쓰는 곳: ${usedBy.join(', ')}`);
      continue;
    }

    // ★ 여기가 가드다. 후보가 여럿이면 own work 만 남기고, 하나도 없으면 죽는다.
    const allowed = candidates.filter((file) => !BLOCKED.has(markerOf(file) ?? ''));
    if (allowed.length === 0) {
      const markers = candidates.map((file) => markerOf(file) ?? 'none').join(' · ');
      problems.push(
        `  ${name}\n    발행할 수 없는 그림입니다(${markers}). 타인 저작이거나 보류 대상입니다.\n` +
          `    쓰는 곳: ${usedBy.join(', ')}`,
      );
      continue;
    }

    const source = allowed[0];
    if (!source) continue;
    if (!check) {
      mkdirSync(PUBLIC_DIR, { recursive: true });
      copyFileSync(source, dest);
    }
    copied.push(`  ${name}  ←  ${basename(source)}`);
  }

  if (copied.length > 0) {
    console.log(check ? '[vault-images] 빠진 그림:' : '[vault-images] 복사함:');
    console.log(copied.join('\n'));
  }

  if (problems.length > 0) {
    console.error('\n[vault-images] 옮길 수 없는 그림이 있습니다:\n' + problems.join('\n'));
    process.exit(1);
  }

  if (check && copied.length > 0) process.exit(1);
  console.log(`[vault-images] 통과 — 참조 ${wanted.size} · 이미 있음 ${present} · 새로 ${copied.length}`);
};

main();
