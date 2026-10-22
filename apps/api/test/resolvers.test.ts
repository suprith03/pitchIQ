import { describe, expect, it } from 'vitest'
import { calculateStandings } from '../src/domain/standings.js'
import type { Match, Team } from '../src/domain/types.js'
import { createResolvers, type GraphContext } from '../src/graphql/resolvers.js'
import type { FootballRepository } from '../src/repositories/football-repository.js'
import { FootballDataProvider } from '../src/providers/football-data.js'
import { MongoService } from '../src/services/mongo-service.js'
import { ProviderCacheRepository } from '../src/repositories/provider-cache-repository.js'

const teams: Team[] = [
  { id: 'test-united', name: 'Test United', crest: null },
  { id: 'example-city', name: 'Example City', crest: null },
]
const matches: Match[] = [1, 2, 3].map((matchday) => ({
  id: `test-${matchday}`,
  matchday,
  date: `2025-08-${String(matchday * 7 + 2).padStart(2, '0')}T15:00:00.000Z`,
  homeTeam: teams[0]!,
  awayTeam: teams[1]!,
  homeGoals: 2,
  awayGoals: 0,
  status: 'FINISHED',
}))

function createTestRepository(): FootballRepository {
  return {
    mode: 'provider-cache',
    getTeams: async () => teams,
    getMatches: async () => matches,
    getStandings: async () => calculateStandings(teams, matches),
    getScorers: async () => [],
    importMatches: async () => 0,
    syncMatches: async () => 0,
    close: async () => {},
  }
}

function createContext(repository = createTestRepository()): GraphContext {
  return {
    repository,
    providerRepository: new ProviderCacheRepository(),
    mongo: new MongoService('', 'pitchiq', 60),
    provider: new FootballDataProvider('', 1000),
    oracle: null,
    lastSyncedAt: null,
    dataSource: 'Test fixture',
    syncError: null,
    activeSnapshot: null,
    benchmarkIterations: 10,
  }
}

describe('GraphQL resolvers', () => {
  it('returns computed standings and source health from the configured provider repository', async () => {
    const context = createContext()
    const resolvers = createResolvers()
    const table = await resolvers.Query.standings(undefined, undefined, context)
    expect(table[0]).toMatchObject({ position: 1, team: { name: 'Test United' }, played: 3, points: 9 })
    await expect(resolvers.Query.dataHealth(undefined, undefined, context)).resolves.toMatchObject({
      storageMode: 'provider-cache', source: 'football-data.org v4', apiConfigured: false,
    })
    await expect(resolvers.Query.matches(undefined, { status: 'FINISHED' }, context)).resolves.toHaveLength(3)
  })

  it('reports live provider source after provider data has been synchronized to Oracle', async () => {
    const repository: FootballRepository = {
      ...createTestRepository(),
      mode: 'oracle',
    }
    const context = createContext(repository)
    context.providerRepository.source = 'football-data.org v4 · live'
    context.providerRepository.lastSyncedAt = '2026-10-22T17:42:31.152Z'
    const resolvers = createResolvers()
    await expect(resolvers.Query.dataHealth(undefined, undefined, context)).resolves.toMatchObject({
      storageMode: 'oracle',
      source: 'football-data.org v4 · live',
    })
  })

  it('rejects same-team and invalid-status query arguments', async () => {
    const context = createContext()
    const resolvers = createResolvers()
    await expect(resolvers.Query.matches(undefined, { status: 'bogus' }, context)).rejects.toThrow('Unsupported match status')
    await expect(resolvers.Query.compareTeams(undefined, { teamA: 'test-united', teamB: 'test-united' }, context)).rejects.toThrow('different teams')
  })
})
