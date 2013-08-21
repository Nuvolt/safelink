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
        this.log.trace(request, "Handling retrieve-pending-commands");
        var defer = Q.defer();
        Q.nextTick(function() {
            var commands = [];

            async.forEach(_this.listPendingCommands(request.id), function(cmd, callback) {
                _this.db.multi()
                    .hget(cmd.id, "key")
                    .hget(cmd.id, "payload")
                    .exec(function(err, results) {
                        commands.push({
                            id:cmd.id,
                            key:results[0],
                            payload: results[1],
                            ts:cmd.ts
                        });
                        cmd.status = 'ACTIVE';
                        callback();
                    });
            }, function(err) {
                if(err) defer.reject(err);
                else{
                    _this.log.trace("Agent %s will receive %d commands to execute", request.id, commands.length);
                    defer.resolve(commands);
                }
            });

        });
        return defer.promise;
    }

})();
