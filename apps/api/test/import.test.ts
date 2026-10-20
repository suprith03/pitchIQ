import { describe, expect, it } from 'vitest'
import { parseCsvMatches } from '../src/repositories/csv-import.js'

const csv = [
  'matchday,date,homeTeam,awayTeam,homeGoals,awayGoals,status',
  '1,2025-08-16T15:00:00Z,Test United,Example City,2,0,FINISHED',
  '2,2025-08-23T15:00:00Z,Example City,Test United,,,SCHEDULED',
].join('\n')

describe('CSV imports', () => {
  it('validates results and unplayed fixtures from a supplied CSV', () => {
    const rows = parseCsvMatches(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ homeTeam: 'Test United', homeGoals: 2, awayGoals: 0, status: 'FINISHED' })
    expect(rows[1]).toMatchObject({ status: 'SCHEDULED', homeGoals: null, awayGoals: null })
  })

  it('rejects missing columns, duplicate fixtures and inconsistent result data', () => {
    expect(() => parseCsvMatches('homeTeam,awayTeam\nAlpha,Bravo')).toThrow('missing required columns')
    const duplicate = [
      'matchday,date,homeTeam,awayTeam,homeGoals,awayGoals,status',
      '1,2025-01-01,Alpha,Bravo,1,0,FINISHED',
      '1,2025-01-01,Alpha,Bravo,0,0,FINISHED',
    ].join('\n')
    expect(() => parseCsvMatches(duplicate)).toThrow('duplicate match')
    const noScore = 'matchday,date,homeTeam,awayTeam,homeGoals,awayGoals,status\n1,2025-01-01,Alpha,Bravo,,,FINISHED'
    expect(() => parseCsvMatches(noScore)).toThrow('require scores')
  })
})
