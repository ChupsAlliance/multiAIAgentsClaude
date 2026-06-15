import { useState, useEffect } from 'react'
import { Sidebar } from '../components/Sidebar'
import { sections } from '../data/sections'
import { Introduction } from '../sections/Introduction'
import { StandardMode } from '../sections/StandardMode'
import { LauncherGuide } from '../sections/LauncherGuide'
import { PlanReviewGuide } from '../sections/PlanReviewGuide'
import { DashboardGuide } from '../sections/DashboardGuide'
import { Setup } from '../sections/Setup'
import { CreateTeam } from '../sections/CreateTeam'
import { TeamInteraction } from '../sections/TeamInteraction'
import { DisplayModes } from '../sections/DisplayModes'
import { BestPractices } from '../sections/BestPractices'
import { RealWorldExamples } from '../sections/RealWorldExamples'
import { HowItWorks } from '../sections/HowItWorks'
import { Limitations } from '../sections/Limitations'
import { ArrowUp } from 'lucide-react'

const sectionMap = {
  intro:            Introduction,
  'standard-mode':  StandardMode,
  'launcher-guide': LauncherGuide,
  'plan-review':    PlanReviewGuide,
  'dashboard-guide':DashboardGuide,
  setup:            Setup,
  'create-team':    CreateTeam,
  interaction:      TeamInteraction,
  display:          DisplayModes,
  best:             BestPractices,
  examples:         RealWorldExamples,
  'how-it-works':   HowItWorks,
  limits:           Limitations,
}

export function DocsPage() {
  const [activeSection, setActiveSection] = useState(sections[0].id)
  const [showTop, setShowTop] = useState(false)

  useEffect(() => {
    const container = document.getElementById('main-scroll')
    if (!container) return

    const observers = sections.map((s) => {
      const el = document.getElementById(s.id)
      if (!el) return null
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSection(s.id) },
        { root: container, rootMargin: '-15% 0px -75% 0px' }
      )
      obs.observe(el)
      return obs
    })

    const onScroll = () => setShowTop(container.scrollTop > 600)
    container.addEventListener('scroll', onScroll)

    return () => {
      observers.forEach(o => o?.disconnect())
      container.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-vs-bg">
      <Sidebar activeSection={activeSection} />

      <main id="main-scroll" className="flex-1 ml-0 md:ml-64 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-20">
          {sections.map((s) => {
            const Component = sectionMap[s.id]
            return (
              <section key={s.id} id={s.id} className="scroll-mt-8 animate-fade-in">
                <Component />
              </section>
            )
          })}

          {/* Footer */}
          <div className="border-t border-vs-border pt-8 text-center text-vs-muted text-xs font-mono">
            <p>Claude Code Agent Teams Guide · Internal Documentation · v1.1</p>
            <p className="mt-1 text-[10px]">Built with Tauri + React</p>
          </div>
        </div>

        {/* Scroll to top */}
        {showTop && (
          <button
            onClick={() => document.getElementById('main-scroll')?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-vs-accent hover:bg-vs-accent2 text-white shadow-lg transition-colors hover:scale-110 no-drag"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </main>
    </div>
  )
}
