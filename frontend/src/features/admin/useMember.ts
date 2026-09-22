import { useCallback, useEffect, useMemo, useState } from 'react'

import { isApiError, useApiClient } from '../../api'
import type { UUID } from '../../api'

import { createAdminApi, type Member } from './api'

export type MemberFailure = 'not-found' | 'forbidden' | 'unavailable'

/** Why a status change was refused, in the page's own vocabulary. */
export type StatusFailure = 'last-admin' | 'not-found' | 'forbidden' | 'unavailable'

export interface MemberState {
  status: 'loading' | 'ready' | 'error'
  member: Member | null
  failure: MemberFailure | null
  /** True while a status change is in flight. */
  saving: boolean
  /** Set when the last status change was refused; cleared when another starts. */
  saveFailure: StatusFailure | null
  reload: () => void
  setActive: (isActive: boolean) => Promise<boolean>
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function classify(error: unknown): MemberFailure {
  if (!isApiError(error)) return 'unavailable'
  if (error.status === 404) return 'not-found'
  if (error.status === 403) return 'forbidden'
  return 'unavailable'
}

function classifyStatus(error: unknown): StatusFailure {
  if (!isApiError(error)) return 'unavailable'
  // 409 has exactly one cause here: "Cannot deactivate the last active
  // administrator". The message is the backend's rule, said in our own words.
  if (error.status === 409) return 'last-admin'
  if (error.status === 404) return 'not-found'
  if (error.status === 403) return 'forbidden'
  return 'unavailable'
}

/**
 * One member account, and the one mutation the backend offers for it.
 *
 *   GET   /admin/members/{id}          the record
 *   PATCH /admin/members/{id}/status   activate or deactivate
 *
 * The row that comes back from the write replaces the one held here, so the
 * page shows what the server stored rather than what was sent: the write is
 * idempotent and the server may legitimately answer with an unchanged row.
 *
 * No optimistic update. A status change is an authorization decision with a
 * last-active-administrator guard behind it; showing it as done before the
 * server agrees would be showing something that may not be true.
 */
export function useMember(memberId: UUID): MemberState {
  const client = useApiClient()
  const api = useMemo(() => createAdminApi(client), [client])

  const [attempt, setAttempt] = useState(0)
  const key = `${memberId}:${attempt}`

  const [loaded, setLoaded] = useState<{ key: string; member: Member } | null>(null)
  const [failed, setFailed] = useState<{ key: string; failure: MemberFailure } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFailure, setSaveFailure] = useState<StatusFailure | null>(null)

  const reload = useCallback(() => setAttempt((previous) => previous + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    api.getMember(memberId, controller.signal).then(
      (member) => {
        if (active) setLoaded({ key, member })
      },
      (error: unknown) => {
        if (isAbort(error) || !active) return
        setFailed({ key, failure: classify(error) })
      },
    )

    return () => {
      active = false
      controller.abort()
    }
  }, [api, memberId, key])

  const member = loaded?.key === key ? loaded.member : null

  const status: MemberState['status'] =
    member !== null ? 'ready' : failed?.key === key ? 'error' : 'loading'

  /** Resolves true when the server accepted the change. */
  const setActive = useCallback(
    async (isActive: boolean): Promise<boolean> => {
      setSaving(true)
      setSaveFailure(null)
      try {
        // Deliberately not aborted on unmount: this is a write, and cancelling
        // it would leave the administrator unsure whether it landed.
        const updated = await api.setMemberStatus(memberId, isActive)
        setLoaded({ key, member: updated })
        return true
      } catch (error: unknown) {
        setSaveFailure(classifyStatus(error))
        return false
      } finally {
        setSaving(false)
      }
    },
    [api, memberId, key],
  )

  return useMemo(
    () => ({
      status,
      member,
      failure: status === 'error' ? (failed?.failure ?? 'unavailable') : null,
      saving,
      saveFailure,
      reload,
      setActive,
    }),
    [status, member, failed, saving, saveFailure, reload, setActive],
  )
}
