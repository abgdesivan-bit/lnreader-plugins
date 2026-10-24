import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';
import { fetchApi } from '@libs/fetch';
импортировать {загрузить как parseHTML} из «cheerio»;

const API =
  'https://api.mystorywave.com/story-wave-backend/api/v1/content';

type ApiResponse<T> = {
  данные: Т;
};

type ApiPage<T> = {
  список: T[];
  totalCount?: число;
  totalPages?: число;
};

тип Книги = {
  id: number | string;
  заголовок?: строка;
  authorPseudonym?: string;
  coverImgUrl?: string;
  краткое содержание?: строка;
  genreName?: string;
  статус?: строка | число;
};

тип Глава = {
  id: number | string;
  заголовок?: строка;
  chapterOrder?: number | string;
  updateTime?: строка;
  paywallStatus?: string;
  уровень?: число | строка;
  статус?: строка;
  содержимое?: строка;
};

function slug(text: string): string {
  возвращаться (
    text.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'book'
  );
}

function escapeHtml(text: string): string {
  возвратный текст
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, ''');
}

// Некоторые API возвращают HTML-код, закодированный как сущности, или в виде буквальных JSON-элементов Unicode.
function decodeEncodedMarkup(value: string): string {
  const containsEncodedTag =
    /(?:<|\\u003c)\s*\/?\s*(?:p|div|span|img|br|hr|h[1-6]|figure|section|article)\b/i.test(value);
  Если (!containsEncodedTag) возвращает значение;

  возвращаемое значение
    .replace(/\\\\u003c/gi, '<')
    .replace(/\\\\u003e/gi, '>')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/</gi, '<')
    .replace(/>/gi, '>')
    .replace(/"/gi, '"')
    .replace(/'|'/gi, "'");
}

function lastSrcsetUrl(srcset?: string): string | undefined {
  if (!srcset) return undefined;
  const candidates = srcset
    .расколоть(',')
    .map(candidate => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
  возвращаем candidates[candidates.length - 1];
}

class BOTITranslation implements Plugin.PluginBase {
  id = 'BOTITranslation';
  имя = 'BOTI Translation';
  site = 'https://www.botitranslation.com';
  версия = '1.0.1';
  icon = 'siteNotAvailable.png';

  // LNReader использует эти заголовки при сохранении изображений обложки и глав.
  imageRequestInit: Plugin.ImageRequestInit = {
    заголовки: {
      Реферер: https://www.botitranslation.com/,
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  };

  private async getJson<T>(url: string): Promise<T> {
    const response = await fetchApi(url, {
      заголовки: {
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
      тип === 'книга'
        ? /\/book\/(\d+)/
        : /\/глава\/(\d+)/;

    const match = path.match(pattern);

    если (!match) {
      throw new Error(`Не удается идентифицировать BOTI ${type} ID`);
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
    пусть страница = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 1000) {
      const url =
        `${API}/chapters/page?sortDirection=ASC` +
        `&bookId=${encodeURIComponent(id)}` +
        `&pageNumber=${page}&pageSize=${pageSize}`;

      const response =
        Ожидайте выполнения this.getJson<ApiResponse<ApiPage<Chapter>>>(url);

      const data = response.data;

      if (!data || !Array.isArray(data.list)) {
        throw new Error('Неверный список глав BOTI');
      }

      if (data.list.length === 0) break;

      chapters.push(...data.list);

      totalPages =
        Число (данные.общее количество страниц) ||
        Math.max(
          1,
          Math.ceil(
            (Number(data.totalCount) || chapters.length) / pageSize,
          ),
        );

      страница++;
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

    пытаться {
      return new URL(url, this.site).href;
    } ловить {
      возвращаемый URL;
    }
  }

  private bookItem(book: Book): Plugin.NovelItem {
    const title = book.title?.trim() || 'Untitled';

    возвращаться {
      имя: титул,
      путь: `/book/${book.id}-${slug(title)}`,
      обложка: this.absoluteUrl(book.coverImgUrl),
    };
  }

  асинхронные популярные романы(
    pageNo: номер,
    _options: Plugin.PopularNovelsOptions<Filters>,
  ): Promise<Plugin.NovelItem[]> {
    const page = Math.max(1, Number(pageNo) || 1);

    const response =
      Ожидайте this.getJson<ApiResponse<ApiPage<Book>>>(
        `${API}/books?pageNumber=${page}&pageSize=20`,
      );

    return (response.data.list || []).map(book =>
      this.bookItem(book),
    );
  }

  async searchNovels(
    поисковый запрос: строка,
    pageNo: номер,
  ): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim();

    if (!query) return [];

    const params = new URLSearchParams({
      ключевое слово: запрос,
      pageNumber: String(Math.max(1, Number(pageNo) || 1)),
      pageSize: '50',
    });

    const response =
      Ожидайте this.getJson<ApiResponse<ApiPage<Book>>>(
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

    возвращаться {
      ...this.bookItem(book),
      путь: novelPath,
      автор: книга.авторПсевдоним || '',
      summary: book.synopsis || '',
      жанры: книга.название жанра || '',
      статус: book.status == null ? '' : String(book.status),

      главы: chapters.map(chapter => ({
        имя: chapter.title || 'Глава',
        путь: `/chapter/${chapter.id}-${slug(
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
        если (
          !значение ||
          /^(?:data:|blob:|javascript:|about:blank)/i.test(value) ||
          /(?:transparent\.gif|spacer\.gif|placeholder\.(?:gif|png)|loading\.gif)/i.test(value)
        ) {
          продолжать;
        }

        пытаться {
          resolvedUrl = new URL(value.replace(/&/gi, '&'), this.site).href;
        } ловить {
          resolvedUrl = value;
        }
        if (resolvedUrl) break;
      }

      if (resolvedUrl) image.attr('src', resolvedUrl);
      else image.removeAttr('src');

      [
        'srcset',
        'data-src',
        'оригинальные данные',
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

    // BOTI может хранить главу в формате HTML, экранированного HTML или обычного текста.
    if (!/<[az][^>]*>/i.test(content)) {
      тело = контент
        .split(/\r?\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `<p>${escapeHtml(line)}</p>`)
        .присоединиться('');
    }

    // LNReader загружает файлы изображений из <img src> при загрузке главы.
    // Затем экспортер EPUB встраивает загруженные локальные изображения.
    body = this.normalizeImageSources(body);

    return '<h1>' + escapeHtml(chapter.title || 'Chapter') + '</h1>' + body;
  }

  resolveUrl(path: string, _isNovel?: boolean): string {
    if (/^https?:\/\//i.test(path)) return path;

    return this.site + (path.startsWith('/') ? path : `/${path}`);
  }
}

export default new BOTITranslation();
