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
    this.log.trace(request, "Handling broadcast command");
    var defer = Q.defer();
    Q.nextTick(function() {

        //TODO: Add channel support

        // Just emit this custom event to all our listeners, including custom event listeners registered through
        // subscriptions. These events will eventually arrive at their destination as agent retrieve their events from the queue.
        _this.emit(request.event, _.extend(request.payload, { _replyTo: request.id}));

        defer.resolve({success:true});
    });

    return defer.promise;
};
