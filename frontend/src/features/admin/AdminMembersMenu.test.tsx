import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { AuthHarness } from '../../test/authHarness'
import { adminMembers, membersPage } from '../../test/courseFixtures'
import { renderRoute } from '../../test/renderRoute'
import { viewports } from '../../test/viewport'

/**
 * FE-ADMIN-MEMBERS-MENU-01 - a row's "More actions" menu (Admin-Members-Menu)
 * and the member view's cards (Admin-Member-View).
 *
 * The menu offers what the application supports: View profile, Edit profile
 * and Deactivate / Activate account - the last one opening the member's page
 * with MEMBERS-02's own confirmation already asking. Reset password is drawn
 * on the board but has no endpoint, so it is not offered anywhere.
 */

const SARRA = adminMembers[0]! // active
const YASSINE = adminMembers[2]! // inactive
const MEMBERS = '/admin/members'

function stubServer(harness: AuthHarness) {
  const rows = adminMembers.map((member) => ({ ...member }))
  harness.http.on(MEMBERS, () => ({ json: membersPage(rows) }))
  for (const row of rows) {
    harness.http.on(`${MEMBERS}/${row.id}`, () => ({ json: row }))
    harness.http.on(`${MEMBERS}/${row.id}/status`, (call) => {
      row.is_active = (JSON.parse(call.body ?? '{}') as { is_active: boolean }).is_active
      return { json: row }
    })
  }
}

const open = (path: string, width?: number) =>
  renderRoute({ path, as: 'admin', beforeMount: stubServer, ...(width ? { width } : {}) })

async function openList(path = MEMBERS, width?: number) {
  const result = await open(path, width)
  await screen.findByRole('table')
  return result
}

const trigger = (name: string) => screen.getByRole('button', { name: `More actions for ${name}` })

async function openMenu(name = 'Sarra Mansour') {
  await userEvent.click(trigger(name))
  return screen.getByRole('menu', { name: `Actions for ${name}` })
}

describe('member row menu - opening it', () => {
  it('opens from the row’s own trigger, named after the member', async () => {
    await openList()

    const button = trigger('Sarra Mansour')
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    const menu = await openMenu()
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', menu.id)
    // One trigger per row, each named after its own member.
    expect(trigger('Mehdi Trabelsi')).toBeInTheDocument()
  })

  it('offers exactly the supported actions - never Reset password', async () => {
    await openList()
    const menu = await openMenu()

    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'View profile',
      'Edit profile',
      'Deactivate account',
    ])
    expect(screen.queryByText(/Reset password/)).toBeNull()
  })

  it('says Activate account for an inactive member', async () => {
    await openList()
    const menu = await openMenu('Yassine Ben Ammar')

    expect(within(menu).getByRole('menuitem', { name: 'Activate account' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Deactivate account' })).toBeNull()
  })
})

describe('member row menu - destinations', () => {
  it('View profile opens the member’s page', async () => {
    const { router } = await openList()
    const menu = await openMenu()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'View profile' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}`))
    expect(await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Edit profile opens the edit page, which returns to the filtered list', async () => {
    const { router } = await openList(`${MEMBERS}?status=active`)
    const menu = await openMenu()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit profile' }))
    await screen.findByRole('heading', { name: 'Edit member profile', level: 1 })
    expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}/edit`)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(MEMBERS))
    expect(router.state.location.search).toBe('?status=active')
  })

  it('Deactivate account opens the member’s page with its own confirmation asking', async () => {
    const { router, harness } = await openList()
    const menu = await openMenu()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Deactivate account' }))

    const dialog = await screen.findByRole('dialog', { name: 'Deactivate this account?' })
    expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}`)
    // Nothing is written until the administrator confirms.
    expect(harness.http.callsTo(`${MEMBERS}/${SARRA.id}/status`)).toHaveLength(0)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(harness.http.callsTo(`${MEMBERS}/${SARRA.id}/status`)).toHaveLength(1))
    expect(JSON.parse(harness.http.callsTo(`${MEMBERS}/${SARRA.id}/status`)[0]!.body ?? '{}')).toEqual({
      is_active: false,
    })
    expect(await screen.findByRole('status')).toHaveTextContent('Member deactivated')
    expect(screen.getByRole('button', { name: 'Activate account' })).toBeInTheDocument()
  })

  it('Activate account, cancelled, writes nothing and leaves the confirmation closed afterwards', async () => {
    const { harness } = await openList()
    const menu = await openMenu('Yassine Ben Ammar')

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Activate account' }))
    const dialog = await screen.findByRole('dialog', { name: 'Activate this account?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(harness.http.callsTo(`${MEMBERS}/${YASSINE.id}/status`)).toHaveLength(0)
  })
})

describe('member row menu - keyboard and dismissal', () => {
  it('moves through the items with the arrow keys, Home and End', async () => {
    await openList()
    const menu = await openMenu()
    const [view, edit, status] = within(menu).getAllByRole('menuitem')

    await waitFor(() => expect(view).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(edit).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(status).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(view).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(status).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(view).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(status).toHaveFocus()
  })

  it('opens from the keyboard and closes with Escape, back on its trigger', async () => {
    await openList()

    trigger('Sarra Mansour').focus()
    await userEvent.keyboard('{Enter}')
    const menu = screen.getByRole('menu')
    await waitFor(() => expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus())

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger('Sarra Mansour')).toHaveFocus()
    expect(trigger('Sarra Mansour')).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on a click outside it', async () => {
    await openList()
    await openMenu()

    await userEvent.click(screen.getByRole('heading', { name: 'Members', level: 1 }))

    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes when its trigger is pressed again, and one menu shows at a time', async () => {
    await openList()
    await openMenu()

    await userEvent.click(trigger('Mehdi Trabelsi'))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menu', { name: 'Actions for Mehdi Trabelsi' })).toBeInTheDocument()

    await userEvent.click(trigger('Mehdi Trabelsi'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('member view - cards (Admin-Member-View)', () => {
  it('shows the subtitle, the identity card and the three cards the board draws', async () => {
    await open(`${MEMBERS}/${SARRA.id}`)
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    expect(screen.getByText('Member profile. Read-only view for administrators.')).toBeInTheDocument()

    const identity = screen.getByRole('region', { name: 'Sarra Mansour' })
    expect(within(identity).getByText(SARRA.email)).toBeInTheDocument()
    expect(within(identity).getByText('MEMBER')).toBeInTheDocument()
    expect(within(identity).getByText('Account created 12 Sep 2026')).toBeInTheDocument()

    const personal = screen.getByRole('region', { name: 'Personal information' })
    expect(within(personal).getByText('First name').nextElementSibling).toHaveTextContent('Sarra')
    expect(within(personal).getByText('Last name').nextElementSibling).toHaveTextContent('Mansour')

    const account = screen.getByRole('region', { name: 'Account information' })
    expect(within(account).getByText('Read-only. Controlled by the platform.')).toBeInTheDocument()
    expect(within(account).getByText('Email address').nextElementSibling).toHaveTextContent(SARRA.email)
    expect(within(account).getByText('Status').nextElementSibling).toHaveTextContent('Active')
    // Read only: nothing in it can be edited.
    expect(within(account).queryByRole('textbox')).toBeNull()
    expect(within(account).queryByRole('button')).toBeNull()

    const security = screen.getByRole('region', { name: 'Account & security' })
    expect(within(security).getByText('Administrator actions on this account.')).toBeInTheDocument()
    expect(within(security).getByRole('button', { name: 'Deactivate account' })).toBeInTheDocument()
    expect(screen.queryByText(/Reset password|Last updated/)).toBeNull()
  })

  it('keeps Edit profile in the header, apart from the read-only information', async () => {
    await open(`${MEMBERS}/${SARRA.id}`)
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })

    const edit = screen.getByRole('link', { name: 'Edit profile' })
    expect(edit).toHaveAttribute('href', `${MEMBERS}/${SARRA.id}/edit`)
    for (const card of ['Personal information', 'Account information']) {
      expect(screen.getByRole('region', { name: card })).not.toContainElement(edit)
    }
  })

  it('the status flow on the page itself is unchanged', async () => {
    const { harness } = await open(`${MEMBERS}/${SARRA.id}`)
    await screen.findByRole('heading', { name: 'Sarra Mansour', level: 1 })
    // Arriving directly asks nothing.
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate account' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => expect(harness.http.callsTo(`${MEMBERS}/${SARRA.id}/status`)).toHaveLength(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Member deactivated')
  })
})

describe('member row menu - responsive', () => {
  it.each([
    ['390', viewports.mobile],
    ['768', viewports.tablet],
    ['1440', viewports.wide],
  ])('opens and leads to the member at %s px', async (_width, width) => {
    const { router } = await openList(MEMBERS, width)
    const menu = await openMenu()

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'View profile' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`${MEMBERS}/${SARRA.id}`))
  })
})
