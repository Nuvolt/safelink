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
(function(){
    var Q = require('q'),
        moment = require('moment'),
        _ = require('underscore');

    module.exports = function(request) {
        var _this = this;
        var defer = Q.defer();

        Q.nextTick(_.bind(function() {
            this.log.info(request, "Received connection request for agent %s", request.id);

            // Create a new structure for this agent
            this.db.multi()
                .hset(request.id, "connectedTs", moment().utc().unix())
                .hset(request.id, "lastHeartbeatTs", moment().utc().unix())
                .hset(request.id, "version", request.version)
                .hset(request.id, "heartbeat-interval", request.interval)
                .exec(function(err) {
                    if(err) defer.reject(err);
                    else {
                        _this.ensureWatchDog(request).then(function(watchdog) {

                            // Force the execution of a configure command on the agent
                            _this.executeOnAgent(request.id, 'configure', {restart: false});
                            defer.resolve({success:true});

                        }, function(err){
                            _this.log.warn("Unable to install watchdog for agent %s. Error = ", request.id, err);
                            defer.reject({success:false, error:err});
                        });
                    }
                });

        }, this));

        return defer.promise;
    }

})();
