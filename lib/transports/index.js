/**
 * Safelink transport layer.
 *
 * Responsible for selecting the best transport available and falling back to polling if required.
 */

var WebSocket = require('./websocket'),
    shortid = require('shortid'),
    Q = require('q'),
    bunyan = require('bunyan'),
    HttpPolling = require('./polling');

module.exports = (function() {

    function Layer(opts) {
        opts = opts || {};
        this.log = opts.log || bunyan.createLogger({name: opts.logName || 'transport', level: opts.logLevel || 'info'});
        this.messages = {};
        this.ws = new WebSocket(this, this.log);
        this.polling = new HttpPolling(this, this.log);

        //TODO: clean up timer
    }

    Layer.prototype.send = function(sender, key, payload, options) {
        var defer = Q.defer(), _this = this;

        // Handle variable arguments
        options = options || {};
        if(arguments.length === 1) {
            payload = {};
        }

        // Allocate a unique id for this command
        var uuid = shortid.generate();

        this.messages[uuid] = {
            defer:defer,
            key: key,
            sts: new Date().getTime(),
            ttl: options.ttl * 1000 || 60000
        };

        if(this.ws.isAvailable()) {
            this.log.debug("Sending command %s(%s) using WS transport", key, uuid, {payload:payload});

            // Try to send the message using the web socket
            this.ws.send(sender, uuid, key, payload, options).then(function(result) {
                _this.log.debug("Resolving message %s(%s) with result", key, uuid, result);
                defer.resolve(result);
            }, function() {
                _this.log.debug("Falling back to polling transport for command %s(%s)", key, uuid,{payload:payload});
                _this.polling.send(sender, uuid, key, payload, options).then(function(result){
                    defer.resolve(result);
                }, function(err) {
                    defer.reject(err);
                }, function(progress) {
                    defer.notify(progress);
                });
            }, function(progress) {
                defer.notify(progress);
            });

        }
        else {
            _this.log.debug("Sending command %s(%s) using polling transport", key, uuid, {payload:payload});
            this.polling.send(sender, uuid, key, payload, options).then(function(result) {
                defer.resolve(result);
            }, function(err){
                defer.reject(err);
            }, function(progress){
                defer.notify(progress);
            });
        }

        // Indicate when this command was resolved for garbage collection
        defer.promise.done(function() {
            _this.messages[uuid].rts = new Date().getTime();
            _this.log.trace("message %s(%s) has been marked with rts", _this.messages[uuid].key, uuid, _this.messages[uuid].rts);
        });

        return defer.promise;
    };


    Layer.prototype.getResult = function(uuid) {
        return this.messages[uuid];
    };


    Layer.prototype.clearResult = function(uuid){
        delete this.messages[uuid];
    };

    return Layer;

})();
