/**
 * cluster.js - Start All 3 Nodes at Once
 * 
 * This script spawns 3 separate node processes:
 * - node1 on port 3001
 * - node2 on port 3002  
 * - node3 on port 3003
 * 
 * They will automatically form a cluster and elect a leader!
 */

import { spawn } from 'child_process';
import process from 'process';

// Banner
console.log('\n' + '╔' + '═'.repeat(68) + '╗');
console.log('║' + ' '.repeat(15) + '🚀 DistributedSync - Raft Cluster' + ' '.repeat(19) + '║');
console.log('╚' + '═'.repeat(68) + '╝\n');

console.log('Starting 3-node cluster...\n');
console.log('📍 Node 1: http://localhost:3001');
console.log('📍 Node 2: http://localhost:3002');
console.log('📍 Node 3: http://localhost:3003\n');

console.log('━'.repeat(70));
console.log('What to expect:');
console.log('1️⃣  All nodes start as FOLLOWERs');
console.log('2️⃣  Election timeout triggers (one node becomes CANDIDATE)');
console.log('3️⃣  Nodes vote, one wins and becomes LEADER 🎉');
console.log('4️⃣  Leader sends heartbeats to maintain leadership');
console.log('━'.repeat(70) + '\n');

// Define the 3 nodes
const nodes = [
  {
    id: 'node1',
    port: 3001,
    peers: ['node2:3002', 'node3:3003']
  },
  {
    id: 'node2',
    port: 3002,
    peers: ['node1:3001', 'node3:3003']
  },
  {
    id: 'node3',
    port: 3003,
    peers: ['node1:3001', 'node2:3002']
  }
];

const processes = [];

// Start each node as a separate process
nodes.forEach((node, index) => {
  const args = [
    'src/server.js',
    '--id', node.id,
    '--port', node.port.toString(),
    '--peers', ...node.peers
  ];
  
  console.log(`🔧 Spawning ${node.id}...`);
  
  const proc = spawn('node', args, {
    stdio: 'inherit' // Show output from child processes
  });
  
  processes.push(proc);
  
  proc.on('error', (err) => {
    console.error(`❌ Error starting ${node.id}:`, err.message);
  });
  
  proc.on('exit', (code, signal) => {
    if (signal === 'SIGINT' || signal === 'SIGTERM') {
      console.log(`\n[${node.id}] Stopped gracefully`);
    } else {
      console.log(`\n[${node.id}] Exited with code ${code}`);
    }
  });
});

console.log('\n✅ All nodes started!\n');

console.log('━'.repeat(70));
console.log('💡 TIP: Watch for "WON ELECTION" to see who becomes leader!');
console.log('━'.repeat(70));

console.log('\n📝 Once a leader is elected, try these commands:\n');
console.log('   # Save data');
console.log('   curl -X POST http://localhost:3001/set \\');
console.log('     -H "Content-Type: application/json" \\');
console.log('     -d \'{"key":"name","value":"Alice"}\'\n');
console.log('   # Read from different node');
console.log('   curl http://localhost:3002/get/name\n');
console.log('   # Check status');
console.log('   curl http://localhost:3001/status\n');

console.log('━'.repeat(70));
console.log('Press Ctrl+C to stop all nodes');
console.log('━'.repeat(70) + '\n');

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

function shutdown() {
  console.log('\n\n' + '━'.repeat(70));
  console.log('🛑 Shutting down cluster...');
  console.log('━'.repeat(70) + '\n');
  
  // Kill all child processes
  processes.forEach((proc) => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  
  // Wait a bit for graceful shutdown
  setTimeout(() => {
    console.log('✅ Cluster stopped\n');
    process.exit(0);
  }, 1000);
}

// Handle Ctrl+C
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Keep the script running
process.stdin.resume();
