(function(){
    var Q = require('q'),
        redis = require('redis'),
        _ = require('underscore'),
        async = require('async'),
        moment = require('moment');

    require('underscore-query');

    module.exports = function(request) {
        var _this = this;
        this.log.trace(request, "Handling unsubscribe command");
        var defer = Q.defer();
        Q.nextTick(function() {

            // Look for an existing subscription for this agent
            var subscription = _.query.build( _this.eventSubscriptions ).and({"agentId":request.id}).first();
            if(subscription) {
                // Remove the specified local listener for this event
                _this.removeListener(request.event, subscription.listener);

                subscription.events.remove(request.event);
                if(subscription.events.length === 0)
                    _this.eventSubscriptions.remove(subscription);

                _this.log.info("Agent successfully unsubscribed from event %d", request.event);
            }
            else
                _this.log.warn("Tried to unsubscribe a missing subscription. Nothing was done");

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
    EventSubscription = function(dispatcher, spec) {

        this.listener = function(e) {
            // Append this event to our event list
            dispatcher.db.rpush(spec.id+"_events", JSON.stringify(e));
        };

    };

})();
