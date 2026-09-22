export { LearningPage } from './LearningPage'
export {
  createLearningApi,
  resourcePath,
  type CatalogLessonContent,
  type LearningApi,
  type LessonProgress,
  type MemberResource,
} from './api'
export { DocumentViewer, type DocumentViewerProps } from './components/DocumentViewer'
export { VideoPlayer } from './components/VideoPlayer'
export { SYNC_INTERVAL_SECONDS, useProgressSync, type ProgressSync } from './useProgressSync'
export {
  useDocumentResource,
  type DocumentFailure,
  type DocumentResourceState,
  type DocumentStatus,
} from './useDocumentResource'
export { useVideoResource, type VideoResourceState } from './useVideoResource'
export {
  type LessonPlacement,
  type LessonRef,
  needsLessonContent,
  orderedLessons,
  placeLesson,
  resumePosition,
  safeExternalUrl,
} from './model'
export { useLearning, type LearningState } from './useLearning'
