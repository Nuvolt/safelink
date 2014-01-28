var WebSocket = require('ws'),
    JSON = require('json3'),
    _ = require('lodash'),
    Q = require('q');

module.exports = (function() {

    function Transport(layer, log) {
        this.log = log;
        this.layer = layer;
    }

    Transport.prototype.init = function(opts) {
        var _this = this;
        this.log.info("Initializing web socket transport");
        this.ws = new WebSocket(opts.dispatcher);

        this.ws.on('open', function() {
            _this.log.debug("WS dispatcher link was successfully established");
            _this.wsopen = true;
        });

        this.ws.on('close', function() {
            _this.log.warn("WebSocket connection has been closed");
            _this.wsopen = false;

            //TODO: Try to reconnect
        });

        this.ws.on('message', function(msg) {
            _this.log.debug("WS message received", msg);
            var content = JSON.parse(msg);
            var cmd = _this.layer.getResult(content.uuid);
            if(cmd) {
                if(content.key === 'message-response') {
                    _this.log.debug("Received response for message %s(%s)", cmd.key, content.uuid);
                    cmd.defer.resolve(content);
                }
                else if(content.key === 'message-error') {
                    _this.log.warn("Received error for message %s(%s)", cmd.key, content.uuid, content.error);
                    cmd.defer.reject(content.error);
                }
                else {
                    _this.log.warn("Received an unsupported response for message %s(%s)", cmd.key, content.uuid, {content:content});
                    cmd.defer.reject({msg:'unknown response from dispatcher', error: content.error});
                }
            }
            else {
                _this.log.error("Unknown message %s(%s). Response will not be processed", content.key, content.uuid, {content: content});
            }

        });

    };

    Transport.prototype.isAvailable = function() {
        return this.wsopen;
    };

    Transport.prototype.send = function(sender, uuid, key, payload, options) {
        var defer = Q.defer();

        var data = _.extend(payload || {}, {
            id: sender.id,
            uuid: uuid,
            key: key,
            v: sender.version
        });

        this.ws.send(JSON.stringify(data), function(err) {
            // Quick failing to use the http fallback.
            if(err)
                defer.reject(err);
            //NOTE: We don't resolve, we wait for the result or timeout
        });

        return defer.promise;
    };

    return Transport;
})();
