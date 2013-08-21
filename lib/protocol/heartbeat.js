(function(){
    var Q = require('q'),
        redis = require('redis'),
        _ = require('underscore'),
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
                    _this.log.trace(arguments, "Agent %s state", request.id);

                    if(state !== 'CONNECTED') {
                        _this.log.info("Agent %s has been detected has connected", request.id);
                        _this.db.hset(request.id, 'status', 'CONNECTED');

                        _this.emit('agent-connected', {
                            id: request.id,
                            ts: moment().utc().unix()
                        });
                    }
                    else {
                        _this.log.debug("Agent %s was already connected.", request.id);

                        // Check if we have a watchdog... we may not have one if we were the one being down
                        _this.db.hget(request.id, 'heartbeat-interval', function(err, interval) {
                            _this.log.trace("Detected heartbeat interval: %s", interval);

                            _this.ensureWatchDog({
                                id:request.id,
                                interval:interval || 30
                            });

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
    }

})();
