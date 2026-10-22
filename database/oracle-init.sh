#!/bin/bash
set -euo pipefail

: "${APP_USER:?APP_USER must be set by the Oracle image}"
: "${APP_USER_PASSWORD:?APP_USER_PASSWORD must be set by the Oracle image}"

sqlplus -s /nolog <<SQL
WHENEVER SQLERROR EXIT SQL.SQLCODE
CONNECT ${APP_USER}/"${APP_USER_PASSWORD}"@FREEPDB1
@/opt/pitchiq/001_initial_schema.sql
EXIT
SQL
