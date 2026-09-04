import { TMeta } from './sendResponse';

export type TQueryOptions = {
  page: number;
  limit: number;
  skip: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  search?: string;
};

type TBuildArgs = {
  query: Record<string, unknown>;
  /** Whitelisted sortable columns - anything else falls back to defaultSort. */
  sortableFields: readonly string[];
  defaultSort?: string;
};

const MAX_LIMIT = 100;

/**
 * Parses `?page&limit&sortBy&sortOrder&search` into Prisma-ready values.
 *
 * `sortBy` is checked against an explicit whitelist so an attacker cannot
 * push an arbitrary column name (or a relation path) into `orderBy`.
 */
export const buildQueryOptions = ({
  query,
  sortableFields,
  defaultSort = 'createdAt',
}: TBuildArgs): TQueryOptions => {
  const page = Math.max(1, Number(query.page) || 1);
  const rawLimit = Number(query.limit) || 10;
  const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

  const requestedSort = String(query.sortBy ?? '');
  const sortBy = sortableFields.includes(requestedSort) ? requestedSort : defaultSort;

  const sortOrder = String(query.sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';

  const search =
    typeof query.search === 'string' && query.search.trim()
      ? query.search.trim()
      : undefined;

  return { page, limit, skip: (page - 1) * limit, sortBy, sortOrder, search };
};

/**
 * Builds a case-insensitive OR-contains filter across the given fields.
 * Returns an empty object when there is no search term, so it can always
 * be spread into a Prisma `where` clause.
 */
export const buildSearchFilter = (
  search: string | undefined,
  fields: readonly string[]
): Record<string, unknown> => {
  if (!search) return {};
  return {
    OR: fields.map((field) => ({
      [field]: { contains: search, mode: 'insensitive' },
    })),
  };
};

export const buildMeta = (page: number, limit: number, total: number): TMeta => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit) || 0,
});
