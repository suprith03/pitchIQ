import { describe, expect, it } from 'vitest'
import { calculateStandings } from '../src/domain/standings.js'
import type { Match, Team } from '../src/domain/types.js'

const teams: Team[] = [
  { id: 'a', name: 'Alpha', crest: null },
  { id: 'b', name: 'Bravo', crest: null },
  { id: 'c', name: 'Charlie', crest: null },
]

const match = (id: string, home: string, away: string, homeGoals: number | null, awayGoals: number | null, status: Match['status'] = 'FINISHED'): Match => ({
  id, matchday: 1, date: `2025-08-${id.padStart(2, '0')}T12:00:00.000Z`,
  homeTeam: teams.find((team) => team.id === home)!, awayTeam: teams.find((team) => team.id === away)!,
  homeGoals, awayGoals, status,
})

describe('calculateStandings', () => {
  it('calculates W/D/L, goal totals, goal difference, points, form and tie-breaks', () => {
    const table = calculateStandings(teams, [
      match('1', 'a', 'b', 2, 0),
      match('2', 'b', 'c', 1, 1),
      match('3', 'c', 'a', 3, 1),
      match('4', 'b', 'a', null, null, 'SCHEDULED'),
    ])
    expect(table.map((row) => [row.team.id, row.points, row.goalDifference])).toEqual([
      ['c', 4, 2], ['a', 3, 0], ['b', 1, -2],
    ])
    expect(table.find((row) => row.team.id === 'a')).toMatchObject({
      played: 2, won: 1, drawn: 0, lost: 1, goalsFor: 3, goalsAgainst: 3, form: 'LW',
    })
  })

  it('includes teams without played matches and never counts scheduled fixtures', () => {
    const table = calculateStandings(teams, [match('1', 'a', 'b', null, null, 'SCHEDULED')])
    expect(table).toHaveLength(3)
    expect(table.every((row) => row.played === 0 && row.points === 0)).toBe(true)
  })
})
