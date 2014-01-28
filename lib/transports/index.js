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

var log = bunyan.createLogger({name:'transport', level: 'debug'});
var messages = {};
var ws = new WebSocket(log);
var polling = new HttpPolling(log);

// clean up timer

module.exports = {

    Transports:{
        WebSocket: ws,
        HttpPolling: polling
    },
    send: function(sender, key, payload, options) {
        var defer = Q.defer();

        // Handle variable arguments
        options = options || {};
        if(arguments.length == 1) {
            payload = {};
        }

        // Allocate a unique id for this command
        var uuid = shortid.generate();

        messages[uuid] = {
            defer:defer,
            key: key,
            sts: new Date().getTime(),
            ttl: options.ttl * 1000 || 60000
        };

        if(ws.isAvailable()) {
            log.debug("Sending command %s(%s) using WS transport", key, uuid, {payload:payload});

            // Try to send the message using the web socket
            ws.send(sender, uuid, key, payload, options).then(function(result) {
                log.debug("Resolving message %s(%s) with result", key, uuid, result);
                defer.resolve(result);
            }, function() {
                log.debug("Falling back to polling transport for command %s(%s)", key, uuid,{payload:payload});
                polling.send(sender, uuid, key, payload, options).then(function(result){
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
            log.debug("Sending command %s(%s) using polling transport", key, uuid, {payload:payload});
            polling.send(sender, uuid, key, payload, options).then(function(result) {
                defer.resolve(result);
            }, function(err){
                defer.reject(err);
            }, function(progress){
                defer.notify(progress);
            });
        }

        // Indicate when this command was resolved for garbage collection
        defer.promise.done(function() {
            messages[uuid].rts = new Date().getTime();
            log.trace("message %s(%s) has been marked with rts", messages[uuid].rts);
        });

        return defer.promise;
    },
    getResult: function(uuid) {
        return messages[uuid];
    },
    clearResult: function(uuid){
        delete messages[uuid];
    }

};
