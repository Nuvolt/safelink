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
                                events.push(JSON.parse(e));
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
