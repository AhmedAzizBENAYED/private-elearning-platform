import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import type { MockResponse, RecordedCall } from '../../test/fetchMock'
import { adminMembers, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * MEMBERS-01 - an administrator creates a member with an initial password.
 *
 * The dialog is the Admin-Members-States board's "Add a member", with the
 * name split into first and last because the API stores them apart. The
 * password must travel only in the one POST body: never a URL, never storage.
 */

const MEMBERS = '/admin/members'
const PASSWORD = 'initial-password-12'

const hedi = {
  id: '99999999-9999-4999-8999-999999999999',
  email: 'hedi.bouzid@example.org',
  first_name: 'Hedi',
  last_name: 'Bouzid',
  is_active: true,
  role: 'MEMBER' as const,
  created_at: '2026-09-21T08:00:00Z',
  updated_at: '2026-09-21T08:00:00Z',
}

type Creation = MockResponse | ((call: RecordedCall) => MockResponse | Promise<MockResponse>)

/**
 * `/admin/members` serves both the listing (GET) and the creation (POST): the
 * handler tells them apart by method, and a successful creation adds the row
 * the next listing returns - exactly what the server would do.
 */
function stubMembers(harness: AuthHarness, creation: Creation = { status: 201, json: hedi }) {
  const rows = [...adminMembers]
  harness.http.on(MEMBERS, async (call) => {
    if (call.method !== 'POST') return { json: membersPage(rows) }
    const reply = typeof creation === 'function' ? await creation(call) : creation
    if ((reply.status ?? 200) < 300) rows.push(reply.json as typeof hedi)
    return reply
  })
}

async function openMembers(creation?: Creation, width?: number) {
  const result = await renderRoute({
    path: MEMBERS,
    as: 'admin',
    beforeMount: (harness) => stubMembers(harness, creation),
    ...(width ? { width } : {}),
  })
  await screen.findByRole('heading', { name: 'Members', level: 1 })
  await screen.findByRole('table')
  return result
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
  return screen.findByRole('dialog', { name: 'Add a member' })
}

async function fillValid(
  dialog: HTMLElement,
  overrides: Partial<Record<'first' | 'last' | 'email' | 'password', string>> = {},
) {
  const view = within(dialog)
  await userEvent.type(view.getByLabelText(/First name/), overrides.first ?? '  Hedi ')
  await userEvent.type(view.getByLabelText(/Last name/), overrides.last ?? 'Bouzid')
  await userEvent.type(view.getByLabelText(/Email address/), overrides.email ?? 'hedi.bouzid@example.org')
  await userEvent.type(view.getByLabelText(/^Password/), overrides.password ?? PASSWORD)
}

const creations = (harness: AuthHarness) =>
  harness.http.calls.filter((call) => call.method === 'POST' && call.url.includes(MEMBERS))

describe('admin members - add member', () => {
  it('offers Add member in the page header', async () => {
    await openMembers()

    const header = screen.getByRole('heading', { name: 'Members', level: 1 }).closest('header')!
    expect(within(header).getByRole('button', { name: 'Add member' })).toBeInTheDocument()
  })

  it('opens the board’s modal with focus in the first field', async () => {
    await openMembers()
    const dialog = await openDialog()

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('heading', { name: 'Add a member', level: 2 })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/First name/)).toHaveFocus()
  })

  it('asks for first name, last name, email and password - nothing else', async () => {
    await openMembers()
    const dialog = await openDialog()
    const view = within(dialog)

    expect(view.getByLabelText(/First name/)).toBeRequired()
    expect(view.getByLabelText(/Last name/)).toBeRequired()
    expect(view.getByLabelText(/Email address/)).toHaveAttribute('type', 'email')
    const password = view.getByLabelText(/^Password/)
    expect(password).toHaveAttribute('type', 'password')
    // The administrator's own saved password must never be filled in here.
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(view.getByText(/The member will use it to sign in\. Share it through a secure channel\./))
      .toBeInTheDocument()
    expect(view.getByText(/At least 12 characters/)).toBeInTheDocument()
    // No role, no status, no avatar: the server decides the first two.
    expect(view.queryByLabelText(/role/i)).toBeNull()
    expect(view.queryByLabelText(/status/i)).toBeNull()
    expect(view.getAllByRole('textbox')).toHaveLength(3)
  })

  it('checks every field locally and sends nothing when one is wrong', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    const view = within(dialog)
    expect(view.getByText('Enter the member’s first name')).toBeInTheDocument()
    expect(view.getByText('Enter the member’s last name')).toBeInTheDocument()
    expect(view.getByText('Enter a valid email address')).toBeInTheDocument()
    expect(view.getByText('Use at least 12 characters')).toBeInTheDocument()
    expect(view.getByLabelText(/First name/)).toHaveAttribute('aria-invalid', 'true')
    // Focus goes to the first field to fix.
    await waitFor(() => expect(view.getByLabelText(/First name/)).toHaveFocus())
    expect(creations(harness)).toEqual([])
  })

  it('refuses an invalid address and a password under twelve characters', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog, { email: 'hedi@', password: 'elevenchars' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    expect(within(dialog).getByText('Enter a valid email address')).toBeInTheDocument()
    expect(within(dialog).getByText('Use at least 12 characters')).toBeInTheDocument()
    expect(creations(harness)).toEqual([])
  })

  it('accepts a password of exactly twelve characters', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog, { password: 'twelve-chars' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    await waitFor(() => expect(creations(harness)).toHaveLength(1))
  })

  it('shows and hides the password', async () => {
    await openMembers()
    const dialog = await openDialog()
    const password = within(dialog).getByLabelText(/^Password/)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Show password' }))
    expect(password).toHaveAttribute('type', 'text')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hide password' }))
    expect(password).toHaveAttribute('type', 'password')
  })

  it('sends exactly the four fields, trimmed, and never a role or a status', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog, { email: '  hedi.bouzid@example.org  ' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    await waitFor(() => expect(creations(harness)).toHaveLength(1))
    const call = creations(harness)[0]!
    expect(new URL(call.url).pathname).toBe('/api/v1/admin/members')
    expect(JSON.parse(call.body!)).toEqual({
      first_name: 'Hedi',
      last_name: 'Bouzid',
      email: 'hedi.bouzid@example.org',
      password: PASSWORD,
    })
    // The password is in the body of this one request and nowhere else.
    for (const request of harness.http.calls) expect(request.url).not.toContain(PASSWORD)
  })

  it('shows the loading state, locks the form and sends one request only', async () => {
    let release = () => undefined as void
    const held = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const { harness } = await openMembers(async () => {
      await held
      return { status: 201, json: hedi }
    })
    const dialog = await openDialog()
    await fillValid(dialog)

    const submit = within(dialog).getByRole('button', { name: 'Create member' })
    await userEvent.click(submit)

    const busy = await within(dialog).findByRole('button', { name: /Creating…/ })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(within(dialog).getByLabelText(/First name/)).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toBeDisabled()

    // Escape cannot dismiss the dialog out from under the request.
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Add a member' })).toBeInTheDocument()
    // A second press does nothing: the button is disabled while it runs.
    await userEvent.click(busy)
    expect(creations(harness)).toHaveLength(1)

    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(creations(harness)).toHaveLength(1)
  })

  it('confirms success, closes, refreshes the list and highlights the new row', async () => {
    const { harness } = await openMembers()
    const listingsBefore = harness.http.calls.filter((call) => call.method === 'GET' && call.url.includes(MEMBERS)).length
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const toast = await screen.findByRole('status')
    await waitFor(() => expect(toast).toHaveTextContent('Member created'))
    expect(toast).toHaveTextContent('Hedi Bouzid can now sign in.')

    // Read again from the server - no full reload - and the new row is there.
    const row = (await screen.findByRole('link', { name: 'Hedi Bouzid' })).closest('tr')!
    expect(row.className).toMatch(/highlighted/)
    const listingsAfter = harness.http.calls.filter((call) => call.method === 'GET' && call.url.includes(MEMBERS)).length
    expect(listingsAfter).toBe(listingsBefore + 1)

    // Focus returns to the control that opened the dialog.
    expect(screen.getByRole('button', { name: 'Add member' })).toHaveFocus()
  })

  it('reports a duplicate email in the board’s words and keeps what was typed', async () => {
    await openMembers({ status: 409, json: { detail: 'Email already in use' } })
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('This email is already used')
    expect(alert).toHaveTextContent('A member with this email address already exists. Use another address.')
    const email = within(dialog).getByLabelText(/Email address/)
    expect(within(dialog).getByText('Use another email address')).toBeInTheDocument()
    expect(email).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(email).toHaveFocus())
    // Nothing is lost: the password is still there for the retry.
    expect(within(dialog).getByLabelText(/^Password/)).toHaveValue(PASSWORD)
    expect(within(dialog).getByLabelText(/First name/)).toHaveValue('  Hedi ')
    expect(screen.getByRole('dialog', { name: 'Add a member' })).toBeInTheDocument()
  })

  it('maps a field the server refuses onto that field', async () => {
    await openMembers({
      status: 422,
      json: { detail: [{ loc: ['body', 'password'], msg: 'String should have at least 12 characters', type: 'string_too_short' }] },
    })
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    const password = within(dialog).getByLabelText(/^Password/)
    await waitFor(() => expect(password).toHaveAttribute('aria-invalid', 'true'))
    expect(within(dialog).getByText('Use 12 to 1024 characters')).toBeInTheDocument()
    // Pydantic's own wording is not shown.
    expect(dialog.textContent).not.toContain('String should have')
  })

  it.each([
    [403, 'You can’t create members'],
    [500, 'We couldn’t create the member'],
    [503, 'We couldn’t create the member'],
  ])('reports a %i without exposing anything internal', async (status, title) => {
    await openMembers({
      status,
      json: { detail: 'Traceback: SELECT * FROM users WHERE hashed_password = ... at /app/services/member_service.py' },
    })
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(title)
    for (const leak of ['Traceback', 'SELECT', 'hashed_password', 'member_service', PASSWORD]) {
      expect(dialog.textContent).not.toContain(leak)
    }
    // Focus is not left on a disabled control: it returns to the retry.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Create member' })).toHaveFocus(),
    )
  })

  it('treats a lost connection as a retryable failure', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog)
    harness.http.failNetwork(MEMBERS)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('We couldn’t create the member')
    expect(within(dialog).getByLabelText(/^Password/)).toHaveValue(PASSWORD)
  })

  it('closes on Cancel without sending anything', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(creations(harness)).toEqual([])
    expect(screen.getByRole('button', { name: 'Add member' })).toHaveFocus()
  })

  it('closes on Escape, and a reopened form starts empty', async () => {
    await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    const again = await openDialog()
    // Nothing from the abandoned attempt survives - the password least of all.
    expect(within(again).getByLabelText(/^Password/)).toHaveValue('')
    expect(within(again).getByLabelText(/First name/)).toHaveValue('')
  })

  it('keeps Tab inside the dialog', async () => {
    await openMembers()
    const dialog = await openDialog()

    // From the last control, Tab wraps to the first rather than leaving.
    within(dialog).getByRole('button', { name: 'Create member' }).focus()
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('submits from the keyboard with Enter', async () => {
    const { harness } = await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog)

    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(creations(harness)).toHaveLength(1))
  })

  it('never writes the password to browser storage', async () => {
    await openMembers()
    const dialog = await openDialog()
    await fillValid(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    for (const store of [localStorage, sessionStorage]) {
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index)!
        expect(store.getItem(key) ?? '').not.toContain(PASSWORD)
      }
    }
  })

  it('offers Add member from the empty list, in the board’s words', async () => {
    await renderRoute({
      path: MEMBERS,
      as: 'admin',
      beforeMount: (harness) => harness.http.on(MEMBERS, { json: membersPage([]) }),
    })

    expect(await screen.findByRole('heading', { name: 'No members yet' })).toBeInTheDocument()
    expect(
      screen.getByText('Create the first member account so that people can sign in and start learning.'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add member' })).toHaveLength(2)
  })

  it.each([viewports.mobile, viewports.tablet, viewports.desktop])(
    'is usable at %ipx',
    async (width) => {
      const { harness } = await openMembers(undefined, width)
      const dialog = await openDialog()
      await fillValid(dialog)

      await userEvent.click(within(dialog).getByRole('button', { name: 'Create member' }))

      await waitFor(() => expect(creations(harness)).toHaveLength(1))
      expect(await screen.findByRole('status')).toHaveTextContent('Member created')
    },
  )
})
