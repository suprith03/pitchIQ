import oracledb from 'oracledb'
import type { CsvMatchInput, Match, Standing, Team } from '../domain/types.js'
import type { FootballRepository } from './football-repository.js'

interface DbTeam { ID: number; NAME: string; CREST: string | null }
interface DbMatch {
  ID: number; MATCHDAY: number; MATCH_DATE: string; HOME_ID: number; HOME_NAME: string
  HOME_CREST: string | null; AWAY_ID: number; AWAY_NAME: string; AWAY_CREST: string | null
  HOME_GOALS: number | null; AWAY_GOALS: number | null; STATUS: Match['status']
}
interface DbStanding {
  POSITION: number; TEAM_ID: number; TEAM_NAME: string; CREST: string | null
  PLAYED: number; WON: number; DRAWN: number; LOST: number; GOALS_FOR: number
  GOALS_AGAINST: number; GOAL_DIFFERENCE: number; POINTS: number; FORM: string | null
}

export class OracleRepository implements FootballRepository {
  readonly mode = 'oracle' as const
  private pool: oracledb.Pool | undefined

  async initialize(): Promise<void> {
    this.pool = await oracledb.createPool({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: process.env.ORACLE_CONNECT_STRING,
      poolMin: 1,
      poolMax: 5,
      poolIncrement: 1,
    })
  }

  async getTeams(): Promise<Team[]> {
    const connection = await this.connection()
    try {
      const result = await connection.execute<DbTeam>(
        'SELECT team_id AS ID, name AS NAME, crest_url AS CREST FROM teams ORDER BY name',
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      return (result.rows ?? []).map((row) => ({ id: String(row.ID), name: row.NAME, crest: row.CREST }))
    } finally {
      await connection.close()
    }
  }

  async getMatches(): Promise<Match[]> {
    const connection = await this.connection()
    try {
      const result = await connection.execute<DbMatch>(
        `SELECT m.match_id AS ID, m.matchday AS MATCHDAY,
          TO_CHAR(m.match_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS MATCH_DATE,
          ht.team_id AS HOME_ID, ht.name AS HOME_NAME, ht.crest_url AS HOME_CREST,
          at.team_id AS AWAY_ID, at.name AS AWAY_NAME, at.crest_url AS AWAY_CREST,
          m.home_goals AS HOME_GOALS, m.away_goals AS AWAY_GOALS, m.status AS STATUS
         FROM matches m JOIN teams ht ON ht.team_id = m.home_team_id
         JOIN teams at ON at.team_id = m.away_team_id ORDER BY m.match_date`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      return (result.rows ?? []).map((row) => ({
        id: String(row.ID), matchday: row.MATCHDAY, date: row.MATCH_DATE,
        homeTeam: { id: String(row.HOME_ID), name: row.HOME_NAME, crest: row.HOME_CREST },
        awayTeam: { id: String(row.AWAY_ID), name: row.AWAY_NAME, crest: row.AWAY_CREST },
        homeGoals: row.HOME_GOALS, awayGoals: row.AWAY_GOALS, status: row.STATUS,
      }))
    } finally {
      await connection.close()
    }
  }

  async getStandings(): Promise<Standing[]> {
    const connection = await this.connection()
    try {
      const result = await connection.execute<DbStanding>(
        `SELECT s.position AS POSITION, t.team_id AS TEAM_ID, t.name AS TEAM_NAME, t.crest_url AS CREST,
          s.played AS PLAYED, s.won AS WON, s.drawn AS DRAWN, s.lost AS LOST,
          s.goals_for AS GOALS_FOR, s.goals_against AS GOALS_AGAINST,
          s.goal_difference AS GOAL_DIFFERENCE, s.points AS POINTS, s.form AS FORM
         FROM standings s JOIN teams t ON t.team_id = s.team_id ORDER BY s.position`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      return (result.rows ?? []).map((row) => ({
        position: row.POSITION, team: { id: String(row.TEAM_ID), name: row.TEAM_NAME, crest: row.CREST },
        played: row.PLAYED, won: row.WON, drawn: row.DRAWN, lost: row.LOST,
        goalsFor: row.GOALS_FOR, goalsAgainst: row.GOALS_AGAINST, goalDifference: row.GOAL_DIFFERENCE,
        points: row.POINTS, form: row.FORM ?? '',
      }))
    } finally {
      await connection.close()
    }
  }

  async syncTeams(teams: Team[]): Promise<void> {
    const connection = await this.connection()
    try {
      for (const team of teams) {
        await connection.execute(
          `MERGE INTO teams target
           USING (SELECT :name AS name, :crest AS crest_url FROM dual) source
           ON (LOWER(target.name) = LOWER(source.name))
           WHEN MATCHED THEN UPDATE SET target.crest_url = COALESCE(source.crest_url, target.crest_url)
           WHEN NOT MATCHED THEN INSERT (name, crest_url) VALUES (source.name, source.crest_url)`,
          { name: team.name, crest: team.crest },
        )
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw new Error(`Oracle team synchronization failed; the transaction was rolled back: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await connection.close()
    }
  }

  async importMatches(matches: CsvMatchInput[]): Promise<number> {
    return this.writeMatches(matches, false)
  }

  async syncMatches(matches: CsvMatchInput[]): Promise<number> {
    return this.writeMatches(matches, true)
  }

  private async writeMatches(matches: CsvMatchInput[], updateExisting: boolean): Promise<number> {
    const connection = await this.connection()
    let imported = 0
    try {
      for (const match of matches) {
        for (const name of [match.homeTeam, match.awayTeam]) {
          await connection.execute(
            `MERGE INTO teams t USING (SELECT :name AS name FROM dual) s ON (LOWER(t.name) = LOWER(s.name))
             WHEN NOT MATCHED THEN INSERT (name) VALUES (s.name)`,
            { name },
          )
        }
        const duplicate = await connection.execute<{ MATCH_ID: number }>(
          `SELECT match_id AS MATCH_ID FROM matches
           WHERE match_date = TO_TIMESTAMP_TZ(:matchDate, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM')
             AND home_team_id = (SELECT team_id FROM teams WHERE LOWER(name) = LOWER(:homeTeam))
             AND away_team_id = (SELECT team_id FROM teams WHERE LOWER(name) = LOWER(:awayTeam))`,
          { matchDate: match.date.replace('Z', '+00:00'), homeTeam: match.homeTeam, awayTeam: match.awayTeam },
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        )
        const existingMatchId = duplicate.rows?.[0]?.MATCH_ID
        if (existingMatchId && !updateExisting) continue
        if (existingMatchId) {
          const update = await connection.execute(
            `UPDATE matches SET matchday = :matchday, home_goals = :homeGoals,
              away_goals = :awayGoals, status = :status WHERE match_id = :matchId`,
            {
              matchday: match.matchday, homeGoals: match.homeGoals, awayGoals: match.awayGoals,
              status: match.status, matchId: existingMatchId,
            },
          )
          imported += update.rowsAffected ?? 0
          continue
        }
        await connection.execute(
          `INSERT INTO matches (matchday, match_date, home_team_id, away_team_id, home_goals, away_goals, status)
           SELECT :matchday, TO_TIMESTAMP_TZ(:matchDate, 'YYYY-MM-DD"T"HH24:MI:SS.FF3TZH:TZM'),
             home.team_id, away.team_id, :homeGoals, :awayGoals, :status
           FROM teams home CROSS JOIN teams away
           WHERE LOWER(home.name) = LOWER(:homeTeam) AND LOWER(away.name) = LOWER(:awayTeam)`,
          {
            matchday: match.matchday, matchDate: match.date.replace('Z', '+00:00'),
            homeGoals: match.homeGoals, awayGoals: match.awayGoals, status: match.status,
            homeTeam: match.homeTeam, awayTeam: match.awayTeam,
          },
        )
        imported++
      }
      await connection.execute(`BEGIN validate_match_results; recalculate_standings; END;`)
      await connection.commit()
      return imported
    } catch (error) {
      await connection.rollback()
      throw new Error(`Oracle CSV import failed; the transaction was rolled back: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      await connection.close()
    }
  }

  async getScorers(): Promise<Array<{ player: string; team: Team; goals: number; penalties: number }>> {
    const connection = await this.connection()
    try {
      const result = await connection.execute<{ PLAYER: string; TEAM_ID: number; TEAM_NAME: string; CREST: string | null; GOALS: number; PENALTIES: number }>(
        `SELECT p.name AS PLAYER, t.team_id AS TEAM_ID, t.name AS TEAM_NAME, t.crest_url AS CREST,
          SUM(pms.goals) AS GOALS, SUM(pms.penalties_scored) AS PENALTIES
         FROM player_match_stats pms JOIN players p ON p.player_id = pms.player_id
         JOIN teams t ON t.team_id = p.team_id GROUP BY p.name, t.team_id, t.name, t.crest_url
         ORDER BY GOALS DESC FETCH FIRST 20 ROWS ONLY`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT },
      )
      return (result.rows ?? []).map((row) => ({
        player: row.PLAYER, team: { id: String(row.TEAM_ID), name: row.TEAM_NAME, crest: row.CREST },
        goals: row.GOALS, penalties: row.PENALTIES,
      }))
    } finally {
      await connection.close()
    }
  }

  async close(): Promise<void> {
    await this.pool?.close(10)
  }

  async benchmarkStandings(): Promise<Standing[]> {
    return this.getStandings()
  }

  private async connection(): Promise<oracledb.Connection> {
    if (!this.pool) throw new Error('Oracle connection pool is not initialized.')
    return this.pool.getConnection()
  }
}
