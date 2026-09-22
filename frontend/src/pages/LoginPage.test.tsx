import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderRoute, type RenderRouteResult } from '../test/renderRoute'
import { testAdmin, testUser } from '../test/authHarness'
import { viewports } from '../test/viewport'

const PASSWORD = 'correct-horse-battery-staple'

async function signIn(email = testUser.email, password = PASSWORD) {
  await userEvent.type(screen.getByLabelText(/Email address/), email)
  await userEvent.type(screen.getByLabelText(/Password/), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('login form', () => {
  it('renders the designed sign-in screen', async () => {
    await renderRoute({ path: '/login' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Password/)).toBeInTheDocument()
    expect(
      screen.getByText(/Accounts are created by an administrator/),
    ).toBeInTheDocument()
  })

  it('offers no password recovery, which the backend does not support', async () => {
    await renderRoute({ path: '/login' })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /reset/i })).not.toBeInTheDocument()
  })

  it('toggles the password reveal', async () => {
    await renderRoute({ path: '/login' })
    await waitFor(() => {
      expect(screen.getByLabelText(/Password/)).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'text')
    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password')
  })
})

describe('login validation', () => {
  it('requires both fields and never calls the backend', async () => {
    const { harness } = await renderRoute({ path: '/login' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Enter your email address')).toBeInTheDocument()
    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(harness.http.callsTo('/auth/login')).toHaveLength(0)
  })

  it('rejects an address that is not one', async () => {
    const { harness } = await renderRoute({ path: '/login' })
    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })

    await signIn('not-an-email')

    expect(
      await screen.findByText('Enter a valid email address, for example name@example.org'),
    ).toBeInTheDocument()
    expect(harness.http.callsTo('/auth/login')).toHaveLength(0)
  })

  it('links each message to its field', async () => {
    await renderRoute({ path: '/login' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const email = await screen.findByLabelText(/Email address/)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('Enter your email address')
  })
})

describe('login success', () => {
  it('signs a member in through the FE-02 abstraction and lands on the dashboard', async () => {
    const { harness, router } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', {
      json: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer' },
    })
    harness.http.on('/auth/me', { json: testUser })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn()

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/dashboard')
    })

    // The page never calls fetch itself: it goes through the session store.
    const login = harness.http.callsTo('/auth/login')[0]
    expect(login?.method).toBe('POST')
    expect(JSON.parse(login?.body ?? '{}')).toEqual({ email: testUser.email, password: PASSWORD })
    expect(harness.http.callsTo('/auth/me')).toHaveLength(1)
    expect(harness.accessTokens.get()).toBe('access-1')
  })

  it('lands an administrator on the admin dashboard', async () => {
    const { harness, router } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', {
      json: { access_token: 'access-1', refresh_token: 'refresh-1', token_type: 'bearer' },
    })
    harness.http.on('/auth/me', { json: testAdmin })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn(testAdmin.email)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/admin')
    })
  })

  it('trims the address before sending it', async () => {
    const { harness } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', {
      json: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
    })
    harness.http.on('/auth/me', { json: testUser })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn(`  ${testUser.email}  `)

    await waitFor(() => {
      expect(harness.http.callsTo('/auth/login')).toHaveLength(1)
    })
    expect(JSON.parse(harness.http.callsTo('/auth/login')[0]?.body ?? '{}').email).toBe(
      testUser.email,
    )
  })
})

describe('login failure', () => {
  it('shows a safe message for rejected credentials and keeps what was typed', async () => {
    const { harness, router } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Incorrect email or password')
    expect(alert).toHaveTextContent('Check your details and try again.')

    // Nothing technical leaks, and the form is still usable.
    expect(alert).not.toHaveTextContent(PASSWORD)
    expect(alert).not.toHaveTextContent(/token|401|Bearer/i)
    expect(screen.getByLabelText(/Email address/)).toHaveValue(testUser.email)
    expect(screen.getByLabelText(/Password/)).toHaveValue(PASSWORD)
    expect(router.state.location.pathname).toBe('/login')
  })

  it('distinguishes an unreachable server from bad credentials', async () => {
    const { harness } = await renderRoute({ path: '/login' })
    harness.http.failNetwork('/auth/login')

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We couldn’t reach the server. Check your connection and try again.',
    )
  })

  it('reports a server failure without echoing the backend internals', async () => {
    const { harness } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', { status: 500, json: { detail: 'Internal server error' } })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The server is unavailable right now. Try again in a moment.')
    expect(alert).not.toHaveTextContent('Internal server error')
  })

  it('logs nothing during a failed sign-in', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    ]

    try {
      const { harness } = await renderRoute({ path: '/login' })
      harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })

      await waitFor(() => {
        expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
      })
      await signIn()
      await screen.findByRole('alert')

      for (const spy of spies) {
        expect(spy.mock.calls.flat().map(String).join('\n')).not.toContain(PASSWORD)
      }
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})

describe('login loading state', () => {
  it('disables the button and prevents a duplicate submission', async () => {
    const { harness } = await renderRoute({ path: '/login' })

    let release: (() => void) | undefined
    harness.http.on('/auth/login', async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { json: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' } }
    })
    harness.http.on('/auth/me', { json: testUser })

    await waitFor(() => {
      expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    })
    await signIn()

    const button = await screen.findByRole('button', { name: 'Signing in…' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    // A second click, and Enter in the field, must both be no-ops.
    await userEvent.click(button)
    await userEvent.type(screen.getByLabelText(/Password/), '{Enter}')
    expect(harness.http.callsTo('/auth/login')).toHaveLength(1)

    release?.()
    await waitFor(() => {
      expect(harness.authStore.getState().status).toBe('authenticated')
    })
  })
})

describe('session expiry notice', () => {
  it('explains why the person is back at the login page', async () => {
    await renderRoute({ path: '/login?expired=1' })

    // Wait for the page itself: the bootstrap screen is also a live region.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sign in again to continue where you left off.',
    )
  })
})

describe('login layout', () => {
  it('renders on a phone without the desktop-only copy', async () => {
    await renderRoute({ path: '/login', width: viewports.mobile })

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in', level: 1 })).toBeInTheDocument()
    })
    expect(screen.getByLabelText(/Email address/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------- FE-LOGIN-01

type Harness = RenderRouteResult['harness']

describe('login - back to home (Login and Login-Mobile boards)', () => {
  it.each([
    ['1440', viewports.wide],
    ['1024', viewports.laptop],
    ['768', viewports.tablet],
    ['390', viewports.mobile],
  ])('offers exactly one way back to the landing page at %s px', async (_width, width) => {
    const { router } = await renderRoute({ path: '/login', width })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    const links = screen.getAllByRole('link', { name: 'Back to home' })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/')

    await userEvent.click(links[0]!)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(
      await screen.findByRole('heading', { name: 'Learn together, at your own pace.', level: 1 }),
    ).toBeInTheDocument()
  })

  it('puts it in the corner of the form panel beside the brand panel', async () => {
    await renderRoute({ path: '/login', width: viewports.laptop })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    expect(screen.getByRole('main')).toContainElement(screen.getByRole('link', { name: 'Back to home' }))
  })

  it.each([
    ['768', viewports.tablet],
    ['390', viewports.mobile],
  ])('puts it under the logo band, above the photo band, once stacked at %s px', async (_width, width) => {
    await renderRoute({ path: '/login', width })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    const back = screen.getByRole('link', { name: 'Back to home' })
    expect(screen.getByRole('main')).not.toContainElement(back)
    const logo = screen.getByRole('img', { name: 'JEENISo' })
    const photo = document.querySelector('img[alt=""]')!
    expect(logo.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(back.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('login - error titles', () => {
  it('titles refused credentials as such', async () => {
    const { harness } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    await signIn()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Incorrect email or password')
    expect(alert).toHaveTextContent('Check your details and try again.')
  })

  it.each([
    [
      'an unreachable server',
      (harness: Harness) => harness.http.failNetwork('/auth/login'),
      'We couldn’t reach the server. Check your connection and try again.',
    ],
    [
      'a failing server',
      (harness: Harness) =>
        harness.http.on('/auth/login', { status: 503, json: { detail: 'Service unavailable' } }),
      'The server is unavailable right now. Try again in a moment.',
    ],
  ])('never blames the credentials for %s', async (_case, fail, body) => {
    await renderRoute({ path: '/login', beforeMount: fail })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    await signIn()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Something went wrong')
    expect(alert).toHaveTextContent(body)
    expect(alert).not.toHaveTextContent('Incorrect email or password')
  })

  it('replaces the expiry notice with the error once a sign-in fails', async () => {
    const { harness } = await renderRoute({ path: '/login?expired=1' })
    harness.http.on('/auth/login', { status: 401, json: { detail: 'Invalid email or password' } })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired')

    await signIn()

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(screen.queryByText('Your session has expired')).toBeNull()
  })
})

describe('login - focus and keyboard', () => {
  it('moves focus to the first field to fix after a failed submission', async () => {
    await renderRoute({ path: '/login' })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByLabelText(/Email address/)).toHaveFocus())

    // With a valid address, the password is the first field left to fix.
    await userEvent.type(screen.getByLabelText(/Email address/), testUser.email)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByLabelText(/Password/)).toHaveFocus())
    expect(screen.getByLabelText(/Password/)).toHaveAccessibleDescription('Enter your password')
  })

  it('reaches every control in reading order with Tab', async () => {
    await renderRoute({ path: '/login' })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    const order = [
      screen.getByRole('link', { name: 'Back to home' }),
      screen.getByLabelText(/Email address/),
      screen.getByLabelText(/Password/),
      screen.getByRole('button', { name: 'Show password' }),
      screen.getByRole('button', { name: 'Sign in' }),
      screen.getByRole('link', { name: 'contact@jeeniso.com' }),
    ]
    for (const control of order) {
      await userEvent.tab()
      expect(control).toHaveFocus()
    }
  })

  it('toggles the password reveal from the keyboard, with the autocomplete hints intact', async () => {
    await renderRoute({ path: '/login' })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    screen.getByRole('button', { name: 'Show password' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'text')
    await userEvent.keyboard(' ')
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/Password/)).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText(/Email address/)).toHaveAttribute('autocomplete', 'username')
  })

  it('signs an administrator in with Enter from the password field', async () => {
    const { harness, router } = await renderRoute({ path: '/login' })
    harness.http.on('/auth/login', {
      json: { access_token: 'a', refresh_token: 'r', token_type: 'bearer' },
    })
    harness.http.on('/auth/me', { json: testAdmin })
    await screen.findByRole('heading', { name: 'Sign in', level: 1 })

    await userEvent.type(screen.getByLabelText(/Email address/), testAdmin.email)
    await userEvent.type(screen.getByLabelText(/Password/), `${PASSWORD}{Enter}`)

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'))
  })
})
