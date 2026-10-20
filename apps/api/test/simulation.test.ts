import { describe, expect, it } from 'vitest'
import { simulateResults, simulateSeason } from '../src/domain/simulation.js'
import { calculateStandings } from '../src/domain/standings.js'
import type { Match, Team } from '../src/domain/types.js'

const teams: Team[] = [
  { id: 'a', name: 'Alpha', crest: null },
  { id: 'b', name: 'Bravo', crest: null },
  { id: 'c', name: 'Charlie', crest: null },
  { id: 'd', name: 'Delta', crest: null },
]
const matches: Match[] = [{
  id: 'finished-1', matchday: 1, date: '2025-08-01T12:00:00.000Z',
  homeTeam: teams[0]!, awayTeam: teams[1]!, homeGoals: 2, awayGoals: 0, status: 'FINISHED',
}, {
  id: 'next-1', matchday: 2, date: '2025-08-08T12:00:00.000Z',
  homeTeam: teams[1]!, awayTeam: teams[2]!, homeGoals: null, awayGoals: null, status: 'SCHEDULED',
}, {
  id: 'next-2', matchday: 2, date: '2025-08-08T12:00:00.000Z',
  homeTeam: teams[3]!, awayTeam: teams[0]!, homeGoals: null, awayGoals: null, status: 'SCHEDULED',
}]

describe('simulation models', () => {
  it('recalculates what-if standings without mutating official matches', () => {
    const before = calculateStandings(teams, matches)
    const result = simulateResults(teams, matches, [{ matchId: 'next-1', homeGoals: 3, awayGoals: 0 }])
    expect(result.table.find((row) => row.team.id === 'b')?.points).toBe(3)
    expect(result.table.find((row) => row.team.id === 'c')?.points).toBe(0)
    expect(matches[1]).toMatchObject({ status: 'SCHEDULED', homeGoals: null })
    expect(calculateStandings(teams, matches)).toEqual(before)
    expect(result.changes.find((change) => change.team.id === 'b')?.pointsGained).toBe(3)
  })

  it('rejects invalid, duplicate, unknown and finished-match outcomes', () => {
    expect(() => simulateResults(teams, matches, [{ matchId: 'next-1', homeGoals: -1, awayGoals: 0 }])).toThrow('non-negative')
    expect(() => simulateResults(teams, matches, [
      { matchId: 'next-1', homeGoals: 1, awayGoals: 0 }, { matchId: 'next-1', homeGoals: 2, awayGoals: 0 },
    ])).toThrow('appears more than once')
    expect(() => simulateResults(teams, matches, [{ matchId: 'missing', homeGoals: 1, awayGoals: 0 }])).toThrow('Unknown match')
    expect(() => simulateResults(teams, matches, [{ matchId: 'finished-1', homeGoals: 1, awayGoals: 0 }])).toThrow('cannot be changed')
  })

  it('produces deterministic valid prediction ranks and probabilities for a seeded random source', () => {
    const prediction = simulateSeason(teams, matches, 200, () => 0.5)
    expect(prediction).toHaveLength(4)
    expect(prediction.map((row) => row.averagePosition)).toEqual([1, 2, 3, 4])
    expect(prediction.every((row) => row.topFourProbability === 1)).toBe(true)
    expect(prediction.every((row) => row.expectedPoints >= 0)).toBe(true)
    expect(() => simulateSeason(teams, matches, 0)).toThrow('between 1 and 10,000')
  })
})
