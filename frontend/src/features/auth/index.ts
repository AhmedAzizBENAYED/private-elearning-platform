/* Public surface of the authentication feature.
 *
 * The token stores are deliberately NOT exported: nothing outside this folder
 * may read or write a credential. Composition happens in `src/runtime.ts`.
 */

export { AuthProvider, type AuthProviderProps } from './AuthProvider'
export { useAuth, type AuthContextValue } from './useAuth'
export { createAuthApi, type AuthApi } from './api'
export { createAuthStore, type AuthStore, type AuthStoreDeps } from './authStore'
export type {
  AccessTokenResponse,
  AuthState,
  AuthStatus,
  LoginRequest,
  RefreshRequest,
  TokenResponse,
  User,
  UserRole,
} from './types'
