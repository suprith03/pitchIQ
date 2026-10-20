import { describe, expect, it } from 'vitest'
import { simulateResults } from '../src/domain/simulation.js'
import type { ProviderSeasonSnapshot } from '../src/providers/football-data.js'
import { ProviderCacheRepository } from '../src/repositories/provider-cache-repository.js'

function snapshot(): ProviderSeasonSnapshot {
  const teams = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1, name: `Premier Club ${index + 1}`, crest: null,
  }))
  return {
    competition: { id: 2021, name: 'Premier League', code: 'PL' },
    season: { id: 2026, startDate: '2026-08-01', endDate: '2027-05-31', currentMatchday: 1 },
    currentSeasonYear: 2026,
    teams,
    standings: teams.map((team, index) => ({
      position: index + 1, team, playedGames: 0, won: 0, draw: 0, lost: 0, points: 0,
      goalsFor: 0, goalsAgainst: 0, goalDifference: 0, form: null,
    })),
    matches: [
      {
        id: 90001, utcDate: '2026-08-10T15:00:00Z', matchday: 1, status: 'SCHEDULED',
        homeTeam: { id: 1, name: teams[0]!.name }, awayTeam: { id: 2, name: teams[1]!.name },
        score: { fullTime: { home: null, away: null } },
      },
    ],
    scorers: [{
      player: { id: 400, name: 'Example Player' }, team: teams[0]!,
      playedMatches: 1, goals: 1, assists: 0, penalties: 0,
    }],
    warnings: [],
    syncedAt: '2026-08-01T12:00:00.000Z',
  }
}

describe('provider season repository', () => {
  it('loads 20 provider teams, fixture IDs, scorer totals and provider standings', async () => {
    const repository = new ProviderCacheRepository()
    repository.loadSnapshot(snapshot(), 'football-data.org v4 · live')
    expect(await repository.getTeams()).toHaveLength(20)
    expect((await repository.getMatches())[0]).toMatchObject({ id: '90001', status: 'SCHEDULED' })
    expect((await repository.getStandings())[0]).toMatchObject({ position: 1, team: { id: '1' } })
    expect(await repository.getScorers()).toMatchObject([{ player: 'Example Player', goals: 1 }])
    expect(repository.seasonYear).toBe(2026)
  })

  it('calculates what-if outcomes on a copy without changing official matches', async () => {
    const repository = new ProviderCacheRepository()
    repository.loadSnapshot(snapshot())
    const before = await repository.getMatches()
    const result = simulateResults(await repository.getTeams(), before, [
      { matchId: '90001', homeGoals: 2, awayGoals: 0 },
    ])
    expect(result.table[0]?.team.id).toBe('1')
    expect(await repository.getMatches()).toEqual(before)
  })

  it('skips CSV fixtures that duplicate a provider fixture even when their IDs differ', async () => {
    const repository = new ProviderCacheRepository()
    const data = snapshot()
    repository.loadSnapshot(data)
    const providerMatch = data.matches[0]!
    await expect(repository.importMatches([{
      matchday: providerMatch.matchday!,
      date: providerMatch.utcDate,
      homeTeam: providerMatch.homeTeam.name,
      awayTeam: providerMatch.awayTeam.name,
      homeGoals: null,
      awayGoals: null,
      status: 'SCHEDULED',
    }])).resolves.toBe(0)
    await expect(repository.getMatches()).resolves.toHaveLength(1)
  })

  it('rejects snapshots that are not the complete 20-team Premier League', () => {
    const repository = new ProviderCacheRepository()
    const incomplete = snapshot()
    incomplete.teams = incomplete.teams.slice(0, 19)
    expect(() => repository.loadSnapshot(incomplete)).toThrow('must contain 20 teams')
  })
})
