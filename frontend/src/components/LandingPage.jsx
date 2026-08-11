import { motion } from 'framer-motion'
import { Fragment } from 'react'
import { GridBackground, Spotlight, GlowCard } from './Spotlight'
import { Marquee } from './Marquee'

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

const FEATURES = [
  {
    title: 'Describe rules in plain English',
    body: "\"Math can't follow PE\" or \"No PE on Fridays\" — type scheduling rules as sentences. An LLM (with a regex fallback when no API key is set) turns them into real constraints the solver enforces.",
    icon: '✦',
  },
  {
    title: 'A real optimization solver',
    body: 'Built on Google OR-Tools\' CP-SAT solver — the same class of technology used for airline crew scheduling and factory planning, not a greedy heuristic that gives up on hard cases.',
    icon: '◈',
  },
  {
    title: 'Bulk import from CSV/Excel',
    body: "Already have your teachers, subjects, and sections in a spreadsheet? Upload it instead of typing everything in one at a time.",
    icon: '⇪',
  },
  {
    title: 'Know why it failed, not just that it did',
    body: "When a schedule is impossible, most tools just say \"infeasible.\" This diagnoses the specific cause — an overloaded teacher, an over-subscribed section — so you know exactly what to fix.",
    icon: '⚑',
  },
  {
    title: 'Edit by hand, lock what matters',
    body: 'Drag a period to move it, lock a slot so it survives the next regeneration, or swap two classes in one move. The solver works around your manual edits, not the other way around.',
    icon: '⚙',
  },
  {
    title: 'Bring your whole team in',
    body: 'Invite an office admin or vice principal with full access, or a read-only viewer. Everyone sees the same live schedule — no emailing spreadsheets back and forth.',
    icon: '⌘',
  },
]

const PRICING_TIERS = [
  {
    name: 'Starter',
    price: '₹—',
    period: '/month',
    tagline: 'For a single school finding its feet',
    features: ['1 school', 'Up to 500 students', 'Unlimited timetables', 'Email support'],
    highlighted: false,
  },
  {
    name: 'Growth',
    price: '₹—',
    period: '/month',
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

export default function LandingPage({ onGetStarted }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <LandingNav onGetStarted={onGetStarted} />
      <Hero onGetStarted={onGetStarted} />
      <LogoStrip />
      <Features />
      <HowItWorks />
      <Pricing onGetStarted={onGetStarted} />
      <Testimonials />
      <FinalCta onGetStarted={onGetStarted} />
      <Footer />
    </div>
  )
}

function LandingNav({ onGetStarted }) {
  return (
    <div className="sticky top-0 z-30 border-b border-slate-100 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-600 text-sm font-semibold text-white">
            T
          </div>
          <span className="text-sm font-semibold">Timetable</span>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-slate-600 md:flex">
          <a href="#features" className="hover:text-slate-900">Features</a>
          <a href="#how-it-works" className="hover:text-slate-900">How it works</a>
          <a href="#pricing" className="hover:text-slate-900">Pricing</a>
        </nav>
        <div className="flex items-center gap-3">
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
      <Spotlight className="left-1/2 top-0 -translate-x-1/2" />
      <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
      <div className="grid items-center gap-14 md:grid-cols-2">
        <motion.div initial="hidden" animate="show" variants={fadeUp} transition={{ duration: 0.6 }}>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Built for Indian schools &amp; colleges
          </div>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
            Conflict-free timetables, generated in minutes — not weeks.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-slate-500">
            Describe your scheduling rules in plain English, and a real optimization solver builds
            the whole institution's timetable at once — every section, every teacher, zero clashes.
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
          <p className="mt-4 text-xs text-slate-400">No credit card required to try it.</p>
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
        <span className="ml-2 text-xs text-slate-400">Grade 8 · Section A</span>
      </div>
      <div className="grid grid-cols-[36px_repeat(5,1fr)] gap-1 text-[10px]">
        <div />
        {cols.map((c) => (
          <div key={c} className="pb-1 text-center font-medium text-slate-400">
            {c}
          </div>
        ))}
        {rows.map((r, ri) => (
          <Fragment key={r}>
            <div className="flex items-center text-slate-400">{r}</div>
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

// Real feature highlights, not customer logos — see this file's top
// docstring on why a marquee of invented company names would be
// misleading when there are no real customers to show yet.
const HIGHLIGHT_CHIPS = [
  'Zero teacher clashes',
  'CP-SAT solver',
  'Plain-English rules',
  'CSV/Excel bulk import',
  'Drag-to-edit grid',
  'Excel & PDF export',
  'Multi-admin access',
  'Infeasibility diagnostics',
]

function LogoStrip() {
  return (
    <div className="border-y border-slate-100 bg-slate-50/60 py-6">
      <p className="mb-3 text-center text-xs uppercase tracking-wide text-slate-400">
        Built for schools & colleges that are done fighting spreadsheets
      </p>
      <Marquee
        speed={32}
        items={HIGHLIGHT_CHIPS.map((label) => (
          <span
            key={label}
            className="whitespace-nowrap rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-medium text-slate-600"
          >
            {label}
          </span>
        ))}
      />
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
          Not a generic scheduler with "school" bolted on — built around how Indian schools and colleges
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
          >
            <GlowCard className="rounded-xl border border-slate-200 p-6 transition-shadow hover:shadow-lg hover:shadow-slate-200/60">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-lg text-white">
                {f.icon}
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
  { n: '01', title: 'Set up your school', body: 'Periods, subjects, teachers, and sections — type them in or bulk-import a spreadsheet.' },
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
        className="mx-auto mb-4 max-w-2xl text-center"
      >
        <h2 className="text-3xl font-semibold tracking-tight">Simple pricing</h2>
        <p className="mt-3 text-slate-500">Pick what fits your school. Change or cancel anytime.</p>
      </motion.div>
      <p className="mx-auto mb-10 max-w-md text-center text-xs text-amber-600">
        Illustrative pricing — final numbers to be confirmed.
      </p>

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
              <span className="text-sm text-slate-400">{tier.period}</span>
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
              <p className="mt-4 text-xs font-medium text-slate-400">— {t.role}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FinalCta({ onGetStarted }) {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <motion.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={fadeUp}
        transition={{ duration: 0.5 }}
        className="rounded-2xl bg-indigo-600 px-8 py-16 text-center text-white"
      >
        <h2 className="text-3xl font-semibold tracking-tight">Ready to stop building timetables by hand?</h2>
        <p className="mx-auto mt-3 max-w-md text-slate-300">
          Set up your first section in a few minutes and see a full schedule generate itself.
        </p>
        <button
          onClick={onGetStarted}
          className="mt-8 rounded-md bg-white px-6 py-3 text-sm font-medium text-slate-900 hover:bg-slate-100"
        >
          Get started free
        </button>
      </motion.div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-100 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-xs text-slate-400 md:flex-row">
        <span>© {new Date().getFullYear()} Timetable. All rights reserved.</span>
        <span>Made for schools & colleges, not spreadsheets.</span>
      </div>
    </footer>
  )
}
