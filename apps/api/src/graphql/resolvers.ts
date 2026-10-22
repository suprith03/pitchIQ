import { GraphQLError } from 'graphql'
import { z } from 'zod'
import { calculateStandings } from '../domain/standings.js'
import { simulateResults, simulateSeason } from '../domain/simulation.js'
import type { Match, Standing, Team } from '../domain/types.js'
import { parseCsvMatches } from '../repositories/csv-import.js'
import type { FootballRepository } from '../repositories/football-repository.js'
import type { FootballDataProvider, ProviderSeasonSnapshot } from '../providers/football-data.js'
import type { MongoService } from '../services/mongo-service.js'
import type { OracleRepository } from '../repositories/oracle-repository.js'
import { matchFixtureKey, ProviderCacheRepository } from '../repositories/provider-cache-repository.js'

export interface GraphContext {
  repository: FootballRepository
  providerRepository: ProviderCacheRepository
  mongo: MongoService
  provider: FootballDataProvider
  oracle: OracleRepository | null
  lastSyncedAt: string | null
  dataSource: string
  syncError: string | null
  activeSnapshot: ProviderSeasonSnapshot | null
  benchmarkIterations: number
}

const inputScore = z.number().int().min(0).max(30)
const idInput = z.string().min(1).max(128)

function fail(message: string, code = 'BAD_USER_INPUT'): never {
  throw new GraphQLError(message, { extensions: { code } })
}

function requireTeam(teams: Team[], id: string): Team {
  const team = teams.find((candidate) => candidate.id === id)
  if (!team) return fail(`Team "${id}" was not found.`, 'NOT_FOUND')
  return team
}

function validateTeamId(id: string): string {
  const parsed = idInput.safeParse(id)
  if (!parsed.success) return fail('A valid team id is required.')
  return parsed.data
}

function makeTeamDNA(team: Team, matches: Match[], standings: Standing[]) {
  const home = matches.filter((m) => m.homeTeam.id === team.id && m.status === 'FINISHED' && m.homeGoals !== null && m.awayGoals !== null)
  const away = matches.filter((m) => m.awayTeam.id === team.id && m.status === 'FINISHED' && m.homeGoals !== null && m.awayGoals !== null)
  const scored = [...home.map((m) => m.homeGoals ?? 0), ...away.map((m) => m.awayGoals ?? 0)]
  const conceded = [...home.map((m) => m.awayGoals ?? 0), ...away.map((m) => m.homeGoals ?? 0)]
  const standing = standings.find((row) => row.team.id === team.id)
  const pointsFor = (match: Match, isHome: boolean) => {
    const own = isHome ? match.homeGoals ?? 0 : match.awayGoals ?? 0
    const opponent = isHome ? match.awayGoals ?? 0 : match.homeGoals ?? 0
    return own > opponent ? 3 : own === opponent ? 1 : 0
  }
  const homePoints = home.reduce((sum, match) => sum + pointsFor(match, true), 0)
  const awayPoints = away.reduce((sum, match) => sum + pointsFor(match, false), 0)
  const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  return {
    team,
    homePlayed: home.length,
    homePoints,
    awayPlayed: away.length,
    awayPoints,
    goalsPerMatch: avg(scored),
    concededPerMatch: avg(conceded),
    attackIndex: standing?.played ? standing.goalsFor / standing.played : 0,
    defenceIndex: standing?.played ? standing.goalsAgainst / standing.played : 0,
    form: standing?.form ?? '',
  }
}

export function createResolvers() {
  return {
    Query: {
      teams: (_: unknown, __: unknown, { repository }: GraphContext) => repository.getTeams(),
      standings: (_: unknown, __: unknown, { repository }: GraphContext) => repository.getStandings(),
      matches: async (_: unknown, args: { status?: string; matchday?: number }, { repository }: GraphContext) => {
        let matches = await repository.getMatches()
        if (args.status) {
          const status = args.status.toUpperCase()
          if (!['FINISHED', 'SCHEDULED', 'TIMED', 'IN_PLAY', 'POSTPONED'].includes(status)) fail(`Unsupported match status "${args.status}".`)
          matches = matches.filter((match) => match.status === status)
        }
        if (args.matchday !== undefined) matches = matches.filter((match) => match.matchday === args.matchday)
        return matches
      },
      scorers: async (_: unknown, __: unknown, context: GraphContext) => {
        if (context.providerRepository.lastSyncedAt) return context.providerRepository.getScorers()
        if (!context.activeSnapshot) return context.repository.getScorers()
        const activeSnapshot = context.activeSnapshot
        const teams = new Map(activeSnapshot.teams.map((team) => [String(team.id), {
          id: String(team.id), name: team.name, crest: team.crest ?? null,
        }]))
        return activeSnapshot.scorers.flatMap((scorer) => {
          const team = teams.get(String(scorer.team.id))
          return team ? [{ player: scorer.player.name, team, goals: scorer.goals, penalties: scorer.penalties ?? 0 }] : []
        })
      },
      teamDNA: async (_: unknown, { teamId }: { teamId: string }, { repository }: GraphContext) => {
        validateTeamId(teamId)
        const [teams, matches, standings] = await Promise.all([repository.getTeams(), repository.getMatches(), repository.getStandings()])
        return makeTeamDNA(requireTeam(teams, teamId), matches, standings)
      },
      compareTeams: async (_: unknown, { teamA, teamB }: { teamA: string; teamB: string }, { repository }: GraphContext) => {
        validateTeamId(teamA)
        validateTeamId(teamB)
        if (teamA === teamB) fail('Choose two different teams.')
        const [teams, matches, standings] = await Promise.all([repository.getTeams(), repository.getMatches(), repository.getStandings()])
        const a = requireTeam(teams, teamA)
        const b = requireTeam(teams, teamB)
        const meetings = matches.filter((m) => m.status === 'FINISHED' &&
          ((m.homeTeam.id === teamA && m.awayTeam.id === teamB) || (m.homeTeam.id === teamB && m.awayTeam.id === teamA)))
        let winsA = 0
        let winsB = 0
        let goalsA = 0
        let goalsB = 0
        let draws = 0
        for (const match of meetings) {
          const aGoals = match.homeTeam.id === teamA ? match.homeGoals ?? 0 : match.awayGoals ?? 0
          const bGoals = match.homeTeam.id === teamB ? match.homeGoals ?? 0 : match.awayGoals ?? 0
          goalsA += aGoals
          goalsB += bGoals
          if (aGoals > bGoals) winsA++
          else if (bGoals > aGoals) winsB++
          else draws++
        }
        return {
          teamA: makeTeamDNA(a, matches, standings), teamB: makeTeamDNA(b, matches, standings),
          meetings: meetings.length, winsA, winsB, draws, goalsA, goalsB,
        }
      },
      dataHealth: async (_: unknown, __: unknown, context: GraphContext) => ({
        storageMode: context.repository.mode,
        source: context.providerRepository.lastSyncedAt
          ? context.providerRepository.source
          : context.repository.mode === 'provider-cache' ? context.providerRepository.source : context.dataSource,
        mongo: context.mongo.status,
        apiConfigured: context.provider.configured,
        lastSyncedAt: context.providerRepository.lastSyncedAt ?? context.lastSyncedAt,
        seasonYear: context.providerRepository.seasonYear,
        syncError: context.repository.mode === 'provider-cache' ? context.providerRepository.syncError : context.syncError,
        providerWarnings: context.providerRepository.warnings,
        mongoCollections: (await context.mongo.diagnostics())?.collections ?? [],
      }),
      benchmark: async (_: unknown, { iterations }: { iterations?: number }, context: GraphContext) => {
        const count = iterations ?? context.benchmarkIterations
        if (!Number.isInteger(count) || count < 1 || count > 200) fail('Benchmark iterations must be between 1 and 200.')
        const metrics: Array<{ database: string; query: string; iterations: number; totalMs: number; averageMs: number; minMs: number; maxMs: number }> = []
        const unavailable: string[] = []
        if (!context.oracle) unavailable.push('Oracle SQL benchmark unavailable: STORAGE_MODE is not oracle or Oracle is not configured.')
        else {
          const times: number[] = []
          for (let i = 0; i < count; i++) {
            const started = performance.now()
            await context.oracle.benchmarkStandings()
            times.push(performance.now() - started)
          }
          metrics.push(metric('Oracle SQL', 'Read standings', times))
        }
        const mongo = await context.mongo.benchmark(count)
        if (mongo) metrics.push({ database: 'MongoDB', query: 'Find API cache entries (limit 100)', ...mongo })
        else unavailable.push('MongoDB benchmark unavailable: MongoDB is not connected.')
        return { metrics, unavailable }
      },
    },
    Mutation: {
      importCsv: async (_: unknown, { csv }: { csv: string }, context: GraphContext) => {
        if (csv.length > 1_500_000) fail('CSV file exceeds the 1.5 MB import limit.')
        try {
          const inputs = parseCsvMatches(csv)
          const repository = context.repository
          if (repository.mode === 'provider-cache') {
            if (context.mongo.status !== 'connected') {
              fail('CSV imports in provider-cache mode require a connected MongoDB so imported fixtures survive restarts.', 'SERVICE_UNAVAILABLE')
            }
            const year = context.providerRepository.seasonYear
            if (year === null) fail('Sync a provider season before importing CSV fixtures.')
            const snapshot = context.activeSnapshot
            if (snapshot) {
              const seasonStart = Date.parse(snapshot.season.startDate)
              const seasonEnd = Date.parse(`${snapshot.season.endDate}T23:59:59.999Z`)
              const outOfSeason = inputs.find((input) => {
                const date = Date.parse(input.date)
                return date < seasonStart || date > seasonEnd
              })
              if (outOfSeason) fail(`CSV fixture ${outOfSeason.homeTeam} vs ${outOfSeason.awayTeam} is outside the active ${year} season.`)
            }
            const existing = await repository.getMatches()
            const existingKeys = new Set(existing.map(matchFixtureKey))
            const newInputs = inputs.filter((input) => !existingKeys.has(matchFixtureKey(input)))
            const saved = await context.mongo.saveImportedMatches(year, newInputs)
            if (saved !== newInputs.length) {
              fail(`MongoDB persisted ${saved} of ${newInputs.length} new CSV fixtures; no import was applied to the active dataset.`, 'SERVICE_UNAVAILABLE')
            }
          }
          const imported = await repository.importMatches(inputs)
          if (imported && repository.mode === 'provider-cache') {
            context.dataSource = `${context.dataSource.replace(/ · CSV supplements$/, '')} · CSV supplements`
            context.providerRepository.source = context.dataSource
          }
          return { imported, skipped: inputs.length - imported, message: `Imported ${imported} matches; skipped ${inputs.length - imported} duplicates.` }
        } catch (error) {
          if (error instanceof GraphQLError) throw error
          fail(error instanceof Error ? error.message : String(error))
        }
      },
      whatIf: async (_: unknown, { outcomes }: { outcomes: Array<{ matchId: string; homeGoals: number; awayGoals: number }> }, { repository }: GraphContext) => {
        try {
          for (const outcome of outcomes) {
            inputScore.parse(outcome.homeGoals)
            inputScore.parse(outcome.awayGoals)
          }
          const [teams, matches] = await Promise.all([repository.getTeams(), repository.getMatches()])
          return simulateResults(teams, matches, outcomes)
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error))
        }
      },
      simulateSeason: async (_: unknown, { iterations }: { iterations?: number }, { repository, mongo }: GraphContext) => {
        try {
          const [teams, matches] = await Promise.all([repository.getTeams(), repository.getMatches()])
          const predictions = simulateSeason(teams, matches, iterations ?? 1000)
          await mongo.saveSimulation({ iterations: iterations ?? 1000, predictions })
          return predictions
        } catch (error) {
          fail(error instanceof Error ? error.message : String(error), 'BAD_USER_INPUT')
        }
      },
      syncFootballData: async (_: unknown, { season }: { season?: number }, context: GraphContext) => {
        try {
          if (season !== undefined && (!Number.isInteger(season) || season < 1992 || season > 2100)) {
            fail('Season must be a four-digit start year between 1992 and 2100.')
          }
          let snapshot: ProviderSeasonSnapshot
          let source = 'football-data.org v4 · live'
          let persistenceWarning: string | null = null
          try {
            snapshot = await context.provider.getSeasonSnapshot(season)
            new ProviderCacheRepository().loadSnapshot(snapshot)
            const persisted = await context.mongo.saveSeasonSnapshot(snapshot)
            if (!persisted) {
              source = context.oracle
                ? 'football-data.org v4 · live (MongoDB snapshot unavailable)'
                : 'football-data.org v4 · live (MongoDB unavailable; session only)'
              persistenceWarning = context.oracle
                ? 'Structured matches were synchronized to Oracle, but the provider snapshot was not persisted to MongoDB.'
                : 'Provider data is available for this session, but MongoDB is unavailable; it will not survive a restart.'
            }
          } catch (providerError) {
            const cacheYear = season ?? (process.env.FOOTBALL_DATA_SEASON ? Number(process.env.FOOTBALL_DATA_SEASON) : undefined)
            const cached = cacheYear === undefined
              ? await context.mongo.getLatestSeasonSnapshot(process.env.FOOTBALL_DATA_COMPETITION ?? 'PL')
              : await context.mongo.getSeasonSnapshot(process.env.FOOTBALL_DATA_COMPETITION ?? 'PL', cacheYear)
            if (!cached) throw providerError
            snapshot = cached
            source = 'football-data.org v4 · persisted MongoDB snapshot'
          }
          const seasonYear = new Date(snapshot.season.startDate).getUTCFullYear()
          if (context.oracle && seasonYear !== snapshot.currentSeasonYear) {
            throw new Error('Historical-season synchronization to Oracle is disabled because the configured Oracle schema is not season-keyed. The fetched snapshot remains cached in MongoDB.')
          }
          context.providerRepository.loadSnapshot(snapshot, source)
          let imported = snapshot.matches.length
          if (context.oracle) {
            const inputs = snapshot.matches.map((match) => {
              if (match.matchday === null) throw new Error(`Provider match ${match.id} has no matchday; refusing to invent one for Oracle.`)
              return {
                matchday: match.matchday,
                date: new Date(match.utcDate).toISOString(),
                homeTeam: match.homeTeam.name,
                awayTeam: match.awayTeam.name,
                homeGoals: match.score.fullTime.home,
                awayGoals: match.score.fullTime.away,
                status: providerStatus(match.status),
              }
            })
            imported = await context.oracle.syncMatches(inputs)
          } else {
            const supplements = await context.mongo.getImportedMatches(seasonYear)
            await context.providerRepository.importMatches(supplements)
            context.repository = context.providerRepository
            if (supplements.length) source = `${source} · CSV supplements`
          }
          context.activeSnapshot = snapshot
          context.dataSource = source
          context.providerRepository.source = source
          context.syncError = persistenceWarning
          context.providerRepository.syncError = persistenceWarning
          const providerMatches = snapshot.matches
          await Promise.all(providerMatches
            .filter((match) => match.goals?.length)
            .map((match) => context.mongo.saveMatchEvents(String(match.id), match.goals ?? [])))
          context.lastSyncedAt = snapshot.syncedAt
          return { imported, fetched: snapshot.matches.length, source, syncedAt: snapshot.syncedAt }
        } catch (error) {
          context.syncError = error instanceof Error ? error.message : String(error)
          context.providerRepository.syncError = context.syncError
          fail(context.syncError, 'SERVICE_UNAVAILABLE')
        }
      },
    },
  }
}

function providerStatus(status: string): Match['status'] {
  if (status === 'FINISHED') return 'FINISHED'
  if (status === 'IN_PLAY' || status === 'PAUSED') return 'IN_PLAY'
  if (status === 'POSTPONED') return 'POSTPONED'
  return 'SCHEDULED'
}

function metric(database: string, query: string, times: number[]) {
  return {
    database,
    query,
    iterations: times.length,
    totalMs: times.reduce((sum, time) => sum + time, 0),
    averageMs: times.reduce((sum, time) => sum + time, 0) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
  }
}
