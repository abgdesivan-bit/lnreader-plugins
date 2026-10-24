import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';
import { fetchApi } from '@libs/fetch';
import { load as parseHTML } from 'cheerio';

const API =
  'https://api.mystorywave.com/story-wave-backend/api/v1/content';

type ApiResponse<T> = {
  data: T;
};

type ApiPage<T> = {
  list: T[];
  totalCount?: number;
  totalPages?: number;
};

type Book = {
  id: number | string;
  title?: string;
  authorPseudonym?: string;
  coverImgUrl?: string;
  synopsis?: string;
  genreName?: string;
  status?: string | number;
};

type Chapter = {
  id: number | string;
  title?: string;
  chapterOrder?: number | string;
  updateTime?: string;
  paywallStatus?: string;
  tier?: number | string;
  status?: string;
  content?: string;
};

function slug(text: string): string {
  return (
    text.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'book'
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Some APIs return HTML encoded as entities or as literal JSON Unicode escapes.
function decodeEncodedMarkup(value: string): string {
  const containsEncodedTag =
    /(?:&lt;|\\u003c)\s*\/?\s*(?:p|div|span|img|br|hr|h[1-6]|figure|section|article)\b/i.test(value);
  if (!containsEncodedTag) return value;

  return value
    .replace(/\\\\u003c/gi, '<')
    .replace(/\\\\u003e/gi, '>')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function lastSrcsetUrl(srcset?: string): string | undefined {
  if (!srcset) return undefined;
  const candidates = srcset
    .split(',')
    .map(candidate => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates[candidates.length - 1];
}

class BOTITranslation implements Plugin.PluginBase {
  id = 'BOTITranslation';
  name = 'BOTI Translation';
  site = 'https://www.botitranslation.com';
  version = '1.0.1';
  icon = 'siteNotAvailable.png';

  // LNReader uses these headers when saving the cover and chapter images.
  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: 'https://www.botitranslation.com/',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  };

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetchApi(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'site-domain': 'www.botitranslation.com',
      },
    });

    if (!response.ok) {
      throw new Error(
        `BOTI Translation: HTTP ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }

  private getId(path: string, type: 'book' | 'chapter'): string {
    const pattern =
      type === 'book'
        ? /\/book\/(\d+)/
        : /\/chapter\/(\d+)/;

    const match = path.match(pattern);

    if (!match) {
      throw new Error(`Cannot identify BOTI ${type} ID`);
    }

    return match[1];
  }

  private async getBook(id: string): Promise<Book> {
    const response = await this.getJson<ApiResponse<Book>>(
      `${API}/books/${encodeURIComponent(id)}`,
    );

    return response.data;
  }

  private async getChapters(id: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 1000) {
      const url =
        `${API}/chapters/page?sortDirection=ASC` +
        `&bookId=${encodeURIComponent(id)}` +
        `&pageNumber=${page}&pageSize=${pageSize}`;

      const response =
        await this.getJson<ApiResponse<ApiPage<Chapter>>>(url);

      const data = response.data;

      if (!data || !Array.isArray(data.list)) {
        throw new Error('Invalid BOTI chapter list');
      }

      if (data.list.length === 0) break;

      chapters.push(...data.list);

      totalPages =
        Number(data.totalPages) ||
        Math.max(
          1,
          Math.ceil(
            (Number(data.totalCount) || chapters.length) / pageSize,
          ),
        );

      page++;
    }

    return chapters.filter(chapter => {
      const published =
        !chapter.status ||
        String(chapter.status).toLowerCase() === 'published';

      const free =
        !chapter.paywallStatus ||
        String(chapter.paywallStatus).toLowerCase() === 'free';

      const freeTier =
        chapter.tier == null || Number(chapter.tier) === 0;

      return published && free && freeTier;
    });
  }

  private absoluteUrl(value?: string): string | undefined {
    const url = value?.trim();
    if (!url) return undefined;

    try {
      return new URL(url, this.site).href;
    } catch {
      return url;
    }
  }

  private bookItem(book: Book): Plugin.NovelItem {
    const title = book.title?.trim() || 'Untitled';

    return {
      name: title,
      path: `/book/${book.id}-${slug(title)}`,
      cover: this.absoluteUrl(book.coverImgUrl),
    };
  }

  async popularNovels(
    pageNo: number,
    _options: Plugin.PopularNovelsOptions<Filters>,
  ): Promise<Plugin.NovelItem[]> {
    const page = Math.max(1, Number(pageNo) || 1);

    const response =
      await this.getJson<ApiResponse<ApiPage<Book>>>(
        `${API}/books?pageNumber=${page}&pageSize=20`,
      );

    return (response.data.list || []).map(book =>
      this.bookItem(book),
    );
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim();

    if (!query) return [];

    const params = new URLSearchParams({
      keyWord: query,
      pageNumber: String(Math.max(1, Number(pageNo) || 1)),
      pageSize: '50',
    });

    const response =
      await this.getJson<ApiResponse<ApiPage<Book>>>(
        `${API}/books/search?${params.toString()}`,
      );

    return (response.data.list || []).map(book =>
      this.bookItem(book),
    );
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const id = this.getId(novelPath, 'book');

    const [book, chapters] = await Promise.all([
      this.getBook(id),
      this.getChapters(id),
    ]);

    return {
      ...this.bookItem(book),
      path: novelPath,
      author: book.authorPseudonym || '',
      summary: book.synopsis || '',
      genres: book.genreName || '',
      status: book.status == null ? '' : String(book.status),

      chapters: chapters.map(chapter => ({
        name: chapter.title || 'Chapter',
        path: `/chapter/${chapter.id}-${slug(
          chapter.title || 'chapter',
        )}`,
        ...(Number.isFinite(Number(chapter.chapterOrder))
          ? { chapterNumber: Number(chapter.chapterOrder) }
          : {}),
        ...(chapter.updateTime
          ? { releaseTime: chapter.updateTime }
          : {}),
      })),
    };
  }

  private normalizeImageSources(html: string): string {
    const $ = parseHTML(html, {}, false);
    $('img').each((_index, element) => {
      const image = $(element);
      const pictureSource = image.closest('picture').find('source').last();
      const pictureSrcset =
        pictureSource.attr('data-srcset') || pictureSource.attr('srcset');
      const candidates = [
        image.attr('data-src'),
        image.attr('data-original'),
        image.attr('data-lazy-src'),
        image.attr('data-url'),
        image.attr('data-image'),
        lastSrcsetUrl(image.attr('data-srcset')),
        image.attr('src'),
        lastSrcsetUrl(image.attr('srcset')),
        lastSrcsetUrl(pictureSrcset),
      ];

      let resolvedUrl: string | undefined;
      for (const candidate of candidates) {
        const value = candidate?.trim();
        if (
          !value ||
          /^(?:data:|blob:|javascript:|about:blank)/i.test(value) ||
          /(?:transparent\.gif|spacer\.gif|placeholder\.(?:gif|png)|loading\.gif)/i.test(value)
        ) {
          continue;
        }

        try {
          resolvedUrl = new URL(value.replace(/&amp;/gi, '&'), this.site).href;
        } catch {
          resolvedUrl = value;
        }
        if (resolvedUrl) break;
      }

      if (resolvedUrl) image.attr('src', resolvedUrl);
      else image.removeAttr('src');

      [
        'srcset',
        'data-src',
        'data-original',
        'data-lazy-src',
        'data-url',
        'data-image',
        'data-srcset',
      ].forEach(attribute => image.removeAttr(attribute));
    });

    return $.root().html() || html;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const id = this.getId(chapterPath, 'chapter');
    const response = await this.getJson<ApiResponse<Chapter>>(
      `${API}/chapters/${encodeURIComponent(id)}`,
    );

    const chapter = response.data;
    const content = decodeEncodedMarkup((chapter.content || '').trim());
    let body = content;

    // BOTI may store a chapter as HTML, escaped HTML, or plain text.
    if (!/<[a-z][^>]*>/i.test(content)) {
      body = content
        .split(/\r?\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('');
    }

    // LNReader downloads image files from <img src> when a chapter is downloaded.
    // The EPUB exporter then embeds those downloaded local images.
    body = this.normalizeImageSources(body);

    return '<h1>' + escapeHtml(chapter.title || 'Chapter') + '</h1>' + body;
  }

  resolveUrl(path: string, _isNovel?: boolean): string {
    if (/^https?:\/\//i.test(path)) return path;

    return this.site + (path.startsWith('/') ? path : `/${path}`);
  }
}

export default new BOTITranslation();
