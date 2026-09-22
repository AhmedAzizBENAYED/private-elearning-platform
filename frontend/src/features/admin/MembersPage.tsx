import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { Button, Select, Skeleton, SkeletonGroup, TextField, Toast } from '../../design-system'
import { MessagePage } from '../../pages/MessagePage'
import { useDebouncedValue } from '../../shared/useDebouncedValue'
import { CoursePagination } from '../courses/components/CoursePagination'

import type { Member } from './api'
import { AddMemberDialog } from './components/AddMemberDialog'
import { isAddMemberIntent, isMemberSavedNotice } from './memberEditState'
import { MembersTable } from './components/MembersTable'
import styles from './MembersPage.module.css'
import { useMembers } from './useMembers'

/** Typing pauses before the list is queried again. */
const SEARCH_DEBOUNCE_MS = 300

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

function parsePage(raw: string | null): number {
  const page = Number(raw)
  // `Pagination.page` accepts 1..1_000_000; anything else is the first page.
  return Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1
}

/** The URL's `status` as the backend's `is_active`. */
function parseStatus(raw: string | null): boolean | null {
  if (raw === 'active') return true
  if (raw === 'inactive') return false
  return null
}

function MembersSkeleton() {
  return (
    <SkeletonGroup label="Loading members" className={styles.skeleton}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} variant="block" height={56} />
      ))}
    </SkeletonGroup>
  )
}

/**
 * Member accounts (Admin-Members).
 *
 * Search, status and page live in the URL and map one to one onto parameters
 * the backend accepts - `search`, `is_active`, `page`, `page_size` - so the
 * count in the header is the server's count of everything that matches, not of
 * the rows that happen to be loaded, and a filtered view can be linked and
 * survives a refresh.
 *
 * Creating a member is deliberately absent; see the ticket report. The backend
 * issues an activation token rather than accepting a password, and returns it
 * only outside production, so the designed "Add a member" dialog - full name,
 * email and password - cannot be implemented against this API as drawn.
 */
export function MembersPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const urlSearch = searchParams.get('search') ?? ''
  const urlStatus = searchParams.get('status')
  const page = parsePage(searchParams.get('page'))
  const isActive = parseStatus(urlStatus)

  // Controlled locally so typing stays responsive; the URL and the request
  // follow once typing settles.
  const [term, setTerm] = useState(urlSearch)
  const [syncedSearch, setSyncedSearch] = useState(urlSearch)
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  // Back and forward must move the field too, not only the results. Adjusted
  // during render, so the field never paints a stale term.
  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch)
    setTerm(urlSearch)
  }

  useEffect(() => {
    // Only sync once the debounce has caught up with the field. Without this,
    // an explicit "Clear search" would be undone a moment later by the debounce
    // still holding the term that was just cleared.
    if (debouncedTerm !== term || debouncedTerm === urlSearch) return

    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (debouncedTerm === '') next.delete('search')
        else next.set('search', debouncedTerm)
        // A new search starts at the beginning: page 3 of the old results says
        // nothing about the new ones.
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [debouncedTerm, term, urlSearch, setSearchParams])

  const onStatusChange = useCallback(
    (value: string) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        if (value === 'all') next.delete('status')
        else next.set('status', value)
        next.delete('page')
        return next
      })
    },
    [setSearchParams],
  )

  const goToPage = useCallback(
    (next: number) => {
      setSearchParams((previous) => {
        const params = new URLSearchParams(previous)
        if (next <= 1) params.delete('page')
        else params.set('page', String(next))
        return params
      })
      globalThis.scrollTo?.({ top: 0, behavior: 'smooth' })
    },
    [setSearchParams],
  )

  // The filtered empty state's way out (Admin-Members-States "Clear search").
  // It clears every filter behind the empty result - the status too - or a
  // list emptied by the status filter alone would stay empty after the click.
  const clearFilters = useCallback(() => {
    setTerm('')
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('search')
        next.delete('status')
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  const query = useMemo(
    () => ({ page, search: urlSearch, isActive }),
    [page, urlSearch, isActive],
  )
  const { status, data, reload } = useMembers(query)

  // Add member (Admin-Members-States). The dialog is remounted for every
  // opening - a new key each time - so a form abandoned earlier, password
  // included, never reappears.
  const location = useLocation()
  const navigate = useNavigate()
  // "Add member" on the dashboard (Admin-Dashboard) lands here with the
  // dialog already open - the one creation flow, not a second one.
  const [adding, setAdding] = useState(() => isAddMemberIntent(location.state))
  const [dialogKey, setDialogKey] = useState(0)
  const [created, setCreated] = useState<Member | null>(null)

  const openAdd = useCallback(() => {
    setDialogKey((previous) => previous + 1)
    setAdding(true)
  }, [])
  const closeAdd = useCallback(() => setAdding(false), [])

  // The board's success state: the dialog closes, a toast confirms, and the
  // new row is highlighted in a list that has been read again from the server.
  const onCreated = useCallback(
    (member: Member) => {
      setAdding(false)
      setCreated(member)
      reload()
    },
    [reload],
  )
  const dismissCreated = useCallback(() => setCreated(null), [])

  // Back from Edit member profile (Admin-Profile-States "Members list · toast
  // + row highlighted after save"). Read once, then dropped from the history
  // entry, so Back and Forward do not announce the save again.
  const [saved, setSaved] = useState<Member | null>(() =>
    isMemberSavedNotice(location.state) ? location.state.savedMember : null,
  )
  useEffect(() => {
    if (isMemberSavedNotice(location.state) || isAddMemberIntent(location.state)) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null })
    }
  }, [location, navigate])
  const dismissSaved = useCallback(() => setSaved(null), [])

  const filtered = urlSearch !== '' || isActive !== null

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.heading}>
          <h1 className={styles.title}>Members</h1>
          <p className={styles.subtitle}>Create member accounts and see who is active.</p>
        </div>
        <Button iconLeft="plus" onClick={openAdd} className={styles.add}>
          Add member
        </Button>
      </header>

      <div className={styles.filters}>
        <TextField
          label="Search members"
          hideLabel
          placeholder="Search members"
          iconLeft="search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className={styles.search}
        />
        {/* Both filters hide their label: the placeholder and the selected
            option say what each control is, and the two then sit on one line.
            The labels stay in the markup for assistive technology. */}
        <Select
          label="Status"
          hideLabel
          options={STATUS_OPTIONS}
          value={urlStatus ?? 'all'}
          onChange={(event) => onStatusChange(event.target.value)}
          className={styles.status}
        />
      </div>

      {status === 'loading' ? (
        <MembersSkeleton />
      ) : status === 'error' || data === null ? (
        <MessagePage
          headingLevel={2}
          icon="wifi-off"
          title="We couldn’t load the members"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : data.members.length === 0 ? (
        // Two different empties: nothing exists yet, or nothing matches. They
        // need different words and different ways out (Admin-Members-States).
        filtered ? (
          <MessagePage
            headingLevel={2}
            icon="search"
            tone="neutral"
            title={urlSearch === '' ? 'No member matches this filter' : `No member matches “${urlSearch}”`}
            body="Check the spelling or search by email address."
            action={
              <Button variant="secondary" iconLeft="x" onClick={clearFilters}>
                Clear search
              </Button>
            }
          />
        ) : (
          <MessagePage
            headingLevel={2}
            icon="users"
            tone="neutral"
            title="No members yet"
            body="Create the first member account so that people can sign in and start learning."
            action={
              <Button iconLeft="plus" onClick={openAdd}>
                Add member
              </Button>
            }
          />
        )
      ) : (
        <>
          {/* A live region: the count changes as the filters do. */}
          <p className={styles.count} aria-live="polite">
            {data.total === 1 ? '1 member' : `${data.total} members`}
          </p>

          <MembersTable members={data.members} highlightId={created?.id ?? saved?.id ?? null} />

          <p className={styles.showing}>
            {`Showing ${data.members.length} of ${data.total} ${data.total === 1 ? 'member' : 'members'}`}
          </p>

          <CoursePagination
            page={data.page}
            pageCount={data.pageCount}
            label="Member pages"
            onChange={goToPage}
          />
        </>
      )}

      <AddMemberDialog key={dialogKey} open={adding} onClose={closeAdd} onCreated={onCreated} />

      {/* One toast, and so one live region, for both confirmations. */}
      <Toast
        open={created !== null || saved !== null}
        title={created !== null ? 'Member created' : 'Profile updated'}
        body={
          created !== null
            ? `${created.first_name} ${created.last_name} can now sign in.`
            : saved !== null
              ? `${saved.first_name} ${saved.last_name}’s profile has been saved.`
              : undefined
        }
        onDismiss={created !== null ? dismissCreated : dismissSaved}
      />
    </div>
  )
}
