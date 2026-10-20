import type { Match, Standing, Team } from './types.js'
import { calculateStandings } from './standings.js'

export interface WhatIfResult {
  table: Standing[]
  changes: Array<{ team: Team; oldPosition: number; newPosition: number; pointsGained: number; goalDifferenceChange: number }>
}

export function simulateResults(
  teams: Team[],
  matches: Match[],
  outcomes: Array<{ matchId: string; homeGoals: number; awayGoals: number }>,
): WhatIfResult {
  const outcomeByMatch = new Map<string, { homeGoals: number; awayGoals: number }>()
  for (const outcome of outcomes) {
    if (!Number.isInteger(outcome.homeGoals) || !Number.isInteger(outcome.awayGoals) || outcome.homeGoals < 0 || outcome.awayGoals < 0) {
      throw new Error('Simulated scores must be non-negative whole numbers.')
    }
    if (outcomeByMatch.has(outcome.matchId)) throw new Error(`Match ${outcome.matchId} appears more than once.`)
    outcomeByMatch.set(outcome.matchId, outcome)
  }
  const updatedMatches = matches.map((match) => {
    const outcome = outcomeByMatch.get(match.id)
    if (!outcome) return match
    if (match.status === 'FINISHED') throw new Error(`Finished match ${match.id} cannot be changed in a what-if simulation.`)
    outcomeByMatch.delete(match.id)
    return { ...match, ...outcome, status: 'FINISHED' as const }
  })
  if (outcomeByMatch.size > 0) throw new Error(`Unknown match: ${outcomeByMatch.keys().next().value}`)
  const oldTable = calculateStandings(teams, matches)
  const table = calculateStandings(teams, updatedMatches)
  const oldByTeam = new Map(oldTable.map((row) => [row.team.id, row]))
  const changes = table.map((row) => {
    const old = oldByTeam.get(row.team.id)
    if (!old) throw new Error(`Missing baseline standing for ${row.team.name}.`)
    return {
      team: row.team,
      oldPosition: old.position,
      newPosition: row.position,
      pointsGained: row.points - old.points,
      goalDifferenceChange: row.goalDifference - old.goalDifference,
    }
  })
  return { table, changes }
}

function poisson(lambda: number, random: () => number): number {
  const threshold = Math.exp(-Math.max(0.05, lambda))
  let product = 1
  let goals = 0
  do {
    goals++
    product *= random()
  } while (product > threshold && goals < 12)
  return goals - 1
}

export function simulateSeason(
  teams: Team[],
  matches: Match[],
  iterations = 1000,
  random: () => number = Math.random,
): Array<{ team: Team; averagePosition: number; topFourProbability: number; expectedPoints: number }> {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10000) {
    throw new Error('Simulation iterations must be between 1 and 10,000.')
  }
  const current = calculateStandings(teams, matches)
  const finished = matches.filter((match) => match.status === 'FINISHED' && match.homeGoals !== null && match.awayGoals !== null)
  const goals = finished.reduce((sum, match) => sum + (match.homeGoals ?? 0) + (match.awayGoals ?? 0), 0)
  const teamMatches = finished.length * 2
  const leagueAverage = teamMatches ? goals / teamMatches : 1.35
  const ratings = new Map(current.map((row) => [row.team.id, {
    attack: (row.goalsFor + leagueAverage * 2) / (row.played + 2) / leagueAverage,
    defence: (row.goalsAgainst + leagueAverage * 2) / (row.played + 2) / leagueAverage,
    points: row.points,
    played: row.played,
  }]))
  const positions = new Map(teams.map((team) => [team.id, { positionSum: 0, topFour: 0, pointsSum: 0 }]))
  for (let trial = 0; trial < iterations; trial++) {
    const simulated = matches.map((match) => {
      if (match.status === 'FINISHED') return match
      const home = ratings.get(match.homeTeam.id)
      const away = ratings.get(match.awayTeam.id)
      const homeGoals = poisson(leagueAverage * (home?.attack ?? 1) * (away?.defence ?? 1) * 1.08, random)
      const awayGoals = poisson(leagueAverage * (away?.attack ?? 1) * (home?.defence ?? 1) * 0.92, random)
      return { ...match, homeGoals, awayGoals, status: 'FINISHED' as const }
    })
    const table = calculateStandings(teams, simulated)
    table.forEach((row) => {
      const aggregate = positions.get(row.team.id)
      if (!aggregate) return
      aggregate.positionSum += row.position
      aggregate.topFour += row.position <= 4 ? 1 : 0
      aggregate.pointsSum += row.points
    })
  }
  return teams.map((team) => {
    const aggregate = positions.get(team.id)
    if (!aggregate) throw new Error(`Missing simulation result for ${team.name}.`)
    return {
      team,
      averagePosition: aggregate.positionSum / iterations,
      topFourProbability: aggregate.topFour / iterations,
      expectedPoints: aggregate.pointsSum / iterations,
    }
  }).sort((a, b) => a.averagePosition - b.averagePosition)
}
