import { MockedProvider } from '@apollo/client/testing/react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App, { DASHBOARD_QUERY, PointsRaceTick } from './App'

const team = (id: string, name: string) => ({ id, name, crest: null })
const mock = {
  request: { query: DASHBOARD_QUERY },
  result: {
    data: {
      standings: [{ position: 1, team: { ...team('test-united', 'Test United'), crest: 'https://example.test/test-united.png' }, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2, points: 3, form: 'W' }],
      matches: [],
      scorers: [{ player: 'Test Striker', team: { ...team('example-city', 'Example City'), crest: 'https://example.test/crest.png' }, goals: 4, penalties: 1 }],
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

  it('shows provider team crests alongside scorer records', async () => {
    render(<MockedProvider mocks={[mock]}><App /></MockedProvider>)
    expect(await screen.findByRole('heading', { name: 'League overview' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Top scorers' })[0]!)
    expect(await screen.findByRole('heading', { name: 'Top scorers' })).toBeInTheDocument()
    const crest = screen.getByAltText('Example City crest')
    expect(crest).toHaveAttribute('src', 'https://example.test/crest.png')
    expect(screen.getByText('Test Striker')).toBeInTheDocument()
    fireEvent.error(crest)
    expect(screen.getByLabelText('Example City crest unavailable')).toBeInTheDocument()
  })

  it('renders team crests on points race ticks and falls back to initials when unavailable', () => {
    const { container } = render(<svg><PointsRaceTick x={10} y={20} name="Test United" crest="https://example.test/test-united.png" size={22} /></svg>)
    const tick = within(container)
    expect(tick.getByRole('img', { name: 'Test United crest' })).toBeInTheDocument()
    const crest = container.querySelector('.points-race-tick image')
    expect(crest).toHaveAttribute('href', 'https://example.test/test-united.png')
    fireEvent.error(crest!)
    expect(tick.getByText('TU')).toBeInTheDocument()
  })

  it('defaults to light, persists theme changes, and keeps the signature on each page', async () => {
    const storedValues = new Map<string, string>()
    const originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storedValues.get(key) ?? null,
        setItem: (key: string, value: string) => storedValues.set(key, value),
        removeItem: (key: string) => storedValues.delete(key),
      },
    })
    const { container, unmount } = render(<MockedProvider mocks={[mock]}><App /></MockedProvider>)
    const app = within(container)
    try {
      const toggle = app.getByRole('switch', { name: 'Switch to dark theme' })
      expect(await app.findByText('@Suprith Singh')).toBeInTheDocument()
      expect(document.documentElement).toHaveAttribute('data-theme', 'light')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-checked', 'true')
      expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
      expect(storedValues.get('pitchiq-theme')).toBe('dark')
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-checked', 'false')
      expect(document.documentElement).toHaveAttribute('data-theme', 'light')
      expect(storedValues.get('pitchiq-theme')).toBe('light')
      fireEvent.click(app.getByRole('button', { name: 'League table' }))
      expect(await app.findByRole('heading', { name: 'League table' })).toBeInTheDocument()
      expect(app.getByText('@Suprith Singh')).toBeInTheDocument()
    } finally {
      unmount()
      if (originalStorage) Object.defineProperty(window, 'localStorage', originalStorage)
      else Reflect.deleteProperty(window, 'localStorage')
      document.documentElement.dataset.theme = 'light'
    }
  })
})
