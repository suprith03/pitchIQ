import { useMemo, useState } from 'react'
import { gql } from '@apollo/client'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client/react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BarChart3, CalendarDays, CircleHelp, Database,
  FileUp, Goal, LayoutDashboard, Menu, RefreshCw, Shield, SlidersHorizontal, Sparkles, Swords,
  Trophy, Users, ChevronDown, X,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export const DASHBOARD_QUERY = gql`
  query Dashboard {
    standings { position team { id name crest } played won drawn lost goalsFor goalsAgainst goalDifference points form }
    matches { id matchday date homeTeam { id name crest } awayTeam { id name crest } homeGoals awayGoals status }
    scorers { player team { id name crest } goals penalties }
    teams { id name crest }
    dataHealth { storageMode source mongo apiConfigured lastSyncedAt seasonYear syncError providerWarnings mongoCollections { name documents indexes } }
  }
`
const TEAM_DNA_QUERY = gql`
  query TeamDNA($teamId: ID!) {
    teamDNA(teamId: $teamId) { team { id name crest } homePlayed homePoints awayPlayed awayPoints goalsPerMatch concededPerMatch attackIndex defenceIndex form }
  }
`
const COMPARE_QUERY = gql`
  query CompareTeams($teamA: ID!, $teamB: ID!) {
    compareTeams(teamA: $teamA, teamB: $teamB) {
      meetings winsA draws winsB goalsA goalsB
      teamA { team { id name crest } homePlayed homePoints awayPlayed awayPoints goalsPerMatch concededPerMatch attackIndex defenceIndex form }
      teamB { team { id name crest } homePlayed homePoints awayPlayed awayPoints goalsPerMatch concededPerMatch attackIndex defenceIndex form }
    }
  }
`
const WHAT_IF = gql`
  mutation WhatIf($outcomes: [OutcomeInput!]!) {
    whatIf(outcomes: $outcomes) {
      table { position team { id name crest } played won drawn lost goalsFor goalsAgainst goalDifference points form }
      changes { team { id name crest } oldPosition newPosition pointsGained goalDifferenceChange }
    }
  }
`
const SEASON_SIM = gql`
  mutation SimulateSeason($iterations: Int) {
    simulateSeason(iterations: $iterations) { team { id name crest } averagePosition topFourProbability expectedPoints }
  }
`
const IMPORT_CSV = gql`mutation ImportCsv($csv: String!) { importCsv(csv: $csv) { imported skipped message } }`
const SYNC = gql`mutation SyncFootballData($season: Int) { syncFootballData(season: $season) { imported fetched source syncedAt } }`
const BENCHMARK = gql`
  query Benchmark($iterations: Int) {
    benchmark(iterations: $iterations) {
      metrics { database query iterations totalMs averageMs minMs maxMs }
      unavailable
    }
  }
`

type Team = { id: string; name: string; crest: string | null }
type Standing = {
  position: number; team: Team; played: number; won: number; drawn: number; lost: number
  goalsFor: number; goalsAgainst: number; goalDifference: number; points: number; form: string
}
type Match = {
  id: string; matchday: number; date: string; homeTeam: Team; awayTeam: Team
  homeGoals: number | null; awayGoals: number | null; status: string
}
type DNA = {
  team: Team; homePlayed: number; homePoints: number; awayPlayed: number; awayPoints: number
  goalsPerMatch: number; concededPerMatch: number; attackIndex: number; defenceIndex: number; form: string
}
type DashboardData = {
  standings: Standing[]; matches: Match[]; scorers: Array<{ player: string; team: Team; goals: number; penalties: number }>
  teams: Team[]; dataHealth: {
    storageMode: string; source: string; mongo: string; apiConfigured: boolean; lastSyncedAt: string | null
    seasonYear: number | null; syncError: string | null; providerWarnings: string[]
    mongoCollections: Array<{ name: string; documents: number; indexes: string[] }>
  }
}
type SyncData = { syncFootballData: { imported: number; fetched: number; source: string; syncedAt: string } }
type WhatIfData = { whatIf: { table: Standing[]; changes: Array<{ team: Team; oldPosition: number; newPosition: number; pointsGained: number; goalDifferenceChange: number }> } }
type SeasonData = { simulateSeason: Array<{ team: Team; averagePosition: number; topFourProbability: number; expectedPoints: number }> }
type ImportData = { importCsv: { imported: number; skipped: number; message: string } }
type BenchmarkData = { benchmark: { metrics: Array<{ database: string; query: string; iterations: number; totalMs: number; averageMs: number; minMs: number; maxMs: number }>; unavailable: string[] } }
type PageId = 'overview' | 'table' | 'fixtures' | 'dna' | 'matchup' | 'whatif' | 'season' | 'scorers' | 'database'

const navigation: Array<{ id: PageId; label: string; icon: typeof Activity; group: string }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Workspace' },
  { id: 'table', label: 'League table', icon: Trophy, group: 'Workspace' },
  { id: 'fixtures', label: 'Fixtures', icon: CalendarDays, group: 'Workspace' },
  { id: 'dna', label: 'Team DNA', icon: Shield, group: 'Analysis' },
  { id: 'matchup', label: 'Matchup lab', icon: Swords, group: 'Analysis' },
  { id: 'whatif', label: 'What-if simulator', icon: SlidersHorizontal, group: 'Simulators' },
  { id: 'season', label: 'Season forecast', icon: Sparkles, group: 'Simulators' },
  { id: 'scorers', label: 'Top scorers', icon: Goal, group: 'Analysis' },
  { id: 'database', label: 'Database lab', icon: Database, group: 'Tools' },
]
const CHART_COLORS = ['#86efac', '#34d399', '#10b981', '#059669', '#047857']
const tooltipStyle = { background: '#131d29', border: '1px solid #263444', borderRadius: 12, color: '#f3f6f8' }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export default function App() {
  const [page, setPage] = useState<PageId>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const { data, loading, error, refetch } = useQuery<DashboardData>(DASHBOARD_QUERY, { fetchPolicy: 'cache-and-network' })
  const [sync, syncState] = useMutation<SyncData>(SYNC, {
    onCompleted: (result) => {
      setNotice(`Synced ${result.syncFootballData.fetched} fixtures from ${result.syncFootballData.source}.`)
      void refetch()
    },
    onError: (mutationError) => setNotice(errorMessage(mutationError)),
  })
  const activeLabel = navigation.find((item) => item.id === page)?.label ?? 'Overview'
  const activeSource = data?.dataHealth.source ?? ''
  const sourceIsLive = activeSource.includes('· live')
  const sourceIsCached = activeSource.includes('persisted MongoDB snapshot')
  const goTo = (next: PageId) => { setPage(next); setMenuOpen(false); setNotice('') }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); goTo('overview') }}>
          <span className="brand-mark"><Activity size={19} strokeWidth={2.8} /></span>
          <span>Pitch<span className="brand-iq">IQ</span><small>FOOTBALL INTELLIGENCE</small></span>
        </a>
        <div className="season-select"><span className="season-dot" /><div><b>Premier League</b><small>{data?.dataHealth.seasonYear ? `${data.dataHealth.seasonYear}/${String(data.dataHealth.seasonYear + 1).slice(-2)} season` : 'Season workspace'}</small></div><ChevronDown size={15} /></div>
        {['Workspace', 'Analysis', 'Simulators', 'Tools'].map((group) => (
          <div className="nav-group" key={group}><div className="nav-label">{group}</div>
            {navigation.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => (
              <button className={`nav-item ${page === id ? 'active' : ''}`} key={id} onClick={() => goTo(id)}>
                <Icon size={17} /><span>{label}</span>{id === 'whatif' && <span className="nav-new">LAB</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-bottom"><div className="profile-avatar">PI</div><div className="profile-meta"><b>Analyst workspace</b><small>{data?.dataHealth.storageMode === 'oracle' ? 'Oracle connected' : sourceIsCached ? 'Cached provider data' : sourceIsLive ? 'Provider data · live' : 'Provider unavailable'}</small></div><CircleHelp size={17} className="muted-icon" /></div>
      </aside>
      {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-separator">/</span><b>{activeLabel}</b></div>
          <div className="topbar-actions">
            <span className={`connection-pill ${data?.dataHealth.storageMode === 'oracle' || sourceIsLive ? 'online' : ''}`}><span className="connection-dot" />{data?.dataHealth.storageMode === 'oracle' ? 'Oracle connected' : sourceIsLive ? 'Live data' : sourceIsCached ? 'Cached data' : data?.dataHealth.apiConfigured ? 'Unavailable' : 'API not configured'}</span>
            <button className="icon-button" aria-label="Refresh data" title="Refresh data" onClick={() => { setNotice(''); void refetch() }}><RefreshCw size={17} /></button>
            <button className="sync-button" aria-label="Sync data" onClick={() => void sync()} disabled={!data?.dataHealth.apiConfigured || syncState.loading} title={data?.dataHealth.apiConfigured ? 'Sync current season from football-data.org' : 'Set FOOTBALL_DATA_API_TOKEN on the backend to enable sync'}>
              <RefreshCw size={15} className={syncState.loading ? 'spin' : ''} /> Sync data
            </button>
          </div>
        </header>
        <section className="page-content">
          {data?.dataHealth.syncError && data.teams.length > 0 && <div className="notice-banner sync-error-banner" role="alert"><span>{data.dataHealth.syncError}</span></div>}
          {notice && <div className="notice-banner" role="status"><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
          {error && !data ? <ErrorState error={errorMessage(error)} onRetry={() => void refetch()} /> : loading && !data ? <LoadingState /> : data ? (
            <PageContent page={page} data={data} setNotice={setNotice} refetch={refetch} />
          ) : <EmptyState title="No data available" detail="Connect the GraphQL API and load a season dataset." />}
        </section>
      </main>
    </div>
  )
}

function PageContent({ page, data, setNotice, refetch }: {
  page: PageId; data: DashboardData; setNotice: (message: string) => void; refetch: () => Promise<unknown>
}) {
  if (!data.teams.length && page !== 'database') {
    const detail = data.dataHealth.syncError
      ?? (data.dataHealth.apiConfigured ? 'No season data is available yet. Try synchronizing again.' : 'Set FOOTBALL_DATA_API_TOKEN in the project root .env file, then restart the API.')
    return <section className="no-season-data">
      <PageHeading eyebrow="DATA CONNECTION" title="No league data available" description="PitchIQ only displays Premier League data returned by football-data.org or retained as a real provider snapshot." />
      <ErrorState error={detail} />
      <EmptyState title="Premier League data has not been loaded" detail="Use Sync data after configuring the provider token. No sample or fictional data is shown." />
    </section>
  }
  switch (page) {
    case 'overview': return <OverviewPage data={data} />
    case 'table': return <TablePage standings={data.standings} />
    case 'fixtures': return <FixturesPage matches={data.matches} />
    case 'dna': return <TeamDNAPage teams={data.teams} />
    case 'matchup': return <MatchupPage teams={data.teams} />
    case 'whatif': return <WhatIfPage matches={data.matches} setNotice={setNotice} />
    case 'season': return <SeasonPage />
    case 'scorers': return <ScorersPage scorers={data.scorers} warnings={data.dataHealth.providerWarnings} />
    case 'database': return <DatabasePage health={data.dataHealth} setNotice={setNotice} refetch={refetch} />
  }
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function OverviewPage({ data }: { data: DashboardData }) {
  const completed = data.matches.filter((match) => match.status === 'FINISHED')
  const totalGoals = completed.reduce((sum, match) => sum + (match.homeGoals ?? 0) + (match.awayGoals ?? 0), 0)
  const upcoming = data.matches.filter((match) => match.status !== 'FINISHED').slice(0, 4)
  const leader = data.standings[0]
  const chartRows = data.standings.map((standing) => ({ team: standing.team.name.split(' ')[0], points: standing.points }))
  const resultProfile = [
    { name: 'Home wins', value: completed.filter((match) => (match.homeGoals ?? 0) > (match.awayGoals ?? 0)).length },
    { name: 'Draws', value: completed.filter((match) => match.homeGoals === match.awayGoals).length },
    { name: 'Away wins', value: completed.filter((match) => (match.homeGoals ?? 0) < (match.awayGoals ?? 0)).length },
  ].filter((item) => item.value > 0)
  return <>
    <PageHeading eyebrow="SEASON SNAPSHOT" title="League overview" description="Your season at a glance. Track the table, fixture list and momentum." action={<span className="source-badge"><span />{data.dataHealth.source}{data.dataHealth.lastSyncedAt ? ` · Synced ${new Date(data.dataHealth.lastSyncedAt).toLocaleString()}` : ''}</span>} />
    <div className="stat-grid">
      <StatCard title="Matches played" value={String(completed.length)} suffix={`of ${data.matches.length}`} icon={<CalendarDays size={17} />} tone="green" />
      <StatCard title="Total goals" value={String(totalGoals)} suffix={completed.length ? `${(totalGoals / completed.length).toFixed(1)} per match` : 'No results yet'} icon={<Goal size={17} />} tone="blue" />
      <StatCard title="League leader" value={leader?.team.name ?? '—'} suffix={leader ? `${leader.points} points · ${leader.played} played` : 'Awaiting results'} icon={<Trophy size={17} />} tone="gold" compact />
      <StatCard title="Teams tracked" value={String(data.teams.length)} suffix="Provider season" icon={<Users size={17} />} tone="purple" />
    </div>
    <div className="dashboard-grid">
      <Panel className="points-panel" title="Points race" subtitle="Current league points" right={<span className="chart-legend"><i /> Points</span>}>
        {chartRows.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid stroke="#25313d" vertical={false} /><XAxis dataKey="team" axisLine={false} tickLine={false} tick={{ fill: '#8694a3', fontSize: 11 }} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#758393', fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#ffffff0a' }} />
          <Bar dataKey="points" name="Points" fill="#7de3a0" radius={[5, 5, 0, 0]} maxBarSize={43} />
        </BarChart></ResponsiveContainer></div> : <EmptyState title="No table data yet" detail="Synchronize a Premier League season to see the points race." />}
      </Panel>
      <Panel title="Results profile" subtitle="Home, draws and away wins" className="profile-panel">
        {resultProfile.length ? <div className="donut-layout">
          <div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={resultProfile} dataKey="value" nameKey="name" innerRadius={48} outerRadius={69} paddingAngle={4} stroke="none">{resultProfile.map((_, index) => <Cell key={index} fill={CHART_COLORS[index]} />)}</Pie><Tooltip contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer><div className="donut-center"><b>{completed.length}</b><small>RESULTS</small></div></div>
          <div className="legend-list">{resultProfile.map((item, index) => <div key={item.name}><span><i style={{ background: CHART_COLORS[index] }} />{item.name}</span><b>{item.value}</b></div>)}</div>
        </div> : <EmptyState title="No results yet" detail="Result distribution will appear here." />}
        <div className="mini-note"><Sparkles size={14} /> Actual results only. Simulations never change this dataset.</div>
      </Panel>
      <Panel className="table-preview" title="Current standings" subtitle="Top teams by points, then goal difference" right={<span className="live-label"><i /> PROVIDER</span>}>
        <StandingsTable standings={data.standings.slice(0, 5)} /><div className="panel-foot">{data.standings.length} clubs in this dataset</div>
      </Panel>
      <Panel className="fixture-preview" title="Next fixtures" subtitle="Upcoming in the selected dataset" right={<CalendarDays size={16} className="subtle-icon" />}>
        {upcoming.length ? upcoming.map((match) => <FixtureRow match={match} key={match.id} />) : <EmptyState title="No upcoming fixtures" detail="No unplayed fixtures are present in this provider season." />}
      </Panel>
    </div>
  </>
}

function StatCard({ title, value, suffix, icon, tone, compact = false }: { title: string; value: string; suffix: string; icon: ReactNode; tone: string; compact?: boolean }) {
  return <div className={`stat-card tone-${tone}`}><div className="stat-top"><span>{title}</span><span className="stat-icon">{icon}</span></div><div className={`stat-value ${compact ? 'small-value' : ''}`}>{value}</div><div className="stat-suffix">{suffix}</div></div>
}

function Panel({ title, subtitle, children, className = '', right }: { title: string; subtitle: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{right}</div>{children}</section>
}

function StandingsTable({ standings, changes }: { standings: Standing[]; changes?: Map<string, { oldPosition: number; newPosition: number; pointsGained: number; goalDifferenceChange: number }> }) {
  if (!standings.length) return <EmptyState title="No standings to show" detail="Import match results to calculate the league table." />
  return <div className="table-scroll"><table className="data-table"><thead><tr><th className="left"># / CLUB</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>PTS</th><th>FORM</th>{changes && <><th>POS Δ</th><th>PTS Δ</th><th>GD Δ</th></>}</tr></thead><tbody>{standings.map((row) => {
      const change = changes?.get(row.team.id)
      return <tr key={row.team.id}><td className="club-cell"><span className={`position ${row.position <= 4 ? 'qualified' : ''}`}>{row.position.toString().padStart(2, '0')}</span><Crest team={row.team} /><b>{row.team.name}</b></td>
        <td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td className={row.goalDifference > 0 ? 'positive' : row.goalDifference < 0 ? 'negative' : ''}>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td><td><b>{row.points}</b></td>
        <td><FormDots form={row.form} />{row.form.length === 0 && <span className="dim">—</span>}</td>
        {changes && <><td><ChangeBadge value={change ? change.oldPosition - change.newPosition : 0} /></td><td><NumericDelta value={change?.pointsGained ?? 0} /></td><td><NumericDelta value={change?.goalDifferenceChange ?? 0} /></td></>}
      </tr>
    })}</tbody></table></div>
}

function Crest({ team }: { team: Team }) {
  return team.crest ? <img className="team-crest" src={team.crest} alt="" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <span className="team-crest crest-placeholder">{team.name.slice(0, 1)}</span>
}
function FormDots({ form }: { form: string }) {
  return <span className="form-dots">{form.split('').map((result, index) => <i key={`${result}${index}`} className={`form-${result}`} title={result === 'W' ? 'Win' : result === 'D' ? 'Draw' : 'Loss'} />)}</span>
}
function ChangeBadge({ value }: { value: number }) {
  if (!value) return <span className="change-flat">—</span>
  return <span className={`change-badge ${value > 0 ? 'up' : 'down'}`}>{value > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(value)}</span>
}
function NumericDelta({ value }: { value: number }) {
  return <span className={`numeric-delta ${value > 0 ? 'up' : value < 0 ? 'down' : ''}`}>{value > 0 ? `+${value}` : value || '—'}</span>
}

function TablePage({ standings }: { standings: Standing[] }) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'points' | 'goalDifference' | 'goalsFor'>('points')
  const filtered = useMemo(() => standings.filter((row) => row.team.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b[sortBy] - a[sortBy] || b.points - a.points || b.goalDifference - a.goalDifference), [standings, search, sortBy])
  return <><PageHeading eyebrow="LEAGUE DATA" title="League table" description="Full standings, form and goal difference. Tie-breaks: points, goal difference, goals scored." />
    <div className="toolbar"><label className="search-box"><input placeholder="Search clubs..." value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="select-label">Rank by <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}><option value="points">Points</option><option value="goalDifference">Goal difference</option><option value="goalsFor">Goals scored</option></select></label>
    </div><Panel title="League standings" subtitle={`${filtered.length} teams · computed from finished matches`}><StandingsTable standings={filtered} /></Panel>
  </>
}

function FixturesPage({ matches }: { matches: Match[] }) {
  const [matchday, setMatchday] = useState('all')
  const [status, setStatus] = useState('all')
  const days = [...new Set(matches.map((match) => match.matchday))].sort((a, b) => a - b)
  const filtered = matches.filter((match) => (matchday === 'all' || String(match.matchday) === matchday) && (status === 'all' || (status === 'finished' ? match.status === 'FINISHED' : match.status !== 'FINISHED')))
  return <><PageHeading eyebrow="MATCH CENTER" title="Fixtures & results" description="Browse completed scores and scheduled kick-offs by matchday." />
    <div className="toolbar"><label className="select-label"><CalendarDays size={15} /> Matchday <select value={matchday} onChange={(event) => setMatchday(event.target.value)}><option value="all">All matchdays</option>{days.map((day) => <option key={day} value={day}>Matchday {day}</option>)}</select></label>
      <label className="select-label">Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All matches</option><option value="finished">Completed</option><option value="upcoming">Upcoming</option></select></label><span className="result-count">{filtered.length} matches</span>
    </div><Panel title="Match schedule" subtitle="Sorted by kick-off time"><div className="fixtures-list">{filtered.map((match) => <FixtureRow match={match} key={match.id} expanded />)}{!filtered.length && <EmptyState title="No fixtures match these filters" detail="Try another matchday or status." />}</div></Panel>
  </>
}

function FixtureRow({ match, expanded = false }: { match: Match; expanded?: boolean }) {
  const date = new Date(match.date)
  const isFinished = match.status === 'FINISHED'
  return <div className={`fixture-row ${expanded ? 'fixture-expanded' : ''}`}><div className="fixture-date"><b>{date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}</b><small>{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small></div>
    <div className="fixture-teams"><div><Crest team={match.homeTeam} /><span>{match.homeTeam.name}</span></div><div><Crest team={match.awayTeam} /><span>{match.awayTeam.name}</span></div></div>
    <div className="fixture-score"><b>{match.homeGoals ?? '—'} <span>:</span> {match.awayGoals ?? '—'}</b><small className={isFinished ? 'finished-status' : ''}>{isFinished ? 'FT' : match.status.replace('_', ' ')}</small></div>
    {expanded && <span className="matchday-tag">MD {match.matchday}</span>}
  </div>
}

function TeamDNAPage({ teams }: { teams: Team[] }) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '')
  const activeId = teams.some((team) => team.id === teamId) ? teamId : teams[0]?.id ?? ''
  const { data, loading, error } = useQuery<{ teamDNA: DNA }>(TEAM_DNA_QUERY, { variables: { teamId: activeId }, skip: !activeId })
  const dna = data?.teamDNA
  const chart = dna ? [{ metric: 'Goals / match', value: dna.goalsPerMatch }, { metric: 'Conceded / match', value: dna.concededPerMatch }] : []
  return <><PageHeading eyebrow="TEAM PROFILE" title="Team DNA" description="Understand the shape of a club: where they earn points and how they score." />
    <div className="toolbar"><label className="select-label"><Users size={15} /> Club <select value={activeId} onChange={(event) => setTeamId(event.target.value)}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>{loading && <span className="muted-copy">Loading team profile…</span>}</div>
    {error ? <ErrorState error={errorMessage(error)} /> : dna ? <div className="dna-grid">
      <Panel title={dna.team.name} subtitle="Performance profile"><div className="dna-scoreline"><div><span>HOME RECORD</span><b>{dna.homePoints}<small> pts</small></b><small>{dna.homePlayed} matches</small></div><div className="dna-divider" /><div><span>AWAY RECORD</span><b>{dna.awayPoints}<small> pts</small></b><small>{dna.awayPlayed} matches</small></div></div>
        <div className="dna-metrics"><Metric label="Attack index" value={dna.attackIndex.toFixed(2)} suffix="goals / game" /><Metric label="Defence index" value={dna.defenceIndex.toFixed(2)} suffix="conceded / game" /><Metric label="Recent form" value={dna.form || '—'} suffix="last five" /></div><div className="form-large"><span>RECENT FORM</span><FormDots form={dna.form} /></div>
      </Panel>
      <Panel title="Goals per match" subtitle="Scoring and concession averages"><div className="chart-wrap dna-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} layout="vertical" margin={{ top: 6, right: 16, left: 4, bottom: 4 }}><CartesianGrid stroke="#25313d" horizontal={false} /><XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: '#8795a4', fontSize: 11 }} /><YAxis type="category" dataKey="metric" axisLine={false} tickLine={false} tick={{ fill: '#bcc6d0', fontSize: 12 }} width={110} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="value" name="Per match" fill="#7de3a0" radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div><div className="mini-note">Indices use the team's actual finished-match records. No external or sample values are inferred.</div></Panel>
    </div> : <EmptyState title="No teams available" detail="Synchronize a Premier League season to start team analysis." />}
  </>
}

function Metric({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return <div className="metric"><span>{label}</span><b>{value}</b><small>{suffix}</small></div>
}

function MatchupPage({ teams }: { teams: Team[] }) {
  const [teamA, setTeamA] = useState(teams[0]?.id ?? '')
  const [teamB, setTeamB] = useState(teams[1]?.id ?? '')
  const selectionA = teams.some((team) => team.id === teamA) ? teamA : teams[0]?.id ?? ''
  const selectionB = teams.some((team) => team.id === teamB) ? teamB : teams[1]?.id ?? ''
  const { data, loading, error } = useQuery<{ compareTeams: { teamA: DNA; teamB: DNA; meetings: number; winsA: number; winsB: number; draws: number; goalsA: number; goalsB: number } }>(
    COMPARE_QUERY, { variables: { teamA: selectionA, teamB: selectionB }, skip: !selectionA || !selectionB || selectionA === selectionB },
  )
  const comparison = data?.compareTeams
  const radarMetrics = comparison ? [
    { metric: 'Goals / game', [comparison.teamA.team.name]: comparison.teamA.goalsPerMatch, [comparison.teamB.team.name]: comparison.teamB.goalsPerMatch },
    { metric: 'Home pts', [comparison.teamA.team.name]: comparison.teamA.homePoints, [comparison.teamB.team.name]: comparison.teamB.homePoints },
    { metric: 'Away pts', [comparison.teamA.team.name]: comparison.teamA.awayPoints, [comparison.teamB.team.name]: comparison.teamB.awayPoints },
  ] : []
  return <><PageHeading eyebrow="HEAD-TO-HEAD" title="Matchup lab" description="Compare season metrics and head-to-head meetings for any two teams." />
    <div className="toolbar matchup-controls"><label className="select-label">Team A <select value={selectionA} onChange={(event) => setTeamA(event.target.value)}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><span className="vs-mark">VS</span><label className="select-label">Team B <select value={selectionB} onChange={(event) => setTeamB(event.target.value)}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><span className="muted-copy">{loading ? 'Comparing…' : ''}</span></div>
    {error ? <ErrorState error={errorMessage(error)} /> : comparison ? <div className="dashboard-grid matchup-grid">
      <Panel className="h2h-panel" title="Head-to-head record" subtitle={`${comparison.meetings} completed meetings in this dataset`}><div className="h2h-score"><div><Crest team={comparison.teamA.team} /><b>{comparison.winsA}</b><span>{comparison.teamA.team.name}</span></div><div className="h2h-draws"><b>{comparison.draws}</b><span>draws</span></div><div><Crest team={comparison.teamB.team} /><b>{comparison.winsB}</b><span>{comparison.teamB.team.name}</span></div></div><div className="h2h-goals"><span>Goals scored across meetings</span><b>{comparison.goalsA} <i>—</i> {comparison.goalsB}</b></div></Panel>
      <Panel title="Performance comparison" subtitle="Season-to-date metrics"><div className="chart-wrap matchup-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={radarMetrics} margin={{ top: 10, right: 5, left: -18, bottom: 0 }}><CartesianGrid stroke="#25313d" vertical={false} /><XAxis dataKey="metric" axisLine={false} tickLine={false} tick={{ fill: '#9aa7b5', fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#758393', fontSize: 10 }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey={comparison.teamA.team.name} fill="#7de3a0" radius={[4, 4, 0, 0]} /><Bar dataKey={comparison.teamB.team.name} fill="#75a9ed" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
      <Panel title="Season profile" subtitle="Home and away points with goals per match" className="wide-panel"><div className="two-team-cards">{[comparison.teamA, comparison.teamB].map((dna) => <div className="team-profile-card" key={dna.team.id}><div className="team-profile-head"><Crest team={dna.team} /><b>{dna.team.name}</b><FormDots form={dna.form} /></div><div className="team-profile-stats"><span>Home <b>{dna.homePoints} pts</b></span><span>Away <b>{dna.awayPoints} pts</b></span><span>Goals/game <b>{dna.goalsPerMatch.toFixed(2)}</b></span><span>Conceded <b>{dna.concededPerMatch.toFixed(2)}</b></span></div></div>)}</div></Panel>
    </div> : <EmptyState title={teams.length < 2 ? 'Not enough teams to compare' : 'Choose two different teams'} detail="Team matchup requires two distinct teams with loaded data." />}
  </>
}

function WhatIfPage({ matches, setNotice }: { matches: Match[]; setNotice: (message: string) => void }) {
  const fixtures = matches.filter((match) => match.status !== 'FINISHED')
  const [selectedMatch, setSelectedMatch] = useState(fixtures[0]?.id ?? '')
  const [homeGoals, setHomeGoals] = useState(1)
  const [awayGoals, setAwayGoals] = useState(0)
  const [result, setResult] = useState<{ table: Standing[]; changes: Array<{ team: Team; oldPosition: number; newPosition: number; pointsGained: number; goalDifferenceChange: number }> } | null>(null)
  const [runSimulation, state] = useMutation<WhatIfData, { outcomes: Array<{ matchId: string; homeGoals: number; awayGoals: number }> }>(WHAT_IF, {
    onCompleted: (response) => { setResult(response.whatIf); setNotice('What-if results are isolated. Official match results and standings remain unchanged.') },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const updateGoal = (setter: (value: number) => void) => (event: ChangeEvent<HTMLInputElement>) => setter(Math.max(0, Math.min(30, Number(event.target.value) || 0)))
  const changes = result ? new Map(result.changes.map((change) => [change.team.id, change])) : undefined
  const affected = result?.changes.filter((change) => change.pointsGained !== 0 || change.goalDifferenceChange !== 0) ?? []
  return <><PageHeading eyebrow="SANDBOX · NO REAL RESULTS CHANGED" title="What-if simulator" description="Explore hypothetical outcomes and see how the full league table shifts. Simulated scores stay separate." />
    <div className="simulator-layout"><Panel className="sim-form-panel" title="Set a hypothetical result" subtitle="Only unfinished fixtures can be simulated.">
      {fixtures.length ? <><label className="field-label">Fixture<select value={selectedMatch} onChange={(event) => setSelectedMatch(event.target.value)}>{fixtures.map((match) => <option key={match.id} value={match.id}>MD {match.matchday} · {match.homeTeam.name} vs {match.awayTeam.name}</option>)}</select></label>
        {(() => { const match = fixtures.find((candidate) => candidate.id === selectedMatch); return match ? <div className="score-inputs"><div><span>{match.homeTeam.name}</span><input aria-label={`${match.homeTeam.name} goals`} type="number" min={0} max={30} value={homeGoals} onChange={updateGoal(setHomeGoals)} /></div><b>:</b><div><span>{match.awayTeam.name}</span><input aria-label={`${match.awayTeam.name} goals`} type="number" min={0} max={30} value={awayGoals} onChange={updateGoal(setAwayGoals)} /></div></div> : null })()}
        <button className="primary-button full-button" disabled={!selectedMatch || state.loading} onClick={() => { setResult(null); void runSimulation({ variables: { outcomes: [{ matchId: selectedMatch, homeGoals, awayGoals }] } }) }}><Sparkles size={16} /> {state.loading ? 'Calculating…' : 'Apply hypothetical score'} <ArrowRight size={15} /></button>
      </> : <EmptyState title="No unfinished fixtures" detail="No unplayed provider fixtures are available to simulate." />}
      <div className="sim-warning"><Shield size={15} /><span>Sandbox only. Results are never written to the league data.</span></div>
    </Panel>
    <Panel className="sim-table-panel" title={result ? 'Simulated standings' : 'Position impact'} subtitle={result ? 'Recalculated table · simulated results in memory only' : 'Run a scenario to see points and position changes.'}>
      {result ? <><div className="change-summary"><span><b>{affected.length}</b> clubs affected</span><span>Position, points & goal difference updated</span></div><StandingsTable standings={result.table} changes={changes} /></> : <div className="impact-placeholder"><div><SlidersHorizontal size={21} /></div><b>Ready for your scenario</b><span>Choose a fixture, set a score and recalculate the entire table.</span></div>}
    </Panel></div>
  </>
}

function SeasonPage() {
  const [iterations, setIterations] = useState(1000)
  const [predictions, setPredictions] = useState<Array<{ team: Team; averagePosition: number; topFourProbability: number; expectedPoints: number }> | null>(null)
  const [simulationError, setSimulationError] = useState('')
  const [runSimulation, state] = useMutation<SeasonData, { iterations: number }>(SEASON_SIM, {
    onCompleted: (result) => { setPredictions(result.simulateSeason); setSimulationError('') },
    onError: (error) => { setPredictions(null); setSimulationError(errorMessage(error)) },
  })
  const chart = predictions?.map((prediction) => ({ team: prediction.team.name, probability: +(prediction.topFourProbability * 100).toFixed(1) })) ?? []
  return <>
    <PageHeading eyebrow="PREDICTIONS · NOT RESULTS" title="Season forecast" description="Explore a probabilistic finish projection based on observed scoring rates and a Poisson goal model." />
    <div className="season-explainer"><Sparkles size={16} /><span>Each remaining fixture is sampled from Poisson goal distributions. Attack and defence rates are smoothed toward the league average; home advantage is modest. This is an illustrative prediction, not a guarantee.</span></div>
    <Panel title="Monte Carlo season simulation" subtitle="Finished matches stay fixed; unfinished fixtures are simulated separately">
      <div className="benchmark-controls"><label className="select-label">Simulation runs <select value={iterations} onChange={(event) => setIterations(Number(event.target.value))}><option value={250}>250 runs</option><option value={1000}>1,000 runs</option><option value={5000}>5,000 runs</option><option value={10000}>10,000 runs</option></select></label><button className="primary-button" disabled={state.loading} onClick={() => { setPredictions(null); void runSimulation({ variables: { iterations } }) }}><Sparkles size={16} />{state.loading ? 'Simulating…' : 'Run forecast'}</button></div>
      {simulationError && <ErrorState error={simulationError} />}
      {predictions ? <div className="season-results">
        <div className="forecast-chart"><div className="section-caption">TOP-FOUR PROBABILITY</div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}><CartesianGrid stroke="#25313d" vertical={false} /><XAxis dataKey="team" axisLine={false} tickLine={false} tick={{ fill: '#9aa7b5', fontSize: 11 }} /><YAxis domain={[0, 100]} unit="%" axisLine={false} tickLine={false} tick={{ fill: '#758393', fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, 'Top four']} /><Bar dataKey="probability" name="Top four chance" fill="#7de3a0" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th className="left">PROJECTED CLUB</th><th>AVG POSITION</th><th>TOP FOUR</th><th>EXPECTED PTS</th></tr></thead><tbody>{predictions.map((row, index) => <tr key={row.team.id}><td className="club-cell"><span className={`position ${index < 4 ? 'qualified' : ''}`}>{String(index + 1).padStart(2, '0')}</span><Crest team={row.team} /><b>{row.team.name}</b></td><td>{row.averagePosition.toFixed(2)}</td><td><b>{(row.topFourProbability * 100).toFixed(1)}%</b></td><td>{row.expectedPoints.toFixed(1)}</td></tr>)}</tbody></table></div>
      </div> : <div className="benchmark-empty"><div><Sparkles size={20} /></div><span>Run a forecast to estimate final positions and top-four probabilities. No projected values are fabricated or saved as official standings.</span></div>}
    </Panel>
  </>
}

function ScorersPage({ scorers, warnings }: { scorers: DashboardData['scorers']; warnings: string[] }) {
  return <>  <PageHeading eyebrow="PLAYER PERFORMANCE" title="Top scorers" description="Provider-reported goal totals when available for the selected season." />
    <Panel title="Golden boot race" subtitle="Ranked by goals scored"><div className="table-scroll"><table className="data-table scorer-table"><thead><tr><th className="left"># / PLAYER</th><th className="left">CLUB</th><th>GOALS</th><th>PENALTIES</th></tr></thead><tbody>{scorers.map((scorer, index) => <tr key={`${scorer.player}-${scorer.team.id}`}><td className="club-cell"><span className={`position ${index < 3 ? 'qualified' : ''}`}>{String(index + 1).padStart(2, '0')}</span><span className="player-avatar">{scorer.player.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span><b>{scorer.player}</b></td><td className="left">{scorer.team.name}</td><td><b>{scorer.goals}</b></td><td>{scorer.penalties}</td></tr>)}</tbody></table>{!scorers.length && <EmptyState title="No scorer records available" detail={warnings.join(' ') || 'The provider returned no scorer totals for this season or API plan. No player statistics are invented.'} />}</div></Panel>
  </>
}

function DatabasePage({ health, setNotice, refetch }: { health: DashboardData['dataHealth']; setNotice: (message: string) => void; refetch: () => Promise<unknown> }) {
  const [iterations, setIterations] = useState(30)
  const [syncSeason, setSyncSeason] = useState(String(health.seasonYear ?? new Date().getFullYear()))
  const [result, setResult] = useState<{ metrics: Array<{ database: string; query: string; iterations: number; totalMs: number; averageMs: number; minMs: number; maxMs: number }>; unavailable: string[] } | null>(null)
  const [fileName, setFileName] = useState('')
  const [importCsv, importState] = useMutation<ImportData, { csv: string }>(IMPORT_CSV, {
    onCompleted: (response) => { setNotice(response.importCsv.message); void refetch() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const [benchmark, benchState] = useLazyQuery<BenchmarkData, { iterations: number }>(BENCHMARK)
  const [sync, syncState] = useMutation<SyncData, { season: number }>(SYNC, {
    onCompleted: (response) => { setNotice(`Loaded ${response.syncFootballData.fetched} fixtures from ${response.syncFootballData.source}.`); void refetch() },
    onError: (error) => setNotice(errorMessage(error)),
  })
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    try {
      const csv = await file.text()
      await importCsv({ variables: { csv } })
    } catch (error) {
      setNotice(errorMessage(error))
    } finally {
      event.target.value = ''
    }
  }
  return <><PageHeading eyebrow="DATA & PERFORMANCE" title="Database lab" description="Inspect data sources, import match CSV and benchmark real query latency." />
    <div className="database-grid">
      <Panel title="Data connections" subtitle="Current backend health"><div className="connection-list">
        <div><span className="db-icon oracle-icon"><Database size={17} /></span><span><b>Oracle Database</b><small>{health.storageMode === 'oracle' ? 'Authoritative structured results' : 'Not selected · Oracle persistence not verified'}</small></span><span className={`status-label ${health.storageMode === 'oracle' ? 'status-good' : 'status-warning'}`}><i />{health.storageMode === 'oracle' ? 'CONNECTED' : 'NOT SELECTED'}</span></div>
        <div><span className="db-icon mongo-icon"><Database size={17} /></span><span><b>MongoDB</b><small>Season snapshots, cache & simulation history</small></span><span className={`status-label ${health.mongo === 'connected' ? 'status-good' : 'status-warning'}`}><i />{health.mongo.toUpperCase()}</span></div>
        <div><span className="db-icon api-icon"><Activity size={17} /></span><span><b>football-data.org v4</b><small>{health.apiConfigured ? 'API token configured on the backend' : 'Sync unavailable · CSV supplements require a loaded season'}</small></span><span className={`status-label ${health.apiConfigured ? 'status-good' : 'status-warning'}`}><i />{health.apiConfigured ? 'READY' : 'NO KEY'}</span></div>
      </div><div className="mini-note"><CircleHelp size={14} />{health.storageMode === 'oracle' ? 'Oracle stores structured results; MongoDB stores provider snapshots, cache, events and simulations.' : 'The active provider snapshot is stored in MongoDB. Oracle structured-result persistence requires STORAGE_MODE=oracle and a reachable Oracle instance.'}</div></Panel>
      <Panel title="Import match CSV" subtitle="Validated, duplicate-checked and parameter-bound on the server"><label className="upload-zone"><input type="file" accept=".csv,text/csv" onChange={(event) => void handleFile(event)} /><span className="upload-icon"><FileUp size={20} /></span><b>{importState.loading ? 'Importing…' : fileName || 'Choose a CSV file'}</b><small>CSV · max 1.5 MB · required: matchday, date, homeTeam, awayTeam, homeGoals, awayGoals, status</small><span className="upload-button">{importState.loading ? 'Please wait' : 'Browse files'}</span></label></Panel>
    </div>
    <Panel title="Query benchmark" subtitle="Repeatable measurements from the connected database services" className="benchmark-panel" right={<span className="measured-label"><Activity size={14} /> Live measurements · no fabricated results</span>}>
      <div className="benchmark-controls"><label className="select-label">Iterations <select value={iterations} onChange={(event) => setIterations(Number(event.target.value))}>{[10, 30, 50, 100, 200].map((count) => <option key={count} value={count}>{count} runs</option>)}</select></label><button className="primary-button" disabled={benchState.loading} onClick={() => { setResult(null); void benchmark({ variables: { iterations } }).then((response) => { if (response.data) setResult(response.data.benchmark) }).catch((error: unknown) => setNotice(errorMessage(error))) }}><BarChart3 size={16} />{benchState.loading ? 'Running benchmark…' : 'Run benchmark'}</button></div>
      {result ? <><div className="benchmark-metrics">{result.metrics.map((metric) => <div className="benchmark-card" key={metric.database}><div><span className={`benchmark-dot ${metric.database.includes('Mongo') ? 'mongo-dot' : ''}`} /><b>{metric.database}</b></div><small>{metric.query} · {metric.iterations} iterations</small><strong>{metric.averageMs.toFixed(3)}<small> ms avg</small></strong><div className="benchmark-range"><span>Min {metric.minMs.toFixed(3)} ms</span><span>Max {metric.maxMs.toFixed(3)} ms</span></div></div>)}</div>
        {!!result.unavailable.length && <div className="unavailable-list">{result.unavailable.map((item) => <p key={item}>{item}</p>)}</div>}
        {result.metrics.length > 1 && <div className="benchmark-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={result.metrics} margin={{ top: 6, right: 12, left: -16, bottom: 0 }}><CartesianGrid stroke="#25313d" vertical={false} /><XAxis dataKey="database" axisLine={false} tickLine={false} tick={{ fill: '#9aa7b5', fontSize: 12 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#758393', fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} /><Bar dataKey="averageMs" name="Average latency (ms)" fill="#7de3a0" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>}
      </> : <div className="benchmark-empty"><div><Activity size={20} /></div><span>Run the benchmark to measure query latency against your active database connections.</span></div>}
    </Panel>
    <Panel title="MongoDB records" subtitle="Persisted collection counts and indexes verified from the connected database">
      {health.mongoCollections.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th className="left">COLLECTION</th><th>DOCUMENTS</th><th className="left">INDEXES</th></tr></thead><tbody>{health.mongoCollections.map((collection) => <tr key={collection.name}><td className="left"><b>{collection.name}</b></td><td>{collection.documents}</td><td className="left">{collection.indexes.join(', ')}</td></tr>)}</tbody></table></div> : <EmptyState title="MongoDB diagnostics unavailable" detail={health.mongo} />}</Panel>
    <Panel title="Manual data synchronization" subtitle="Historical access depends on the football-data.org plan" className="sync-panel">
      <div className="sync-row"><div><b>football-data.org · Premier League (PL)</b><small>{health.lastSyncedAt ? `Last successful sync ${new Date(health.lastSyncedAt).toLocaleString()}` : 'No successful provider sync recorded'} · API errors and plan restrictions are shown directly</small></div><div className="benchmark-controls"><label className="select-label">Season start year <input className="season-year-input" type="number" min="1992" max="2100" step="1" value={syncSeason} onChange={(event) => setSyncSeason(event.target.value)} /></label><button className="secondary-button" disabled={!health.apiConfigured || syncState.loading || !/^(199[2-9]|20\d{2}|2100)$/.test(syncSeason)} onClick={() => void sync({ variables: { season: Number(syncSeason) } })}><RefreshCw size={15} />{syncState.loading ? 'Syncing…' : 'Sync season'}</button></div></div>
      {health.providerWarnings.map((warning) => <p className="unavailable-list" key={warning}>{warning}</p>)}
    </Panel>
  </>
}

function LoadingState() {
  return <div className="loading-state" role="status"><span className="loader" /><b>Connecting to PitchIQ</b><span>Loading the league dataset…</span></div>
}
function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <div className="error-state"><div><X size={19} /></div><b>Unable to load data</b><span>{error}</span>{onRetry && <button className="secondary-button" onClick={onRetry}>Retry</button>}</div>
}
function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><div><Activity size={18} /></div><b>{title}</b><span>{detail}</span></div>
}
