import { afterEach, describe, expect, it, vi } from 'vitest'
import { FootballDataProvider } from '../src/providers/football-data.js'

afterEach(() => vi.unstubAllGlobals())

describe('football-data.org provider', () => {
  it('uses the documented v4 competition endpoint and token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ matches: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FootballDataProvider('test-token', 1000, 'PL', '2024')
    await expect(provider.getMatches()).resolves.toEqual([])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.football-data.org/v4/competitions/PL/matches?season=2024',
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Auth-Token': 'test-token' }) }),
    )
  })

  it('honours provider 429 responses and Retry-After without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('rate limited', {
      status: 429, headers: { 'Retry-After': '30' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FootballDataProvider('test-token', 1000)
    await expect(provider.getMatches()).rejects.toThrow('HTTP 429')
    await expect(provider.getMatches()).rejects.toThrow('Retry in 30 seconds')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces a clear configuration error when no API key is supplied', async () => {
    const provider = new FootballDataProvider('', 1000)
    await expect(provider.getMatches()).rejects.toThrow('FOOTBALL_DATA_API_TOKEN')
  })

  it('fetches a season snapshot from the competition, teams, standings, matches, and scorers endpoints', async () => {
    const teams = Array.from({ length: 20 }, (_, index) => ({
      id: index + 1, name: `Club ${index + 1}`, crest: null,
    }))
    const season = { id: 2026, startDate: '2026-08-01', endDate: '2027-05-31', currentMatchday: 1 }
    const bodies = [
      { id: 2021, name: 'Premier League', code: 'PL', currentSeason: season },
      { teams, season },
      { standings: [{ type: 'TOTAL', table: teams.map((team, index) => ({
        position: index + 1, team, playedGames: 0, won: 0, draw: 0, lost: 0, points: 0,
        goalsFor: 0, goalsAgainst: 0, goalDifference: 0, form: null,
      })) }] },
      { matches: [] },
      { scorers: [] },
    ]
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(bodies[fetchMock.mock.calls.length - 1]), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new FootballDataProvider('test-token', 1000)
    const snapshot = await provider.getSeasonSnapshot(2026)
    expect(snapshot.teams).toHaveLength(20)
    expect(snapshot.standings).toHaveLength(20)
    expect(snapshot.season.startDate).toBe(season.startDate)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.football-data.org/v4/competitions/PL',
      'https://api.football-data.org/v4/competitions/PL/teams?season=2026',
      'https://api.football-data.org/v4/competitions/PL/standings?season=2026',
      'https://api.football-data.org/v4/competitions/PL/matches?season=2026',
      'https://api.football-data.org/v4/competitions/PL/scorers?season=2026',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('keeps league data when scorer access is restricted and reports the unavailable statistics', async () => {
    const teams = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Club ${index + 1}` }))
    const season = { id: 2026, startDate: '2026-08-01', endDate: '2027-05-31', currentMatchday: 1 }
    const payloads = [
      new Response(JSON.stringify({ id: 1, name: 'Premier League', code: 'PL', currentSeason: season }), { status: 200 }),
      new Response(JSON.stringify({ teams, season }), { status: 200 }),
      new Response(JSON.stringify({ standings: [{ type: 'TOTAL', table: teams.map((team, index) => ({
        position: index + 1, team, playedGames: 0, won: 0, draw: 0, lost: 0, points: 0,
        goalsFor: 0, goalsAgainst: 0, goalDifference: 0, form: null,
      })) }] }), { status: 200 }),
      new Response(JSON.stringify({ matches: [] }), { status: 200 }),
      new Response('scorers not included in this plan', { status: 403 }),
    ]
    const fetchMock = vi.fn().mockImplementation(async () => payloads[fetchMock.mock.calls.length - 1])
    vi.stubGlobal('fetch', fetchMock)
    const snapshot = await new FootballDataProvider('test-token', 1000).getSeasonSnapshot()
    expect(snapshot.teams).toHaveLength(20)
    expect(snapshot.scorers).toEqual([])
    expect(snapshot.warnings[0]).toContain('HTTP 403')
  })
})
