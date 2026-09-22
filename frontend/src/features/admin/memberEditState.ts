import type { Member } from './api'

/*
 * Location state shared by the member edit page and the pages around it.
 * Kept apart from the pages so neither has to import the other.
 */

/**
 * Where the edit was opened from, carried in location state by the entry
 * points, so Cancel and a successful save lead back there: the member list
 * with the filters it had, or the member's own page (the default).
 */
export interface MemberEditOrigin {
  from: 'list'
  search: string
}

/** What the destination shows after a save: the board's toast (and row tint). */
export interface MemberSavedNotice {
  savedMember: Member
}

export function isMemberSavedNotice(state: unknown): state is MemberSavedNotice {
  return typeof state === 'object' && state !== null && 'savedMember' in state
}

export function isListOrigin(state: unknown): state is MemberEditOrigin {
  return typeof state === 'object' && state !== null && (state as { from?: unknown }).from === 'list'
}

/**
 * "Deactivate account" / "Activate account" from a row's menu: the member's
 * page opens with its own status confirmation already asking (MEMBERS-02).
 */
export interface MemberStatusIntent {
  confirmStatus: true
}

export function isMemberStatusIntent(state: unknown): state is MemberStatusIntent {
  return typeof state === 'object' && state !== null && (state as { confirmStatus?: unknown }).confirmStatus === true
}

/** "Add member" from the dashboard: the member list opens with its dialog. */
export interface AddMemberIntent {
  addMember: true
}

export function isAddMemberIntent(state: unknown): state is AddMemberIntent {
  return typeof state === 'object' && state !== null && (state as { addMember?: unknown }).addMember === true
}
