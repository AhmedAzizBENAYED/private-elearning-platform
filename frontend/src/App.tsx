import { ApiClientProvider } from './api'
import { AppRouter } from './app/AppRouter'
import { AuthProvider } from './features/auth'
import { apiClient } from './runtime'

/**
 * Application root.
 *
 * `AuthProvider` sits above the router so the session is restored once, and the
 * router's bootstrap gate can wait on it before deciding anything.
 */
export default function App() {
  return (
    <AuthProvider>
      <ApiClientProvider client={apiClient}>
        <AppRouter />
      </ApiClientProvider>
    </AuthProvider>
  )
}
