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
                            defer.resolve();
                        }, function(err){
                            _this.log.warn("Unable to install watchdog for agent %s. Error = ", request.id, err);
                            defer.reject(err);
                        });
                    }
                });

        }, this));

        return defer.promise;
    }

})();
