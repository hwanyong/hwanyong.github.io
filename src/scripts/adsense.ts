/**
 * AdSense 광고 슬롯 초기화.
 *
 * 로더 스크립트(<script async src="…adsbygoogle.js">)는 Google 이 요구하는
 * 원형 그대로 AdSenseHead.astro 의 <head> 에 남기고, push 로직만 여기로 뺐다.
 *
 * push 를 슬롯 컴포넌트가 아니라 초기화기 한 곳에서 하는 이유:
 *   Astro 는 동일한 <script> 를 페이지당 한 번만 출력한다(deduplication).
 *   슬롯 컴포넌트마다 push({}) 를 넣으면 슬롯이 3개여도 push 는 1번만 나가서
 *   2·3번째 광고가 영원히 빈칸이 된다 — 빌드 에러 없이 조용히 실패한다.
 */

declare global {
  interface Window {
    adsbygoogle?: unknown[];
    __adPushedSlots?: WeakSet<Element>;
    __adRouterBound?: boolean;
  }
}

const pushedSlots = (): WeakSet<Element> => {
  window.__adPushedSlots ??= new WeakSet();
  return window.__adPushedSlots;
};

const initAdSlots = (): void => {
  const pushed = pushedSlots();

  for (const slot of document.querySelectorAll('ins.adsbygoogle')) {
    // 이미 채워진 슬롯을 다시 push 하는 것은 정책상 '사용자 요청 없는 새로고침'이다.
    if (pushed.has(slot)) continue;
    pushed.add(slot);

    try {
      (window.adsbygoogle ??= []).push({});
    } catch (error) {
      console.warn('[adsense] push 실패', error);
      break;
    }
  }
};

export const initAdSense = (): void => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdSlots, { once: true });
  } else {
    initAdSlots();
  }

  // ClientRouter(뷰 트랜지션)를 나중에 켤 경우를 대비한 훅.
  // astro:page-load 는 ClientRouter 가 없으면 발화하지 않으므로 무해하다.
  if (window.__adRouterBound) return;
  window.__adRouterBound = true;
  document.addEventListener('astro:page-load', initAdSlots);
};

export {};
