#!/usr/bin/env bash
# يطبّق كل ملفات قاعدة البيانات على PostgreSQL محلي ثم يشغّل سيناريوهات الاختبار
# الاستخدام: bash supabase/tests/run.sh   (يحتاج PostgreSQL 15+ ومستخدم postgres)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db=masareef_test
psql_() { sudo -u postgres psql -v ON_ERROR_STOP=1 -q -X "$@"; }
psql_ -c "drop database if exists $db" -c "create database $db"
psql_ -d $db -f "$here/stubs.sql"
for f in "$here"/../migrations/*.sql; do
  echo "→ $(basename "$f")"
  # الإضافات غير متوفرة محلياً (لها بدائل في stubs.sql)، والاستعلام الأخير في 0002 للعرض فقط
  sed -e '/create extension if not exists pg_net/d' -e '/create extension if not exists pg_cron/d' "$f" \
    | psql_ -d $db -o /dev/null
done
echo "→ scenarios"
psql_ -d $db -o /dev/null -f "$here/scenarios.sql"
