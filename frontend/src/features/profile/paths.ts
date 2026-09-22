import { routes } from '../../app/routes'

/**
 * Which shell a profile screen sits in.
 *
 * The screens are the same for everyone (Password-States: "the same component
 * sits in both Edit profile pages; only the shell around it changes"), so the
 * route passes the area instead of the page guessing it from the role.
 */
export type ProfileArea = 'member' | 'admin'

export interface ProfileAreaProps {
  area: ProfileArea
}

export const profilePaths: Record<ProfileArea, { view: string; edit: string }> = {
  member: { view: routes.profile, edit: routes.profileEdit },
  admin: { view: routes.adminProfile, edit: routes.adminProfileEdit },
}

/** Navigation state the edit page leaves for the read view after a save. */
export interface ProfileNotice {
  notice: 'profile-updated'
}

export function isProfileNotice(state: unknown): state is ProfileNotice {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { notice?: unknown }).notice === 'profile-updated'
  )
}

export const roleLabel = { ADMIN: 'Administrator', MEMBER: 'Member' } as const
