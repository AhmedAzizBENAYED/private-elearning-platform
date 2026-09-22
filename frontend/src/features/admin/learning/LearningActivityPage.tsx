import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  Button,
  FilterTabs,
  Icon,
  Skeleton,
  SkeletonGroup,
  TextField,
  media,
  useMediaQuery,
} from '../../../design-system'
import { MessagePage } from '../../../pages/MessagePage'
import { useDebouncedValue } from '../../../shared/useDebouncedValue'
import { CoursePagination } from '../../courses/components/CoursePagination'

import { ActivityCards, ActivityRows } from './components/ActivityRows'
import { LearningShell } from './components/LearningShell'
import { Stat, Stats } from './components/Figures'
import styles from './Learning.module.css'
import {
  ACTIVE_NOW_MINUTES,
  ACTIVITY_WINDOWS,
  activeSince,
  formatDateTime,
  isActivityWindow,
  parsePage,
} from './model'
import { useLearningActivity } from './useLearning'

const SEARCH_DEBOUNCE_MS = 300
const PAGE_SIZE = 20

/**
 * Learning activity (Admin-Activity, Admin-Activity-Mobile).
 *
 * "Active now means a learning event was received in the last 5 minutes" - the
 * design's own words, above the table and in the window this screen asks for.
 * There is no websocket, no heartbeat and no polling: the page reads recorded
 * events once, and says so.
 *
 * The four pills of the board are windows on `active_since`. Two of them -
 * "Idle 7+ days" and "No activity" - are the opposite question ("last event
 * *before* this instant"), which the endpoint does not accept, so they are not
 * drawn rather than faked. Reported as a gap.
 */
export function LearningActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const urlSearch = searchParams.get('search') ?? ''
  const windowParam = searchParams.get('activity')
  const window = isActivityWindow(windowParam) ? windowParam : 'any'
  const page = parsePage(searchParams.get('page'))

  // Measured when the screen is opened and when Refresh is pressed - never on
  // a render, which would move the window under the administrator's feet.
  const [now, setNow] = useState(() => Date.now())

  const [term, setTerm] = useState(urlSearch)
  const [syncedSearch, setSyncedSearch] = useState(urlSearch)
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  if (urlSearch !== syncedSearch) {
    setSyncedSearch(urlSearch)
    setTerm(urlSearch)
  }

  useEffect(() => {
    if (debouncedTerm !== term || debouncedTerm === urlSearch) return
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (debouncedTerm === '') next.delete('search')
        else next.set('search', debouncedTerm)
        next.delete('page')
        return next
      },
      { replace: true },
    )
  }, [debouncedTerm, term, urlSearch, setSearchParams])

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous)
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
        if (key !== 'page') next.delete('page')
        return next
      })
    },
    [setSearchParams],
  )

  const goToPage = useCallback(
    (next: number) => {
      setParam('page', next <= 1 ? null : String(next))
      globalThis.scrollTo?.({ top: 0, behavior: 'smooth' })
    },
    [setParam],
  )

  const query = useMemo(() => {
    const since = activeSince(window, now)
    return {
      page,
      pageSize: PAGE_SIZE,
      ...(urlSearch === '' ? {} : { search: urlSearch }),
      // The window both counts and - because a pill is a filter, not a legend -
      // keeps the members inside it.
      ...(since === undefined ? {} : { activeSince: since, onlyActive: true }),
    }
  }, [page, urlSearch, window, now])

  const { status, data, reload } = useLearningActivity(query)

  // "Updated 09:42 · Refresh" (Admin-Activity): the page reads recorded events,
  // so refreshing is an explicit act - it moves the window and reads again.
  const refresh = useCallback(() => {
    setNow(Date.now())
    reload()
  }, [reload])

  const phone = useMediaQuery(media.belowSm)
  const pageCount = data === null ? 1 : Math.max(1, Math.ceil(data.total / Math.max(1, data.page_size)))
  const filtered = urlSearch !== '' || window !== 'any'

  return (
    <LearningShell
      lede="What each member is using now, or used most recently."
      action={
        <div className={styles.toolbar}>
          <span className={styles.statCaption}>{`Updated ${formatDateTime(new Date(now).toISOString())}`}</span>
          <Button variant="secondary" iconLeft="refresh" onClick={refresh}>
            Refresh
          </Button>
        </div>
      }
    >
      <p className={styles.note}>
        <Icon name="info" size={18} className={styles.noteIcon} />
        <span>
          <strong>Active now</strong>
          {` means a learning event was received in the last ${ACTIVE_NOW_MINUTES} minutes. It is an estimate from recorded activity, not a live stream. Otherwise the page shows the most recently accessed course and lesson.`}
        </span>
      </p>

      {data === null ? null : (
        <Stats>
          <Stat label="Members shown" value={data.total} />
          <Stat label="With recorded activity" value={data.members_with_activity} />
          <Stat
            label="In this window"
            value={data.active_members ?? '—'}
            caption={window === 'any' ? 'Choose a window to count' : undefined}
          />
        </Stats>
      )}

      <FilterTabs
        label="Filter by activity"
        appearance="chip"
        value={window}
        onChange={(value) => setParam('activity', value === 'any' ? null : value)}
        options={ACTIVITY_WINDOWS.map((option) => ({
          value: option.value,
          label: option.value === 'now' ? 'Active now' : option.label,
          // The endpoint counts the window it was asked for, so only that one
          // has a figure; inventing the others would mean four requests.
          count: option.value === window ? (data?.active_members ?? data?.total ?? null) : null,
        }))}
      />

      <div className={styles.filters}>
        <TextField
          label="Search member or course"
          hideLabel
          placeholder="Name or course"
          iconLeft="search"
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          className={styles.search}
        />
      </div>

      {status === 'loading' ? (
        <SkeletonGroup label="Loading learning activity" className={styles.skeleton}>
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} variant="block" height={64} />
          ))}
        </SkeletonGroup>
      ) : status === 'error' || data === null ? (
        <MessagePage
          headingLevel={2}
          icon="wifi-off"
          title="We couldn’t load the learning activity"
          body="Something went wrong while contacting the server."
          action={
            <Button iconLeft="refresh" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : data.items.length === 0 ? (
        <MessagePage
          headingLevel={2}
          icon={filtered ? 'search' : 'users'}
          tone="neutral"
          title={filtered ? 'No member matches these filters' : 'No recorded activity yet'}
          body={
            filtered
              ? 'Try a wider activity window, or another name.'
              : 'Activity appears here as soon as a member opens a course or a lesson.'
          }
          action={
            filtered ? (
              <Button variant="secondary" iconLeft="x" onClick={() => setParam('activity', null)}>
                Any activity
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className={styles.count} aria-live="polite">
            {data.total === 1 ? '1 member' : `${data.total} members`}
          </p>

          {phone ? (
            <ActivityCards rows={data.items} now={now} />
          ) : (
            <ActivityRows rows={data.items} now={now} />
          )}

          <p className={styles.showing}>
            {`Showing ${data.items.length} of ${data.total} members · sorted by last active`}
          </p>

          <CoursePagination
            page={data.page}
            pageCount={pageCount}
            label="Learning activity pages"
            onChange={goToPage}
          />
        </>
      )}
    </LearningShell>
  )
}
