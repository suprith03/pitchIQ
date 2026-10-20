export type MatchStatus = 'FINISHED' | 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'POSTPONED'

export interface Team {
  id: string
  name: string
  crest: string | null
}

export interface Match {
  id: string
  matchday: number
  date: string
  homeTeam: Team
  awayTeam: Team
  homeGoals: number | null
  awayGoals: number | null
  status: MatchStatus
}

export interface Standing {
  position: number
  team: Team
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
  form: string
}

export interface CsvMatchInput {
  matchday: number
  date: string
  homeTeam: string
  awayTeam: string
  homeGoals: number | null
  awayGoals: number | null
  status: MatchStatus
}

export interface DataHealth {
  storageMode: string
  source: string
  mongo: string
  apiConfigured: boolean
  lastSyncedAt: string | null
}
