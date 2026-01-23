/**
 * RaftNode.js - The Heart of Our Distributed System
 * 
 * This class represents one server (node) in our distributed system.
 * Each node can be in one of 3 states:
 * 
 * FOLLOWER - Listens to the leader and replicates data
 * CANDIDATE - Trying to become the leader (during an election)
 * LEADER - The boss! Coordinates all data changes
 * 
 * The magic of Raft is that nodes automatically elect a leader,
 * and if the leader crashes, they elect a new one!
 */

export class RaftNode {
  // The 3 possible states a node can be in
  static FOLLOWER = 'FOLLOWER';
  static CANDIDATE = 'CANDIDATE';
  static LEADER = 'LEADER';

  constructor(id, port, peers) {
    // Basic identification
    this.id = id;                    // e.g., "node1"
    this.port = port;                // e.g., 3001
    this.peers = peers;              // Other nodes: [{id: "node2", port: 3002}, ...]
    
    // Raft persistent state (would be saved to disk in production)
    this.currentTerm = 0;            // Election term number (increments with each election)
    this.votedFor = null;            // Who we voted for in current term
    this.log = [];                   // Commands we've received: [{term, key, value}, ...]
    
    // Raft volatile state (can be rebuilt)
    this.commitIndex = 0;            // Highest log entry we know is committed
    this.lastApplied = 0;            // Highest log entry applied to our store
    this.state = RaftNode.FOLLOWER;  // Everyone starts as a follower
    
    // Our actual data storage (the "state machine")
    this.store = new Map();          // key -> value storage
    
    // Leader tracking
    this.leaderId = null;            // Who's the current leader?
    
    // Timers
    this.electionTimer = null;       // When this expires, start an election
    this.heartbeatTimer = null;      // Leader uses this to send heartbeats
    
    // Vote tracking (for when we're a candidate)
    this.votesReceived = new Set();  // Track who voted for us
    
    console.log(`\n[${this.id}] 🚀 Starting up as a ${this.state}`);
    console.log(`[${this.id}] 📍 Listening on port ${this.port}`);
    console.log(`[${this.id}] 🤝 Connected to peers: ${peers.map(p => p.id).join(', ')}\n`);
    
    // Start the election timer (will fire if we don't hear from a leader)
    this.resetElectionTimeout();
  }

  /**
   * Reset Election Timeout
   * 
   * WHY: We use a random timeout (150-300ms) so that all nodes don't
   * try to become leader at the exact same time. This prevents ties!
   * 
   * When this timer expires, the node will start an election.
   * We reset this timer whenever we hear from the leader.
   */
  resetElectionTimeout() {
    // Clear existing timer
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
    
    // Random timeout between 150-300ms
    // WHY RANDOM: If all nodes had the same timeout, they'd all become
    // candidates at once and constantly tie. Random prevents this!
    const timeout = 150 + Math.random() * 150;
    
    this.electionTimer = setTimeout(() => {
      // Only followers and candidates can timeout and start elections
      // (Leaders don't need to - they're already in charge!)
      if (this.state !== RaftNode.LEADER) {
        console.log(`[${this.id}] ⏰ Election timeout! Haven't heard from leader.`);
        this.startElection();
      }
    }, timeout);
  }

  /**
   * Start Election
   * 
   * This is called when we haven't heard from the leader in a while.
   * We become a CANDIDATE and ask other nodes to vote for us.
   */
  startElection() {
    console.log(`[${this.id}] 🗳️  STARTING ELECTION!`);
    
    // Become a candidate
    this.state = RaftNode.CANDIDATE;
    
    // Increment term (we're trying for a new term)
    this.currentTerm += 1;
    
    // Vote for ourselves
    this.votedFor = this.id;
    this.votesReceived = new Set([this.id]);
    
    console.log(`[${this.id}] 📊 Term ${this.currentTerm} - Voted for myself (1 vote so far)`);
    
    // Reset election timer in case we don't win
    // (if we don't hear back from enough nodes, we'll try again)
    this.resetElectionTimeout();
    
    // Check if we already won (possible if we're the only node)
    this.checkElectionResult();
  }

  /**
   * Handle Request Vote
   * 
   * Another node is asking for our vote. Should we grant it?
   * 
   * Rules:
   * 1. Only vote once per term
   * 2. Only vote for candidates with at least as much data as us
   * 3. If candidate has higher term, update our term
   */
  handleRequestVote(candidateId, candidateTerm) {
    console.log(`[${this.id}] 📬 Vote request from ${candidateId} (term ${candidateTerm})`);
    
    // If candidate has a higher term than us, update our term
    if (candidateTerm > this.currentTerm) {
      console.log(`[${this.id}] 📈 Candidate has newer term! Updating ${this.currentTerm} -> ${candidateTerm}`);
      this.currentTerm = candidateTerm;
      this.votedFor = null;
      this.state = RaftNode.FOLLOWER;
    }
    
    // Reject if candidate's term is old
    if (candidateTerm < this.currentTerm) {
      console.log(`[${this.id}] ❌ DENIED - Candidate's term ${candidateTerm} is old (we're on ${this.currentTerm})`);
      return { voteGranted: false, term: this.currentTerm };
    }
    
    // Reject if we already voted for someone else this term
    if (this.votedFor !== null && this.votedFor !== candidateId) {
      console.log(`[${this.id}] ❌ DENIED - Already voted for ${this.votedFor} this term`);
      return { voteGranted: false, term: this.currentTerm };
    }
    
    // Grant the vote!
    this.votedFor = candidateId;
    this.resetElectionTimeout(); // Reset timer since we heard from a candidate
    console.log(`[${this.id}] ✅ GRANTED vote to ${candidateId}`);
    
    return { voteGranted: true, term: this.currentTerm };
  }

  /**
   * Receive Vote Response
   * 
   * Called when another node responds to our vote request
   */
  receiveVoteResponse(fromNodeId, voteGranted, term) {
    // If we're not a candidate anymore, ignore
    if (this.state !== RaftNode.CANDIDATE) {
      return;
    }
    
    // If they have a higher term, step down
    if (term > this.currentTerm) {
      console.log(`[${this.id}] 📉 Vote response has higher term. Stepping down to FOLLOWER.`);
      this.currentTerm = term;
      this.state = RaftNode.FOLLOWER;
      this.votedFor = null;
      return;
    }
    
    // If vote granted, record it
    if (voteGranted) {
      this.votesReceived.add(fromNodeId);
      console.log(`[${this.id}] ✅ Got vote from ${fromNodeId} (${this.votesReceived.size} votes total)`);
      this.checkElectionResult();
    }
  }

  /**
   * Check Election Result
   * 
   * Do we have enough votes to become leader?
   * Need majority: (total nodes / 2) + 1
   * With 3 nodes: need 2 votes
   */
  checkElectionResult() {
    if (this.state !== RaftNode.CANDIDATE) {
      return;
    }
    
    const totalNodes = this.peers.length + 1; // peers + ourselves
    const majority = Math.floor(totalNodes / 2) + 1;
    
    if (this.votesReceived.size >= majority) {
      this.becomeLeader();
    }
  }

  /**
   * Become Leader
   * 
   * We won the election! Time to take charge.
   */
  becomeLeader() {
    console.log(`\n[${this.id}] 🎉 WON ELECTION! I'm the leader for term ${this.currentTerm}!`);
    console.log(`[${this.id}] 👑 Now coordinating all data changes\n`);
    
    this.state = RaftNode.LEADER;
    this.leaderId = this.id;
    
    // Stop election timer
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
    
    // Start sending heartbeats to followers
    this.startHeartbeat();
  }

  /**
   * Start Heartbeat
   * 
   * Leaders send regular "heartbeats" to followers to say:
   * "I'm still alive! Don't start an election!"
   * 
   * Also used to replicate log entries to followers.
   */
  startHeartbeat() {
    // Send heartbeat every 50ms
    this.heartbeatTimer = setInterval(() => {
      if (this.state === RaftNode.LEADER) {
        // console.log(`[${this.id}] 💓 Sending heartbeat to followers`);
        // Actual sending happens in server.js
      } else {
        // Not leader anymore, stop heartbeats
        clearInterval(this.heartbeatTimer);
      }
    }, 50);
  }

  /**
   * Handle Append Entries
   * 
   * The leader is sending us data (or just a heartbeat).
   * 
   * This is how the leader:
   * 1. Tells us it's still alive (heartbeat)
   * 2. Sends us new log entries to replicate
   * 3. Tells us which entries are committed (safe to apply)
   */
  handleAppendEntries(leaderId, leaderTerm, entries, leaderCommit) {
    // If leader has old term, reject
    if (leaderTerm < this.currentTerm) {
      console.log(`[${this.id}] ❌ Rejected AppendEntries - leader term ${leaderTerm} is old`);
      return { success: false, term: this.currentTerm };
    }
    
    // Update our term if leader has newer term
    if (leaderTerm > this.currentTerm) {
      this.currentTerm = leaderTerm;
      this.votedFor = null;
    }
    
    // Become follower if we're not already
    if (this.state !== RaftNode.FOLLOWER) {
      console.log(`[${this.id}] 👤 Leader exists! Becoming FOLLOWER`);
      this.state = RaftNode.FOLLOWER;
    }
    
    // Update who the leader is
    this.leaderId = leaderId;
    
    // Reset election timeout (we heard from leader!)
    this.resetElectionTimeout();
    
    // If there are new entries, add them to our log
    if (entries && entries.length > 0) {
      console.log(`[${this.id}] 📝 Received ${entries.length} new log entries from leader`);
      this.log.push(...entries);
    }
    
    // Update commit index and apply entries
    if (leaderCommit > this.commitIndex) {
      this.commitIndex = Math.min(leaderCommit, this.log.length);
      this.applyCommittedEntries();
    }
    
    return { success: true, term: this.currentTerm };
  }

  /**
   * Apply Committed Entries
   * 
   * Move committed log entries into our actual data store.
   * This is when data becomes "real" - before this, it's just
   * in the log waiting to be confirmed.
   */
  applyCommittedEntries() {
    while (this.lastApplied < this.commitIndex) {
      const entry = this.log[this.lastApplied];
      
      if (entry) {
        // Apply the command to our store
        this.store.set(entry.key, entry.value);
        console.log(`[${this.id}] 💾 SAVED to store: ${entry.key} = "${entry.value}"`);
      }
      
      this.lastApplied++;
    }
  }

  /**
   * Execute Command
   * 
   * Client wants to save data. Only the leader can do this!
   * Followers will redirect clients to the leader.
   */
  executeCommand(key, value) {
    // Only leader can accept writes
    if (this.state !== RaftNode.LEADER) {
      console.log(`[${this.id}] ⚠️  Can't execute - not the leader! Leader is: ${this.leaderId}`);
      return { 
        success: false, 
        error: 'Not the leader', 
        leaderId: this.leaderId 
      };
    }
    
    console.log(`[${this.id}] 📥 New command: SET ${key} = "${value}"`);
    
    // Add to our log
    const entry = {
      term: this.currentTerm,
      key: key,
      value: value
    };
    this.log.push(entry);
    
    console.log(`[${this.id}] ✅ Added to log (will replicate to followers)`);
    
    // In a full implementation, we'd wait for majority replication
    // For simplicity, we'll commit immediately
    this.commitIndex = this.log.length;
    this.applyCommittedEntries();
    
    return { success: true, message: 'Command executed' };
  }

  /**
   * Get Value
   * 
   * Read data from our store. Any node can do this!
   */
  getValue(key) {
    const value = this.store.get(key);
    if (value !== undefined) {
      console.log(`[${this.id}] 📖 READ from store: ${key} = "${value}"`);
    } else {
      console.log(`[${this.id}] 📖 READ from store: ${key} = (not found)`);
    }
    return value;
  }

  /**
   * Get Status
   * 
   * Return current state of this node (for debugging/monitoring)
   */
  getStatus() {
    return {
      id: this.id,
      port: this.port,
      state: this.state,
      term: this.currentTerm,
      leaderId: this.leaderId,
      logSize: this.log.length,
      commitIndex: this.commitIndex,
      storeSize: this.store.size,
      isLeader: this.state === RaftNode.LEADER
    };
  }

  /**
   * Shutdown
   * 
   * Clean up when shutting down
   */
  shutdown() {
    console.log(`[${this.id}] 🛑 Shutting down...`);
    
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
    }
    
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    console.log(`[${this.id}] ✅ Shutdown complete`);
  }
}

export default RaftNode;
