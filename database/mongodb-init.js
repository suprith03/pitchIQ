db = db.getSiblingDB('pitchiq');
db.api_cache.createIndex({ key: 1 }, { unique: true });
db.api_cache.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
db.simulation_results.createIndex({ createdAt: 1 });
db.match_events.createIndex({ provider: 1, providerMatchId: 1 }, { unique: true });
db.football_seasons.createIndex({ competition: 1, seasonYear: 1 }, { unique: true });
