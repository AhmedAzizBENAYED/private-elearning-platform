import type { LearningProgressRow } from './api'

/**
 * A member and the rows the page holds for them.
 *
 * The matrix and the phone cards are read by member, while the endpoint returns
 * member x course pairs; this is the one place that turns the second into the
 * first. Order is the order the backend sent, never re-sorted here.
 */
export interface MemberGroup {
  member: LearningProgressRow['member']
  /** This member's rows, by course id. */
  byCourse: Map<string, LearningProgressRow>
  rows: LearningProgressRow[]
  started: number
  completed: number
}

export function groupByMember(rows: readonly LearningProgressRow[]): MemberGroup[] {
  const groups = new Map<string, MemberGroup>()

  for (const row of rows) {
    let group = groups.get(row.member.id)
    if (group === undefined) {
      group = { member: row.member, byCourse: new Map(), rows: [], started: 0, completed: 0 }
      groups.set(row.member.id, group)
    }
    group.byCourse.set(row.course.id, row)
    group.rows.push(row)
    // "3 of 6 started · 1 completed": started is the board's own definition -
    // anything that is not NOT_STARTED has been started.
    if (row.status !== 'NOT_STARTED') group.started += 1
    if (row.status === 'COMPLETED') group.completed += 1
  }

  return [...groups.values()]
}
