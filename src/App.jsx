import { useState } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { CalendarDays, LineChart, Upload, Tag, LogOut } from 'lucide-react'
import clsx from 'clsx'
import MesCorrentePage from './pages/MesCorrentePage'
import FluxoPage from './pages/FluxoPage'
import ImportarPage from './pages/ImportarPage'
import ClassificarPage from './pages/ClassificarPage'
import LoginPage from './pages/LoginPage'
import { getToken, clearAuth } from './lib/github'

const NAV = [
  { to: '/mes', label: 'Mês', icon: CalendarDays },
  { to: '/fluxo', label: 'Fluxo', icon: LineChart },
  { to: '/classificar', label: 'Classificar', icon: Tag },
  { to: '/importar', label: 'Importar', icon: Upload },
]

/** Desktop: barra lateral. Celular: tab bar embaixo, no alcance do polegar. */
function Nav() {
  return (
    <>
      <aside className="hidden md:flex w-[172px] shrink-0 bg-gap-navy text-white/80 flex-col">
        <div className="px-4 py-4 border-b border-white/10">
          <div className="text-[13px] font-bold text-white tracking-tight">Finance Tracker</div>
          <div className="text-[10.5px] text-white/45 mt-0.5">pessoal</div>
        </div>
        <nav className="p-2 flex flex-col gap-0.5">
          {NAV.map(({ to, label, icon: Icon, soon }) => (
            <NavLink
              key={to} to={to}
              className={({ isActive }) => clsx(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors',
                isActive ? 'bg-gap-blue text-white font-semibold' : 'hover:bg-white/10',
                soon && 'opacity-40 pointer-events-none'
              )}
            >
              <Icon size={14} />{label}
              {soon && <span className="ml-auto text-[9px] uppercase">breve</span>}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => { clearAuth(); location.reload() }}
          className="mt-auto m-2 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] hover:bg-white/10"
        ><LogOut size={13} />Sair</button>
      </aside>

      {/* tab bar do celular — pb-safe respeita a barra de gestos do iPhone */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-gap-navy flex pb-safe">
        {NAV.map(({ to, label, icon: Icon, soon }) => (
          <NavLink
            key={to} to={to}
            className={({ isActive }) => clsx(
              'flex-1 flex flex-col items-center gap-0.5 py-2 text-[10.5px] transition-colors',
              isActive ? 'text-gap-blue font-semibold' : 'text-white/55',
              soon && 'opacity-35 pointer-events-none'
            )}
          >
            <Icon size={18} />{label}
          </NavLink>
        ))}
      </nav>
    </>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(!!getToken())
  if (!authed) return <LoginPage onOk={() => setAuthed(true)} />

  return (
    <div className="flex h-full">
      <Nav />
      {/* pb-20 no celular: a tab bar fixa nao pode cobrir o fim da lista */}
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <Routes>
          <Route path="/" element={<Navigate to="/mes" replace />} />
          <Route path="/mes" element={<MesCorrentePage />} />
          <Route path="/fluxo" element={<FluxoPage />} />
          <Route path="/classificar" element={<ClassificarPage />} />
          <Route path="/importar" element={<ImportarPage />} />
          <Route path="*" element={<Navigate to="/mes" replace />} />
        </Routes>
      </main>
    </div>
  )
}
