import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import type { MockResponse } from '../../test/fetchMock'
import { adminMembers, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * MEMBERS-02 - activate and deactivate a member.
 *
 * The action already lived on the member's page; these cover what the ticket
 * adds and what it asks to be proven: the toast, the reason shown *inside*
 * the confirmation when a write is refused, one request per confirmation,
 * and a list that shows the new state - and filters by it - once the
 * administrator goes back to it.
 */

const SARRA = adminMembers[0]!
const YASSINE = adminMembers[2]! // inactive in the fixtures
const MEMBERS = '/admin/members'

/**
 * A small server: the listing, the record and the status write share one
 * piece of state, so a change made on the member page is what the list shows
 * afterwards - filtered by `is_active` exactly as the backend filters.
 */
function stubServer(harness: AuthHarness, statusReply?: MockResponse) {
  const rows = adminMembers.map((member) => ({ ...member }))
  harness.http.on(MEMBERS, (call) => {
    const flag = new URL(call.url).searchParams.get('is_active')
    const items = flag === null ? rows : rows.filter((row) => String(row.is_active) === flag)
    return { json: membersPage(items) }
  })
  for (const row of rows) {
    harness.http.on(`${MEMBERS}/${row.id}`, () => ({ json: row }))
    harness.http.on(`${MEMBERS}/${row.id}/status`, (call) => {
      if (statusReply) return statusReply
      row.is_active = (JSON.parse(call.body ?? '{}') as { is_active: boolean }).is_active
      return { json: row }
    })
  }
}

async function openMember(member = SARRA, statusReply?: MockResponse, width?: number) {
  const result = await renderRoute({
    path: `${MEMBERS}/${member.id}`,
    as: 'admin',
    beforeMount: (harness) => stubServer(harness, statusReply),
    ...(width ? { width } : {}),
  })
  await screen.findByRole('heading', { name: `${member.first_name} ${member.last_name}`, level: 1 })
  return result
}

const statusCalls = (harness: AuthHarness, member = SARRA) =>
  harness.http.callsTo(`${MEMBERS}/${member.id}/status`)

async function confirm(action: 'Deactivate' | 'Activate') {
  await userEvent.click(screen.getByRole('button', { name: `${action} account` }))
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: action }))
  return dialog
}

describe('admin members - activate / deactivate', () => {
  it('labels the action by the state the account is in', async () => {
    await openMember(SARRA)
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Activate account' })).toBeNull()
  })

  it('offers Activate for an inactive account', async () => {
    await openMember(YASSINE)
    expect(screen.getByRole('button', { name: 'Activate account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate account' })).toBeNull()
  })

  it('confirms a deactivation as a destructive action, focus on Cancel', async () => {
    await openMember(SARRA)

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))

    const dialog = await screen.findByRole('dialog', { name: 'Deactivate this account?' })
    expect(dialog).toHaveTextContent('Sarra Mansour will no longer be able to sign in.')
    // The dialog opens on the safe choice, not on the consequential one.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Deactivate' }).className).toMatch(/danger/)
  })

  it('confirms an activation without the destructive styling', async () => {
    await openMember(YASSINE)

    await userEvent.click(screen.getByRole('button', { name: 'Activate account' }))

    const dialog = await screen.findByRole('dialog', { name: 'Activate this account?' })
    expect(within(dialog).getByRole('button', { name: 'Activate' }).className).not.toMatch(/danger/)
  })

  it('deactivates, announces it and shows the new state', async () => {
    const { harness } = await openMember(SARRA)

    await confirm('Deactivate')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const toast = await screen.findByRole('status')
    await waitFor(() => expect(toast).toHaveTextContent('Member deactivated'))
    expect(toast).toHaveTextContent('Sarra Mansour can no longer sign in.')
    expect(screen.getByRole('button', { name: 'Activate account' })).toBeInTheDocument()
    expect(JSON.parse(statusCalls(harness)[0]!.body ?? '{}')).toEqual({ is_active: false })
    // Focus returns to the action, now relabelled.
    expect(screen.getByRole('button', { name: 'Activate account' })).toHaveFocus()
  })

  it('reactivates, announces it and shows the new state', async () => {
    const { harness } = await openMember(YASSINE)

    await confirm('Activate')

    const toast = await screen.findByRole('status')
    await waitFor(() => expect(toast).toHaveTextContent('Member activated'))
    expect(toast).toHaveTextContent('Yassine Ben Ammar can sign in again.')
    expect(await screen.findByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
    expect(JSON.parse(statusCalls(harness, YASSINE)[0]!.body ?? '{}')).toEqual({ is_active: true })
  })

  it('sends the state only - never a role, a name, an email or a password', async () => {
    const { harness } = await openMember(SARRA)

    await confirm('Deactivate')

    await waitFor(() => expect(statusCalls(harness)).toHaveLength(1))
    const call = statusCalls(harness)[0]!
    expect(call.method).toBe('PATCH')
    expect(Object.keys(JSON.parse(call.body ?? '{}'))).toEqual(['is_active'])
  })

  it('sends one request per confirmation, however often it is pressed', async () => {
    let release = () => undefined as void
    const held = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const { harness } = await renderRoute({
      path: `${MEMBERS}/${SARRA.id}`,
      as: 'admin',
      beforeMount: (instance) => {
        stubServer(instance)
        instance.http.on(`${MEMBERS}/${SARRA.id}/status`, async () => {
          await held
          return { json: { ...SARRA, is_active: false } }
        })
      },
    })
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    const dialog = await screen.findByRole('dialog')
    const action = within(dialog).getByRole('button', { name: 'Deactivate' })
    await userEvent.click(action)

    // Busy: the confirm button is locked and Cancel with it.
    await waitFor(() => expect(action).toBeDisabled())
    expect(action).toHaveAttribute('aria-busy', 'true')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.click(action)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(statusCalls(harness)).toHaveLength(1)
  })

  it.each([
    [409, 'last active administrator'],
    [403, 'no longer active'],
    [404, 'no longer exists'],
    [500, 'could not be saved'],
  ])('shows a %i refusal inside the dialog, where it can be seen', async (status, reason) => {
    await openMember(SARRA, {
      status,
      json: { detail: 'Traceback (most recent call last): SELECT * FROM users' },
    })

    const dialog = await confirm('Deactivate')

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent(new RegExp(reason, 'i'))
    expect(document.body.textContent).not.toContain('Traceback')
    expect(document.body.textContent).not.toContain('SELECT')
    // Nothing was claimed: the state and the action are unchanged.
    expect(screen.getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
    expect(screen.queryByText('Member deactivated')).toBeNull()
    // Still usable: the retry is right there.
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeEnabled()
  })

  it('keeps the reason on the page once a refused dialog is cancelled', async () => {
    await openMember(SARRA, { status: 500, json: { detail: 'boom' } })

    const dialog = await confirm('Deactivate')
    await within(dialog).findByRole('alert')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be saved/i)
  })

  it('reports a dropped connection and stays usable', async () => {
    const { harness } = await openMember(SARRA)
    harness.http.failNetwork(`${MEMBERS}/${SARRA.id}/status`)

    const dialog = await confirm('Deactivate')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not be saved/i)
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeEnabled()
  })

  it('works from the keyboard alone', async () => {
    const { harness } = await openMember(SARRA)

    screen.getByRole('button', { name: 'Deactivate account' }).focus()
    await userEvent.keyboard('{Enter}')
    await screen.findByRole('dialog')
    // Focus starts on Cancel; Tab reaches the confirm button, Enter presses it.
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(statusCalls(harness)).toHaveLength(1))
    expect(await screen.findByRole('button', { name: 'Activate account' })).toBeInTheDocument()
  })

  it('shows the new badge in the list, and the status filter follows it', async () => {
    await openMember(SARRA)
    await confirm('Deactivate')
    await screen.findByRole('button', { name: 'Activate account' })

    // Back to the list: it is read again from the server.
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    await userEvent.click(within(breadcrumb).getByRole('link', { name: 'Members' }))
    const row = (await screen.findByRole('link', { name: 'Sarra Mansour' })).closest('tr')!
    expect(within(row).getByText('Inactive')).toBeInTheDocument()

    // "Inactive" now includes her; "Active" no longer does.
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'inactive')
    await waitFor(() => expect(screen.getByRole('link', { name: 'Sarra Mansour' })).toBeInTheDocument())
    expect(screen.getByText('2 members')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Sarra Mansour' })).toBeNull())
    expect(screen.getByText('1 member')).toBeInTheDocument()
  })

  it.each([viewports.mobile, viewports.tablet, viewports.desktop])(
    'is usable at %ipx',
    async (width) => {
      const { harness } = await openMember(SARRA, undefined, width)

      await confirm('Deactivate')

      await waitFor(() => expect(statusCalls(harness)).toHaveLength(1))
      expect(await screen.findByRole('button', { name: 'Activate account' })).toBeInTheDocument()
    },
  )
})
