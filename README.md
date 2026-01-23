# DistributedSync - Learning How Distributed Systems Work

This is a simple implementation of the Raft consensus algorithm to help you understand how multiple servers stay synchronized. When you have 3 servers running the same application, how do they all agree on the same data? This project shows you!

## What Does This Do?

Imagine you have 3 servers. When someone saves data on one server, all 3 servers need to have the same data. But what if one server crashes? What if two servers get different requests at the same time? This project solves those problems by:

- **Electing a leader** - One server becomes the boss and coordinates everything
- **Replicating data** - The leader copies data to all followers
- **Handling failures** - If the leader crashes, a new leader is elected automatically

## Quick Start

```bash
# Install dependencies
npm install

# Start 3 servers at once
npm run dev
```

You'll see the servers start up, hold an election, and one will become the LEADER. The others become FOLLOWERs.

## Testing It Out

**Option 1: Run the test script (easiest)**

In a NEW terminal (keep the cluster running), run:
```bash
./test.sh
```

This will automatically test data replication across all nodes!

**Option 2: Manual testing**

Once the servers are running (you'll see "WON ELECTION"), try these commands:

**Save some data:**
```bash
curl -X POST http://localhost:3001/set \
  -H "Content-Type: application/json" \
  -d '{"key":"username","value":"alice"}'
```

**Read the data from a different server:**
```bash
curl http://localhost:3002/get/username
```

You'll see the same data! That's replication in action.

**Check which server is the leader:**
```bash
curl http://localhost:3001/status
```

## What You'll Learn

- **Leader Election**: How servers automatically pick a leader without human help
- **Log Replication**: How data gets copied to all servers
- **Consensus**: How servers agree on the same data even with failures
- **Fault Tolerance**: What happens when a server crashes (try Ctrl+C on one!)

## What Happens When a Server Crashes?

Try this experiment:
1. Start the cluster with `npm run dev`
2. Wait for a leader to be elected
3. Find which node is the leader (look for "WON ELECTION")
4. Press Ctrl+C to kill that terminal
5. Watch the other 2 servers elect a new leader!

This is how real distributed systems like databases and cloud services stay online even when servers fail.

## Files in This Project

- **src/RaftNode.js** - The brain of each server (leader election, data replication)
- **src/server.js** - HTTP server that accepts commands
- **src/cluster.js** - Script to start all 3 servers at once

## Learn More

This is based on the Raft consensus algorithm. Want to learn more? Check out:
- [The Secret Lives of Data](http://thesecretlivesofdata.com/raft/) - Animated explanation
- [Raft Paper](https://raft.github.io/raft.pdf) - Original research paper
