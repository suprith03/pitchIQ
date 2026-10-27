import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(rootDirectory, '.env') })

function commandWorks(command, args) {
  const result = spawnSync(command, args, { cwd: rootDirectory, stdio: 'ignore' })
  return !result.error && result.status === 0
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: rootDirectory, stdio: 'inherit', ...options })
  if (result.error) throw new Error(`Could not run ${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
}

function ensureDockerIsRunning() {
  if (commandWorks('docker', ['info'])) return
  if (process.platform !== 'darwin') {
    throw new Error('Docker is not running. Start Docker Desktop or your Docker service, then retry.')
  }
  if (!commandWorks('colima', ['status'])) {
    console.log('Docker is not running; starting Colima...')
    runCommand('colima', ['start'])
  }
  if (!commandWorks('docker', ['info'])) {
    throw new Error('Colima started, but Docker is still unavailable. Check the Colima status and retry.')
  }
}

function getComposeCommand() {
  if (commandWorks('docker-compose', ['version'])) return ['docker-compose', []]
  if (commandWorks('docker', ['compose', 'version'])) return ['docker', ['compose']]
  throw new Error('Docker Compose is not installed. Install Docker Compose and retry.')
}

function startDatabases(storageMode) {
  const [command, prefixArgs] = getComposeCommand()
  const oracleMode = storageMode === 'oracle'
  const args = [
    ...prefixArgs,
    ...(oracleMode ? ['--profile', 'oracle'] : []),
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '900',
    'mongodb',
    ...(oracleMode ? ['oracle'] : []),
  ]
  console.log(`Starting local ${oracleMode ? 'MongoDB and Oracle' : 'MongoDB'} and waiting for healthy services...`)
  runCommand(command, args)
}

function startApplications() {
  const concurrentlyPath = path.join(rootDirectory, 'node_modules/concurrently/dist/bin/concurrently.js')
  if (!existsSync(concurrentlyPath)) {
    throw new Error('Project dependencies are missing. Run npm install and retry.')
  }
  const child = spawn(process.execPath, [
    concurrentlyPath,
    '-k',
    '-n',
    'api,web',
    '-c',
    'blue,green',
    'cd apps/api && "$NODE" ../../node_modules/tsx/dist/cli.mjs watch src/index.ts',
    'cd apps/web && "$NODE" ../../node_modules/vite/bin/vite.js',
  ], { cwd: rootDirectory, stdio: 'inherit' })

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('error', (error) => {
    console.error(`Could not start the development servers: ${error.message}`)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    process.exitCode = signal ? 1 : code ?? 1
  })
}

try {
  const storageMode = process.env.STORAGE_MODE ?? 'provider-cache'
  if (storageMode !== 'provider-cache' && storageMode !== 'oracle') {
    throw new Error(`Unsupported STORAGE_MODE "${storageMode}". Use "provider-cache" or "oracle".`)
  }
  try {
    ensureDockerIsRunning()
    startDatabases(storageMode)
  } catch (error) {
    if (storageMode === 'oracle') throw error
    console.warn(`Local MongoDB could not be started: ${error instanceof Error ? error.message : String(error)}`)
    console.warn('Starting in provider-cache mode without MongoDB; database persistence will be unavailable.')
  }
  startApplications()
} catch (error) {
  console.error(`PitchIQ dev setup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
