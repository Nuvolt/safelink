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

    require('underscore-query');

    module.exports = function(request) {
        var _this = this;
        this.log.trace(request, "Handling subscribe command");
        var defer = Q.defer();
        Q.nextTick(function() {
            _this.log.info("Subscribing agent %s to event %s", request.id, request.event);

            // Look for an existing subscription for this agent
            var subscription = _.query.build( _this.eventSubscriptions ).and({"agentId":request.id}).first();
            if(!subscription) {
                subscription = new EventSubscription(_this, request.id);
                _this.eventSubscriptions.push(subscription);
            }

            // Add a local handler to propagate these events to this subscription
            if(! _.contains(subscription.events, request.event)) {
                _this.on(request.event, subscription.listener(request));
                subscription.events.push(request.event);
                _this.log.debug("Subscription to event %s was successfully established for agent %s", request.event, request.id);
            }
            else
                _this.log.warn("Subscription to event %s is already in place. It will be reused", request.event);

            defer.resolve({success:true});
        });

        return defer.promise;
    };

    /**
     * Abstract an agent subscription for various custom events. Each event will be broadcast to the agent
     * as they are received by the dispatcher through the standard emit method.
     *
     * @param dispatcher
     * @param spec
     * @constructor
     */
    var EventSubscription = function(dispatcher, agentId) {
        this.events = [];
        this.agentId = agentId;

        this.listener = function(s) {
            return function(e) {
                // Append this event to our event list
                dispatcher.emitTo(s.id, s.event, e);
            };
        };

    };

})();
