import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { FileDropzone } from './FileDropzone'
import { formatFileSize } from './formatFileSize'

const file = () => new File(['video-bytes'], 'structuring-a-message.mp4', { type: 'video/mp4' })

describe('formatFileSize', () => {
  it('formats bytes the way the boards write them', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2.4 * 1024 * 1024)).toBe('2.4 MB')
    expect(formatFileSize(192_937_984)).toBe('184 MB')
  })

  it('returns an empty string rather than NaN for invalid input', () => {
    expect(formatFileSize(Number.NaN)).toBe('')
    expect(formatFileSize(-1)).toBe('')
  })
})

describe('FileDropzone', () => {
  it('renders a real file input, not a button pretending to be one', () => {
    const { container } = render(<FileDropzone label="Video file" kind="video" />)

    const input = container.querySelector('input[type="file"]')
    expect(input).toBeInTheDocument()
    // Visually hidden, but still focusable, so it is reachable without a mouse.
    expect(input).not.toHaveAttribute('hidden')
    expect(input).toHaveAccessibleName('Video file')
  })

  it('reports the selected files', async () => {
    const onFileSelected = vi.fn()
    render(<FileDropzone label="Video file" kind="video" onFileSelected={onFileSelected} />)

    await userEvent.upload(screen.getByLabelText('Video file'), file())

    expect(onFileSelected).toHaveBeenCalledTimes(1)
    expect(onFileSelected.mock.calls[0]?.[0]?.[0]?.name).toBe('structuring-a-message.mp4')
  })

  it('forwards accept and multiple to the input', () => {
    render(
      <FileDropzone label="Video file" kind="video" acceptedTypes="video/mp4" multiple />,
    )

    const input = screen.getByLabelText('Video file')
    expect(input).toHaveAttribute('accept', 'video/mp4')
    expect(input).toHaveAttribute('multiple')
  })

  it('does not accept a file while disabled', async () => {
    const onFileSelected = vi.fn()
    render(
      <FileDropzone label="Video file" kind="video" disabled onFileSelected={onFileSelected} />,
    )

    const input = screen.getByLabelText('Video file')
    expect(input).toBeDisabled()
    await userEvent.upload(input, file())
    expect(onFileSelected).not.toHaveBeenCalled()
  })

  it('shows a labelled progress bar and a cancel action while uploading', async () => {
    const onCancel = vi.fn()
    render(
      <FileDropzone
        label="Video file"
        kind="video"
        status="uploading"
        fileName="structuring-a-message.mp4"
        fileSize={192_937_984}
        progress={64}
        onCancel={onCancel}
      />,
    )

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '64')
    expect(bar).toHaveAccessibleName('Uploading structuring-a-message.mp4')
    expect(screen.getByText('64%')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('offers replace and remove once uploaded', async () => {
    const onRemove = vi.fn()
    render(
      <FileDropzone
        label="Video file"
        kind="video"
        status="uploaded"
        fileName="structuring-a-message.mp4"
        fileSize={192_937_984}
        onRemove={onRemove}
      />,
    )

    expect(screen.getByText(/Uploaded/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove structuring-a-message.mp4' }),
    )
    expect(onRemove).toHaveBeenCalledTimes(1)
  })

  it('announces the failure and offers a retry', async () => {
    const onRetry = vi.fn()
    render(
      <FileDropzone
        label="Video file"
        kind="video"
        status="error"
        fileName="structuring-a-message.mp4"
        error="Upload failed. Check your connection and try again."
        onRetry={onRetry}
      />,
    )

    // role="alert" so the failure is spoken without the user hunting for it.
    expect(screen.getByRole('alert')).toHaveTextContent('Upload failed.')

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('names the document variant without mentioning a storage provider', () => {
    const { container } = render(<FileDropzone label="Document file" kind="document" />)

    expect(screen.getByText('Drag and drop a document here')).toBeInTheDocument()
    expect(container.textContent?.toLowerCase()).not.toContain('drive')
    expect(container.textContent?.toLowerCase()).not.toContain('google')
  })
})
