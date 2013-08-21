(function(){
    var Q = require('q'),
        redis = require('redis'),
        _ = require('underscore'),
        async = require('async'),
        moment = require('moment');

    module.exports = function(request) {
        var _this = this;
        this.log.debug(request, "Handling command-error command");
        var defer = Q.defer();
        Q.nextTick(function() {
            _this.applyCommandError(request.commandId, {type:request.type, error:request.error}).then(defer);
        });
        return defer.promise;
    }

})();
