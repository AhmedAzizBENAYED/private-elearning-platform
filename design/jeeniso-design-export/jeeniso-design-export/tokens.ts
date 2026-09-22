export const bp = { sm: 600, md: 1024, lg: 1280, xl: 1600 } as const;

export type CourseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type LessonType   = 'VIDEO' | 'DOCUMENT' | 'TEXT' | 'LINK';
export type Role         = 'ADMIN' | 'MEMBER';
export type LessonState  = 'completed' | 'current' | 'not-started';
export type CourseState  = 'not-enrolled' | 'in-progress' | 'completed';

type Badge = { label: string; icon: string; style: string };
export const statusBadge: Record<CourseStatus, Badge> = {
  DRAFT:     { label: 'DRAFT', icon: 'edit',
               style: 'dashed outline, white bg' },
  PUBLISHED: { label: 'PUBLISHED', icon: 'check-circle',
               style: 'blue-50 bg, navy text' },
  ARCHIVED:  { label: 'ARCHIVED', icon: 'archive',
               style: 'gray-100 bg, gray-600 text' },
};

export const lessonIcon: Record<LessonType, string> = {
  VIDEO: 'video', DOCUMENT: 'doc', TEXT: 'text', LINK: 'link',
};

// only VIDEO lessons count toward progress and completion
export const countsForProgress = (t: LessonType) => t === 'VIDEO';
