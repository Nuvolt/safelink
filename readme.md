# SafeLink [![Bitdeli Badge](https://d2weczhvl823v0.cloudfront.net/jgrenon/safelink/trend.png)](https://bitdeli.com/free "Bitdeli Badge")

SafeLink is an open-source NodeJS library created to maintain long-term communication between distant remote sites with varying network quality. After deploying many different solutions for one
of our customers, without much success, we decided to create our own library to satisfy our particular specifications.

## Requirements

1. **No active connection.** Communication should be made through basic HTTP connection without Keep-Alive. We must establish the communication channel each time to avoid having to manage connection state, reconnects, etc.
2. **Heartbeat with payload and admin response** Agents must send a frequent heartbeat in order to indicate that they are still alive. The heartbeat may contain a payload containing details status information for the agent. The heartbeat response might contain administrative commands that are related to the communication itself and not application specific. For example, an admin-command might instruct the agent to send heartbeat to a different URL starting from now.
3. **Command/Response pattern** The protocol must provide a way for an agent to send a response to a specific command. This bi-directional communication is critical to the usefulness of the protocol.
4. **Event Pattern** An agent might subscribe to a number of network events that will be broadcast by the central process. Events are the way agents may communicate between themselves to understand the overall network condition or to react to specific events.
5. **JSON based** The protocol should transport JSON payloads.

## Version History

- 0.3.0 : Add support for agent-connected event from the dispatcher. This will help host add logic on agent connection


## Getting Started

### Installation

You install Safelink in your project using NPM

    npm install safelink --save

### Setting up a dispatcher

#### Basic HTTP server

SafeLink dispatcher is the server side component that is responsible for mamaging agent communication links. All communication messages are transported through HTTP and the simplest way to use Safelink is to instantiate the dispatcher and start listening on a given port (default to 9090). 

	var Dispatcher = require('safelink').Dispatcher;

    var dispatcher = new Dispatcher({
        port:9090
    });

    dispatcher.listen().then(function() {
        dispatcher.log.info("Listening for incoming agent connections");
    }, function(err) {
    	displatcher.log.error(err, "General communication error");
    });

Everywhere in the library, we use *promises* from the Q library. The promise abstraction is better than simple callbacks, even more for remoting software where responses may or may not be available directly (or cached). The power of Q promises is that it will return the result if the promise has already been fulfilled, thus freeing the client from knowing the actual state of the request. 





