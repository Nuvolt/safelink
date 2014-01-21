- Integrate web socket. We must try to use the web socket first and fall back to the standard http mechanism if not available. Web socket state must be check at each heartbeat.
- Add an ordered accumulator to support different guarantee of delivery for command and events. At the moment, server generated events are nearly guaranteed to be delivered while agent
driven ones aren't. This could be used also for mobile synchronization.

