(function(){
    var Q = require('q'),
        moment = require('moment'),
        _ = require('underscore');

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

})();
