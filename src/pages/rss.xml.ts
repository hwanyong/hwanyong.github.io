// src/pages/rss.xml.ts — RSS 피드.
// 확장자가 붙은 엔드포인트라 trailing slash 없이 /rss.xml 로만 접근된다.
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getLogEntries } from '../lib/content';
import { SITE } from '../lib/site';
import { ORIGIN } from '../lib/i18n';

export async function GET(context: APIContext) {
  const posts = await getLogEntries();

  return rss({
    title: SITE.title,
    description: SITE.description,
    // context.site 는 astro.config.ts 의 site 에서 온다.
    site: context.site ?? ORIGIN,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      categories: post.data.tags,
      link: `/log/${post.id}/`,
    })),
    customData: `<language>ko-kr</language>`,
  });
}
