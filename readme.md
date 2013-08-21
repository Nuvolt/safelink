# SafeLink

SafeLink is an open-source NodeJS library created to maintain long-term communication between distant remote sites with varying network quality. After deploying many different solutions for one
of our customers, without much success, we decided to create our own library to satisfy our particular specifications.

## Requirements

1. **No active connection.** Communication should be made through basic HTTP connection without Keep-Alive. We must establish the communication channel each time to avoid having to manage connection state, reconnects, etc.
2. **Heartbeat with payload and admin response** Agents must send a frequent heartbeat in order to indicate that they are still alive. The heartbeat may contain a payload containing details status information for the agent. The heartbeat response might contain administrative commands that are related to the communication itself and not application specific. For example, an admin-command might instruct the agent to send heartbeat to a different URL starting from now.
3. **Command/Response pattern** The protocol must provide a way for an agent to send a response to a specific command. This bi-directional communication is critical to the usefulness of the protocol.
4. **Event Pattern** An agent might subscribe to a number of network events that will be broadcasted by the central process. Events are the way agents may communicate between themselves to understand the overall network condition or to react to specific events.
5. **JSON based** The protocol should transport JSON payloads.

