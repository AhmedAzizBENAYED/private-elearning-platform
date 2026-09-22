import { routes } from '../../../app/routes'
import { fullName, type Member } from '../api'
import type { MemberEditOrigin, MemberStatusIntent } from '../memberEditState'

import { RowMenu } from './RowMenu'

export interface MemberRowMenuProps {
  member: Member
  /** The list's own query string, so Edit profile can come back to it. */
  search: string
}

/**
 * A member row's "More actions" menu (Admin-Members-Menu).
 *
 * The board draws View profile, Edit profile, Reset password and Deactivate
 * account. Reset password is not offered: the backend has no endpoint for it.
 * Deactivate was drawn disabled for want of an endpoint that now exists
 * (MEMBERS-02); it opens the member's page with that page's own confirmation
 * already asking, so the one status flow - its dialog, its copy, its errors -
 * is the one used, never a copy of it.
 */
export function MemberRowMenu({ member, search }: MemberRowMenuProps) {
  const name = fullName(member)
  const fromList: MemberEditOrigin = { from: 'list', search }
  const askStatus: MemberStatusIntent = { confirmStatus: true }

  return (
    <RowMenu
      label={`More actions for ${name}`}
      menuLabel={`Actions for ${name}`}
      items={[
        { kind: 'link', label: 'View profile', icon: 'eye', to: routes.adminMember(member.id) },
        {
          kind: 'link',
          label: 'Edit profile',
          icon: 'edit',
          to: routes.adminMemberEdit(member.id),
          state: fromList,
        },
        { kind: 'separator' },
        {
          kind: 'link',
          label: member.is_active ? 'Deactivate account' : 'Activate account',
          icon: member.is_active ? 'lock' : 'check',
          to: routes.adminMember(member.id),
          state: askStatus,
        },
      ]}
    />
  )
}
