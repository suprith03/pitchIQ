import { calculateStandings } from '../domain/standings.js'
import type { CsvMatchInput, Match, Standing, Team } from '../domain/types.js'
import type { ProviderSeasonSnapshot } from '../providers/football-data.js'
import type { FootballRepository } from './football-repository.js'

export class ProviderCacheRepository implements FootballRepository {
  readonly mode = 'provider-cache' as const
  source = 'football-data.org v4'
  lastSyncedAt: string | null = null
  syncError: string | null = null
  seasonYear: number | null = null
  warnings: string[] = []
  private teams: Team[] = []
  private matches: Match[] = []
  private standings: Standing[] = []
  private scorers: Array<{ player: string; team: Team; goals: number; penalties: number }> = []

  loadSnapshot(snapshot: ProviderSeasonSnapshot, source = 'football-data.org v4'): void {
    const teams = new Map(snapshot.teams.map((team) => [team.id, {
      id: String(team.id), name: team.name, crest: team.crest ?? null,
    }]))
    if (teams.size !== snapshot.teams.length) throw new Error('Provider season contains duplicate team IDs.')
    if (teams.size !== 20) throw new Error(`Premier League snapshot must contain 20 teams; received ${teams.size}.`)
    this.teams = [...teams.values()]
    this.matches = snapshot.matches.map((match) => {
      const homeTeam = teams.get(match.homeTeam.id)
      const awayTeam = teams.get(match.awayTeam.id)
      if (!homeTeam || !awayTeam) {
        throw new Error(`Match ${match.id} references a team not present in the season team list.`)
      }
      if (!Number.isFinite(Date.parse(match.utcDate))) throw new Error(`Match ${match.id} has an invalid UTC date.`)
      if (match.matchday === null || !Number.isInteger(match.matchday) || match.matchday < 1) {
        throw new Error(`Premier League match ${match.id} has no valid matchday in the provider response.`)
      }
      const homeGoals = match.score.fullTime.home
      const awayGoals = match.score.fullTime.away
      if ((homeGoals === null) !== (awayGoals === null)) throw new Error(`Match ${match.id} has an incomplete full-time score.`)
      if (homeGoals !== null && (!Number.isInteger(homeGoals) || homeGoals < 0 || !Number.isInteger(awayGoals) || (awayGoals ?? -1) < 0)) {
        throw new Error(`Match ${match.id} has an invalid full-time score.`)
      }
      if (match.status === 'FINISHED' && homeGoals === null) throw new Error(`Finished match ${match.id} has no full-time score.`)
      return {
        id: String(match.id),
        matchday: match.matchday,
        date: new Date(match.utcDate).toISOString(),
        homeTeam,
        awayTeam,
        homeGoals,
        awayGoals,
        status: providerStatus(match.status),
      }
    })
    if (new Set(this.matches.map((match) => match.id)).size !== this.matches.length) {
      throw new Error('Provider season contains duplicate match IDs.')
    }
    this.standings = snapshot.standings.map((row) => {
      const team = teams.get(row.team.id)
      if (!team) throw new Error(`Standing references unknown provider team ${row.team.id}.`)
      return {
        position: row.position, team, played: row.playedGames, won: row.won, drawn: row.draw,
        lost: row.lost, goalsFor: row.goalsFor, goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference, points: row.points, form: row.form ?? '',
      }
    }).sort((a, b) => a.position - b.position)
    this.scorers = snapshot.scorers.map((scorer) => {
      const team = teams.get(scorer.team.id)
      if (!team) throw new Error(`Scorer references unknown provider team ${scorer.team.id}.`)
      return {
        player: scorer.player.name,
        team,
        goals: scorer.goals,
        penalties: scorer.penalties ?? 0,
      }
    })
    this.lastSyncedAt = snapshot.syncedAt
    this.seasonYear = new Date(snapshot.season.startDate).getUTCFullYear()
    this.warnings = [...snapshot.warnings]
    this.source = source
  }

  async getTeams(): Promise<Team[]> { return [...this.teams] }
  async getMatches(): Promise<Match[]> { return [...this.matches].sort((a, b) => a.date.localeCompare(b.date)) }
  async getStandings(): Promise<Standing[]> {
    return this.standings.length ? [...this.standings] : calculateStandings(this.teams, this.matches)
  }
  async getScorers(): Promise<Array<{ player: string; team: Team; goals: number; penalties: number }>> {
    return [...this.scorers]
  }
  async close(): Promise<void> {}

  async importMatches(inputs: CsvMatchInput[]): Promise<number> {
    return this.upsertCsvMatches(inputs, false)
  }

  async syncMatches(inputs: CsvMatchInput[]): Promise<number> {
    return this.upsertCsvMatches(inputs, true)
  }

  private upsertCsvMatches(inputs: CsvMatchInput[], updateExisting: boolean): number {
    let changed = 0
    for (const input of inputs) {
      const homeTeam = this.ensureTeam(input.homeTeam)
      const awayTeam = this.ensureTeam(input.awayTeam)
      const existing = this.matches.find((match) => matchFixtureKey(match) === matchFixtureKey(input))
      if (existing) {
        if (!updateExisting) continue
        Object.assign(existing, {
          matchday: input.matchday, date: input.date, homeGoals: input.homeGoals,
          awayGoals: input.awayGoals, status: input.status,
        })
        changed++
        continue
      }
      this.matches.push({
        id: `${input.date}:${homeTeam.id}:${awayTeam.id}`,
        matchday: input.matchday, date: input.date, homeTeam, awayTeam,
        homeGoals: input.homeGoals, awayGoals: input.awayGoals, status: input.status,
      })
      changed++
    }
    if (changed) this.standings = []
    return changed
  }

  private ensureTeam(name: string): Team {
    const existing = this.teams.find((team) => team.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    const team = { id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, crest: null }
    this.teams.push(team)
    return team
  }
}

export function matchFixtureKey(match: Pick<CsvMatchInput, 'date' | 'homeTeam' | 'awayTeam'> | Pick<Match, 'date' | 'homeTeam' | 'awayTeam'>): string {
  const homeTeam = typeof match.homeTeam === 'string' ? match.homeTeam : match.homeTeam.name
  const awayTeam = typeof match.awayTeam === 'string' ? match.awayTeam : match.awayTeam.name
  return `${new Date(match.date).toISOString()}|${homeTeam.trim().toLowerCase()}|${awayTeam.trim().toLowerCase()}`
}

function providerStatus(status: string): Match['status'] {
  if (status === 'FINISHED') return 'FINISHED'
  if (status === 'IN_PLAY' || status === 'PAUSED' || status === 'LIVE') return 'IN_PLAY'
  if (status === 'POSTPONED' || status === 'SUSPENDED' || status === 'CANCELLED' || status === 'AWARDED') return 'POSTPONED'
  return status === 'TIMED' ? 'TIMED' : 'SCHEDULED'
}
