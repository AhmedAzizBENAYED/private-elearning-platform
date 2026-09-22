import { useEffect, useState } from 'react'

/**
 * Which landing section is being read (DS 09: "Header anchors scroll to
 * sections and mark the current one").
 *
 * One `IntersectionObserver` watches a band across the viewport - from under
 * the sticky header down to 40% of the height - and the current section is the
 * first one, in page order, that crosses it. The browser reports crossings;
 * there is no scroll listener, and React re-renders only when the answer
 * actually changes.
 *
 * Before any section has reached the band - the hero - the first section is
 * current, as the boards draw the header at the top of the page ("Desktop ·
 * visitor": Platform marked). Without `IntersectionObserver` that stays the
 * answer, and the links work the same either way.
 */
export function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0])
  const key = ids.join(' ')

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const order = key.split(' ')
    const elements = order
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    if (elements.length === 0) return

    const crossing = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) crossing.add(entry.target.id)
          else crossing.delete(entry.target.id)
        }
        const current = order.find((id) => crossing.has(id))
        // Between two sections nothing crosses the band: keep the last one.
        if (current !== undefined) setActive(current)
      },
      // 84px: the header's height, the same offset the anchors scroll to.
      { rootMargin: '-84px 0px -60% 0px' },
    )
    for (const element of elements) observer.observe(element)
    return () => observer.disconnect()
  }, [key])

  return active
}
