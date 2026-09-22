import { useState } from 'react'

import {
  Avatar,
  Badge,
  Button,
  type ButtonVariant,
  FileDropzone,
  type FileDropzoneStatus,
  Icon,
  iconNames,
  Progress,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonGroup,
  TextField,
  Textarea,
  type LessonType,
} from '../design-system'

import styles from './Gallery.module.css'

const variants: ButtonVariant[] = [
  'primary',
  'secondary',
  'tertiary',
  'tonal',
  'danger',
  'danger-outline',
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function ButtonMatrix() {
  return (
    <div className={styles.card}>
      <div className={styles.matrixScroll}>
        <div className={styles.matrix}>
          <span />
          {['default', 'hover', 'pressed', 'focus', 'disabled', 'loading'].map((state) => (
            <span key={state} className={styles.caption} style={{ marginBottom: 0 }}>
              {state}
            </span>
          ))}

          {variants.map((variant) => (
            <ButtonRow key={variant} variant={variant} />
          ))}
        </div>
      </div>
      <p className={styles.lede}>
        Hover and pressed are real CSS states: point at, or hold down, the first cell of a row to
        see them. The focus column is reached with Tab.
      </p>
    </div>
  )
}

function ButtonRow({ variant }: { variant: ButtonVariant }) {
  return (
    <>
      <span className={styles.matrixLabel}>{variant}</span>
      <Button variant={variant}>Label</Button>
      <Button variant={variant}>Label</Button>
      <Button variant={variant}>Label</Button>
      <Button variant={variant}>Label</Button>
      <Button variant={variant} disabled>
        Label
      </Button>
      <Button variant={variant} loading loadingLabel="Saving…">
        Label
      </Button>
    </>
  )
}

function FormControls() {
  const [password, setPassword] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [description, setDescription] = useState('Write clear, professional messages.')

  return (
    <div className={styles.grid}>
      <TextField
        label="Email address"
        placeholder="name@example.org"
        hint="We only use it to sign you in."
        type="email"
      />
      <TextField label="Email address" defaultValue="iyed@example.org" type="email" />
      <TextField
        label="Email address"
        defaultValue="iyed@"
        type="email"
        error="Enter a valid email address"
      />
      <TextField label="Email address" defaultValue="iyed@example.org" disabled />
      <TextField label="Full name" placeholder="First and last name" required />
      <TextField
        label="Password"
        type={revealed ? 'text' : 'password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Your password"
        iconLeft="lock"
        rightSlot={
          <Button
            variant="tertiary"
            size="sm"
            iconOnly
            iconLeft={revealed ? 'eye-off' : 'eye'}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            onClick={() => setRevealed((shown) => !shown)}
          />
        }
      />
      <Select
        label="Status"
        options={[
          { value: 'all', label: 'All statuses' },
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ]}
        defaultValue="all"
      />
      <Select
        label="Status"
        options={[{ value: 'all', label: 'All statuses' }]}
        defaultValue="all"
        disabled
      />
      <Select
        label="Module"
        options={[{ value: '1', label: 'Writing for the workplace' }]}
        placeholder="Choose a module"
        defaultValue=""
        required
        error="Choose a module"
      />
      <Textarea
        label="Description"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        hint="Shown under the lesson title."
        maxLength={200}
        valueLength={description.length}
      />
      <Textarea label="Description" error="Add a short description" />
      <Textarea label="Description" defaultValue="Read only" disabled />
    </div>
  )
}

function SegmentedDemo() {
  const [type, setType] = useState<LessonType>('VIDEO')

  return (
    <div className={styles.stack}>
      <SegmentedControl<LessonType>
        label="Lesson type"
        value={type}
        onChange={setType}
        hint="Arrow keys move between options."
        options={[
          { value: 'VIDEO', label: 'Video', icon: 'video' },
          { value: 'DOCUMENT', label: 'Document', icon: 'doc' },
          { value: 'TEXT', label: 'Text', icon: 'text' },
          { value: 'LINK', label: 'Link', icon: 'link' },
        ]}
      />
      <SegmentedControl<LessonType>
        label="Lesson type (disabled)"
        value="TEXT"
        onChange={() => undefined}
        disabled
        options={[
          { value: 'VIDEO', label: 'Video', icon: 'video' },
          { value: 'TEXT', label: 'Text', icon: 'text' },
        ]}
      />
    </div>
  )
}

function DropzoneDemo() {
  const [picked, setPicked] = useState<string | null>(null)
  const statuses: FileDropzoneStatus[] = ['uploading', 'uploaded', 'error']

  return (
    <div className={styles.gridWide}>
      <div>
        <p className={styles.caption}>Idle — drag, or pick a file</p>
        <FileDropzone
          label="Video file"
          kind="video"
          acceptedTypes="video/mp4"
          hint="Formats and size limits come from the API."
          onFileSelected={(files) => setPicked(files[0]?.name ?? null)}
        />
        <p className={styles.lede}>{picked ? `Selected: ${picked}` : 'Nothing selected yet.'}</p>
      </div>

      {statuses.map((status) => (
        <div key={status}>
          <p className={styles.caption}>{status}</p>
          <FileDropzone
            label="Video file"
            kind="video"
            status={status}
            fileName="structuring-a-message.mp4"
            fileSize={192_937_984}
            progress={64}
          />
        </div>
      ))}

      <div>
        <p className={styles.caption}>Idle — disabled</p>
        <FileDropzone label="Document file" kind="document" disabled />
      </div>
    </div>
  )
}

function Badges() {
  return (
    <div className={styles.stack}>
      <div>
        <p className={styles.caption}>Course status</p>
        <div className={styles.row}>
          <Badge kind="course-status" value="DRAFT" />
          <Badge kind="course-status" value="PUBLISHED" />
          <Badge kind="course-status" value="ARCHIVED" />
        </div>
      </div>
      <div>
        <p className={styles.caption}>Member status</p>
        <div className={styles.row}>
          <Badge kind="member-status" value="active" />
          <Badge kind="member-status" value="inactive" />
        </div>
      </div>
      <div>
        <p className={styles.caption}>Learning status</p>
        <div className={styles.row}>
          <Badge kind="learning-status" value="not-enrolled" />
          <Badge kind="learning-status" value="in-progress" />
          <Badge kind="learning-status" value="completed" />
        </div>
      </div>
      <div>
        <p className={styles.caption}>Lesson type</p>
        <div className={styles.row}>
          <Badge kind="lesson-type" value="VIDEO" />
          <Badge kind="lesson-type" value="DOCUMENT" />
          <Badge kind="lesson-type" value="TEXT" />
          <Badge kind="lesson-type" value="LINK" />
        </div>
      </div>
    </div>
  )
}

function ProgressBars() {
  return (
    <div className={styles.grid}>
      <Progress value={45} label="Progress" showHeader caption="5 of 11 videos completed" />
      <Progress value={100} label="Progress" showHeader caption="11 of 11 videos completed" />
      <Progress value={0} label="Progress" showHeader caption="0 of 11 videos completed" />
      <div className={styles.stack}>
        <p className={styles.caption}>Thin — header and outline</p>
        <Progress value={45} size={4} label="Course progress" />
        <Progress value={64} size={6} label="Upload" />
        <Progress value={45} size={10} label="Course progress" />
      </div>
    </div>
  )
}

function Avatars() {
  return (
    <div className={styles.avatarRow}>
      <Avatar name="Iyed Belghith" size={24} />
      <Avatar name="Iyed Belghith" size={32} />
      <Avatar name="Iyed Belghith" size={40} />
      <Avatar name="Iyed Belghith" size={56} />
      <span className={styles.avatarPair}>
        <Avatar name="Amal Dridi" tone="accent" />
        Amal Dridi
      </span>
      <span className={styles.avatarPair}>
        <Avatar name="Yassine Ben Ammar" tone="inactive" />
        Yassine Ben Ammar
      </span>
    </div>
  )
}

function Skeletons() {
  return (
    <div className={styles.card}>
      <SkeletonGroup label="Loading courses">
        <div className={styles.skeletonRow}>
          <Skeleton variant="block" width={64} height={36} />
          <Skeleton width={180} />
        </div>
        <div className={styles.skeletonRow}>
          <Skeleton variant="block" width={64} height={36} />
          <Skeleton width={220} />
        </div>
        <div className={styles.skeletonRow}>
          <Skeleton variant="circle" width={40} height={40} />
          <Skeleton width={140} />
        </div>
        <Skeleton variant="block" height={44} />
      </SkeletonGroup>
    </div>
  )
}

function Icons() {
  return (
    <div className={styles.iconGrid}>
      {iconNames.map((name) => (
        <div key={name} className={styles.iconCell}>
          <Icon name={name} size={24} />
          <span className={styles.iconName}>{name}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Design-system gallery.
 *
 * A development-only verification surface for FE-01: every implemented
 * component with the states its board defines. It calls no API and holds no
 * application data. FE-03 replaces it with the real router.
 */
export function Gallery() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.strip}>
          <div className={styles.stripAccent} />
          <div className={styles.stripMuted} />
        </div>
        <h1>Design system</h1>
        <p className={styles.lede}>
          JEENISo learning platform — primitives, feedback components and icons, built from the
          DS 04–08 boards. Development-only page; no application data, no network calls.
        </p>
      </header>

      <Section title="Buttons — variants × states">
        <ButtonMatrix />
      </Section>

      <Section title="Buttons — sizes, icons and inverse surfaces">
        <div className={styles.stack}>
          <div className={styles.card}>
            <p className={styles.caption}>Sizes and icons</p>
            <div className={styles.row}>
              <Button size="lg">Large 52</Button>
              <Button size="md">Medium 44</Button>
              <Button size="sm">Small 36</Button>
              <Button iconLeft="plus">With icon</Button>
              <Button variant="secondary" iconRight="arrow-right">
                Icon right
              </Button>
              <Button variant="tertiary" iconOnly iconLeft="edit" aria-label="Edit" />
              <Button variant="secondary" iconOnly iconLeft="trash" aria-label="Delete" />
              <Button variant="tertiary" size="sm" iconOnly iconLeft="more" aria-label="More" />
              <Button href="#gallery-links" variant="secondary" iconRight="external">
                Link button
              </Button>
              <Button fullWidth>Full width</Button>
            </div>
          </div>

          <div className={[styles.card, styles.cardDark].join(' ')}>
            <p className={[styles.caption, styles.captionOnDark].join(' ')}>Inverse surfaces</p>
            <div className={styles.row}>
              <Button variant="on-dark">On dark</Button>
              <Button variant="ghost-dark">Ghost dark</Button>
              <Button variant="ghost-dark" disabled>
                Disabled
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Text field, select and textarea">
        <FormControls />
      </Section>

      <Section title="Segmented control">
        <SegmentedDemo />
      </Section>

      <Section title="File dropzone">
        <DropzoneDemo />
      </Section>

      <Section title="Badges">
        <Badges />
      </Section>

      <Section title="Progress">
        <ProgressBars />
      </Section>

      <Section title="Avatar">
        <Avatars />
      </Section>

      <Section title="Skeleton">
        <Skeletons />
      </Section>

      <Section title="Icons">
        <Icons />
      </Section>

      <p id="gallery-links" />
    </main>
  )
}
