import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from '../design-system'
import { adminCourses, catalogEnrolled, page } from '../test/courseFixtures'
import { renderRoute } from '../test/renderRoute'

/**
 * FE-14 - the defects the hardening audit found, each pinned by the behaviour
 * that was wrong before it was fixed.
 *
 * These are regression tests, not descriptions of the implementation: every one
 * of them fails against the code as it stood at the start of this ticket.
 */

// ------------------------------------------------- P1: one h1 per page

describe('heading hierarchy', () => {
  it('gives the empty catalogue one h1, the page title, not two', async () => {
    await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (harness) => harness.http.on('/courses', { json: page([]) }),
    })
    await screen.findByRole('heading', { name: 'No courses yet' })

    // The page's own title is the only h1; the empty state sits beneath it.
    const first = screen.getAllByRole('heading', { level: 1 })
    expect(first).toHaveLength(1)
    expect(first[0]).toHaveTextContent('Courses')
    expect(
      screen.getByRole('heading', { name: 'No courses yet', level: 2 }),
    ).toBeInTheDocument()
  })

  it('gives the empty dashboard one h1', async () => {
    await renderRoute({ path: '/dashboard', as: 'member' })
    await screen.findByRole('heading', { name: 'You haven’t started a course yet' })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole('heading', { name: 'You haven’t started a course yet', level: 2 }),
    ).toBeInTheDocument()
  })

  it('gives a failed catalogue load one h1', async () => {
    await renderRoute({
      path: '/courses',
      as: 'member',
      beforeMount: (harness) =>
        harness.http.on('/courses', { status: 500, json: { detail: 'Internal server error' } }),
    })
    await screen.findByRole('heading', { name: /couldn’t load the courses/i })

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('gives the empty admin course list one h1', async () => {
    await renderRoute({
      path: '/admin/courses',
      as: 'admin',
      beforeMount: (harness) => harness.http.on('/admin/courses', { json: page([]) }),
    })
    await screen.findByRole('heading', { name: 'No courses yet' })

    const first = screen.getAllByRole('heading', { level: 1 })
    expect(first).toHaveLength(1)
    expect(first[0]).toHaveTextContent('Courses')
  })

  it('keeps h1 where the message really is the whole page', async () => {
    await renderRoute({ path: '/nope-not-a-route', as: 'member' })

    // A 404 has no page title of its own, so the card's title is the h1.
    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
  })
})

// --------------------------------------- P1: member navigation stayed in the SPA

describe('member navigation uses the router', () => {
  it('returns to the catalogue without a document navigation', async () => {
    const { router } = await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${catalogEnrolled.id}`, {
          status: 404,
          json: { detail: 'Course not found' },
        })
      },
    })
    const card = (
      await screen.findByRole('heading', { name: 'This course isn’t available' })
    ).closest('div')!.parentElement!

    await userEvent.click(within(card).getByRole('link', { name: 'Browse courses' }))

    // A bare <a> would leave the memory router exactly where it was: jsdom
    // performs no navigation. Only a router Link moves the location.
    await waitFor(() => expect(router.state.location.pathname).toBe('/courses'))
  })

  it('offers its action as a link, not a button that looks like one', async () => {
    await renderRoute({
      path: `/courses/${catalogEnrolled.id}`,
      as: 'member',
      beforeMount: (harness) => {
        harness.http.on(`/courses/${catalogEnrolled.id}`, {
          status: 404,
          json: { detail: 'Course not found' },
        })
      },
    })
    const card = (
      await screen.findByRole('heading', { name: 'This course isn’t available' })
    ).closest('div')!.parentElement!

    const action = within(card).getByRole('link', { name: 'Browse courses' })
    expect(action).toHaveAttribute('href', '/courses')
  })
})

// ----------------------------------------- P1: focus stays inside a busy dialog

describe('confirmation dialog focus', () => {
  function Harness({ busy }: { busy: boolean }) {
    return (
      <>
        <button type="button">Delete course</button>
        <ConfirmDialog
          open
          busy={busy}
          title="Delete “Course”?"
          body="This cannot be undone."
          confirmLabel="Delete course"
          tone="danger"
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />
      </>
    )
  }

  it('does not throw focus back to the page behind when the action starts', async () => {
    const { rerender } = render(<Harness busy={false} />)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    // The confirming action begins: `busy` flips.
    rerender(<Harness busy />)

    // Focus must still be inside the dialog - never on the trigger behind it,
    // which is what re-running the focus effect used to cause.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(screen.getByRole('button', { name: 'Delete course', hidden: true })).not.toHaveFocus()
  })

  it('returns focus to the opener once it closes, not to a detached node', async () => {
    const onCancel = vi.fn()

    function Wrapper() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <ConfirmDialog
            open={open}
            title="Sure?"
            body="Body"
            confirmLabel="Yes"
            onConfirm={() => setOpen(false)}
            onCancel={() => {
              onCancel()
              setOpen(false)
            }}
          />
        </>
      )
    }

    render(<Wrapper />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await userEvent.click(opener)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(opener).toHaveFocus())
  })
})

// ------------------------------------------------------- P1: skip link

describe('bypassing the navigation', () => {
  it('puts a skip link first in the member tab order and lands on the content', async () => {
    await renderRoute({ path: '/dashboard', as: 'member' })

    await userEvent.tab()
    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveFocus()
    expect(skip).toHaveAttribute('href', '#main')

    // The target is a real landmark and can receive focus.
    const main = document.getElementById('main')
    expect(main?.tagName).toBe('MAIN')
    expect(main).toHaveAttribute('tabindex', '-1')
  })

  it('puts one in the admin shell too', async () => {
    await renderRoute({ path: '/admin', as: 'admin' })

    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    expect(document.getElementById('main')?.tagName).toBe('MAIN')
  })
})

// --------------------------------- P1: a failed validation is not silent

describe('form validation reaches the keyboard', () => {
  it('moves focus to the first invalid field when a course form is rejected', async () => {
    await renderRoute({ path: '/admin/courses/new', as: 'admin' })
    await screen.findByRole('heading', { name: 'Create course', level: 1 })

    // Submitted empty: every required field is invalid.
    await userEvent.click(screen.getByRole('button', { name: 'Create course' }))

    const title = screen.getByLabelText(/^Title/)
    await waitFor(() => expect(title).toHaveFocus())
    // Focusing it announces the reason, because the field owns its message.
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAttribute('aria-describedby')
  })

  it('moves focus to the first invalid field when a module form is rejected', async () => {
    const DRAFT = adminCourses[0]!
    await renderRoute({
      path: `/admin/courses/${DRAFT.id}`,
      as: 'admin',
      beforeMount: (harness) => {
        harness.http.on(`/admin/courses/${DRAFT.id}`, { json: DRAFT })
        harness.http.on(`/admin/courses/${DRAFT.id}/modules`, { json: page([]) })
        harness.http.on(`/admin/courses/${DRAFT.id}/resources`, { json: [] })
      },
    })
    // The module form is the "Add a module" dialog (Admin-Editor-States).
    await userEvent.click(await screen.findByRole('button', { name: 'Add module' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add a module' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add module' }))

    const title = within(dialog).getByLabelText(/^Module title/)
    await waitFor(() => expect(title).toHaveFocus())
    expect(title).toHaveAttribute('aria-invalid', 'true')
  })
})
