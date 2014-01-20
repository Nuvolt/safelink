/**
 *
 * Copyright 2013 Joel Grenon
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function() {
    var moment = require('moment');

    WatchDog = (function(){

        /**
         * @class WatchDog
         * @protected
         * @description Each instance is responsible for monitoring the state of a single agent. If we don't receive heartbeat at regular intervals,
         * the watchdog will emit an agent-disconnected event to reset the agent communication.
         * @param agent {Object} An agent object (with id) to watch
         * @param dispatcher {Object} The dispatcher hosting this watchdog
         * @constructor
         */
        function WatchDog(agent, dispatcher) {
            var _this = this;

            var interval = agent.interval || 30;

            this.agent = agent;

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
