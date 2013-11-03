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
    moment = require('moment'),
    _ = require('lodash');

module.exports = function(request) {
    var _this = this;
    var defer = Q.defer();

    Q.nextTick(_.bind(function() {
        this.log.info(request, "Received disconnection request for agent %s", request.id);

        // Create a new structure for this agent
        this.db.del(request.id);
        _this.stopAgentWatchDog(request.id);
        _this.emit('agent-disconnected', request.id);
        defer.resolve();

    }, this));

    return defer.promise;
}
