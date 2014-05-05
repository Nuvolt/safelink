var request = require('request'),
    _ = require('lodash'),
    Q = require('q');

module.exports = (function() {

    function Transport(layer, log) {
        this.log = log.child({transport:'polling'});
        this.layer = layer;
    }

    Transport.prototype.isAvailable = function() {
        return true;
    };

    Transport.prototype.send = function(sender, uuid, key, payload, options) {
        var defer = Q.defer(), _this = this;

        this.log.debug("Sending message %s(%s) with timeout %d", key, uuid, (options.timeout || sender.timeout) * 1000 );

        request({
            url: sender.url,
            method:'POST',
            body: _.extend(payload || {}, {uuid: uuid, key:key, v: sender.version, id: sender.id}),
            json:true,
            pool:false,
            timeout:(options.timeout || sender.timeout) * 1000
        }, function(err, resp, body) {

            if(err || resp.statusCode >= 400)   {
                _this.log.error("Error received from server for request, but no callback was provided. %s", err, JSON.stringify({url:sender.url, method:'POST', body:_.extend(payload || {}, {key:key, v: sender.version, id: sender.id}) }));
                defer.reject({status:resp.statusCode, error:err});
            }
            else {
                defer.resolve(body);
            }
        });

        return defer.promise;
    };

    return Transport;
})();
