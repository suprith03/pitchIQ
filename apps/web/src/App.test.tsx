import { MockedProvider } from '@apollo/client/testing/react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App, { DASHBOARD_QUERY } from './App'

const team = (id: string, name: string) => ({ id, name, crest: null })
const mock = {
  request: { query: DASHBOARD_QUERY },
  result: {
    data: {
      standings: [{ position: 1, team: team('test-united', 'Test United'), played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3, form: 'W' }],
      matches: [],
      scorers: [],
      teams: [team('test-united', 'Test United'), team('example-city', 'Example City')],
      dataHealth: {
        storageMode: 'provider-cache', source: 'football-data.org v4 · live', mongo: 'connected',
        apiConfigured: false, lastSyncedAt: null, seasonYear: null, syncError: null, providerWarnings: [], mongoCollections: [],
      },
    },
  },
}
const emptySeasonMock = {
  request: { query: DASHBOARD_QUERY },
  result: {
    data: {
      standings: [],
      matches: [],
      scorers: [],
      teams: [],
      dataHealth: {
        storageMode: 'provider-cache', source: 'football-data.org v4 · unavailable', mongo: 'connected',
        apiConfigured: true, lastSyncedAt: null, seasonYear: null, syncError: 'Provider returned HTTP 503',
        providerWarnings: [], mongoCollections: [],
      },
    },
  },
}

describe('PitchIQ dashboard interactions', () => {
  it('loads GraphQL-backed dashboard data and navigates to the standings page', async () => {
    render(<MockedProvider mocks={[mock]}><App /></MockedProvider>)
    expect(await screen.findByRole('heading', { name: 'League overview' })).toBeInTheDocument()
    expect(screen.getAllByText('Test United').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'League table' }))
    expect(await screen.findByRole('heading', { name: 'League table' })).toBeInTheDocument()
    expect(screen.getByText('Full standings, form and goal difference. Tie-breaks: points, goal difference, goals scored.')).toBeInTheDocument()
  })

  it('shows the provider error and an empty state instead of fabricated league statistics', async () => {
    render(<MockedProvider mocks={[emptySeasonMock]}><App /></MockedProvider>)
    expect(await screen.findByRole('heading', { name: 'No league data available' })).toBeInTheDocument()
    expect(screen.getByText('Provider returned HTTP 503')).toBeInTheDocument()
    expect(screen.getByText(/No sample or fictional data is shown/)).toBeInTheDocument()
  })
})
