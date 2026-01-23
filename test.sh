#!/bin/bash

# test.sh - Simple test script for DistributedSync

echo ""
echo "🧪 Testing DistributedSync Cluster"
echo "=================================="
echo ""

# Wait for cluster to be ready
echo "⏳ Waiting 3 seconds for leader election..."
sleep 3

echo ""
echo "1️⃣  Saving data to node1..."
curl -s -X POST http://localhost:3001/set \
  -H "Content-Type: application/json" \
  -d '{"key":"username","value":"alice"}' | jq '.'

echo ""
echo "2️⃣  Reading data from node2 (different node!)..."
curl -s http://localhost:3002/get/username | jq '.'

echo ""
echo "3️⃣  Saving more data..."
curl -s -X POST http://localhost:3001/set \
  -H "Content-Type: application/json" \
  -d '{"key":"city","value":"Tokyo"}' | jq '.'

echo ""
echo "4️⃣  Reading from node3..."
curl -s http://localhost:3003/get/city | jq '.'

echo ""
echo "5️⃣  Checking cluster status..."
echo "   Node 1:"
curl -s http://localhost:3001/status | jq '{id, state, term, leaderId, isLeader}'
echo "   Node 2:"
curl -s http://localhost:3002/status | jq '{id, state, term, leaderId, isLeader}'
echo "   Node 3:"
curl -s http://localhost:3003/status | jq '{id, state, term, leaderId, isLeader}'

echo ""
echo "✅ Test complete!"
echo ""
