- Refactor connection. We should not perform a specific connection action. Only heartbeat should be used to establish connections. This way, if the heartbeat is suspended for
a certain period of time, the connection will automatically be restored. The problem we have at the moment is that configure is not emitted if there is a middle network problem.
- Integrate web socket. We must try to use the web socket first and fall back to the standard http mechanism if not available. Web socket state must be check at each heartbeat.
- Add an ordered accumulator to support different guarantee of delivery for command and events. At the moment, server generated events are nearly guaranteed to be delivered while agent
driven ones aren't. This could be used also for mobile synchronization.

