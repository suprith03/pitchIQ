export const typeDefs = `#graphql
  type Team { id: ID!, name: String!, crest: String }
  type Standing {
    position: Int!, team: Team!, played: Int!, won: Int!, drawn: Int!, lost: Int!,
    goalsFor: Int!, goalsAgainst: Int!, goalDifference: Int!, points: Int!, form: String!
  }
  type Match {
    id: ID!, matchday: Int!, date: String!, homeTeam: Team!, awayTeam: Team!,
    homeGoals: Int, awayGoals: Int, status: String!
  }
  type Scorer { player: String!, team: Team!, goals: Int!, penalties: Int! }
  type TeamDNA {
    team: Team!, homePlayed: Int!, homePoints: Int!, awayPlayed: Int!, awayPoints: Int!,
    goalsPerMatch: Float!, concededPerMatch: Float!, attackIndex: Float!, defenceIndex: Float!, form: String!
  }
  type TeamComparison {
    teamA: TeamDNA!, teamB: TeamDNA!, meetings: Int!, winsA: Int!, draws: Int!, winsB: Int!,
    goalsA: Int!, goalsB: Int!
  }
  type PositionChange {
    team: Team!, oldPosition: Int!, newPosition: Int!, pointsGained: Int!, goalDifferenceChange: Int!
  }
  type WhatIfResult { table: [Standing!]!, changes: [PositionChange!]! }
  type SeasonPrediction {
    team: Team!, averagePosition: Float!, topFourProbability: Float!, expectedPoints: Float!
  }
  type DataHealth {
    storageMode: String!, source: String!, mongo: String!, apiConfigured: Boolean!, lastSyncedAt: String,
    seasonYear: Int, syncError: String, providerWarnings: [String!]!, mongoCollections: [MongoCollectionStatus!]!
  }
  type MongoCollectionStatus { name: String!, documents: Int!, indexes: [String!]! }
  type BenchmarkMetric {
    database: String!, query: String!, iterations: Int!, totalMs: Float!, averageMs: Float!, minMs: Float!, maxMs: Float!
  }
  type BenchmarkReport { metrics: [BenchmarkMetric!]!, unavailable: [String!]! }
  type ImportReport { imported: Int!, skipped: Int!, message: String! }
  type SyncReport { imported: Int!, fetched: Int!, source: String!, syncedAt: String! }
  input OutcomeInput { matchId: ID!, homeGoals: Int!, awayGoals: Int! }

  type Query {
    teams: [Team!]!
    standings: [Standing!]!
    matches(status: String, matchday: Int): [Match!]!
    scorers: [Scorer!]!
    teamDNA(teamId: ID!): TeamDNA!
    compareTeams(teamA: ID!, teamB: ID!): TeamComparison!
    dataHealth: DataHealth!
    benchmark(iterations: Int): BenchmarkReport!
  }
  type Mutation {
    importCsv(csv: String!): ImportReport!
    whatIf(outcomes: [OutcomeInput!]!): WhatIfResult!
    simulateSeason(iterations: Int): [SeasonPrediction!]!
    syncFootballData(season: Int): SyncReport!
  }
`
