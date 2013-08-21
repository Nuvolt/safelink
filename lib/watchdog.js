(function() {
    var moment = require('moment');

    WatchDog = (function(){

        function WatchDog(agent, dispatcher) {
            var _this = this;

            var interval = agent.interval || 30;

            dispatcher.log.debug("Installing agent %s watchdog at an interval of %d seconds", agent.id, interval * 2);

            this.watchDogInterval = setInterval(function(){
                dispatcher.log.debug("Executing watchdog check for agent ", agent.id);

                dispatcher.db.multi()
                    .hget(agent.id, "lastHeartbeatTs")
                    .hget(agent.id, "status")
                    .exec(function(err, results) {
                        dispatcher.log.trace(results, "Agent %s current state", agent.id);

                        try {
                            var delta = moment().utc().unix() - moment(parseInt(results[0]) * 1000).utc().unix() + 5;
                        }
                        catch(err) {
                            delta = 0;
                        }

                        dispatcher.log.debug("%d seconds since last heartbeat for agent %s", delta, agent.id);

                        // If we haven't received a heartbeat for twice the time, it means our agent is probably dead...
                        if(delta > interval * 2 ) {
                            dispatcher.db.hset(agent.id, "status", "DISCONNECTED");

                            if(results[1] === 'CONNECTED') {
                                dispatcher.log.warn("Watchdog Report: Agent %s is disconnected. Last heartbeat we received was %d", agent.id, results[0]);
                                dispatcher.emit('agent-disconnected', {id:agent.id, lastHeartbeatTs: results[0]});
                            }

                            // Close this watch dog, another one will be created when the agent is reconnected
                            dispatcher.log.info("Removing watchdog for agent %s", agent.id);
                            clearInterval(_this.watchDogInterval);
                        }
                        else {
                            dispatcher.log.debug("Watchdog Report: Agent %s is still connected", agent.id);
                        }
                    });


            }, interval * 2000);
        }

        return WatchDog;
    })();

    module.exports = WatchDog;
})();
