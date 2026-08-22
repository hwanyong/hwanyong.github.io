// src/pages/[...lang]/rss.xml.ts — 로케일별 피드. 라우트 파일 하나가 로케일 수만큼 낸다.
// 확장자가 붙은 엔드포인트라 trailing slash 없이 /rss.xml · /ko/rss.xml 로만 접근된다.
//
// ★ 피드 범위가 log 가 아니라 전체 타임라인인 이유:
//   홈(index.astro)은 자기 존재 이유를 "두 축을 나눠 놓으면 언제 무엇을 했는지가
//   두 목록으로 쪼개져 읽히지 않는다" 로 선언하는데, 피드만 log 축을 싣고 있었다.
//   구독자는 홈에서 보는 것과 다른 것을 받고 있었던 셈이다. 여기서 그 불일치가 끝난다.
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getTimeline } from '../../lib/content';
import { FEED_URN_NS, LOCALE_CODES, LOCALES, ORIGIN, type Locale } from '../../lib/i18n';
import { feedHref, homeHref, langParam, logHref, revisionHref } from '../../lib/routes';
import { UI } from '../../lib/ui';

export const getStaticPaths = () =>
  LOCALE_CODES.map((locale) => ({ params: { lang: langParam(locale) }, props: { locale } }));

export async function GET(context: APIContext) {
  const { locale } = context.props as { locale: Locale };
  const t = UI[locale];
  const items = await getTimeline(locale);
  // context.site 는 astro.config.ts 의 site 에서 온다.
  const origin = context.site ?? new URL(ORIGIN);

  return rss({
    title: t.site.title,
    description: t.site.description,
    // ★ 채널 <link> 는 그 로케일의 홈이다. 두 피드가 같은 값을 쓰면 리더가 둘을
    //   구분할 표준 수단이 title 밖에 없어진다.
    site: new URL(homeHref(locale), origin),
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    items: items.map((item) => ({
      title: item.title,
      pubDate: item.date,
      description: item.description,
      categories: item.tags,
      link:
        item.kind === 'log'
          ? logHref(locale, item.slug)
          : revisionHref(locale, item.kind, item.slug, null),
      // ★ guid 는 URL 이 아니다. 기본 guid 는 link 라서 글이 이사하면 구독자의 리더가
      //   같은 글을 새 글로 다시 띄운다.
      //
      // ★ slug 가 아니라 identity 다. 강의의 slug 에는 과목이 들어 있고 과목은 분류라
      //   나중에 바뀔 수 있다 — guid 가 그것을 담으면 재분류가 전 구독자에게
      //   "새 글" 로 다시 뜬다. identity 는 과목을 담지 않는다.
      //   @astrojs/rss 는 customData 를 기본 guid 뒤에 병합하므로 이 한 줄이 기본값을 덮는다.
      customData: `<guid isPermaLink="false">${FEED_URN_NS}:${item.kind}:${item.identity}:${locale}</guid>`,
    })),
    customData:
      `<language>${LOCALES[locale].hreflang}</language>` +
      `<atom:link href="${new URL(feedHref(locale), origin).href}" rel="self" type="application/rss+xml"/>`,
  });
}
