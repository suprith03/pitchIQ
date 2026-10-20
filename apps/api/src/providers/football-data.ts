export interface ProviderMatch {
  id: number
  utcDate: string
  matchday: number | null
  status: string
  homeTeam: { id: number; name: string }
  awayTeam: { id: number; name: string }
  score: { fullTime: { home: number | null; away: number | null } }
  goals?: Array<Record<string, unknown>>
}

export interface ProviderTeam {
  id: number
  name: string
  shortName?: string
  tla?: string
  crest?: string | null
}

export interface ProviderStanding {
  position: number
  team: ProviderTeam
  playedGames: number
  won: number
  draw: number
  lost: number
  points: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  form: string | null
}

export interface ProviderScorer {
  player: { id: number; name: string }
  team: ProviderTeam
  playedMatches: number
  goals: number
  assists: number | null
  penalties: number | null
}

export interface ProviderSeasonSnapshot {
  competition: { id: number; name: string; code: string }
  season: { id: number; startDate: string; endDate: string; currentMatchday: number | null }
  currentSeasonYear: number | null
  teams: ProviderTeam[]
  standings: ProviderStanding[]
  matches: ProviderMatch[]
  scorers: ProviderScorer[]
  warnings: string[]
  syncedAt: string
}

interface CompetitionResponse {
  id: number
  name: string
  code: string
  currentSeason?: { id: number; startDate: string; endDate: string; currentMatchday: number | null }
  season?: { id: number; startDate: string; endDate: string; currentMatchday: number | null }
}
interface TeamsResponse { teams: ProviderTeam[]; season: ProviderSeasonSnapshot['season'] }
interface StandingsResponse { standings: Array<{ type: string; table: ProviderStanding[] }> }
interface MatchesResponse { matches: ProviderMatch[] }
interface ScorersResponse { scorers: ProviderScorer[] }

export class FootballDataProvider {
  private readonly baseUrl = 'https://api.football-data.org/v4'
  private nextAllowedAt = 0
  private requestQueue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly competition = 'PL',
    private readonly season?: string,
  ) {}

  get configured(): boolean { return this.apiKey.length > 0 }

  async getSeasonSnapshot(season?: number): Promise<ProviderSeasonSnapshot> {
    const selectedSeason = season ?? (this.season ? Number(this.season) : undefined)
    if (selectedSeason !== undefined && (!Number.isInteger(selectedSeason) || selectedSeason < 1992 || selectedSeason > 2100)) {
      throw new Error(`Invalid football-data.org season year "${selectedSeason}". Use a four-digit season start year.`)
    }
    const competition = await this.get<CompetitionResponse>(`/competitions/${encodeURIComponent(this.competition)}`)
    const params = new URLSearchParams()
    if (selectedSeason !== undefined) params.set('season', String(selectedSeason))
    const suffix = params.size ? `?${params}` : ''
    const teamsResult = await this.get<TeamsResponse>(`/competitions/${encodeURIComponent(this.competition)}/teams${suffix}`)
    const standingsResult = await this.get<StandingsResponse>(`/competitions/${encodeURIComponent(this.competition)}/standings${suffix}`)
    const matchesResult = await this.get<MatchesResponse>(`/competitions/${encodeURIComponent(this.competition)}/matches${suffix}`)
    let scorerRows: ProviderScorer[] = []
    const warnings: string[] = []
    try {
      const scorersResult = await this.get<ScorersResponse>(`/competitions/${encodeURIComponent(this.competition)}/scorers${suffix}`)
      if (!Array.isArray(scorersResult.scorers)) throw new Error('football-data.org scorers response did not contain a scorers array.')
      scorerRows = scorersResult.scorers
    } catch (error) {
      if (!(error instanceof Error) || !/HTTP (403|404)\b/.test(error.message)) throw error
      warnings.push(`Scorer data unavailable for this season or API plan: ${error.message}`)
    }
    const currentSeason = competition.currentSeason ?? competition.season
    const seasonDetails = teamsResult.season ?? (selectedSeason === undefined ? currentSeason : undefined)
    if (!seasonDetails) throw new Error(`football-data.org did not return season metadata for ${selectedSeason ?? 'current season'}.`)
    if (!Array.isArray(teamsResult.teams) || !Array.isArray(standingsResult.standings) ||
      !Array.isArray(matchesResult.matches)) {
      throw new Error('football-data.org returned an incomplete season response.')
    }
    const totalTable = standingsResult.standings.find((standing) => standing.type === 'TOTAL')?.table
      ?? standingsResult.standings[0]?.table
    if (!totalTable?.length) throw new Error('football-data.org returned no league standings for this season.')
    if (teamsResult.teams.length !== totalTable.length) {
      throw new Error(`football-data.org returned ${teamsResult.teams.length} teams but ${totalTable.length} table rows.`)
    }
    return {
      competition: { id: competition.id, name: competition.name, code: competition.code },
      season: seasonDetails,
      currentSeasonYear: currentSeason ? new Date(currentSeason.startDate).getUTCFullYear() : null,
      teams: teamsResult.teams,
      standings: totalTable,
      matches: matchesResult.matches,
      scorers: scorerRows,
      warnings,
      syncedAt: new Date().toISOString(),
    }
  }

  async getMatches(season?: number): Promise<ProviderMatch[]> {
    const params = new URLSearchParams()
    const selectedSeason = season ?? (this.season ? Number(this.season) : undefined)
    if (selectedSeason !== undefined) params.set('season', String(selectedSeason))
    const suffix = params.size ? `?${params}` : ''
    const body = await this.get<MatchesResponse>(`/competitions/${encodeURIComponent(this.competition)}/matches${suffix}`)
    if (!Array.isArray(body.matches)) throw new Error('football-data.org response did not contain a matches array.')
    return body.matches
  }

  private get<T>(pathname: string): Promise<T> {
    const request = this.requestQueue.then(() => this.performRequest<T>(pathname))
    this.requestQueue = request.catch(() => undefined)
    return request
  }

  private async performRequest<T>(pathname: string): Promise<T> {
    if (!this.configured) throw new Error('Football data sync is unavailable: set FOOTBALL_DATA_API_TOKEN in the project root .env file.')
    if (Date.now() < this.nextAllowedAt) {
      const waitSeconds = Math.ceil((this.nextAllowedAt - Date.now()) / 1000)
      throw new Error(`Football data provider rate limit is active. Retry in ${waitSeconds} seconds.`)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${pathname}`, {
        headers: { 'X-Auth-Token': this.apiKey, Accept: 'application/json' },
        signal: controller.signal,
      })
      const remainingHeader = response.headers.get('X-Requests-Available-Minute')
      const remaining = remainingHeader === null ? null : Number(remainingHeader)
      if (remaining !== null && Number.isFinite(remaining) && remaining <= 0) this.nextAllowedAt = Date.now() + 60_000
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After')
        const retryAfterSeconds = Number(retryAfterHeader)
        const retryAt = retryAfterHeader && !Number.isFinite(retryAfterSeconds) ? Date.parse(retryAfterHeader) : NaN
        const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : Number.isFinite(retryAt) && retryAt > Date.now() ? retryAt - Date.now() : 60_000
        this.nextAllowedAt = Date.now() + retryDelay
        throw new Error('Football data provider returned HTTP 429; the provider rate limit will be respected.')
      }
      if (!response.ok) {
        const details = await response.text()
        throw new Error(`Football data provider returned HTTP ${response.status}: ${details.replaceAll(this.apiKey, '[redacted]').slice(0, 250)}`)
      }
      return await response.json() as T
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Football data request timed out after ${this.timeoutMs} ms.`)
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}
