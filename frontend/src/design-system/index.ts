/* Public surface of the design system.
 *
 * Application code imports from here, never from a component's own path, so a
 * component can be reorganised without a repo-wide rename.
 *
 * Styles are NOT exported: tokens, fonts and the reset are imported once from
 * src/index.css.
 */

export {
  Button,
  buttonClassName,
  type ButtonClassNameOptions,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './primitives/Button'
export {
  FileDropzone,
  formatFileSize,
  type FileDropzoneKind,
  type FileDropzoneProps,
  type FileDropzoneStatus,
} from './primitives/FileDropzone'
export {
  FilterTabs,
  type FilterTabOption,
  type FilterTabsProps,
} from './primitives/FilterTabs'
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from './primitives/SegmentedControl'
export { Select, type SelectOption, type SelectProps } from './primitives/Select'
export { TextField, type TextFieldProps } from './primitives/TextField'
export { Textarea, type TextareaProps } from './primitives/Textarea'

export { Avatar, initialsFrom, type AvatarProps, type AvatarSize, type AvatarTone } from './feedback/Avatar'
export {
  Badge,
  type BadgeProps,
  type LearningProgressState,
  type MemberStatus,
} from './feedback/Badge'
export { ConfirmDialog, type ConfirmDialogProps } from './feedback/ConfirmDialog'
export { Dialog, type DialogProps } from './feedback/Dialog'
export { Toast, type ToastKind, type ToastProps } from './feedback/Toast'
export { BottomBarContext, useBottomBar } from './feedback/BottomBar'
export { Progress, type ProgressProps, type ProgressSize } from './feedback/Progress'
export {
  Skeleton,
  SkeletonGroup,
  type SkeletonGroupProps,
  type SkeletonProps,
  type SkeletonVariant,
} from './feedback/Skeleton'

export { asIconName, Icon, iconNames, type IconName, type IconProps } from './icons'

export {
  bp,
  countsForProgress,
  lessonIcon,
  statusBadge,
  type CourseState,
  type CourseStatus,
  type LessonState,
  type LessonType,
  type Role,
} from './tokens'

export { media, useMediaQuery } from './responsive'
