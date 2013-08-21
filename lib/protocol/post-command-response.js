(function(){
    var Q = require('q'),
        redis = require('redis'),
        _ = require('underscore'),
        async = require('async'),
        moment = require('moment');

    module.exports = function(request) {
        var _this = this;
        this.log.debug(request, "Handling post-command-response command");
        var defer = Q.defer();
        Q.nextTick(function() {
            _this.applyCommandResponse(request.commandId, request.result).then(function(result) {
                defer.resolve(result);
            }, function(err){
                defer.reject(err);
            });
        });
        return defer.promise;
    }

})();
