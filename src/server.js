/**
 * server.js - HTTP Server for Each Raft Node
 * 
 * This creates an Express server that:
 * 1. Accepts client requests (set/get data)
 * 2. Handles Raft communication between nodes (voting, heartbeats)
 * 
 * Each node runs its own server on a different port.
 */

import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import { RaftNode } from './RaftNode.js';

/**
 * Parse Command Line Arguments
 * 
 * Example: node server.js --id node1 --port 3001 --peers node2:3002 node3:3003
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config = { peers: [] };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--id') {
      config.id = args[i + 1];
      i++;
    } else if (args[i] === '--port') {
      config.port = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--peers') {
      // Parse peers: node2:3002 node3:3003
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        const [peerId, peerPort] = args[i].split(':');
        config.peers.push({
          id: peerId,
          host: 'localhost',
          port: parseInt(peerPort)
        });
        i++;
      }
      i--; // Back up one since loop will increment
    }
  }
  
  return config;
}

// Parse arguments and create Raft node
const config = parseArgs();

if (!config.id || !config.port) {
  console.error('Usage: node server.js --id <node-id> --port <port> --peers <peer1:port1> <peer2:port2>');
  process.exit(1);
}

console.log('\n' + '='.repeat(70));
console.log(`🖥️  Starting Node: ${config.id}`);
console.log(`📡 Port: ${config.port}`);
console.log(`🔗 Peers: ${config.peers.map(p => `${p.id}:${p.port}`).join(', ')}`);
console.log('='.repeat(70));

// Create the Raft node
const raftNode = new RaftNode(config.id, config.port, config.peers);

// Create Express app
const app = express();
app.use(bodyParser.json());

// ============================================================================
// CLIENT ENDPOINTS (for users to interact with the cluster)
// ============================================================================

/**
 * POST /set
 * 
 * Save data to the cluster. Only works if this node is the leader!
 * If not leader, will tell you who the leader is.
 * 
 * Body: { "key": "username", "value": "alice" }
 */
app.post('/set', (req, res) => {
  const { key, value } = req.body;
  
  if (!key || value === undefined) {
    return res.status(400).json({ 
      error: 'Missing key or value',
      example: { key: 'username', value: 'alice' }
    });
  }
  
  console.log(`\n[${config.id}] 🌐 HTTP POST /set - key="${key}", value="${value}"`);
  
  const result = raftNode.executeCommand(key, value);
  
  if (!result.success) {
    // Not the leader - tell client who is
    return res.status(503).json({
      error: result.error,
      leaderId: result.leaderId,
      message: `This node is not the leader. Try node: ${result.leaderId}`
    });
  }
  
  // Success! Data saved and will be replicated
  res.json({ 
    success: true, 
    message: 'Data saved and replicated',
    key: key,
    value: value
  });
});

/**
 * GET /get/:key
 * 
 * Read data from this node's store.
 * Works on any node (leader or follower).
 */
app.get('/get/:key', (req, res) => {
  const key = req.params.key;
  
  console.log(`[${config.id}] 🌐 HTTP GET /get/${key}`);
  
  const value = raftNode.getValue(key);
  
  res.json({
    key: key,
    value: value || null,
    found: value !== undefined,
    nodeId: config.id
  });
});

/**
 * GET /status
 * 
 * Get current status of this node (useful for debugging)
 */
app.get('/status', (req, res) => {
  const status = raftNode.getStatus();
  res.json(status);
});

/**
 * GET /health
 * 
 * Simple health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    nodeId: config.id,
    state: raftNode.state
  });
});

// ============================================================================
// RAFT RPC ENDPOINTS (for node-to-node communication)
// ============================================================================

/**
 * POST /requestVote
 * 
 * Another node is asking for our vote in an election.
 * 
 * Body: { "candidateId": "node2", "term": 5 }
 */
app.post('/requestVote', (req, res) => {
  const { candidateId, term } = req.body;
  
  const response = raftNode.handleRequestVote(candidateId, term);
  res.json(response);
});

/**
 * POST /appendEntries
 * 
 * Leader is sending us a heartbeat or log entries to replicate.
 * 
 * Body: { 
 *   "leaderId": "node1", 
 *   "term": 5,
 *   "entries": [{key: "x", value: "y"}],
 *   "leaderCommit": 3
 * }
 */
app.post('/appendEntries', (req, res) => {
  const { leaderId, term, entries, leaderCommit } = req.body;
  
  const response = raftNode.handleAppendEntries(
    leaderId, 
    term, 
    entries || [], 
    leaderCommit || 0
  );
  
  res.json(response);
});

// ============================================================================
// NETWORK COMMUNICATION (sending requests to other nodes)
// ============================================================================

/**
 * Send RequestVote to all peers
 * 
 * Called when we become a candidate and need votes
 */
async function requestVotesFromPeers() {
  const promises = raftNode.peers.map(async (peer) => {
    try {
      const response = await axios.post(
        `http://${peer.host}:${peer.port}/requestVote`,
        {
          candidateId: raftNode.id,
          term: raftNode.currentTerm
        },
        { timeout: 1000 }
      );
      
      // Process the vote response
      raftNode.receiveVoteResponse(
        peer.id,
        response.data.voteGranted,
        response.data.term
      );
    } catch (error) {
      // Peer didn't respond (might be down)
      // This is okay - we can still win with majority of other votes
    }
  });
  
  await Promise.all(promises);
}

/**
 * Send heartbeat/log entries to all followers
 * 
 * Called periodically when we're the leader
 */
async function sendHeartbeatToFollowers() {
  if (raftNode.state !== RaftNode.LEADER) {
    return;
  }
  
  // Get uncommitted entries to send
  const entriesToSend = raftNode.log.slice(raftNode.commitIndex);
  
  const promises = raftNode.peers.map(async (peer) => {
    try {
      await axios.post(
        `http://${peer.host}:${peer.port}/appendEntries`,
        {
          leaderId: raftNode.id,
          term: raftNode.currentTerm,
          entries: entriesToSend,
          leaderCommit: raftNode.commitIndex
        },
        { timeout: 1000 }
      );
    } catch (error) {
      // Follower didn't respond (might be down)
      // This is okay - leader keeps trying
    }
  });
  
  await Promise.all(promises);
}

// Override the RaftNode's startElection to actually send network requests
const originalStartElection = raftNode.startElection.bind(raftNode);
raftNode.startElection = function() {
  originalStartElection();
  // After becoming candidate, request votes from peers
  requestVotesFromPeers();
};

// Override the RaftNode's startHeartbeat to actually send network requests
const originalStartHeartbeat = raftNode.startHeartbeat.bind(raftNode);
raftNode.startHeartbeat = function() {
  originalStartHeartbeat();
  // Send initial heartbeat immediately
  sendHeartbeatToFollowers();
  // Then send regularly
  setInterval(() => {
    if (raftNode.state === RaftNode.LEADER) {
      sendHeartbeatToFollowers();
    }
  }, 50);
};

// ============================================================================
// START SERVER
// ============================================================================

const server = app.listen(config.port, () => {
  console.log(`\n✅ Server running on http://localhost:${config.port}`);
  console.log(`📊 Status: http://localhost:${config.port}/status\n`);
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

function shutdown() {
  console.log(`\n[${config.id}] 🛑 Received shutdown signal`);
  raftNode.shutdown();
  server.close(() => {
    console.log(`[${config.id}] ✅ Server stopped\n`);
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
