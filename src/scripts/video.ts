/**
 * VideoFacade 의 동작. 포스터를 누르면 그 자리에 YouTube iframe 을 만든다.
 *
 * 페이지에 영상이 없으면 즉시 반환한다(모든 페이지에서 안전하게 호출된다).
 * 버튼은 교체되므로 리스너를 개별로 달지 않고 위임 하나로 끝낸다.
 */
const EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

const play = (button: HTMLButtonElement): void => {
  const id = button.dataset.video;
  if (!id) return;

  const frame = document.createElement('iframe');
  frame.className = 'video__frame';
  // autoplay=1 은 사용자가 재생 버튼을 눌렀을 때만 붙는다 — 자동재생이 아니다.
  frame.src = `${EMBED_ORIGIN}/embed/${id}?autoplay=1&rel=0`;
  frame.title = button.getAttribute('aria-label') ?? 'YouTube';
  frame.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';

  button.replaceWith(frame);
};

export const initVideo = (): void => {
  const root = document.querySelector('.column');
  if (!root || !root.querySelector('[data-video]')) return;

  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      'button[data-video]',
    );
    if (button) play(button);
  });
};
