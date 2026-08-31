import { motion } from 'framer-motion'
import { Fragment, useEffect, useState } from 'react'
import { GridBackground, GlowCard } from './Spotlight'

/**
 * Marketing landing page — what an unauthenticated visitor sees before
 * AuthPage.jsx, instead of landing straight on a login form. App.jsx
 * renders this first and only swaps to AuthPage once `onGetStarted` is
 * called (a "Get started" / "Sign in" click), so bookmarking straight
 * into login isn't supported yet — not a real gap for a single-page app
 * with no router, just worth knowing if that's ever needed later.
 *
 * Content notes for whoever edits this next:
 *   - PRICING is explicitly placeholder (see the section below) — actual
 *     pricing hasn't been decided yet (see docs/ARCHITECTURE.md and the
 *     business-side conversation this was built alongside). Replace the
 *     numbers before this goes live for real, or swap the section for a
 *     "Contact us" CTA if usage-based/custom pricing ends up being the
 *     model instead.
 *   - TESTIMONIALS are placeholder too, deliberately attributed to a role
 *     ("School Administrator") rather than an invented name/school, so
 *     nobody mistakes them for real quotes. Swap in real ones once you
 *     have them — fabricated specific attributions (fake names, fake
 *     schools) would be actively misleading, generic role-based ones are
 *     an honest placeholder.
 *   - The hero's timetable visual is a hand-built CSS/SVG mockup, not a
 *     real screenshot — there's no production deployment to screenshot
 *     yet (see the deployment conversation). Swap for a real screenshot
 *     once the app is hosted somewhere presentable.
 */

// Each card leads with the outcome for the institution, not the
// mechanism behind it (plain English input, a CP-SAT solver, etc.) —
// people don't shop for a solver, they shop for their term-planning
// headache going away. The "how" still shows up in the second sentence
// for anyone who wants it, but it's not the headline.
const FEATURES = [
  {
    title: 'Save weeks of admin work every term',
    body: 'Type your scheduling rules as plain sentences instead of wrestling with spreadsheet formulas, and get a working timetable in an afternoon.',
    icon: 'speed',
  },
  {
    title: 'Hand out a schedule with zero clashes',
    body: 'No teacher double-booked, no class in two places at once. Every timetable is checked against every rule before it ever reaches you.',
    icon: 'shieldCheck',
  },
  {
    title: 'Go live in a day, not a week',
    body: 'Already have your teachers, subjects, and sections in a spreadsheet? Upload it and start scheduling right away, instead of re-typing everything by hand.',
    icon: 'upload',
  },
  {
    title: "Never get stuck guessing what went wrong",
    body: "When a schedule can't be built, you're told exactly which teacher or section is the problem, so it takes minutes to fix, not hours of trial and error.",
    icon: 'flag',
  },
  {
    title: 'Adapt without rebuilding from scratch',
    body: 'Lock in the parts of a schedule that already work and adjust the rest by hand. One change to one class does not mean starting over.',
    icon: 'sliders',
  },
  {
    title: 'Keep your whole staff on the same page',
    body: 'Office admins, vice principals, and teachers all see one live schedule, instead of five different spreadsheet versions emailed back and forth.',
    icon: 'users',
  },
]

// Small line-icon set for the feature cards below, drawn in the same
// stroke style already used for Sidebar.jsx's nav icons (24x24 viewBox,
// stroke="currentColor", strokeWidth 2, round caps/joins) instead of the
// Unicode glyphs (✦ ◈ ⇪ ⚑ ⚙ ⌘) this section used before — those read as
// placeholder characters rather than a real icon system.
const FEATURE_ICONS = {
  speed: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
    </svg>
  ),
  shieldCheck: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 3v5c0 5-3.2 8.5-7 10-3.8-1.5-7-5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  upload: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  ),
  flag: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V4" />
      <path d="M5 4h13l-2.5 4L18 12H5" />
    </svg>
  ),
  sliders: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h9" />
      <path d="M17 6h3" />
      <circle cx="14" cy="6" r="2" />
      <path d="M4 12h3" />
      <path d="M11 12h9" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 18h11" />
      <path d="M19 18h1" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  ),
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="10" cy="8" r="3.5" />
      <path d="M21 20v-1a4 4 0 0 0-2.5-3.7" />
      <path d="M15.5 4.3a3.5 3.5 0 0 1 0 6.9" />
    </svg>
  ),
}

const PRICING_TIERS = [
  {
    name: 'Starter',
    price: '₹1,999',
    period: '+ GST /month',
    tagline: 'For a single school finding its feet',
    features: ['1 school', 'Up to 500 students', 'Unlimited timetables', 'Email support'],
    highlighted: false,
  },
  {
    name: 'Growth',
    price: '₹4,999',
    period: '+ GST /month',
    tagline: 'For schools that need more hands on deck',
    features: ['1 school', 'Unlimited students', 'Multiple admins & viewers', 'Priority support'],
    highlighted: true,
  },
  {
    name: 'Group',
    price: 'Contact us',
    period: '',
    tagline: 'For a group running several schools',
    features: ['Multiple schools', 'Everything in Growth', 'Dedicated onboarding', 'Custom terms'],
    highlighted: false,
  },
]

const TESTIMONIALS = [
  {
    quote:
      "Building the timetable used to take our vice principal two full weeks every term. Typing in the rules and letting it solve took an afternoon.",
    role: 'School Administrator',
  },
  {
    quote:
      'The bit I didn\'t expect to matter: when it can\'t find a schedule, it tells you why. No more guessing which constraint is the problem.',
    role: 'Academic Coordinator',
  },
  {
    quote:
      "We locked the slots that were already working and let it fill in the rest. Didn't have to start from a blank grid.",
    role: 'School Administrator',
  },
]

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
}

/**
 * A typewriter-style word cycler: types out each word in `words`
 * character by character, pauses, deletes it, then moves to the next
 * word and loops. Used in the Hero headline so it cycles through
 * "schools" / "colleges" / "institutions" instead of picking just one.
 */
function TypingWords({ words, typingSpeedMs = 90, deletingSpeedMs = 45, pauseMs = 1400 }) {
  const [wordIndex, setWordIndex] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const currentWord = words[wordIndex]

    if (!deleting && charCount === currentWord.length) {
      const pause = setTimeout(() => setDeleting(true), pauseMs)
      return () => clearTimeout(pause)
    }

    if (deleting && charCount === 0) {
      setDeleting(false)
      setWordIndex((prev) => (prev + 1) % words.length)
      return
    }

    const timeout = setTimeout(
      () => setCharCount((prev) => prev + (deleting ? -1 : 1)),
      deleting ? deletingSpeedMs : typingSpeedMs
    )
    return () => clearTimeout(timeout)
  }, [charCount, deleting, wordIndex, words, typingSpeedMs, deletingSpeedMs, pauseMs])

  return (
    <span className="text-indigo-600">
      {words[wordIndex].slice(0, charCount)}
      <span className="ml-0.5 inline-block w-0.5 animate-pulse bg-indigo-600 align-middle" style={{ height: '0.85em' }} />
    </span>
  )
}


export default function LandingPage({ onGetStarted }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <LandingNav onGetStarted={onGetStarted} />
      <Hero onGetStarted={onGetStarted} />
      <Features />
      <HowItWorks />
      <Pricing onGetStarted={onGetStarted} />
      <Testimonials />
      <Footer />
    </div>
  )
}

function LandingNav({ onGetStarted }) {
  return (
    <div className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur">
      {/* No max-w-6xl/mx-auto here unlike the rest of the page's sections —
          that centers a fixed-width column and leaves equal, growing
          margins on both sides as the viewport widens, which is exactly
          why the logo never actually reached the true left edge like
          Asana/Docusign's headers do. This bar instead spans the full
          width with fixed edge padding, so the logo and nav sit close to
          the real left edge on any screen size. */}
      <div className="flex items-center px-8 py-4 md:px-16 lg:px-28">
        {/* Logo + nav links grouped together on the left (Asana/Docusign-
            style layout) instead of the logo/nav/CTA being spread evenly
            across the bar with justify-between — the nav reads as
            belonging to the brand mark, not as a separate centered block. */}
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-sm font-semibold text-white">
              T
            </div>
            <span className="text-sm font-semibold">Timetable</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
            <a href="#features" className="hover:text-slate-900">Why Timetable</a>
            <a href="#how-it-works" className="hover:text-slate-900">How it Works</a>
            <a href="#pricing" className="hover:text-slate-900">Plans and Pricing</a>
          </nav>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button onClick={onGetStarted} className="text-sm font-medium text-slate-600 hover:text-slate-900">
            Sign in
          </button>
          <button
            onClick={onGetStarted}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Get started free
          </button>
        </div>
      </div>
    </div>
  )
}

function Hero({ onGetStarted }) {
  return (
    <section className="relative overflow-hidden">
      <GridBackground />
      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
      <div className="grid items-center gap-14 md:grid-cols-2">
        <motion.div initial="hidden" animate="show" variants={fadeUp} transition={{ duration: 0.6 }}>
          {/* The cycling word sits on its own dedicated line (explicit <br/>,
              not just wrapping wherever it happens to land) so its
              changing width can never push "Instant timetables" onto an
              extra line — see the earlier version of this component for
              the layout-shift bug this avoids. */}
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Instant timetables
            <br />
            for <TypingWords words={['schools', 'colleges', 'institutions']} />
          </h1>
          <p className="mt-5 max-w-lg text-lg text-slate-500">
            Describe your scheduling rules in plain English and get a complete, ready-to-use
            timetable for every section and every teacher, with zero clashes.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={onGetStarted}
              className="rounded-md bg-indigo-600 px-6 py-3 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Get started free
            </button>
            <a
              href="#how-it-works"
              className="rounded-md border border-slate-300 px-6 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-500">No credit card required to try it.</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15 }}
        >
          <TimetableMockup />
        </motion.div>
      </div>
      </div>
    </section>
  )
}

/**
 * A hand-built visual, not a real screenshot (see this file's top
 * docstring) — a small animated grid that suggests the actual product's
 * By Section timetable view without claiming to BE it.
 */
function TimetableMockup() {
  const rows = ['P1', 'P2', 'P3', 'P4', 'P5']
  const cols = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const subjects = ['Math', 'Science', 'English', 'PE', 'Art', 'History', 'Music']
  const colors = ['bg-indigo-600', 'bg-emerald-600', 'bg-amber-500', 'bg-sky-600', 'bg-violet-600']

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xl shadow-slate-200/60">
      <div className="mb-3 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        <span className="ml-2 text-xs text-slate-500">Grade 8 · Section A</span>
      </div>
      <div className="grid grid-cols-[36px_repeat(5,1fr)] gap-1 text-[10px]">
        <div />
        {cols.map((c) => (
          <div key={c} className="pb-1 text-center font-medium text-slate-500">
            {c}
          </div>
        ))}
        {rows.map((r, ri) => (
          <Fragment key={r}>
            <div className="flex items-center text-slate-500">{r}</div>
            {cols.map((c, ci) => (
              <motion.div
                key={`${r}-${c}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (ri * 5 + ci) * 0.02, duration: 0.3 }}
                className={`${colors[(ri + ci) % colors.length]} rounded px-1 py-1.5 text-center font-medium text-white`}
              >
                {subjects[(ri * 5 + ci * 3) % subjects.length]}
              </motion.div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={fadeUp}
        transition={{ duration: 0.5 }}
        className="mx-auto mb-14 max-w-2xl text-center"
      >
        <h2 className="text-3xl font-semibold tracking-tight">Everything the job actually needs</h2>
        <p className="mt-3 text-slate-500">
          Not a generic scheduler with "school" bolted on, but built around how Indian schools and colleges
          actually plan a term.
        </p>
      </motion.div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
            whileHover={{ y: -4 }}
            className="h-full"
          >
            {/* h-full here (and on the motion.div above) so the visible
                bordered box actually fills the row height the CSS grid
                already stretches its wrapper to, instead of just sizing
                to its own text — otherwise a card with less copy than
                its row-mates left its border sitting short of where the
                row actually ends, making rows look ragged whenever card
                lengths weren't hand-tuned to match exactly. */}
            <GlowCard className="flex h-full flex-col rounded-xl border border-slate-200 p-6 transition-shadow hover:shadow-lg hover:shadow-slate-200/60">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
                {FEATURE_ICONS[f.icon]}
              </div>
              <h3 className="font-medium">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{f.body}</p>
            </GlowCard>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

const STEPS = [
  { n: '01', title: 'Set up your school', body: 'Periods, subjects, teachers, and sections: type them in or bulk-import a spreadsheet.' },
  { n: '02', title: 'Describe your rules', body: 'Plain-English constraints, scoped to a subject, teacher, day, or specific section.' },
  { n: '03', title: 'Generate', body: 'The solver builds every section\'s schedule at once, with zero teacher or room clashes.' },
  { n: '04', title: 'Fine-tune and export', body: 'Lock slots, drag to adjust, then export to Excel or PDF for the staff room wall.' },
]

function HowItWorks() {
  return (
    <section id="how-it-works" className="bg-slate-50/60 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center text-3xl font-semibold tracking-tight"
        >
          From blank slate to a full timetable
        </motion.h2>
        <div className="grid gap-8 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <div className="mb-3 text-2xl font-semibold text-slate-300">{s.n}</div>
              <h3 className="font-medium">{s.title}</h3>
              <p className="mt-2 text-sm text-slate-500">{s.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Pricing({ onGetStarted }) {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.3 }}
        variants={fadeUp}
        transition={{ duration: 0.5 }}
        className="mx-auto mb-10 max-w-2xl text-center"
      >
        <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
        <p className="mt-3 text-slate-500">Pick what fits your school. Change or cancel anytime.</p>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-3">
        {PRICING_TIERS.map((tier, i) => (
          <motion.div
            key={tier.name}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={fadeUp}
            transition={{ duration: 0.4, delay: i * 0.1 }}
            className={`rounded-xl border p-7 ${
              tier.highlighted ? 'border-indigo-600 shadow-xl shadow-slate-200/60' : 'border-slate-200'
            }`}
          >
            {tier.highlighted && (
              <span className="mb-3 inline-block rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                Most popular
              </span>
            )}
            <h3 className="font-medium">{tier.name}</h3>
            <p className="mt-1 text-sm text-slate-500">{tier.tagline}</p>
            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-3xl font-semibold">{tier.price}</span>
              <span className="text-sm text-slate-500">{tier.period}</span>
            </div>
            <ul className="mt-6 flex flex-col gap-2.5 text-sm text-slate-600">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-emerald-600">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={onGetStarted}
              className={`mt-7 w-full rounded-md px-4 py-2.5 text-sm font-medium ${
                tier.highlighted
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              Get started
            </button>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

function Testimonials() {
  return (
    <section className="bg-slate-50/60 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          variants={fadeUp}
          transition={{ duration: 0.5 }}
          className="mb-14 text-center text-3xl font-semibold tracking-tight"
        >
          What schools are saying
        </motion.h2>
        <div className="grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.role + i}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeUp}
              transition={{ duration: 0.4, delay: i * 0.1 }}
              className="rounded-xl border border-slate-200 bg-white p-6"
            >
              <p className="text-sm leading-relaxed text-slate-600">"{t.quote}"</p>
              <p className="mt-4 text-xs font-medium text-slate-500">{t.role}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-100 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-xs text-slate-500 md:flex-row">
        <span>© {new Date().getFullYear()} Timetable. All rights reserved.</span>
        <span>Made for schools & colleges, not spreadsheets.</span>
      </div>
    </footer>
  )
}
