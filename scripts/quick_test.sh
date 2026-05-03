#!/usr/bin/env bash
# Quick test script to exercise API endpoints (assumes server at http://127.0.0.1:8000)
set -euo pipefail
BASE=http://127.0.0.1:8000

echo "Create house"
curl -s -X POST $BASE/houses -H "Content-Type: application/json" -d '{"name":"Flat"}' | jq || true

echo "\nCreate store (house 1)"
# create a store for price tests
curl -s -X POST $BASE/houses/1/stores -H "Content-Type: application/json" -d '{"name":"Asda"}' | jq || true

echo "\nAdd ingredient (Tomatoes)"
curl -s -X POST $BASE/houses/1/ingredients -H "Content-Type: application/json" -d '{"name":"Tomatoes","canonical_unit":"g","has_any":false}' | jq || true

echo "\nAdd price for ingredient 1 at store 1"
curl -s -X POST $BASE/ingredients/1/prices -H "Content-Type: application/json" -d '{"store_id":1,"price":3.5,"price_unit":"500g","unit_size":500,"unit_size_unit":"g","currency":"GBP","source":"manual"}' | jq || true

echo "\nToggle ingredient has_any to true"
curl -s -X PATCH $BASE/ingredients/1 -H "Content-Type: application/json" -d '{"has_any":true}' | jq || true

echo "\nAdd shopping list item for ingredient 1"
curl -s -X POST $BASE/houses/1/shopping-list -H "Content-Type: application/json" -d '{"ingredient_id":1,"auto_generated":false}' | jq || true

echo "\nToggle shopping list item 1"
curl -s -X PATCH $BASE/shopping-list/1 | jq || true

echo "done"

