import { type CSSProperties, Fragment } from 'react'

import { LinkButton } from '../../app/LinkButton'
import poster from '../../assets/poster.jpg'
import thumb from '../../assets/thumb-1.jpg'
import { buttonClassName, Icon, Progress } from '../../design-system'
import { useAuth } from '../auth'

import styles from './Landing.module.css'
import motion from './motion.module.css'
import { primaryAction } from './sections'

/** The heading, word by word: each rises on its own (Landing boards). */
const TITLE_WORDS = ['Learn', 'together,', 'at', 'your', 'own', 'pace.'] as const

/**
 * The pointer-parallax grid over the hero: 5 columns by 3 rows of zones. The
 * zone under the pointer sets how far the shapes lean (`--mx`, `--my`), in CSS
 * alone - no pointer listener.
 */
const ZONES = [0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((column) => ({ row, column })))

/** How far each shape moves per step of the pointer, as the boards set it. */
const depth = (value: number) => ({ '--d': value }) as CSSProperties

/**
 * The illustration beside the hero text (DS 09 "Hero preview card").
 *
 * "An illustration of the real course card: it is hidden from assistive
 * technology and cannot be focused." Its figures are the board's own sample,
 * not anyone's data.
 */
function PreviewCard() {
  return (
    <div className={[styles.previewWrap, styles.float].join(' ')} aria-hidden="true">
      <div className={styles.previewCard}>
        <p className={styles.overline}>Continue learning</p>
        <div className={styles.previewThumb}>
          <img src={thumb} alt="" />
        </div>
        <div className={styles.previewTitleBlock}>
          <p className={styles.previewTitle}>Python Fundamentals</p>
          <p className={styles.previewMeta}>Module 2 · Parameters and return values</p>
        </div>
        <div className={styles.previewProgressHead}>
          <span>Your progress</span>
          <span>45%</span>
        </div>
        <Progress value={45} label="Progress 45%" />
        <div className={styles.previewContinue}>
          <Icon name="play-filled" size={18} />
          Continue
        </div>
      </div>
      <div className={styles.previewPill}>
        <span className={styles.previewPillBadge}>
          <span className={styles.previewPillRing} />
          <span className={styles.previewPillCheck}>
            <Icon name="check" size={16} strokeWidth={3} />
          </span>
        </span>
        <span className={styles.previewPillText}>
          <span className={styles.previewPillTitle}>Getting started</span>
          <span className={styles.previewMeta}>4 of 4 videos completed</span>
        </span>
      </div>
    </div>
  )
}

/**
 * The hero (Landing boards): the poster photo under the charte's translucent
 * navy panel, the overline, the one heading of the page, the lede, the
 * actions and the privacy note; the preview card beside it on a wide screen
 * and under it on a tablet, and no card on a phone, as drawn.
 *
 * Motion (LANDING-03, all in `Landing.module.css`, none of it under
 * `prefers-reduced-motion: reduce`): the photo zooms and wipes in, the panel
 * slides in, the words rise one by one and "together," is underlined, the
 * texts follow; the card slides in and floats, the shapes drift, and on a
 * wide screen with a pointer they lean towards it.
 *
 * "See how it works" scrolls to the How it works section (`#how`).
 */
export function LandingHero() {
  const { user, isAuthenticated } = useAuth()
  const action = primaryAction(isAuthenticated ? user : null)

  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <img className={styles.heroPhoto} src={poster} alt="" />

      {ZONES.map(({ row, column }) => (
        <div
          key={`${row}-${column}`}
          className={[styles.zone, styles[`zx${column}`], styles[`zy${row}`]].join(' ')}
          style={{ left: `${column * 20}%`, top: `${row * 33.3}%` }}
          aria-hidden="true"
        />
      ))}

      <div className={styles.heroPanel}>
        <div className={styles.heroDecor} aria-hidden="true">
          <div className={styles.blobOne} />
          <div className={styles.blobTwo} />
          <div className={styles.grid} />
        </div>

        <div className={styles.heroContent}>
          <p className={styles.heroOverline}>JEENISo · Learning platform</p>
          <h1 id="landing-title" className={styles.heroTitle}>
            {TITLE_WORDS.map((word, index) => (
              <Fragment key={word}>
                <span className={styles.wordMask}>
                  <span className={styles.word} style={{ '--i': index } as CSSProperties}>
                    {index === 1 ? <span className={styles.underline}>{word}</span> : word}
                  </span>
                </span>
                {index < TITLE_WORDS.length - 1 ? ' ' : null}
              </Fragment>
            ))}
          </h1>
          <p className={styles.heroLede}>
            Video lessons, documents and resources chosen by the association, in one private
            place. Pick up where you left off and see your progress grow, course after course.
          </p>
          <div className={styles.heroActions}>
            <LinkButton
              to={action.to}
              variant="on-dark"
              size="lg"
              iconLeft={isAuthenticated ? undefined : 'login'}
              iconRight={isAuthenticated ? 'arrow-right' : undefined}
              className={[styles.heroAction, styles.lift, styles.glow].join(' ')}
            >
              {action.label}
            </LinkButton>
            {/* An in-page anchor, not a route: a plain link the browser scrolls. */}
            <a
              href="#how"
              className={buttonClassName({
                variant: 'ghost-dark',
                size: 'lg',
                className: [styles.heroAction, styles.lift].join(' '),
              })}
            >
              <span>See how it works</span>
              <Icon name="arrow-down" size={20} />
            </a>
          </div>
          <p className={styles.heroNote}>
            <Icon name="lock" size={16} />
            Private platform. Accounts are created by an administrator.
          </p>

          <div className={[styles.heroCardBelow, styles.cardIn].join(' ')}>
            <PreviewCard />
          </div>
        </div>
      </div>

      {/* Wide screens: the card and the still shapes around it, on the photo.
          Each sits in a layer that leans with the pointer, by its own depth. */}
      <div className={styles.heroAside} aria-hidden="true">
        <div className={styles.spot} />
        <div className={[styles.layer, styles.orbitLayer].join(' ')} style={depth(-12)}>
          <div className={styles.orbit} />
        </div>
        <div className={[styles.layer, styles.squareLayer].join(' ')} style={depth(16)}>
          <div className={[styles.square, motion.parallax].join(' ')} />
        </div>
        <div className={[styles.layer, styles.outlineLayer].join(' ')} style={depth(-20)}>
          <div className={[styles.outline, styles.float2].join(' ')} />
        </div>
        <div className={[styles.layer, styles.heroCardAside].join(' ')} style={depth(14)}>
          <div className={styles.cardIn}>
            <PreviewCard />
          </div>
        </div>
        <div className={[styles.layer, styles.lessonTypesLayer].join(' ')} style={depth(20)}>
          <div className={styles.popIn}>
            <div className={[styles.lessonTypes, styles.float2].join(' ')}>
              <p className={styles.overline}>Every lesson type</p>
              <div className={styles.lessonTypeRow}>
                {(['video', 'text', 'doc', 'link'] as const).map((name) => (
                  <span key={name} className={styles.lessonTypeTile}>
                    <Icon name={name} size={20} />
                  </span>
                ))}
              </div>
              <p className={styles.lessonTypeCaption}>Video · Text · Document · Link</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
