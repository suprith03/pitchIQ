import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express4'
import { OracleRepository } from './repositories/oracle-repository.js'
import type { FootballRepository } from './repositories/football-repository.js'
import { typeDefs } from './graphql/schema.js'
import { createResolvers, type GraphContext } from './graphql/resolvers.js'
import { FootballDataProvider, type ProviderSeasonSnapshot } from './providers/football-data.js'
import { MongoService } from './services/mongo-service.js'
import { ProviderCacheRepository } from './repositories/provider-cache-repository.js'

const directory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(directory, '../../../')
dotenv.config({ path: path.join(rootDirectory, '.env') })
const footballDataApiToken = process.env.FOOTBALL_DATA_API_TOKEN?.trim() ?? ''
const apiPort = Number(process.env.API_PORT ?? 4000)
const requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 10_000)
const mongo = new MongoService(
  process.env.MONGO_URI === undefined ? 'mongodb://127.0.0.1:27017' : process.env.MONGO_URI,
  process.env.MONGO_DATABASE ?? 'pitchiq',
  Number(process.env.CACHE_TTL_SECONDS ?? 900),
)
const provider = new FootballDataProvider(
  footballDataApiToken,
  requestTimeout,
  process.env.FOOTBALL_DATA_COMPETITION ?? 'PL',
  process.env.FOOTBALL_DATA_SEASON || undefined,
)

async function makeRepository(): Promise<FootballRepository> {
  const mode = process.env.STORAGE_MODE ?? 'provider-cache'
  if (mode === 'oracle') {
    const repository = new OracleRepository()
    await repository.initialize()
    return repository
  }
  if (mode === 'provider-cache') return new ProviderCacheRepository()
  throw new Error(`Unsupported STORAGE_MODE "${mode}". Use "provider-cache" or "oracle".`)
}

async function start() {
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error(`Invalid API_PORT: ${apiPort}`)
  await mongo.connect()
  if (!mongo.status.includes('connected')) console.warn(`MongoDB cache/simulation persistence status: ${mongo.status}`)
  let repository = await makeRepository()
  const providerRepository = repository instanceof ProviderCacheRepository ? repository : new ProviderCacheRepository()
  let dataSource = repository.mode === 'oracle' ? 'Oracle Database' : 'football-data.org v4'
  let lastSyncedAt: string | null = null
  let syncError: string | null = null
  let activeSnapshot: ProviderSeasonSnapshot | null = null
  if (repository instanceof ProviderCacheRepository) {
    let fetchedSnapshot: ProviderSeasonSnapshot | null = null
    let providerError: unknown
    try {
      fetchedSnapshot = await provider.getSeasonSnapshot()
      providerRepository.loadSnapshot(fetchedSnapshot, 'football-data.org v4 · live')
    } catch (error) {
      providerError = error
    }
    if (fetchedSnapshot) {
      activeSnapshot = fetchedSnapshot
      lastSyncedAt = fetchedSnapshot.syncedAt
      dataSource = providerRepository.source
      try {
        const persisted = await mongo.saveSeasonSnapshot(fetchedSnapshot)
        if (!persisted) syncError = 'Live provider data is loaded for this session, but MongoDB is unavailable; this snapshot will not survive a restart.'
      } catch (error) {
        syncError = `Live provider data is loaded for this session, but saving the MongoDB snapshot failed: ${error instanceof Error ? error.message : String(error)}`
      }
    } else {
      const requestedYear = process.env.FOOTBALL_DATA_SEASON ? Number(process.env.FOOTBALL_DATA_SEASON) : undefined
      const cached = requestedYear === undefined
        ? await mongo.getLatestSeasonSnapshot(process.env.FOOTBALL_DATA_COMPETITION ?? 'PL')
        : await mongo.getSeasonSnapshot(process.env.FOOTBALL_DATA_COMPETITION ?? 'PL', requestedYear)
      if (cached) {
        providerRepository.loadSnapshot(cached, 'football-data.org v4 · persisted MongoDB snapshot')
        activeSnapshot = cached
        lastSyncedAt = cached.syncedAt
        dataSource = providerRepository.source
        syncError = `Live synchronization failed; showing the last successful MongoDB snapshot. ${providerError instanceof Error ? providerError.message : String(providerError)}`
      } else {
        dataSource = 'football-data.org v4 · unavailable'
        syncError = providerError instanceof Error ? providerError.message : String(providerError)
      }
    }
  } else {
    try {
      const requestedYear = process.env.FOOTBALL_DATA_SEASON ? Number(process.env.FOOTBALL_DATA_SEASON) : undefined
      const cached = requestedYear === undefined
        ? await mongo.getLatestSeasonSnapshot(process.env.FOOTBALL_DATA_COMPETITION ?? 'PL')
        : await mongo.getSeasonSnapshot(process.env.FOOTBALL_DATA_COMPETITION ?? 'PL', requestedYear)
      if (cached) {
        providerRepository.loadSnapshot(cached, 'football-data.org v4 · persisted MongoDB snapshot')
        activeSnapshot = cached
        lastSyncedAt = cached.syncedAt
        dataSource = providerRepository.source
      } else {
        dataSource = 'Oracle Database · provider snapshot unavailable'
        syncError = 'No persisted football-data.org snapshot is available. Run syncFootballData to load provider team, standings, and scorer data.'
      }
    } catch (error) {
      dataSource = 'Oracle Database · provider snapshot unavailable'
      syncError = `Stored football-data.org snapshot could not be loaded: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  if (repository === providerRepository && providerRepository.seasonYear !== null) {
    const imported = await mongo.getImportedMatches(providerRepository.seasonYear)
    if (imported.length) {
      await providerRepository.importMatches(imported)
      dataSource = `${dataSource} · CSV supplements`
    }
  }
  if (repository === providerRepository) {
    providerRepository.source = dataSource
    providerRepository.syncError = syncError
  }
  const oracle = repository instanceof OracleRepository ? repository : null
  const context: GraphContext = {
    repository, providerRepository, mongo, provider, oracle, lastSyncedAt,
    dataSource, syncError, activeSnapshot,
    benchmarkIterations: Number(process.env.BENCHMARK_ITERATIONS ?? 30),
  }
  const apollo = new ApolloServer<GraphContext>({
    typeDefs,
    resolvers: createResolvers(),
    formatError(formattedError) {
      console.error(`GraphQL error [${formattedError.extensions?.code ?? 'UNKNOWN'}]: ${formattedError.message}`)
      return formattedError
    },
  })
  await apollo.start()
  const app = express()
  app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' }))
  app.get('/health', (_request, response) => response.json({
    status: 'ok', storage: context.repository.mode,
    source: context.providerRepository.lastSyncedAt
      ? context.providerRepository.source
      : context.repository.mode === 'provider-cache' ? context.providerRepository.source : context.dataSource,
    mongo: mongo.status, apiConfigured: provider.configured,
    lastSyncedAt: context.providerRepository.lastSyncedAt ?? context.lastSyncedAt,
    syncError: context.repository.mode === 'provider-cache' ? context.providerRepository.syncError : context.syncError,
  }))
  app.use('/graphql', express.json({ limit: '2mb' }), expressMiddleware(apollo, { context: async () => context }))
  const httpServer = app.listen(apiPort, () => {
    console.log(`PitchIQ GraphQL API listening at http://localhost:${apiPort}/graphql`)
  })
  let shuttingDown = false
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    process.exitCode = exitCode
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => error ? reject(error) : resolve())
      })
    }
    await Promise.all([apollo.stop(), repository.close(), mongo.close()])
  }
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    const reason = error.code === 'EADDRINUSE'
      ? `port ${apiPort} is already in use. Stop the existing API process or set API_PORT to another available port.`
      : `could not listen on port ${apiPort}: ${error.message}`
    console.error(`PitchIQ API failed to start: ${reason}`)
    void shutdown(1).catch((shutdownError: unknown) => {
      console.error(`PitchIQ API cleanup failed: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`)
      process.exitCode = 1
    })
  })
  process.on('SIGINT', () => {
    void shutdown().catch((error: unknown) => {
      console.error(`PitchIQ API shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
  })
  process.on('SIGTERM', () => {
    void shutdown().catch((error: unknown) => {
      console.error(`PitchIQ API shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
  })
}

start().catch((error: unknown) => {
  console.error(`PitchIQ API failed to start: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
