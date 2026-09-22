import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import type { MockResponse } from '../../test/fetchMock'
import { adminMembers, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-ADMIN-MEMBER-EDIT-01 - an administrator edits a member's name
 * (Admin-Member-Edit, Admin-Member-Edit-Mobile, Admin-Profile-States).
 *
 * `PATCH /admin/members/{id}` takes `first_name` / `last_name` (and an email
 * the board keeps read-only, so it is never sent). The server below keeps one
 * copy of each row, so what the edit writes is what the list and the member's
 * page read back afterwards.
 */

const SARRA = adminMembers[0]!
const MEMBERS = '/admin/members'
const EDIT = `${MEMBERS}/${SARRA.id}/edit`

function stubServer(harness: AuthHarness, patchReply?: MockResponse) {
  const rows = adminMembers.map((member) => ({ ...member }))
  harness.http.on(MEMBERS, () => ({ json: membersPage(rows) }))
  for (const row of rows) {
    harness.http.on(`${MEMBERS}/${row.id}`, (call) => {
      if (call.method !== 'PATCH') return { json: row }
      if (patchReply) return patchReply
      Object.assign(row, JSON.parse(call.body ?? '{}'), { updated_at: '2026-09-21T10:00:00Z' })
      return { json: row }
    })
    harness.http.on(`${MEMBERS}/${row.id}/status`, { json: row })
  }
}

const open = (path: string, patchReply?: MockResponse, width?: number) =>
  renderRoute({
    path,
    as: 'admin',
    beforeMount: (harness) => stubServer(harness, patchReply),
    ...(width ? { width } : {}),
  })

async function openEdit(patchReply?: MockResponse, width?: number) {
  const result = await open(EDIT, patchReply, width)
  await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })
  return result
}

const firstName = () => screen.getByLabelText(/^First name/)
const lastName = () => screen.getByLabelText(/^Last name/)
const save = () => screen.getByRole('button', { name: /Save changes|Saving/ })
const patches = (harness: AuthHarness) =>
  harness.http.callsTo(`${MEMBERS}/${SARRA.id}`).filter((call) => call.method === 'PATCH')

async function rename(value = 'Sarra Nour') {
  await userEvent.clear(firstName())
  await userEvent.type(firstName(), value)
}

describe('admin member edit - entry points', () => {
  it('opens from the member list row, for that member', async () => {
    const { router } = await open(MEMBERS)
    const table = await screen.findByRole('table')

    await userEvent.click(within(table).getByRole('link', { name: 'Edit profile for Sarra Mansour' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(EDIT))
    expect(await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })).toBeInTheDocument()
  })

  it('opens from the member’s own page', async () => {
    const { router } = await open(`${MEMBERS}/${SARRA.id}`)
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('link', { name: 'Edit profile' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(EDIT))
  })
})

describe('admin member edit - the form', () => {
  it('shows the member’s current values, as drawn', async () => {
    await openEdit()

    expect(screen.getByText('Update Sarra Mansour’s personal information.')).toBeInTheDocument()
    expect(
      screen.getByText('You are editing the profile of another member. Only administrators can do this.'),
    ).toBeInTheDocument()
    expect(firstName()).toHaveValue('Sarra')
    expect(lastName()).toHaveValue('Mansour')
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(breadcrumb).getByRole('link', { name: 'Members' })).toHaveAttribute('href', MEMBERS)
    expect(within(breadcrumb).getByRole('link', { name: 'Sarra Mansour' })).toBeInTheDocument()
  })

  it('makes only the names editable; email, role, status and creation stay read-only', async () => {
    await openEdit()

    for (const label of [/^Email address/, /^Role/, /^Status/, /^Account created/]) {
      expect(screen.getByLabelText(label)).toHaveAttribute('readonly')
    }
    expect(screen.getByLabelText(/^Email address/)).toHaveValue(SARRA.email)
    expect(screen.getByLabelText(/^Status/)).toHaveValue('Active')
    expect(screen.getByText('Not editable from this page.')).toBeInTheDocument()
    // What the backend cannot do is not offered at all.
    expect(screen.queryByText(/Upload photo|Reset password|Set new password/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Deactivate|Activate/ })).toBeNull()
  })

  it('keeps Save disabled until something changes', async () => {
    await openEdit()

    expect(save()).toBeDisabled()
    await userEvent.type(lastName(), ' ')
    // Whitespace is trimmed by the backend, so it is not a change either.
    expect(save()).toBeDisabled()
    await rename()
    expect(save()).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })
})

describe('admin member edit - saving', () => {
  it('sends exactly the names that changed, trimmed, and nothing else', async () => {
    const { harness } = await openEdit()

    await rename('  Sarra Nour  ')
    await userEvent.click(save())

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
    expect(JSON.parse(patches(harness)[0]!.body ?? '{}')).toEqual({ first_name: 'Sarra Nour' })
    // The status write is a separate endpoint and is never touched.
    expect(harness.http.callsTo(`${MEMBERS}/${SARRA.id}/status`)).toHaveLength(0)
  })

  it('returns to the member list with a toast and the row highlighted, opened from there', async () => {
    const { harness, router } = await open(`${MEMBERS}?status=active`)
    const table = await screen.findByRole('table')
    await userEvent.click(within(table).getByRole('link', { name: 'Edit profile for Sarra Mansour' }))
    await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })

    await rename()
    await userEvent.click(save())

    await waitFor(() => expect(router.state.location.pathname).toBe(MEMBERS))
    expect(router.state.location.search).toBe('?status=active')
    // The router's location changes before React commits the list, so the edit
    // page - and its "Saving your changes…" status region - can still be on
    // screen. Wait for it to go and for the list's toast to say it was saved;
    // `getByRole` also proves the edit page's region is no longer there.
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Edit member profile', level: 1 })).toBeNull()
      expect(screen.getByRole('status')).toHaveTextContent('Profile updated')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Sarra Nour Mansour’s profile has been saved.')
    const row = (await screen.findByRole('link', { name: 'Sarra Nour Mansour' })).closest('tr')!
    expect(row.className).toMatch(/highlighted/)
    expect(patches(harness)).toHaveLength(1)
  })

  it('returns to the member’s page with the new name, opened from there', async () => {
    const { router } = await open(`${MEMBERS}/${SARRA.id}`)
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })
    await userEvent.click(screen.getByRole('link', { name: 'Edit profile' }))
    await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })

    await rename()
    await userEvent.click(save())

    await waitFor(() => expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}`))
    expect(await screen.findByRole('heading', { name: 'Sarra Nour Mansour', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Sarra Nour Mansour’s profile has been saved.')
  })

  it('sends one request however often Save is pressed, and says it is saving', async () => {
    const { harness } = await openEdit({ status: 200, json: SARRA })
    let release: (() => void) | undefined
    harness.http.on(`${MEMBERS}/${SARRA.id}`, async (call) => {
      if (call.method !== 'PATCH') return { json: SARRA }
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { json: { ...SARRA, first_name: 'Sarra Nour' } }
    })

    await rename()
    await userEvent.click(save())

    expect(await screen.findByText('Saving your changes…')).toBeInTheDocument()
    expect(save()).toBeDisabled()
    await userEvent.click(save())
    await userEvent.type(lastName(), '{Enter}')
    expect(patches(harness)).toHaveLength(1)
    release?.()
  })
})

describe('admin member edit - validation and errors', () => {
  it('checks the names first, focusing the first field to fix', async () => {
    const { harness } = await openEdit()

    await userEvent.clear(firstName())
    await userEvent.clear(lastName())
    await userEvent.click(save())

    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes can’t be saved yet')
    await waitFor(() => expect(firstName()).toHaveFocus())
    expect(firstName()).toHaveAccessibleDescription('Enter the member’s first name')
    expect(lastName()).toHaveAccessibleDescription('Enter the member’s last name')
    expect(patches(harness)).toHaveLength(0)
  })

  it('maps a 422 onto the field the server named, keeping what was typed', async () => {
    await openEdit({
      status: 422,
      json: { detail: [{ loc: ['body', 'first_name'], msg: 'String too long', type: 'string_too_long' }] },
    })

    await rename('Sarra Nour')
    await userEvent.click(save())

    await waitFor(() => expect(firstName()).toHaveAttribute('aria-invalid', 'true'))
    expect(firstName()).toHaveAccessibleDescription('Enter a name of 1 to 100 characters')
    expect(firstName()).toHaveValue('Sarra Nour')
    expect(screen.queryByText('String too long')).toBeNull()
  })

  it.each([
    [404, 'This member doesn’t exist any more'],
    [403, 'You can’t edit this profile'],
    [409, 'We couldn’t save your changes'],
    [500, 'We couldn’t save your changes'],
  ])('explains a %i from the save and keeps the entered values', async (status, title) => {
    const { router } = await openEdit({ status, json: { detail: 'Internal detail' } })

    await rename('Sarra Nour')
    await userEvent.click(save())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).not.toHaveTextContent('Internal detail')
    expect(firstName()).toHaveValue('Sarra Nour')
    expect(save()).toBeEnabled()
    expect(router.state.location.pathname).toBe(EDIT)
  })

  it('explains a dropped connection and keeps the entered values', async () => {
    const { harness } = await openEdit()
    harness.http.failNetwork(`${MEMBERS}/${SARRA.id}`)

    await rename('Sarra Nour')
    await userEvent.click(save())

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t save your changes')
    expect(firstName()).toHaveValue('Sarra Nour')
  })

  it('shows the designed page for a member that does not exist', async () => {
    await renderRoute({
      path: `${MEMBERS}/99999999-9999-4999-8999-999999999999/edit`,
      as: 'admin',
      beforeMount: (harness) => {
        stubServer(harness)
        harness.http.on(`${MEMBERS}/99999999-9999-4999-8999-999999999999`, {
          status: 404,
          json: { detail: 'Member not found' },
        })
      },
    })

    expect(await screen.findByRole('heading', { name: 'This member doesn’t exist any more' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to members' })).toHaveAttribute('href', MEMBERS)
    expect(screen.queryByLabelText(/^First name/)).toBeNull()
  })
})

describe('admin member edit - leaving', () => {
  it('Cancel with nothing changed goes back to the member’s page', async () => {
    const { router } = await openEdit()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}`))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('asks before discarding changes, and can keep editing', async () => {
    const { router, harness } = await openEdit()

    await rename()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    const dialog = await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe(EDIT)
    expect(firstName()).toHaveValue('Sarra Nour')

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard changes' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}`))
    expect(patches(harness)).toHaveLength(0)
  })

  it('Cancel returns to the list with its filters when opened from there', async () => {
    const { router } = await open(`${MEMBERS}?search=sarra`)
    const table = await screen.findByRole('table')
    await userEvent.click(within(table).getByRole('link', { name: 'Edit profile for Sarra Mansour' }))
    await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(MEMBERS))
    expect(router.state.location.search).toBe('?search=sarra')
  })
})

describe('admin member edit - status is untouched', () => {
  it('leaves the status workflow on the member’s page as it was', async () => {
    const { harness } = await open(`${MEMBERS}/${SARRA.id}`)
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
    expect(harness.http.callsTo(`${MEMBERS}/${SARRA.id}/status`)).toHaveLength(0)
  })
})

describe('admin member edit - responsive', () => {
  it.each([
    ['390', viewports.mobile],
    ['768', viewports.tablet],
    ['1440', viewports.wide],
  ])('is usable at %s px', async (_width, width) => {
    const { harness } = await openEdit(undefined, width)

    await rename()
    await userEvent.click(save())

    await waitFor(() => expect(patches(harness)).toHaveLength(1))
  })
})
