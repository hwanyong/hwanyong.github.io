// src/pages/rss.xml.ts — RSS 피드.
// 확장자가 붙은 엔드포인트라 trailing slash 없이 /rss.xml 로만 접근된다.
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getLogEntries } from '../lib/content';
import { DEFAULT_LOCALE, LOCALES, ORIGIN } from '../lib/i18n';
import { logHref } from '../lib/routes';
import { UI } from '../lib/ui';

// S3 에서 [...lang]/rss.xml.ts 가 되어 로케일마다 하나씩 낸다.
const locale = DEFAULT_LOCALE;

export async function GET(context: APIContext) {
  const posts = await getLogEntries();

  return rss({
    title: UI[locale].site.title,
    description: UI[locale].site.description,
    // context.site 는 astro.config.ts 의 site 에서 온다.
    site: context.site ?? ORIGIN,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      categories: post.data.tags,
      link: logHref(locale, post.id),
    })),
    // ko-kr 은 RSS Advisory Board 의 언어 코드 목록에 없는 값이었다.
    // LOCALES 의 hreflang 이 그 목록과 같은 어휘를 쓰므로 여기서 파생한다.
    customData: `<language>${LOCALES[locale].hreflang}</language>`,
  });
}
