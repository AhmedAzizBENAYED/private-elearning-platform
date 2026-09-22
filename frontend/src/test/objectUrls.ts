/**
 * `URL.createObjectURL` for jsdom, which implements neither it nor
 * `revokeObjectURL`.
 *
 * The stub is not only a stand-in: it records what was created and what was
 * revoked, which is how the document tests assert that a lesson's bytes are
 * released when the member navigates away. Without that ledger, "the resource
 * is cleaned up" would be untestable.
 */

export interface ObjectUrlLedger {
  created: string[]
  revoked: string[]
  /** Created but not yet revoked. */
  live: () => string[]
  /** The `Blob` a given URL was made from, for asserting on its media type. */
  blobFor: (url: string) => Blob | undefined
  reset: () => void
}

export const objectUrls: ObjectUrlLedger = {
  created: [],
  revoked: [],
  live: () => objectUrls.created.filter((url) => !objectUrls.revoked.includes(url)),
  blobFor: (url) => blobs.get(url),
  reset: () => {
    objectUrls.created.length = 0
    objectUrls.revoked.length = 0
    blobs.clear()
  },
}

const blobs = new Map<string, Blob>()

export function installObjectUrls(): void {
  let counter = 0

  URL.createObjectURL = (object: Blob | MediaSource): string => {
    counter += 1
    const url = `blob:http://localhost/object-${counter}`
    objectUrls.created.push(url)
    if (object instanceof Blob) blobs.set(url, object)
    return url
  }

  URL.revokeObjectURL = (url: string): void => {
    objectUrls.revoked.push(url)
  }
}
