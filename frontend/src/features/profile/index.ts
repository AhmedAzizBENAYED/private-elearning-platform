/* Public surface of the profile feature: the signed-in account's own pages. */

export { ProfilePage } from './ProfilePage'
export { ProfileEditPage } from './ProfileEditPage'
export { profilePaths, type ProfileArea } from './paths'

// Shared with the administrator's member edit (Admin-Member-Edit), which is the
// same name form about another account - one set of rules, not two.
export { ReadOnlyField } from './ProfileEditPage'
export { RoleChip } from './ProfilePage'
export {
  PROFILE_LIMITS,
  PROFILE_MESSAGES,
  classifyProfileError,
  isProfileDirty,
  profilePatch,
  profileValuesFrom,
  validateProfile,
  type ProfileErrors,
  type ProfileValues,
} from './model'
export { useUnsavedChanges } from './useUnsavedChanges'
