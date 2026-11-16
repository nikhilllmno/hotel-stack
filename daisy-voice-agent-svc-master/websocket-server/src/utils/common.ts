//Type of Request.query
export interface ParsedQs {
  [key: string]: undefined | string | ParsedQs | (string | ParsedQs)[];
}

export const trueValues = [1, '1', true, 'true', 'yes', 'y'];

export interface GetRequestForPagination {
  base_path: string;
  query_params: ParsedQs;
}

export function getPaginationUrls(
  base_path: string,
  query: ParsedQs,
  page: number,
  limit: number,
  total_pages: number,
) {
  // Next page
  const nextPage = page < total_pages ? Number(page) + 1 : null;
  const prevPage = page > 1 ? Number(page) - 1 : null;

  const buildUrl = (targetPage: number | null) => {
    if (!targetPage) return null;
    return (
      base_path +
      Object.entries({ ...query, page: targetPage, limit })
        .map(
          ([k, v]) =>
            `${encodeURIComponent(k)}=${encodeURIComponent(v.toString())}`,
        )
        .join('&')
    );
  };

  return {
    next_page: buildUrl(nextPage) || (nextPage?.toString() ?? ''),
    prev_page: buildUrl(prevPage) || (prevPage?.toString() ?? ''),
  };
}

export function capitalizeFirst(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
