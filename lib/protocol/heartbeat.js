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
var Q = require('q'),
    redis = require('redis'),
    _ = require('lodash'),
    moment = require('moment');

module.exports = function(request) {
    var _this = this;

    this.log.debug(request, "Handling heartbeat");
    var defer = Q.defer();

    Q.nextTick(_.bind(function() {
        this.db.hset(request.id, "lastHeartbeatTs", moment().utc().unix());
        this.db.hget(request.id, "status", function(err, state) {
            if(err) defer.reject(err);
            else {
                _this.log.trace(arguments, "Agent  %s state", request.id);

                if(state !== 'CONNECTED') {
                    _this.log.info("Agent %s has been detected has connected", request.id);
                    _this.db.hset(request.id, 'status', 'CONNECTED');

                    _this.emit('agent-connected', {
                        id: request.id,
                        ts: moment().utc().unix(),
                        agent: request,
                        meta: request.meta
                    });
                }
                else {
                    _this.log.debug("Agent %s was already connected.", request.id);

                    // Check if we have a watchdog... we may not have one if we were the one being down
                    _this.db.hget(request.id, 'heartbeat-interval', function(err, interval) {
                        _this.log.trace("Detected heartbeat interval: %s", interval);

                        if(!_this.hasWatchDog(request.id)) {

                            _this.ensureWatchDog({
                                id:request.id,
                                interval:interval || 30
                            });

                            // Force the execution of a configure command on the agent
                            _this.executeOnAgent(request.id, 'configure', {restart: true});
                        }

                    });
                }

                // Do we have a payload, ask for advise on how to handle this extra infos
                if(request.payload) {
                    _this.log.debug("A payload was supplied by agent %s, asking for help from our host", request.id);
                    _this.emit('heartbeat-payload', request, request.payload);
                }

                defer.resolve();
            }

        });

    }, this));

    return defer.promise;
};
