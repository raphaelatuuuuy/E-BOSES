-- ============================================================
-- E-Boses — PostGIS Initialization Script
-- ============================================================
-- This script runs when the postgis/postgis container starts
-- for the first time. It enables required extensions.
-- ============================================================

-- Enable PostGIS (spatial database support)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
