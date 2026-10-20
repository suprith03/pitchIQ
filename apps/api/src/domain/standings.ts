import type { Match, Standing, Team } from './types.js'

export function calculateStandings(teams: Team[], matches: Match[]): Standing[] {
  const rows = new Map<string, Standing & { recent: Array<{ date: number; result: string }> }>()
  for (const team of teams) {
    rows.set(team.id, {
      position: 0,
      team,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: '',
      recent: [],
    })
  }

  for (const match of matches) {
    if (match.status !== 'FINISHED' || match.homeGoals === null || match.awayGoals === null) continue
    const home = rows.get(match.homeTeam.id)
    const away = rows.get(match.awayTeam.id)
    if (!home || !away) continue
    const homeGoals = match.homeGoals
    const awayGoals = match.awayGoals
    home.played++
    away.played++
    home.goalsFor += homeGoals
    home.goalsAgainst += awayGoals
    away.goalsFor += awayGoals
    away.goalsAgainst += homeGoals
    const result = homeGoals === awayGoals ? 'D' : homeGoals > awayGoals ? 'W' : 'L'
    if (result === 'W') {
      home.won++
      home.points += 3
      away.lost++
    } else if (result === 'L') {
      away.won++
      away.points += 3
      home.lost++
    } else {
      home.drawn++
      away.drawn++
      home.points++
      away.points++
    }
    const date = Date.parse(match.date)
    home.recent.push({ date, result })
    away.recent.push({ date, result: result === 'W' ? 'L' : result === 'L' ? 'W' : 'D' })
  }

  return [...rows.values()]
    .map(({ recent, ...row }) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      form: recent.sort((a, b) => b.date - a.date).slice(0, 5).map(({ result }) => result).join(''),
    }))
    .sort((a, b) =>
      b.points - a.points
      || b.goalDifference - a.goalDifference
      || b.goalsFor - a.goalsFor
      || a.team.name.localeCompare(b.team.name),
    )
    .map((row, index) => ({ ...row, position: index + 1 }))
}
