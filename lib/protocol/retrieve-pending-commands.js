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
