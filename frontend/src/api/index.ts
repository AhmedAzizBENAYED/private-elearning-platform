/* Public surface of the API layer. */

export { API_VERSION_PREFIX, buildUrl, normalizeBaseUrl, resolveApiBaseUrl } from './config'
export { createApiClient, type ApiClient, type AuthBridge } from './client'
export { useApiClient } from './ApiClientContext'
export { ApiClientProvider, type ApiClientProviderProps } from './ApiClientProvider'
export {
  ApiError,
  AuthSessionError,
  NetworkError,
  isApiError,
  toApiError,
  type ValidationIssue,
} from './errors'
export type {
  CatalogCourse,
  CatalogCourseListItem,
  CatalogEnrollmentCounts,
  CatalogPage,
  CatalogLesson,
  CatalogModule,
  ContentType,
  CourseContent,
  CourseContentLesson,
  CourseContentModule,
  CourseProgress,
  CourseStatus,
  EnrollmentFilter,
  EnrollmentSummary,
  ISODateTime,
  Page,
  UUID,
} from './types'
export {
  createHttpClient,
  type HttpClient,
  type HttpClientConfig,
  type HttpMethod,
  type RequestOptions,
} from './http'
export { advanceUploadPercent, uploadPercent, type UploadProgress } from './uploadProgress'
