import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';
import { fetchApi } from '@libs/fetch';

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

class BOTITranslation implements Plugin.PluginBase {
  id = 'BOTITranslation';
  name = 'BOTI Translation';
  site = 'https://www.botitranslation.com';
  version = '1.0.0';
  icon = 'siteNotAvailable.png';

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

  private bookItem(book: Book): Plugin.NovelItem {
    const title = book.title?.trim() || 'Untitled';

    return {
      name: title,
      path: `/book/${book.id}-${slug(title)}`,
      cover: book.coverImgUrl || undefined,
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

  async parseChapter(chapterPath: string): Promise<string> {
    const id = this.getId(chapterPath, 'chapter');

    const response =
      await this.getJson<ApiResponse<Chapter>>(
        `${API}/chapters/${encodeURIComponent(id)}`,
      );

    const chapter = response.data;
    const content = (chapter.content || '').trim();

    let body = content;

    // API content may already contain HTML.
    // Convert plain text into paragraphs when necessary.
    if (!/<[a-z][^>]*>/i.test(content)) {
      body = content
        .split(/\r?\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .join('');
    }

    return (
      `<h1>${escapeHtml(chapter.title || 'Chapter')}</h1>` +
      body
    );
  }

  resolveUrl(path: string, _isNovel?: boolean): string {
    if (/^https?:\/\//i.test(path)) return path;

    return this.site + (path.startsWith('/') ? path : `/${path}`);
  }
}

export default new BOTITranslation();
