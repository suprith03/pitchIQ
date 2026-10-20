import type { CsvMatchInput, Match, Standing, Team } from '../domain/types.js'

export interface FootballRepository {
  readonly mode: 'oracle' | 'provider-cache'
  getTeams(): Promise<Team[]>
  getMatches(): Promise<Match[]>
  getStandings(): Promise<Standing[]>
  importMatches(matches: CsvMatchInput[]): Promise<number>
  syncMatches(matches: CsvMatchInput[]): Promise<number>
  getScorers(): Promise<Array<{ player: string; team: Team; goals: number; penalties: number }>>
  close(): Promise<void>
}
