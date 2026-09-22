import { useCallback, useEffect, useMemo, useState } from 'react'

import { useApiClient } from '../../api'
import type { Page } from '../../api'

import { MEMBERS_PAGE_SIZE, createAdminApi, type Member } from './api'

export interface MembersQueryInput {
  /** 1-based page, as the backend counts. */
  page: number
  /** Literal substring search; empty means no filter. */
  search: string
  /** `true` active, `false` inactive, `null` both. */
  isActive: boolean | null
}

export interface MembersData {
  members: Member[]
  /** The backend's own count for this query, across every page. */
  total: number
  page: number
  pageSize: number
  pageCount: number
}

export interface MembersState {
  status: 'loading' | 'ready' | 'error'
  data: MembersData | null
  reload: () => void
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * One page of member accounts.
 *
 *   GET /admin/members?page&page_size&search&is_active   once per query
 *
 * Search and status are the backend's own parameters, so filtering is a
 * database query rather than a pass over one page: a term that matches nothing
 * on page 1 still finds its row, and the count in the header is the count of
 * everything that matches, not of what happens to be loaded.
 *
 * Each outcome is tagged with the query it belongs to and every run owns an
 * `AbortController`, so a reply for a term the administrator has already
 * changed can never be rendered as the current result - the same discipline
 * the catalogue uses.
 */
export function useMembers({ page, search, isActive }: MembersQueryInput): MembersState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const queryKey = JSON.stringify([page, search, isActive, attempt])

  const [loaded, setLoaded] = useState<{ key: string; result: Page<Member> } | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api
      .listMembers({
        page,
        pageSize: MEMBERS_PAGE_SIZE,
        search,
        isActive: isActive ?? undefined,
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (active) setLoaded({ key: queryKey, result })
        },
        (error: unknown) => {
          if (isAbort(error) || !active) return
          setFailedKey(queryKey)
        },
      )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, page, search, isActive, queryKey])

  const fresh = loaded?.key === queryKey
  const status: MembersState['status'] = fresh
    ? 'ready'
    : failedKey === queryKey
      ? 'error'
      : 'loading'

  const data = useMemo<MembersData | null>(() => {
    if (!fresh || loaded === null) return null
    const result = loaded.result

    return {
      members: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.page_size,
      // `Page` carries neither a page count nor has_next/has_previous, so it is
      // derived from `total` and `page_size` - both of which it does carry.
      pageCount: Math.max(1, Math.ceil(result.total / Math.max(1, result.page_size))),
    }
  }, [fresh, loaded])

  return useMemo(() => ({ status, data, reload }), [status, data, reload])
}
