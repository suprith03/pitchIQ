const endpoint = process.env.PITCHIQ_GRAPHQL_URL ?? 'http://localhost:4000/graphql'
const argumentIndex = process.argv.findIndex((argument) => argument === '--iterations')
const inlineArgument = process.argv.find((argument) => argument.startsWith('--iterations='))
const argumentValue = inlineArgument?.split('=', 2)[1] ?? (argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined)
const iterations = Number(argumentValue ?? process.env.BENCHMARK_ITERATIONS ?? 30)

if (!Number.isInteger(iterations) || iterations < 1 || iterations > 200) {
  console.error('Usage: npm run benchmark -- --iterations <1..200>')
  process.exitCode = 2
} else {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query Benchmark($iterations: Int) {
          benchmark(iterations: $iterations) {
            metrics { database query iterations totalMs averageMs minMs maxMs }
            unavailable
          }
        }`,
        variables: { iterations },
      }),
    })
    const result = await response.json()
    if (!response.ok || result.errors?.length) {
      throw new Error(result.errors?.map((error) => error.message).join('; ') || `HTTP ${response.status}`)
    }
    console.log(JSON.stringify(result.data.benchmark, null, 2))
  } catch (error) {
    console.error(`Benchmark request failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
