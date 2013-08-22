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
        redis = require('redis'),
        _ = require('underscore'),
        async = require('async'),
        moment = require('moment');

    module.exports = function(request) {
        var _this = this;
        this.log.trace(request, "Handling retrieve-pending-events");
        var defer = Q.defer();
        Q.nextTick(function() {
            var events = [], event = "DUMMY";

            // Asynchronously loop through all available events, removing them from our queue
            async.whilst(
                function() { return event !== null; },
                function(callback) {
                    _this.db.lpop(request.id+"_events", function(err, e) {
                        if(err) callback(err);
                        else {
                            if(e) {
                                _this.log.trace(e, "Event found in queue");
                                var parsedEvent = JSON.parse(e);
                                events.push(parsedEvent);
                            }
                            else
                                _this.log.trace("No more events for agent %s", request.id);

                            event = e;
                            callback();
                        }
                    });
                },
                function(err) {
                    if(err) defer.reject(err);
                    else {
                        _this.log.trace("Agent %s will receive %d events to handle", request.id, events.length);
                        defer.resolve(events);
                    }
                }
            );

        });

        return defer.promise;
    }

})();
