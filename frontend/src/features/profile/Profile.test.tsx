import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { User } from '../auth'
import { type AuthHarness, testAdmin, testUser } from '../../test/authHarness'
import type { MockResponse, RecordedCall } from '../../test/fetchMock'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-PROFILE-01 - My profile and Edit profile, for a MEMBER and an ADMIN.
 *
 * `/auth/me` answers both the sign-in's GET and the profile's PATCH, so the
 * stub tells them apart by method; that is also how the tests prove a save
 * never triggers a second GET.
 */

const NEW_PASSWORD = 'a-brand-new-password'
const CURRENT_PASSWORD = 'my-current-password'

interface Stubs {
  patch?: MockResponse | ((call: RecordedCall) => MockResponse)
  password?: MockResponse
}

function stubProfile(harness: AuthHarness, user: User, stubs: Stubs = {}) {
  harness.http.on('/auth/me', (call) => {
    if (call.method !== 'PATCH') return { json: user }
    if (stubs.patch !== undefined) {
      return typeof stubs.patch === 'function' ? stubs.patch(call) : stubs.patch
    }
    // Echo what the backend would store: the fields sent, over the account.
    return { json: { ...user, ...(JSON.parse(call.body ?? '{}') as Partial<User>) } }
  })
  harness.http.on('/auth/change-password', stubs.password ?? { status: 204 })
}

async function open(path: string, as: 'member' | 'admin' = 'member', stubs?: Stubs, width?: number) {
  const user = as === 'admin' ? testAdmin : testUser
  const result = await renderRoute({
    path,
    as,
    beforeMount: (harness) => stubProfile(harness, user, stubs),
    ...(width ? { width } : {}),
  })
  await screen.findByRole('heading', { level: 1 })
  return result
}

const patches = (harness: AuthHarness) =>
  harness.http.callsTo('/auth/me').filter((call) => call.method === 'PATCH')
const meReads = (harness: AuthHarness) =>
  harness.http.callsTo('/auth/me').filter((call) => call.method === 'GET')

const firstName = () => screen.getByRole('textbox', { name: /First name/ })
const lastName = () => screen.getByRole('textbox', { name: /Last name/ })
const save = () => screen.getByRole('button', { name: 'Save changes' })
const updatePassword = () => screen.getByRole('button', { name: 'Update password' })

/**
 * Types into the three password fields.
 *
 * `user` is the instance to type with; it defaults to the shared one every
 * other test uses, so only a caller that needs a differently configured
 * instance passes one.
 */
async function fillPassword(
  current: string,
  next: string,
  confirm = next,
  user: Pick<typeof userEvent, 'type'> = userEvent,
) {
  if (current) await user.type(screen.getByLabelText(/Current password/), current)
  if (next) await user.type(screen.getByLabelText(/^New password/), next)
  if (confirm) await user.type(screen.getByLabelText(/Confirm new password/), confirm)
}

// ---------------------------------------------------------------- entry points

describe('profile - entry points', () => {
  it('a member reaches My profile from the account menu', async () => {
    const { router } = await open('/dashboard')

    await userEvent.click(screen.getByRole('button', { name: /Iyed Belghith/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'My profile' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(screen.getByRole('heading', { name: 'My profile', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Iyed Belghith', level: 2 })).toBeInTheDocument()
    expect(screen.getAllByText('MEMBER').length).toBeGreaterThan(0)
    expect(screen.getAllByText('iyed@example.org').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/profile/edit')
  })

  it('moves through the account menu with the arrow keys', async () => {
    await open('/dashboard')
    const trigger = screen.getByRole('button', { name: /Iyed Belghith/ })
    trigger.focus()
    await userEvent.keyboard('{Enter}')

    expect(screen.getByRole('menuitem', { name: 'My profile' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'My profile' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('an administrator reaches My profile from the sidebar identity block', async () => {
    const { router } = await open('/admin', 'admin', undefined, viewports.laptop)

    await userEvent.click(screen.getByRole('link', { name: 'My profile — Amal Dridi, Administrator' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/profile'))
    expect(screen.getByRole('heading', { name: 'My profile', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Your personal information as an administrator.')).toBeInTheDocument()
    expect(screen.getAllByText('ADMINISTRATOR').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /My profile — Amal Dridi/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
      'href',
      '/admin/profile/edit',
    )
    // Sign out stays visible under the identity block.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('on a phone, the Account tab opens the profile, which ends with Sign out', async () => {
    const { router, harness } = await open('/dashboard', 'member', undefined, viewports.mobile)

    await userEvent.click(screen.getByRole('link', { name: 'Account' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(harness.authStore.getState().status).toBe('unauthenticated'))
  })

  it('shows the password only as dots, and links to the password card', async () => {
    await open('/profile')

    expect(screen.getByText('Hidden')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change password' })).toHaveAttribute(
      'href',
      '/profile/edit#security',
    )
  })

  it('opening "Change password" starts on the current-password field', async () => {
    await open('/profile/edit#security')

    await waitFor(() => expect(screen.getByLabelText(/Current password/)).toHaveFocus())
  })
})

// ---------------------------------------------------------------- edit profile

describe('profile - edit', () => {
  it('opens with the account’s own names, and nothing else is editable', async () => {
    await open('/profile/edit')

    expect(firstName()).toHaveValue('Iyed')
    expect(lastName()).toHaveValue('Belghith')

    for (const [label, value] of [
      ['Email address', 'iyed@example.org'],
      ['Role', 'Member'],
      ['Account created', '01 Sep 2026'],
    ] as const) {
      const field = screen.getByRole('textbox', { name: label })
      expect(field).toHaveValue(value)
      expect(field).toHaveAttribute('readonly')
      await userEvent.type(field, 'x')
      expect(field).toHaveValue(value)
    }
    // Read-only is said, not only drawn.
    expect(screen.getAllByRole('img', { name: 'Read-only' })).toHaveLength(3)
    // What the backend cannot do is not offered.
    expect(screen.queryByRole('button', { name: /photo/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /forgot|reset/i })).toBeNull()
  })

  it('keeps Save disabled until a name changes, then says so', async () => {
    await open('/profile/edit')

    expect(save()).toBeDisabled()
    expect(screen.queryByText('Unsaved changes')).toBeNull()

    await userEvent.type(firstName(), ' Amine')

    expect(save()).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('saves, sends only the changed name, and returns to the read view', async () => {
    const { harness, router } = await open('/profile/edit')

    await userEvent.clear(firstName())
    await userEvent.type(firstName(), '  Iyed Amine ')
    await userEvent.click(save())

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    const [call] = patches(harness)
    expect(call?.method).toBe('PATCH')
    // Trimmed, and the unchanged last name is not sent.
    expect(JSON.parse(call?.body ?? '{}')).toEqual({ first_name: 'Iyed Amine' })

    // Found by its own text: the edit page's status region can still be in
    // the document for a moment while the read view mounts.
    const toast = (await screen.findByText('Profile updated')).closest('[role="status"]')
    expect(toast).toHaveTextContent('Your changes have been saved.')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'My profile', level: 1 })).toHaveFocus(),
    )
    expect(screen.getByRole('heading', { name: 'Iyed Amine Belghith', level: 2 })).toBeInTheDocument()
  })

  it('updates the session’s account from the response, with no second /auth/me', async () => {
    const { harness, router } = await open('/profile/edit')
    const readsBefore = meReads(harness).length

    await userEvent.clear(lastName())
    await userEvent.type(lastName(), 'Ben Salah')
    await userEvent.click(save())
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))

    expect(harness.authStore.getState().user?.last_name).toBe('Ben Salah')
    // The header reads the same session: the new name is already there.
    expect(screen.getByRole('button', { name: /Iyed Ben Salah/ })).toBeInTheDocument()
    expect(meReads(harness)).toHaveLength(readsBefore)
  })

  it('an administrator edits their own profile the same way', async () => {
    const { harness, router } = await open('/admin/profile/edit', 'admin', undefined, viewports.laptop)

    expect(firstName()).toHaveValue('Amal')
    expect(screen.getByRole('textbox', { name: 'Role' })).toHaveValue('Administrator')
    await userEvent.type(firstName(), ' Nour')
    await userEvent.click(save())

    await waitFor(() => expect(router.state.location.pathname).toBe('/admin/profile'))
    expect(JSON.parse(patches(harness)[0]?.body ?? '{}')).toEqual({ first_name: 'Amal Nour' })
    expect(await screen.findByRole('link', { name: /My profile — Amal Nour Dridi/ })).toBeInTheDocument()
  })

  it('refuses two empty names with a summary, inline messages and focus on the first', async () => {
    const { harness } = await open('/profile/edit')

    await userEvent.clear(firstName())
    await userEvent.clear(lastName())
    await userEvent.click(save())

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Your changes can’t be saved yet')
    expect(alert).toHaveTextContent('Fill in the two fields below, then try again.')
    expect(firstName()).toHaveAccessibleDescription('Enter your first name')
    expect(lastName()).toHaveAccessibleDescription('Enter your last name')
    expect(firstName()).toHaveFocus()
    expect(patches(harness)).toHaveLength(0)
  })

  it('reports one empty name inline, without a summary', async () => {
    const { harness } = await open('/profile/edit')

    await userEvent.clear(lastName())
    await userEvent.type(lastName(), '   ')
    await userEvent.click(save())

    expect(lastName()).toHaveAttribute('aria-invalid', 'true')
    expect(lastName()).toHaveFocus()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(patches(harness)).toHaveLength(0)
  })

  it('locks the form while saving and sends one request', async () => {
    let release = () => undefined as void
    const held = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const { harness, router } = await renderRoute({
      path: '/profile/edit',
      as: 'member',
      beforeMount: (instance) => {
        stubProfile(instance, testUser)
        instance.http.on('/auth/me', async (call) => {
          if (call.method !== 'PATCH') return { json: testUser }
          await held
          return { json: { ...testUser, first_name: 'Iyed Amine' } }
        })
      },
    })
    await screen.findByRole('heading', { level: 1 })

    await userEvent.type(firstName(), ' Amine')
    await userEvent.click(save())

    await waitFor(() => expect(firstName()).toBeDisabled())
    expect(lastName()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByText('Saving your changes…')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Saving/ }))

    release()
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(patches(harness)).toHaveLength(1)
  })

  it.each([
    ['a server error', { status: 500, json: { detail: 'Traceback: SELECT * FROM users' } }],
    ['storage unavailable', { status: 503, json: { detail: 'Profile storage temporarily unavailable' } }],
  ])('keeps the changes on %s, with the board’s message', async (_label, reply) => {
    const { router } = await open('/profile/edit', 'member', { patch: reply })

    await userEvent.type(firstName(), ' Amine')
    await userEvent.click(save())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t save your changes')
    expect(alert).toHaveTextContent('Your changes are still on this page. Try again in a moment.')
    expect(document.body.textContent).not.toMatch(/Traceback|SELECT|storage temporarily/)
    expect(firstName()).toHaveValue('Iyed Amine')
    expect(router.state.location.pathname).toBe('/profile/edit')
    expect(save()).toBeEnabled()
  })

  it('reports a dropped connection the same way', async () => {
    const { harness } = await open('/profile/edit')
    harness.http.failNetwork('/auth/me')

    await userEvent.type(firstName(), ' Amine')
    await userEvent.click(save())

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save your changes')
    expect(firstName()).toHaveValue('Iyed Amine')
  })

  it('maps a 422 back onto the field the server named', async () => {
    await open('/profile/edit', 'member', {
      patch: {
        status: 422,
        json: { detail: [{ loc: ['body', 'last_name'], msg: 'String too long', type: 'string_too_long' }] },
      },
    })

    await userEvent.type(lastName(), 'x')
    await userEvent.click(save())

    await waitFor(() => expect(lastName()).toHaveAttribute('aria-invalid', 'true'))
    expect(lastName()).toHaveAccessibleDescription('Enter a name of 1 to 100 characters')
    expect(screen.queryByText('String too long')).toBeNull()
  })

  it('an expired session goes to sign-in, without being held by the discard dialog', async () => {
    const { harness, router } = await open('/profile/edit', 'member', {
      patch: { status: 401, json: { detail: 'Invalid authentication credentials' } },
    })
    harness.http.on('/auth/refresh', { status: 401, json: { detail: 'Invalid token' } })

    await userEvent.type(firstName(), ' Amine')
    await userEvent.click(save())

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

// ------------------------------------------------------------ unsaved changes

describe('profile - leaving with unsaved changes', () => {
  it('Cancel with nothing changed goes straight back', async () => {
    const { router } = await open('/profile/edit')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel with a change asks first; Keep editing keeps everything', async () => {
    const { router } = await open('/profile/edit')
    await userEvent.type(firstName(), ' Amine')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    expect(dialog).toHaveTextContent('You have unsaved changes. If you leave this page now, they will be lost.')
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Discard changes' }).className).toMatch(/danger/)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/profile/edit')
    expect(firstName()).toHaveValue('Iyed Amine')
  })

  it('Discard changes leaves without saving anything', async () => {
    const { router, harness } = await open('/profile/edit')
    await userEvent.type(firstName(), ' Amine')

    await userEvent.click(screen.getByRole('link', { name: 'My profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(patches(harness)).toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Iyed Belghith', level: 2 })).toBeInTheDocument()
  })

  it('also holds the navigation links and the browser’s Back', async () => {
    const { router } = await renderRoute({
      path: '/dashboard',
      as: 'member',
      beforeMount: (harness) => stubProfile(harness, testUser),
    })
    await screen.findByRole('heading', { level: 1 })
    await router.navigate('/profile/edit')
    await screen.findByRole('heading', { name: 'Edit profile', level: 1 })
    await userEvent.type(firstName(), ' Amine')

    await userEvent.click(screen.getByRole('link', { name: 'Courses' }))
    expect(await screen.findByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

    await router.navigate(-1)
    expect(await screen.findByRole('dialog', { name: 'Discard your changes?' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profile/edit')
  })
})

// ------------------------------------------------------------ password change

describe('profile - change password', () => {
  it('starts disabled, with the reason and the twelve-character requirement', async () => {
    await open('/profile/edit')

    expect(updatePassword()).toBeDisabled()
    expect(updatePassword()).toHaveAccessibleDescription(
      'Fill in all fields and meet every requirement to continue.',
    )
    expect(screen.getByRole('list', { name: 'Your password must have' })).toHaveTextContent(
      'At least 12 characters — not met',
    )
    expect(screen.queryByText(/8 characters/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear form' })).toBeDisabled()
  })

  // FE-QA-FINAL-01 (G31): Password-States' meter, "A guide only".
  it('shows a strength meter under the new password, in words, as a guide only', async () => {
    await open('/profile/edit')
    const field = screen.getByLabelText(/^New password/)
    // This test types four passwords in a row - 85 keystrokes. The default
    // instance waits for a macrotask between each one, which on a busy machine
    // is what pushed it past the five-second limit. `delay: null` drops that
    // wait only; every key still dispatches the same keydown/input/keyup and
    // the component re-renders for each of them.
    const typist = userEvent.setup({ delay: null })

    expect(screen.getByText('Strength shows here as you type.')).toBeInTheDocument()

    await typist.type(field, 'Blue7')
    expect(screen.getByText('Strength: Weak')).toBeInTheDocument()
    expect(screen.getByText('A guide only. The requirements above are what count.')).toBeInTheDocument()

    await typist.clear(field)
    await typist.type(field, 'bluebird-evening')
    expect(screen.getByText('Strength: Fair')).toBeInTheDocument()

    await typist.clear(field)
    await typist.type(field, 'Blue-bird Evening 7')
    expect(screen.getByText('Strength: Strong')).toBeInTheDocument()
    // Announced: the verdict lives in a polite status region.
    expect(screen.getByText('Strength: Strong').closest('[role="status"]')).not.toBeNull()

    // A guide, not a gate: a long lowercase passphrase is accepted as it is.
    await typist.clear(field)
    await typist.type(field, 'x'.repeat(12))
    expect(screen.getByText('Strength: Weak')).toBeInTheDocument()
    await fillPassword(CURRENT_PASSWORD, '', 'x'.repeat(12), typist)
    expect(updatePassword()).toBeEnabled()
  })

  it('ticks the requirement at twelve characters, not before', async () => {
    await open('/profile/edit')

    await fillPassword(CURRENT_PASSWORD, 'x'.repeat(11))
    expect(screen.getByRole('list', { name: 'Your password must have' })).toHaveTextContent('— not met')
    expect(updatePassword()).toBeDisabled()

    await userEvent.type(screen.getByLabelText(/^New password/), 'x')
    await userEvent.type(screen.getByLabelText(/Confirm new password/), 'x')
    expect(screen.getByRole('list', { name: 'Your password must have' })).toHaveTextContent(
      'At least 12 characters — met',
    )
    expect(updatePassword()).toBeEnabled()
    expect(updatePassword()).toHaveAccessibleDescription('Ready to update')
  })

  it('says when the confirmation does not match, and stays disabled', async () => {
    await open('/profile/edit')

    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD, 'a-brand-new-passwore')

    const confirm = screen.getByLabelText(/Confirm new password/)
    expect(confirm).toHaveAttribute('aria-invalid', 'true')
    expect(confirm).toHaveAccessibleDescription('The two passwords don’t match')
    expect(updatePassword()).toBeDisabled()

    await userEvent.clear(confirm)
    await userEvent.type(confirm, NEW_PASSWORD)
    expect(confirm).not.toHaveAttribute('aria-invalid')
    expect(updatePassword()).toBeEnabled()
  })

  it('requires the current password', async () => {
    await open('/profile/edit')

    await fillPassword('', NEW_PASSWORD)

    expect(updatePassword()).toBeDisabled()
  })

  it('sends the two passwords and never the confirmation, then confirms and clears', async () => {
    const { harness } = await open('/profile/edit')

    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD)
    await userEvent.click(updatePassword())

    const notice = await screen.findByText('Password updated')
    const box = notice.closest('[role="status"]') as HTMLElement
    expect(box).toHaveTextContent('Your new password is active. Use it the next time you sign in.')
    expect(box).toHaveFocus()
    // Other sessions are not signed out by the backend; nothing claims it.
    expect(document.body.textContent).not.toMatch(/other (devices|sessions)|signed out everywhere/i)

    const [call] = harness.http.callsTo('/auth/change-password')
    expect(call?.method).toBe('POST')
    expect(JSON.parse(call?.body ?? '{}')).toEqual({
      current_password: CURRENT_PASSWORD,
      new_password: NEW_PASSWORD,
    })
    expect(screen.getByLabelText(/Current password/)).toHaveValue('')
    expect(screen.getByLabelText(/^New password/)).toHaveValue('')
    expect(screen.getByLabelText(/Confirm new password/)).toHaveValue('')
    // The profile was not saved by it.
    expect(patches(harness)).toHaveLength(0)
    expect(harness.authStore.getState().status).toBe('authenticated')
  })

  it('shows a wrong current password on that field, without touching the session', async () => {
    const { harness, router } = await open('/profile/edit', 'member', {
      password: { status: 400, json: { detail: 'Current password is incorrect' } },
    })

    await fillPassword('not-my-password', NEW_PASSWORD)
    // The session bootstrap refreshes once at mount; count from here.
    const refreshesBefore = harness.http.callsTo('/auth/refresh').length
    await userEvent.click(updatePassword())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We couldn’t update your password')
    expect(alert).toHaveTextContent('Check your current password and try again.')
    const current = screen.getByLabelText(/Current password/)
    expect(current).toHaveAttribute('aria-invalid', 'true')
    expect(current).toHaveAccessibleDescription('Your current password is incorrect')
    await waitFor(() => expect(current).toHaveFocus())
    // A form error, not an expired session: no refresh, still signed in.
    expect(harness.http.callsTo('/auth/refresh')).toHaveLength(refreshesBefore)
    expect(harness.http.callsTo('/auth/change-password')).toHaveLength(1)
    expect(harness.authStore.getState().status).toBe('authenticated')
    expect(router.state.location.pathname).toBe('/profile/edit')
    // The entries are kept.
    expect(screen.getByLabelText(/^New password/)).toHaveValue(NEW_PASSWORD)
  })

  it('clears the wrong-password error once the field is edited', async () => {
    await open('/profile/edit', 'member', {
      password: { status: 400, json: { detail: 'Current password is incorrect' } },
    })
    await fillPassword('not-my-password', NEW_PASSWORD)
    await userEvent.click(updatePassword())
    await screen.findByRole('alert')

    await userEvent.type(screen.getByLabelText(/Current password/), 'x')

    expect(screen.getByLabelText(/Current password/)).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['a server error', { status: 500, json: { detail: 'Traceback' } }],
    ['storage unavailable', { status: 503, json: { detail: 'Profile storage temporarily unavailable' } }],
  ])('keeps the entries on %s', async (_label, reply) => {
    await open('/profile/edit', 'member', { password: reply })

    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD)
    await userEvent.click(updatePassword())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Nothing was changed. Your entries are still here. Try again in a moment.')
    expect(document.body.textContent).not.toMatch(/Traceback|storage temporarily/)
    expect(screen.getByLabelText(/Current password/)).toHaveValue(CURRENT_PASSWORD)
  })

  it('maps a policy refusal (422) onto the new password', async () => {
    await open('/profile/edit', 'member', {
      password: {
        status: 422,
        json: { detail: [{ loc: ['body', 'new_password'], msg: 'too short', type: 'string_too_short' }] },
      },
    })

    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD)
    await userEvent.click(updatePassword())

    const next = screen.getByLabelText(/^New password/)
    await waitFor(() => expect(next).toHaveAttribute('aria-invalid', 'true'))
    expect(next).toHaveAccessibleDescription('Use 12 to 1024 characters')
  })

  it('shows and hides each password on its own', async () => {
    await open('/profile/edit')
    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD)

    const toggles = screen.getAllByRole('button', { name: 'Show password' })
    expect(toggles).toHaveLength(3)
    await userEvent.click(toggles[0]!)

    expect(screen.getByLabelText(/Current password/)).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('type', 'password')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
  })

  it('Clear form empties every field', async () => {
    await open('/profile/edit')
    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD)

    await userEvent.click(screen.getByRole('button', { name: 'Clear form' }))

    expect(screen.getByLabelText(/Current password/)).toHaveValue('')
    expect(screen.getByLabelText(/Confirm new password/)).toHaveValue('')
    expect(updatePassword()).toBeDisabled()
  })

  it('an administrator changes their own password through the same form', async () => {
    const { harness } = await open('/admin/profile/edit', 'admin', undefined, viewports.laptop)

    await fillPassword(CURRENT_PASSWORD, NEW_PASSWORD)
    await userEvent.click(updatePassword())

    await screen.findByText('Password updated')
    expect(harness.http.callsTo('/auth/change-password')).toHaveLength(1)
  })
})

// ------------------------------------------------------------------ responsive

// FE-QA-FINAL-01: at 1024 the card beside the identity card is narrow; the
// label column gives way (down to 96px) so the role chip, which never wraps,
// keeps the room it needs instead of pushing the page wider than the window.
describe('profile - the detail rows', () => {
  it('lets the label column shrink before the value overflows', async () => {
    await open('/profile')
    const label = await screen.findByText('Role', { selector: 'dt' })

    expect(getComputedStyle(label.parentElement!).gridTemplateColumns).toBe(
      'minmax(96px, 180px) minmax(min-content, 1fr)',
    )
  })
})

describe('profile - responsive', () => {
  it.each([viewports.mobile, viewports.tablet, viewports.desktop])(
    'the read view and the edit page work at %ipx',
    async (width) => {
      const { router, harness } = await open('/profile', 'member', undefined, width)

      await userEvent.click(screen.getByRole('link', { name: 'Edit profile' }))
      await screen.findByRole('heading', { name: 'Edit profile', level: 1 })
      await userEvent.type(firstName(), ' Amine')
      await userEvent.click(save())

      await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
      expect(patches(harness)).toHaveLength(1)
    },
  )
})

// ------------------------------------------------ FE-MOBILE-01 (G29, G32)

/**
 * Profile-Mobile and Admin-Profile-Mobile end the page with "Edit profile"
 * then "Sign out", for both roles; from 600px "Edit profile" stays in the
 * header. Toasts and dialogs rise above the member bottom bar (DS 06).
 */
describe('profile - on a phone', () => {
  const header = () => screen.getByRole('heading', { name: 'My profile', level: 1 }).closest('header')!
  const security = () => screen.getByRole('region', { name: 'Account & security' })
  const follows = (first: Element, second: Element) =>
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

  it.each([
    ['member', 390],
    ['member', 375],
    ['member', 599],
    ['admin', 390],
  ] as const)('the %s profile ends with Edit profile, then Sign out, at %ipx', async (role, width) => {
    await open(role === 'admin' ? '/admin/profile' : '/profile', role, undefined, width)

    // One Edit profile link on the page, and not in the header.
    const edits = screen.getAllByRole('link', { name: 'Edit profile' })
    expect(edits).toHaveLength(1)
    expect(header()).not.toContainElement(edits[0]!)
    expect(edits[0]).toHaveAttribute('href', role === 'admin' ? '/admin/profile/edit' : '/profile/edit')

    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(follows(security(), edits[0]!)).toBe(true)
    expect(follows(edits[0]!, signOut)).toBe(true)
    // Same style as each other: full width, the board's 52px size.
    expect(edits[0]!.className).toMatch(/lg/)
    expect(signOut.className).toMatch(/lg/)
    expect(signOut.className).toMatch(/fullWidth/)
  })

  it.each([
    ['member', 600],
    ['member', 768],
    ['member', 1440],
    ['admin', 768],
    ['admin', 1024],
    ['admin', 1440],
  ] as const)('the %s profile keeps Edit profile in the header at %ipx', async (role, width) => {
    await open(role === 'admin' ? '/admin/profile' : '/profile', role, undefined, width)

    const edits = screen.getAllByRole('link', { name: 'Edit profile' })
    expect(edits).toHaveLength(1)
    expect(header()).toContainElement(edits[0]!)
    // No page-level Sign out: from 600px it lives in the shell (account menu,
    // or the admin sidebar), as before.
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('signs an administrator out from the mobile profile, through the existing sign-out', async () => {
    const { router, harness } = await open('/admin/profile', 'admin', undefined, viewports.mobile)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(harness.authStore.getState().status).toBe('unauthenticated')
    expect(harness.refreshTokens.read()).toBeNull()
  })

  it('signs a member out from the mobile profile, as before', async () => {
    const { router, harness } = await open('/profile', 'member', undefined, viewports.mobile)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(harness.authStore.getState().status).toBe('unauthenticated')
  })

  it('shows the saved toast above the member bottom bar on a phone', async () => {
    await open('/profile/edit', 'member', undefined, viewports.mobile)

    await userEvent.type(firstName(), ' Amine')
    await userEvent.click(save())

    const toast = (await screen.findByText('Profile updated')).closest('[role="status"]')!
    expect(toast).toHaveAttribute('data-bottom-bar')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it.each([
    ['a member at 768px', 'member', viewports.tablet],
    ['an administrator on a phone (no bottom bar)', 'admin', viewports.mobile],
  ] as const)('keeps the toast at the bottom edge for %s', async (_case, role, width) => {
    await open(role === 'admin' ? '/admin/profile/edit' : '/profile/edit', role, undefined, width)

    await userEvent.type(firstName(), ' Amine')
    await userEvent.click(save())

    const toast = (await screen.findByText('Profile updated')).closest('[role="status"]')!
    expect(toast).not.toHaveAttribute('data-bottom-bar')
  })

  it('opens the discard dialog as a sheet above the bottom bar, and still guards the edit', async () => {
    const { router } = await open('/profile/edit', 'member', undefined, viewports.mobile)
    await userEvent.type(firstName(), ' Amine')

    await userEvent.click(screen.getByRole('link', { name: 'Account' }))

    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    expect(dialog.parentElement).toHaveAttribute('data-placement', 'sheet')
    expect(dialog.parentElement).toHaveAttribute('data-bottom-bar')
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/profile/edit')
    expect(firstName()).toHaveValue('Iyed Amine')
  })
})
