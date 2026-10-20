import { MongoClient, type Collection, type Db, type Document } from 'mongodb'
import type { ProviderSeasonSnapshot } from '../providers/football-data.js'
import type { CsvMatchInput } from '../domain/types.js'

export class MongoService {
  private client: MongoClient | undefined
  private database: Db | undefined
  private connectionError: string | undefined

  constructor(private readonly uri: string, private readonly databaseName: string, private readonly ttlSeconds: number) {}

  get status(): string {
    if (!this.uri) return 'not configured'
    if (this.database) return 'connected'
    return this.connectionError ? `unavailable: ${this.connectionError}` : 'connecting'
  }

  async connect(): Promise<void> {
    if (!this.uri) return
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 2500, connectTimeoutMS: 2500 })
    try {
      await this.client.connect()
      this.database = this.client.db(this.databaseName)
      await Promise.all([
        this.collection('api_cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        this.collection('api_cache').createIndex({ key: 1 }, { unique: true }),
        this.collection('simulation_results').createIndex({ createdAt: 1 }),
        this.collection('match_events').createIndex({ provider: 1, providerMatchId: 1 }, { unique: true }),
        this.collection('football_seasons').createIndex({ competition: 1, seasonYear: 1 }, { unique: true }),
        this.collection('csv_matches').createIndex({ seasonYear: 1, fixtureKey: 1 }, { unique: true }),
      ])
    } catch (error) {
      this.connectionError = redactMongoCredentials(error instanceof Error ? error.message : String(error))
      await this.client.close()
      this.client = undefined
      console.error(`MongoDB connection failed: ${this.connectionError}`)
    }
  }

  async getCached<T>(key: string): Promise<T | null> {
    if (!this.database) return null
    const doc = await this.collection('api_cache').findOne<{ payload: T }>({ key, expiresAt: { $gt: new Date() } })
    return doc?.payload ?? null
  }

  async setCached(key: string, payload: unknown): Promise<void> {
    if (!this.database) return
    await this.collection('api_cache').updateOne(
      { key }, { $set: { key, payload, cachedAt: new Date(), expiresAt: new Date(Date.now() + this.ttlSeconds * 1000) } },
      { upsert: true },
    )
  }

  async getSeasonSnapshot(competition: string, seasonYear: number): Promise<ProviderSeasonSnapshot | null> {
    if (!this.database) return null
    const doc = await this.collection('football_seasons').findOne<{ snapshot: ProviderSeasonSnapshot }>({ competition, seasonYear })
    return doc?.snapshot ?? null
  }

  async getLatestSeasonSnapshot(competition: string): Promise<ProviderSeasonSnapshot | null> {
    if (!this.database) return null
    const doc = await this.collection('football_seasons')
      .find<{ snapshot: ProviderSeasonSnapshot }>({ competition })
      .sort({ seasonYear: -1 })
      .limit(1)
      .next()
    return doc?.snapshot ?? null
  }

  async saveSeasonSnapshot(snapshot: ProviderSeasonSnapshot): Promise<boolean> {
    if (!this.database) return false
    const seasonYear = new Date(snapshot.season.startDate).getUTCFullYear()
    await this.collection('football_seasons').updateOne(
      { competition: snapshot.competition.code, seasonYear },
      { $set: { competition: snapshot.competition.code, seasonYear, snapshot, syncedAt: new Date(snapshot.syncedAt) } },
      { upsert: true },
    )
    return true
  }

  async getImportedMatches(seasonYear: number): Promise<CsvMatchInput[]> {
    if (!this.database) return []
    const documents = await this.collection('csv_matches')
      .find<{ match: CsvMatchInput }>({ seasonYear })
      .project<{ match: CsvMatchInput }>({ _id: 0, match: 1 })
      .toArray()
    return documents.map(({ match }) => match)
  }

  async saveImportedMatches(seasonYear: number, matches: CsvMatchInput[]): Promise<number> {
    if (!this.database || matches.length === 0) return 0
    const operations = matches.map((match) => {
      const fixtureKey = `${new Date(match.date).toISOString()}|${match.homeTeam.trim().toLowerCase()}|${match.awayTeam.trim().toLowerCase()}`
      return {
        updateOne: {
          filter: { seasonYear, fixtureKey },
          update: { $setOnInsert: { seasonYear, fixtureKey, match, importedAt: new Date() } },
          upsert: true,
        },
      }
    })
    const result = await this.collection('csv_matches').bulkWrite(operations, { ordered: true })
    return result.upsertedCount
  }

  async diagnostics(): Promise<{
    collections: Array<{ name: string; documents: number; indexes: string[] }>
  } | null> {
    if (!this.database) return null
    const collections = await this.database.listCollections({}, { nameOnly: true }).toArray()
    const details = await Promise.all(collections.map(async ({ name }) => {
      const collection = this.collection(name)
      const [documents, indexes] = await Promise.all([collection.countDocuments(), collection.indexes()])
      return { name, documents, indexes: indexes.map((index) => index.name ?? 'unnamed') }
    }))
    return { collections: details.sort((a, b) => a.name.localeCompare(b.name)) }
  }

  async saveSimulation(payload: Document): Promise<void> {
    if (!this.database) return
    await this.collection('simulation_results').insertOne({ ...payload, createdAt: new Date() })
  }

  async saveMatchEvents(providerMatchId: string, events: Array<Record<string, unknown>>): Promise<void> {
    if (!this.database || events.length === 0) return
    await this.collection('match_events').updateOne(
      { provider: 'football-data.org v4', providerMatchId },
      { $set: { provider: 'football-data.org v4', providerMatchId, events, fetchedAt: new Date() } },
      { upsert: true },
    )
  }

  async benchmark(iterations: number): Promise<{ iterations: number; totalMs: number; averageMs: number; minMs: number; maxMs: number } | null> {
    if (!this.database) return null
    const collection = this.collection('api_cache')
    const durations: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await collection.find({ key: { $exists: true } }).limit(100).toArray()
      durations.push(performance.now() - start)
    }
    return {
      iterations,
      totalMs: durations.reduce((sum, value) => sum + value, 0),
      averageMs: durations.reduce((sum, value) => sum + value, 0) / iterations,
      minMs: Math.min(...durations),
      maxMs: Math.max(...durations),
    }
  }

  async close(): Promise<void> {
    await this.client?.close()
  }

  private collection(name: string): Collection<Document> {
    if (!this.database) throw new Error(`MongoDB collection ${name} requested while MongoDB is disconnected.`)
    return this.database.collection(name)
  }
}

function redactMongoCredentials(message: string): string {
  return message.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1[redacted]@')
}
