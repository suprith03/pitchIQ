import { parse } from 'csv-parse/sync'
import type { CsvMatchInput } from '../domain/types.js'

export function parseCsvMatches(csv: string): CsvMatchInput[] {
  const records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Array<Record<string, string>>
  const required = ['matchday', 'date', 'homeTeam', 'awayTeam', 'homeGoals', 'awayGoals', 'status']
  const headers = records.length ? Object.keys(records[0] ?? {}) : []
  const missing = required.filter((header) => !headers.includes(header))
  if (missing.length) throw new Error(`CSV is missing required columns: ${missing.join(', ')}.`)
  if (!records.length) throw new Error('CSV contains no match rows.')
  const seen = new Set<string>()
  return records.map((row, index) => {
    const line = index + 2
    const homeTeam = row.homeTeam?.trim()
    const awayTeam = row.awayTeam?.trim()
    const date = row.date?.trim()
    const status = row.status?.trim().toUpperCase()
    const matchday = Number(row.matchday)
    if (!homeTeam || !awayTeam || homeTeam === awayTeam) throw new Error(`CSV line ${line}: distinct homeTeam and awayTeam are required.`)
    if (!date || Number.isNaN(Date.parse(date))) throw new Error(`CSV line ${line}: date must be a valid ISO-compatible date.`)
    if (!Number.isInteger(matchday) || matchday < 1) throw new Error(`CSV line ${line}: matchday must be a positive integer.`)
    if (!['FINISHED', 'SCHEDULED', 'TIMED', 'IN_PLAY', 'POSTPONED'].includes(status ?? '')) {
      throw new Error(`CSV line ${line}: unsupported status "${row.status}".`)
    }
    const homeGoals = row.homeGoals === '' ? null : Number(row.homeGoals)
    const awayGoals = row.awayGoals === '' ? null : Number(row.awayGoals)
    if ((homeGoals === null) !== (awayGoals === null)) throw new Error(`CSV line ${line}: provide both scores or leave both blank.`)
    if (homeGoals !== null && (!Number.isInteger(homeGoals) || homeGoals < 0 || !Number.isInteger(awayGoals) || (awayGoals ?? -1) < 0)) {
      throw new Error(`CSV line ${line}: scores must be non-negative whole numbers.`)
    }
    if (status === 'FINISHED' && homeGoals === null) throw new Error(`CSV line ${line}: finished matches require scores.`)
    if (status !== 'FINISHED' && homeGoals !== null && status !== 'IN_PLAY') {
      throw new Error(`CSV line ${line}: only finished or in-play matches may have scores.`)
    }
    const duplicateKey = `${date}:${homeTeam.toLowerCase()}:${awayTeam.toLowerCase()}`
    if (seen.has(duplicateKey)) throw new Error(`CSV line ${line}: duplicate match ${homeTeam} vs ${awayTeam} on ${date}.`)
    seen.add(duplicateKey)
    return { matchday, date: new Date(date).toISOString(), homeTeam, awayTeam, homeGoals, awayGoals, status: status as CsvMatchInput['status'] }
  })
}
