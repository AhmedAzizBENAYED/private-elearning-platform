import { Link, useLocation } from 'react-router-dom'

import { LinkButton } from '../../../app/LinkButton'

import { routes } from '../../../app/routes'
import { Avatar, Badge } from '../../../design-system'
import { fullName, type Member } from '../api'
import { formatDate } from '../model'

import { MemberRowMenu } from './MemberRowMenu'
import styles from './MembersTable.module.css'

export interface MembersTableProps {
  members: readonly Member[]
  /**
   * The member just created, if this page shows it: that row is tinted, as the
   * board's success state draws it. Colour is not the only signal - the toast
   * names the member - so the tint only helps the eye find the row.
   */
  highlightId?: string | null
}

/**
 * The member table (Admin-Members): Member, Email, Status, Created, Actions.
 *
 * A real `<table>` with a real `<thead>`, because this is tabular data and a
 * grid of divs would leave a screen reader without the column a cell belongs
 * to. Each row's name is the link to that member; the Actions cell holds the
 * board's "Edit profile" (Admin-Member-Edit) and its "More actions" menu
 * (Admin-Members-Menu), with the entries the application supports.
 *
 * Every column comes from `MemberResponse`. Nothing derived and nothing
 * invented: the backend returns no last-sign-in, no enrollment count and no
 * activity, so none is shown.
 */
export function MembersTable({ members, highlightId = null }: MembersTableProps) {
  // The edit page returns here, with these filters, on Cancel or after a save.
  const { search } = useLocation()

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Member</th>
            <th scope="col">Email</th>
            <th scope="col">Status</th>
            <th scope="col">Created</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const name = fullName(member)

            return (
              <tr key={member.id} className={member.id === highlightId ? styles.highlighted : undefined}>
                <th scope="row" className={styles.memberCell}>
                  <Avatar name={name} size={32} tone="brand" />
                  <Link className={styles.name} to={routes.adminMember(member.id)}>
                    {name}
                  </Link>
                </th>
                <td className={styles.email}>{member.email}</td>
                <td>
                  <Badge kind="member-status" value={member.is_active ? 'active' : 'inactive'} />
                </td>
                <td className={styles.created}>
                  <time dateTime={member.created_at}>{formatDate(member.created_at)}</time>
                </td>
                <td className={styles.actions}>
                  <div className={styles.actionGroup}>
                  <LinkButton
                    to={routes.adminMemberEdit(member.id)}
                    state={{ from: 'list', search }}
                    variant="secondary"
                    size="sm"
                    iconLeft="edit"
                    // One per row: the name says whose profile, and still
                    // starts with the visible words (WCAG 2.5.3).
                    aria-label={`Edit profile for ${name}`}
                  >
                    Edit profile
                  </LinkButton>
                  <MemberRowMenu member={member} search={search} />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
