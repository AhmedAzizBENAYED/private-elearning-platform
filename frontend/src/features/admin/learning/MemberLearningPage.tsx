import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { LinkButton } from '../../../app/LinkButton'
import { routes } from '../../../app/routes'
import {
  Avatar,
  Badge,
  Button,
  FilterTabs,
  Icon,
  Progress,
  Skeleton,
  SkeletonGroup,
} from '../../../design-system'
import { MessagePage } from '../../../pages/MessagePage'

import type { LearningStatus } from './api'
import { ActivityCell, StatusCell } from './components/Cells'
import { Stat, Stats } from './components/Figures'
import styles from './Learning.module.css'
import {
  describeEvent,
  formatDateTime,
  formatLessons,
  formatOptionalDate,
  formatPercent,
  isActiveNow,
  isLearningStatus,
  memberName,
} from './model'
import { useMemberLearning } from './useLearning'

/**
 * A member's learning progress (Admin-Member-View, Admin-Member-Learning-Mobile).
 *
 *   GET /admin/learning/members/{id}
 *
 * One request for the whole page: the endpoint answers with the member, the
 * counts, their latest location, every published course and their last events.
 * The status filter above the course list therefore works on a list that is
 * already complete by contract - not on a page of it - so there is nothing to
 * ask the server again for.
 */
export function MemberLearningPage() {
  const { memberId = '' } = useParams<{ memberId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const status: LearningStatus | null = isLearningStatus(statusParam) ? statusParam : null

  const [now] = useState(() => Date.now())
  const { status: state, data, failure, reload } = useMemberLearning(memberId)

  const courses = useMemo(
    () => (data === null ? [] : data.courses.filter((row) => status === null || row.status === status)),
    [data, status],
  )

  if (state === 'loading') {
    return (
      <SkeletonGroup label="Loading learning progress" className={styles.skeleton}>
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="block" height={260} />
      </SkeletonGroup>
    )
  }

  if (state === 'error' || data === null) {
    const missing = failure === 'not-found'
    return (
      <MessagePage
        icon={missing ? 'users' : 'wifi-off'}
        tone={missing ? 'neutral' : undefined}
        title={missing ? 'Member not found' : 'We couldn’t load this member’s progress'}
        body={
          missing
            ? 'This account no longer exists, or the link is incorrect.'
            : 'Something went wrong while contacting the server.'
        }
        action={
          missing ? (
            <LinkButton to={routes.adminMembers} variant="secondary" iconLeft="arrow-left">
              All members
            </LinkButton>
          ) : (
            <Button iconLeft="refresh" onClick={reload}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  const member = data.member
  const name = memberName(member)
  const latest = data.latest
  const live = isActiveNow(data.last_activity_at, now)

  return (
    <div className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link className={styles.crumb} to={routes.adminMembers}>
          Members
        </Link>
        <Icon name="chevron-right" size={14} aria-hidden="true" />
        <Link className={styles.crumb} to={routes.adminMember(member.id)}>
          {name}
        </Link>
        <Icon name="chevron-right" size={14} aria-hidden="true" />
        <span className={styles.current} aria-current="page">
          Learning progress
        </span>
      </nav>

      <header className={styles.head}>
        <div className={styles.member}>
          <Avatar name={name} size={56} tone={member.is_active ? 'brand' : 'inactive'} />
          <div>
            <h1 className={styles.title}>{name}</h1>
            <p className={styles.subtitle}>{member.email}</p>
          </div>
        </div>
        <LinkButton to={routes.adminMemberEdit(member.id)} variant="secondary" iconLeft="edit">
          Edit profile
        </LinkButton>
      </header>

      {/* The board's two tabs. Real links: each is its own route. */}
      <nav className={styles.tabs} aria-label="Member views">
        <span className={[styles.tab, styles.tabCurrent].join(' ')} aria-current="page">
          Learning progress
        </span>
        <Link className={styles.tab} to={routes.adminMember(member.id)}>
          Profile &amp; account
        </Link>
      </nav>

      <Stats>
        <Stat
          label="Courses started"
          value={`${data.counts.started} of ${data.counts.all}`}
          caption="every published course is listed"
        />
        <Stat label="Completed" value={data.counts.completed} />
        <Stat label="In progress" value={data.counts.in_progress} />
        <Stat
          label="Last active"
          value={
            data.last_activity_at === null ? (
              'No activity yet'
            ) : (
              <ActivityCell at={data.last_activity_at} now={now} />
            )
          }
        />
      </Stats>

      <section className={styles.panel} aria-labelledby="member-latest">
        <div className={styles.cardHead}>
          <h2 id="member-latest" className={styles.panelTitle}>
            {live ? 'Currently viewing' : 'Last viewed'}
          </h2>
          {live ? (
            <span className={styles.activeNow}>
              <span className={styles.dot} aria-hidden="true" />
              Active now
            </span>
          ) : null}
        </div>

        {latest === null || latest.course === null ? (
          <p className={styles.panelCaption}>No course opened yet.</p>
        ) : (
          <>
            <p className={styles.cardTitle}>
              <Link className={styles.courseLink} to={routes.adminLearningCourse(latest.course.id)}>
                {latest.course.title}
              </Link>
            </p>
            {latest.lesson === null ? null : (
              <p className={styles.panelCaption}>
                {`${latest.lesson.title} · Module ${latest.lesson.module_position} · ${latest.lesson.module_title}`}
              </p>
            )}
            {latest.progress_percent === null ? null : (
              <>
                <Progress
                  value={latest.progress_percent}
                  size={8}
                  label={`${name} in ${latest.course.title}`}
                  showHeader
                  headerLabel="Progress"
                  caption={`${formatLessons(latest.completed_video_lessons ?? 0, latest.total_video_lessons ?? 0)} lessons completed`}
                />
              </>
            )}
          </>
        )}

        {data.last_activity_at === null ? null : (
          <p className={styles.panelCaption}>
            {`Last learning event received ${formatDateTime(data.last_activity_at)}. This page shows recorded activity, not a live feed.`}
          </p>
        )}
      </section>

      <section aria-labelledby="member-courses" className={styles.page}>
        <h2 id="member-courses" className={styles.panelTitle}>
          Course progress
        </h2>
        <p className={styles.panelCaption}>
          {`${data.counts.started} started · ${data.counts.completed} completed · ${data.counts.not_started} not started. Every published course is listed.`}
        </p>

        <FilterTabs
          label="Filter courses by status"
          appearance="chip"
          value={status ?? 'all'}
          onChange={(value) =>
            setSearchParams(
              (previous) => {
                const next = new URLSearchParams(previous)
                if (value === 'all') next.delete('status')
                else next.set('status', value)
                return next
              },
              { replace: true },
            )
          }
          options={[
            { value: 'all', label: 'All', count: data.counts.all },
            { value: 'IN_PROGRESS', label: 'In progress', count: data.counts.in_progress },
            { value: 'COMPLETED', label: 'Completed', count: data.counts.completed },
            { value: 'NOT_STARTED', label: 'Not started', count: data.counts.not_started },
          ]}
        />

        {courses.length === 0 ? (
          <MessagePage
            headingLevel={3}
            icon="book"
            tone="neutral"
            title="No course with this status"
            body="Choose another status to see this member’s other courses."
          />
        ) : (
          <ul className={styles.cards}>
            {courses.map((row) => (
              <li key={row.course.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <h3 className={styles.cardTitle}>
                    <Link
                      className={styles.courseLink}
                      to={routes.adminLearningCourse(row.course.id)}
                    >
                      {row.course.title}
                    </Link>
                  </h3>
                  <StatusCell status={row.status} />
                </div>

                {row.status === 'NOT_STARTED' ? (
                  <p className={styles.cellCaption}>
                    {`No lesson opened yet · ${row.total_modules} modules · ${row.total_video_lessons} lessons`}
                  </p>
                ) : (
                  <>
                    <span className={styles.percent}>{formatPercent(row.progress_percent)}</span>
                    <Progress
                      value={row.progress_percent}
                      size={6}
                      label={`${name} in ${row.course.title}`}
                    />
                    <p className={styles.cellCaption}>
                      {`${formatLessons(row.completed_video_lessons, row.total_video_lessons)} lessons · ${formatLessons(row.completed_modules, row.total_modules)} modules`}
                    </p>
                    <p className={styles.cellCaption}>
                      {row.completed_at === null
                        ? `Started ${formatOptionalDate(row.started_at)} · Last activity ${formatOptionalDate(row.last_activity_at)}`
                        : `Started ${formatOptionalDate(row.started_at)} · Completed ${formatOptionalDate(row.completed_at)}`}
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="member-events">
        <h2 id="member-events" className={styles.panelTitle}>
          Recent activity
        </h2>
        {data.recent_events.length === 0 ? (
          <p className={styles.panelCaption}>No recorded event yet.</p>
        ) : (
          <ul className={styles.events}>
            {data.recent_events.map((event) => (
              <li key={event.id} className={styles.event}>
                <span className={styles.eventTitle}>{describeEvent(event)}</span>
                <span className={styles.cellCaption}>{event.course_title}</span>
                <span className={styles.exact}>
                  <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {member.is_active ? null : (
        <p className={styles.panelCaption}>
          <Badge kind="member-status" value="inactive" /> This account cannot sign in; its recorded
          progress is kept.
        </p>
      )}
    </div>
  )
}
